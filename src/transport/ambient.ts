/**
 * 群聊旁听与主动发言 — 未 @ 消息的中间件终点
 *
 * 这条链路只处理「机器人能收到、但没有 @ 机器人」的群消息：
 *
 *   旁听消息 → 记长期记忆 → 进入候选批次（debounce）
 *            → 概率/冷却/配额（features/proactive.ts）
 *            → 模型判断「现在插话会不会打断别人」（features/proactive-judge.ts）
 *            → 以「【旁听】…」的形式 followup 给会话，模型可选择输出 [SILENT]
 *
 * 为什么单独成文件：
 * - `transport/inbound.ts` 负责「把一条消息组装成 agentBody」，与主动发言无关；
 * - 主动发言需要在 SDK mentionGate **之前**执行（mentionGate 命中未 @ 会直接
 *   stop 整条链），因此它不是一个普通的入站处理器，而是中间件链上的特殊环节。
 *
 * 纯策略（候选过滤、频率、概率）在 `features/proactive.ts`，本文件只负责
 * 计时、上下文与模型调用。
 */
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { SessionManager } from '../session/index.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { ChatScope, Logger, ReplyTarget } from '../types.ts';
import { buildIdentityPrefix } from '../identity/role.ts';
import { shortSenderId } from '../shared/utils.ts';
import {
  createProactiveState,
  isProactiveCandidate,
  noteActivity,
  noteSpoke,
  registerAmbient,
  shouldSpeak,
  type ProactiveState,
} from '../features/proactive.ts';

/** 旁听处理只需要消息的最小字段，避免与 inbound 的完整组装类型耦合 */
interface AmbientMessage {
  rawEventType?: string;
  kind: 'c2c' | 'group';
  senderId: string;
  senderName?: string;
  content?: string;
  messageId: string;
  groupOpenid?: string;
  mentions?: Array<{ is_you?: boolean }>;
  replyTarget?: ReplyTarget;
}

/** 旁听处理只读取引用关系，不消费正文 */
interface AmbientState {
  quote?: { entry?: { senderId?: string } };
}

interface ProactiveBatchItem {
  senderId: string;
  senderName?: string;
  content: string;
  at: number;
}

/** 每个群一份旁听状态：冷却、配额、正在等待的批次、最近上下文 */
interface ProactiveRuntime {
  state: ProactiveState;
  /** 最近一段群聊（内存里保留最近 12 条），给模型判断是不是两人对话 */
  recent: ProactiveBatchItem[];
  pending?: {
    timer: ReturnType<typeof setTimeout>;
    messages: ProactiveBatchItem[];
    replyTarget: ReplyTarget;
    senderId: string;
  };
}

const proactiveRuntimes = new WeakMap<SessionManager, Map<string, ProactiveRuntime>>();

/**
 * 群聊是否真的 @ 了机器人。
 *
 * 中间件链里已有 mentionGate，这里再判一次作为硬门控：官方与 OneBot 的字段
 * 不完全一致（rawEventType / mentions / 正文 @id），配置或 SDK 升级漏掉判定时
 * 也不能让未 @ 的群消息进模型。历史与人格档案在更早的中间件里已记录，不受影响。
 */
export function isGroupAddressed(msg: AmbientMessage, config: ImQQBotConfig): boolean {
  if (msg.rawEventType === 'GROUP_AT_MESSAGE_CREATE') return true;
  if (Array.isArray(msg.mentions) && msg.mentions.some((mention) => mention?.is_you === true)) return true;
  const selfId = config.onebot?.selfId?.trim() ?? '';
  return selfId !== '' && (msg.content ?? '').includes(`@${selfId}`);
}

/**
 * 处理「没有 @ 机器人」的群消息：只记记忆，并按概率决定是否主动接话。
 *
 * 这个函数会被放在 SDK mentionGate **之前** 调用。因为 mentionGate 命中
 * 未 @ 时会直接 stop 整条链，导致后面的 handleInbound 根本收不到旁听消息。
 * 返回 true 表示已消费该消息，调用方应停止后续中间件（不进入命令/回复流程）。
 */
export function handleAmbientGroupMessage(
  ctx: MiddlewareContext,
  manager: SessionManager,
  config: ImQQBotConfig,
  logger: Logger,
): boolean {
  const msg = ctx.message as unknown as AmbientMessage;
  const scope: ChatScope = msg.kind === 'group' ? 'group' : 'c2c';
  if (scope !== 'group' || !config.requireMention || isGroupAddressed(msg, config)) return false;

  const peerId = msg.groupOpenid ?? msg.senderId;
  const replyChannel = (ctx.replyTarget as unknown as { channel?: ReplyTarget['channel'] })?.channel
    ?? msg.replyTarget?.channel;
  const replyTarget: ReplyTarget = {
    scope,
    targetId: peerId,
    msgId: msg.messageId,
    ...(replyChannel !== undefined ? { channel: replyChannel } : {}),
  };

  manager.recordInteraction(
    scope,
    peerId,
    msg.senderId,
    msg.senderName,
    msg.content ?? '',
    replyChannel,
  );
  considerProactive({
    manager,
    config,
    logger,
    msg,
    state: ctx.state as unknown as AmbientState,
    replyTarget,
  });
  logger.debug(`skip group message without @: sender=${msg.senderId} group=${peerId}`);
  return true;
}

/**
 * 旁听消息进入候选批次。
 *
 * 只做「值不值得考虑」和「什么时候考虑」：真正的随机概率、冷却、配额在
 * 批次计时结束时判断，避免一串碎片消息被逐条计算成多次机会。
 */
