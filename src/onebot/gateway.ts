/**
 * OneBot 传输层装配
 *
 * 复用官方 SDK 的整条中间件链（buildMiddlewares）与 handleInbound：
 * 差异只在事件来源（WS）与 bot 门面（OneBotBot），业务能力完全一致。
 */
import type { QQBot, QQBotInboundMessage, Middleware, MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import { runMiddlewareChain } from '@tencent-connect/qqbot-nodejs';
import type { SessionManager } from '../session/index.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import type { GatewayTransport } from '../gateway/transport.ts';
import { buildMiddlewares } from '../gateway/middleware-setup.ts';
import { handleInbound } from '../transport/inbound.ts';
import type { ArchiveRuntime } from '../gateway/archive-runtime.ts';
import { OneBotClient } from './client.ts';
import { OneBotBot } from './sender.ts';
import { buildInboundMessage, type OneBotInboundMessage } from './message.ts';
import { handlePokeSignal } from '../transport/poke.ts';
import type { OneBotEvent, OneBotMessageDetail, OneBotMessageEvent } from './types.ts';

/** 同一会话内两次自动回戳的最小间隔，避免互戳刷屏 */
const POKE_BACK_COOLDOWN_MS = 10_000;

export interface OneBotTransportDeps {
  config: ImQQBotConfig;
  manager: SessionManager;
  logger: Logger;
  archive: ArchiveRuntime;
}

/** 构造与 SDK createMiddlewareContext 等价的上下文（SDK 未导出该工厂） */
function createContext(
  bot: OneBotBot,
  message: OneBotInboundMessage,
  log: Logger,
): MiddlewareContext {
  const receivedAt = Date.now();
  let stopped = false;
  let stopReason: string | undefined;
  const controller = new AbortController();

  const ctx = {
    bot: bot as unknown as QQBot,
    message: message as unknown as QQBotInboundMessage,
    replyTarget: message.replyTarget,
    state: {},
    log,
    stop(reason?: string): void {
      stopped = true;
      stopReason = reason;
    },
    get stopped(): boolean {
      return stopped;
    },
    get stopReason(): string | undefined {
      return stopReason;
    },
    get signal(): AbortSignal {
      return controller.signal;
    },
    abort(reason?: string): void {
      controller.abort(reason);
      stopped = true;
      stopReason = reason ?? 'aborted';
    },
    get aborted(): boolean {
      return controller.signal.aborted;
    },
    receivedAt,
  };

  return ctx as unknown as MiddlewareContext;
}

/** 创建 OneBot 传输层（未连接，start() 时才建立 WS） */
export function createOneBotTransport(deps: OneBotTransportDeps): GatewayTransport {
  const { config, manager, logger, archive } = deps;

  let selfId = config.onebot.selfId.trim();
  let middlewares: Middleware[] = [];

  const client: OneBotClient = new OneBotClient({
    httpUrl: config.onebot.httpUrl,
    wsUrl: config.onebot.wsUrl,
    accessToken: config.onebot.accessToken,
    logger,
    onEvent: (event) => {
      // 事件处理内部已兜错；这里再 catch 一次避免未处理 rejection
      void handleEvent(event).catch((err: unknown) => {
        logger.error(`OneBot 事件处理异常: ${err instanceof Error ? err.message : String(err)}`);
      });
    },
  });

  const bot = new OneBotBot({
    client,
    logger,
    appId: config.appId,
  });

  // 中间件链只构建一次（与 official 完全相同的顺序）
  middlewares = buildMiddlewares({
    config,
    manager,
    logger,
    ...(archive.archive !== undefined ? { personaArchive: archive.archive } : {}),
    allowInsecureMedia: true,
  });

  /** 解析引用消息（get_msg），失败返回 undefined 由上层降级 */
  async function getMessage(messageId: string): Promise<OneBotMessageDetail | undefined> {
    try {
      return await client.call<OneBotMessageDetail>('get_msg', { message_id: messageId });
    } catch (err) {
      logger.debug(`OneBot get_msg 失败 id=${messageId}: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  /** 每个会话最近一次自动回戳的时间 */
  const lastPokeBackAt = new Map<string, number>();
  /** 每个会话最近一条普通消息的时间：用来判断戳一戳有没有「上文」 */
  const lastMessageAt = new Map<string, number>();
  /** 等待中的戳一戳：连续戳只保留一个定时器，最终只回一次 */
  const pendingPokes = new Map<string, {
    timer: ReturnType<typeof setTimeout>;
    count: number;
    userId: string;
    groupId: string;
    senderName?: string;
  }>();
  /** 正在处理中的戳一戳，避免同一会话并发开新轮 */
  const pokeInFlight = new Set<string>();
  /** 戳完后先等一会儿：对方可能马上把真正要说的话发出来 */
  const POKE_WAIT_MS = 6_000;
  /** 最近这么久内有消息才算「有上文」 */
  const POKE_CONTEXT_WINDOW_MS = 5 * 60_000;

  /**
   * 戳一戳：视情况回戳一下，同时当作「主动消息信号」投给模型。
   *
   * NapCat / LLOneBot 的字段：`notice_type=notify, sub_type=poke`，
   * 被戳对象在 `target_id`；部分实现用 `notice_type=poke`，这里都兼容。
   */
  async function handlePoke(event: OneBotEvent): Promise<void> {
    const noticeType = String(event.notice_type ?? '');
    const subType = String(event.sub_type ?? '');
    if (noticeType !== 'poke' && !(noticeType === 'notify' && subType === 'poke')) return;
    if (selfId === '') return;

    const userId = event.user_id !== undefined ? String(event.user_id) : '';
    const targetId = event.target_id !== undefined ? String(event.target_id) : '';
    // 只处理「别人戳机器人」；自己戳自己 / 戳别人一律忽略
    if (userId === '' || userId === selfId) return;
    if (targetId !== '' && targetId !== selfId) return;

    const groupId = event.group_id !== undefined ? String(event.group_id) : '';
    const scope = groupId !== '' ? 'group' : 'c2c';
    const peerId = groupId !== '' ? groupId : userId;
    const key = `${scope}:${peerId}`;

    // 回击一个戳一戳（带冷却）：这是「视情况」的最低成本回应
    const now = Date.now();
    if (now - (lastPokeBackAt.get(key) ?? 0) >= POKE_BACK_COOLDOWN_MS) {
      lastPokeBackAt.set(key, now);
      const params: Record<string, unknown> = {};
      if (groupId !== '') params.group_id = /^\d+$/.test(groupId) ? Number(groupId) : groupId;
      params.user_id = /^\d+$/.test(userId) ? Number(userId) : userId;
      try {
        await client.call('send_poke', params);
        logger.info(`im-qqbot: poke back → ${key} user=${userId}`);
      } catch (err) {
        logger.debug(`im-qqbot: send_poke 失败 ${key}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // 不立刻触发模型：先等一会儿，看对方会不会把真正要说的话发出来。
    // 连续戳多次只保留一个待处理项，最终只回其中一次。
    const existing = pendingPokes.get(key);
    if (existing !== undefined) {
      existing.count += 1;
      existing.userId = userId;
      existing.groupId = groupId;
      return;
    }
    const sender = event.sender as { nickname?: unknown } | undefined;
    const senderName = typeof sender?.nickname === 'string' && sender.nickname.trim() !== ''
      ? sender.nickname
      : undefined;
    const pending = {
      timer: setTimeout(() => {
        void firePoke(key).catch((err: unknown) => {
          logger.warn(`poke turn failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      }, POKE_WAIT_MS),
      count: 1,
      userId,
      groupId,
      ...(senderName !== undefined ? { senderName } : {}),
    };
    (pending.timer as { unref?: () => void }).unref?.();
    pendingPokes.set(key, pending);
  }

  /**
   * 戳一戳的延时处理：
   * - 这段时间里对方发了消息 → 定时器已被取消（那条消息才是要回应的）；
   * - 没有上文（最近 5 分钟没消息）→ 不回应，等对方的下一条消息；
   * - 有上文 → 投给模型，让它结合聊天记录决定接话还是 [SILENT]。
   */
  async function firePoke(key: string): Promise<void> {
    const pending = pendingPokes.get(key);
    if (pending === undefined) return;
    pendingPokes.delete(key);

    const now = Date.now();
    if (now - (lastMessageAt.get(key) ?? 0) > POKE_CONTEXT_WINDOW_MS) {
      logger.info(`im-qqbot: poke 无上文，等对方下一条消息 ${key}`);
      return;
    }
    if (pokeInFlight.has(key)) return;
    pokeInFlight.add(key);
    try {
      await handlePokeSignal(manager, config, logger, {
        scope: pending.groupId !== '' ? 'group' : 'c2c',
        peerId: pending.groupId !== '' ? pending.groupId : pending.userId,
        senderId: pending.userId,
        ...(pending.senderName !== undefined ? { senderName: pending.senderName } : {}),
        replyTarget: {
          scope: pending.groupId !== '' ? 'group' : 'c2c',
          targetId: pending.groupId !== '' ? pending.groupId : pending.userId,
          channel: 'onebot',
        },
      });
    } finally {
      pokeInFlight.delete(key);
    }
  }

  /** 收到普通消息：记录活跃时间，并取消该会话等待中的戳一戳回应 */
  function noteMessageActivity(event: OneBotMessageEvent): void {
    const groupId = event.group_id !== undefined ? String(event.group_id) : '';
    const userId = event.user_id !== undefined ? String(event.user_id) : '';
    const key = groupId !== '' ? `group:${groupId}` : `c2c:${userId}`;
    lastMessageAt.set(key, Date.now());
    const pending = pendingPokes.get(key);
    if (pending !== undefined) {
      clearTimeout(pending.timer);
      pendingPokes.delete(key);
      logger.debug(`im-qqbot: 戳一戳等待被消息取消 ${key}`);
    }
  }

  async function handleEvent(event: OneBotEvent): Promise<void> {
    if (event.post_type === 'notice') {
      await handlePoke(event);
      return;
    }
    if (event.post_type !== 'message') return;

    // selfId 未配置时用事件自带字段兜底（OneBot 事件都带 self_id）
    if (selfId === '' && event.self_id !== undefined) {
      selfId = String(event.self_id);
    }
    const messageEvent = event as OneBotMessageEvent;
    if (messageEvent.user_id !== undefined && String(messageEvent.user_id) === selfId) return;
    noteMessageActivity(messageEvent);

    const built = await buildInboundMessage(messageEvent, {
      selfId,
      logger,
      getMessage,
    });
    if (built === undefined) return;

    const ctx = createContext(bot, built.message, logger);
    if (built.quote !== undefined) {
      // 直接写入 state.quote：SDK 的 quoteRef 只按 refMsgIdx 覆盖，
      // 这里已通过 get_msg 解析完成，结构满足 inbound 的消费契约
      (ctx.state as Record<string, unknown>).quote = built.quote;
    }

    // 与 SDK 一致：把入站处理作为链的最后一环，保证并发守卫/限流在整轮处理期间持有锁
    const terminal: Middleware = async () => {
      await handleInbound(ctx, manager, config, logger);
    };

    await runMiddlewareChain([...middlewares, terminal], ctx);
  }

  return {
    sender: bot,
    mediaSender: bot,
    async start(): Promise<void> {
      if (selfId === '') {
        try {
          const info = await client.getLoginInfo();
          if (info.user_id !== undefined) {
            selfId = String(info.user_id);
            logger.info(`OneBot 已连接账号 ${selfId}${info.nickname ? `（${info.nickname}）` : ''}`);
          }
        } catch (err) {
          logger.warn(
            `OneBot get_login_info 失败，selfId 将从事件中推断: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      await client.start();
    },
    stop(): void {
      client.stop();
    },
  };
}