function considerProactive(args: {
  manager: SessionManager;
  config: ImQQBotConfig;
  logger: Logger;
  msg: AmbientMessage;
  state: AmbientState;
  replyTarget: ReplyTarget;
}): void {
  const { manager, config, logger, msg, state, replyTarget } = args;
  const cfg = config.proactive;
  if (cfg?.enabled !== true) return;

  const channel = replyTarget.channel ?? 'official';
  if (!cfg.channels.includes(channel)) return;

  const content = (msg.content ?? '').trim();
  const key = `${channel}:${replyTarget.targetId}`;
  const runtime = proactiveRuntime(manager, key);
  const now = Date.now();
  registerAmbient(runtime.state, now);

  // 先记入最近上下文（哪怕这条不适合接，也能帮模型判断是不是两人在聊）
  const item: ProactiveBatchItem = {
    senderId: msg.senderId,
    ...(msg.senderName !== undefined ? { senderName: msg.senderName } : {}),
    content,
    at: now,
  };
  runtime.recent.push(item);
  if (runtime.recent.length > 12) runtime.recent.shift();

  if (!isProactiveCandidate(content, cfg)) return;
  // @ 了别人 / 在回复别人：不插嘴
  if (Array.isArray(msg.mentions) && msg.mentions.length > 0) return;
  if (state.quote?.entry?.senderId !== undefined) return;
  const selfId = config.onebot?.selfId?.trim() ?? '';
  if (selfId !== '' && msg.senderId === selfId) return;

  if (runtime.pending !== undefined) {
    runtime.pending.messages.push(item);
    if (runtime.pending.messages.length > 6) runtime.pending.messages.shift();
    return;
  }

  const timer = setTimeout(() => {
    const pending = runtime.pending;
    runtime.pending = undefined;
    if (pending === undefined) return;
    if (!shouldSpeak(runtime.state, cfg, Date.now())) return;
    noteSpoke(runtime.state, Date.now());
    const recent = [...runtime.recent];
    void runProactiveTurn(manager, config, logger, pending, recent).catch((err) => {
      logger.warn(`proactive turn failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }, Math.max(0, Math.trunc(cfg.debounceMs)));
  (timer as { unref?: () => void }).unref?.();

  runtime.pending = {
    timer,
    messages: [item],
    replyTarget,
    senderId: msg.senderId,
  };
}

/** 正常 @ 回复后：重置冷却，并取消尚未触发的旁听批次，避免刚回完又插一句 */
export function noteProactiveActivity(
  manager: SessionManager,
  config: ImQQBotConfig,
  peerId: string,
  channel?: ReplyTarget['channel'],
): void {
  const cfg = config.proactive;
  if (cfg?.enabled !== true) return;
  const ch = channel ?? 'official';
  if (!cfg.channels.includes(ch)) return;
  const runtime = proactiveRuntime(manager, `${ch}:${peerId}`);
  noteActivity(runtime.state, Date.now());
  if (runtime.pending !== undefined) {
    clearTimeout(runtime.pending.timer);
    runtime.pending = undefined;
  }
}

async function runProactiveTurn(
  manager: SessionManager,
  config: ImQQBotConfig,
  logger: Logger,
  pending: NonNullable<ProactiveRuntime['pending']>,
  recent: readonly ProactiveBatchItem[],
): Promise<void> {
  const latest = pending.messages[pending.messages.length - 1];
  if (latest === undefined) return;

  // 先让模型判断「现在插话会不会打断别人」：两人对话/话题封闭时保持沉默
  const allowed = await manager.judgeProactive(
    { recent, batch: pending.messages },
    'group',
    pending.replyTarget.targetId,
  );
  if (!allowed) {
    logger.info(`proactive judge: stay silent group=${pending.replyTarget.targetId}`);
    return;
  }

  const record = await manager.getOrCreate(
    'group',
    pending.replyTarget.targetId,
    pending.senderId,
    pending.replyTarget,
  );
  record.lastUserText = latest.content;
  delete record.voiceRequested;
  delete record.voiceInstruction;
  delete record.stickerDescTokens;

  const lines = pending.messages.map((item) => {
    const identity = buildIdentityPrefix(item.senderId, config.identity);
    const name = item.senderName ?? shortSenderId(item.senderId);
    return `${identity}${name}: ${item.content}`;
  });
  const body = [
    '【旁听】群里的对话（没有人叫你，你可以选择接一句，也可以不接）：',
    ...(lines),
    '',
    '想接：像平时在群里插话一样，1-2 句；不要总结、不要回答所有人、不要客服腔。',
    '如果看出来主要是两个人在互相聊，就别接。',
    '不想接：只输出 [SILENT]，不要输出任何别的字。',
  ].join('\n');

  const message = createUserMessage({
    content: [{ type: 'text' as const, text: body }],
    source: { kind: 'user' as const },
  });
  record.agent.followup(message);
  logger.info(`proactive → followup: group=${pending.replyTarget.targetId}`);
  await record.agent.whenIdle();
}

function proactiveRuntime(manager: SessionManager, key: string, now = Date.now()): ProactiveRuntime {
  let byGroup = proactiveRuntimes.get(manager);
  if (byGroup === undefined) {
    byGroup = new Map();
    proactiveRuntimes.set(manager, byGroup);
  }
  let runtime = byGroup.get(key);
  if (runtime === undefined) {
    runtime = { state: createProactiveState(now), recent: [] };
    byGroup.set(key, runtime);
  }
  return runtime;
}
