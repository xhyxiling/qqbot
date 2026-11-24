/**
 * SessionManager — 管理 QQ peer → dsh Agent 的映射和生命周期
 *
 * sessionKey 格式: `qqbot:${appId}:${kind}:${peerId}`
 *   - c2c:   peerId = senderId (用户 openid)
 *   - group: peerId = groupOpenid
 *
 * SessionId 由 sessionKey 确定性派生（SHA-256），
 * 保证同一个用户/群的消息始终路由到同一个会话，
 * 重启后可根据 key 恢复 session。
 *
 * 支持 agent-presets 系统：通过 setup hook 在 create/resume 时
 * 挂载 preset（工具集、prompt sections 等），实现场景化配置。
 */
import { legacyDerivedSessionId, mintSessionId } from './session-id.ts';
import { SessionId } from '@deepseek-ai/dsh-session';
import type { Context } from '@deepseek-ai/cordis';
import { createHostAdapter, type HostAdapter } from '../host/adapter.ts';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { ChatScope, Logger, ReplyTarget } from '../types.ts';
import type { ImQQBotConfig, PersonaPreset } from '../config.ts';
import { ModelResolver } from '../model/model-resolver.ts';
import {
  buildPersonaPromptSections,
  findPersona,
  PERSONA_OFF,
  resolvePersonaId,
} from '../personas/persona-utils.ts';
import {
  applyPersonaToolBinding,
  listToolNames,
  resolveToolBinding,
  type ToolsRestrictServiceLike,
} from '../personas/persona-tools.ts';
import { DEFAULT_TOOL_ALLOWLIST, STICKER_TOOL_NAMES } from '../shared/tool-catalog.ts';
import type { ModelRoute, ModelEntry } from '../model/types.ts';
import { buildIdentityPromptSection } from '../identity/role.ts';
import { MemoryStore, type ChatMemory, type MemoryNote } from '../memory/memory-store.ts';
import {
  buildMemoryPromptSection,
  extractMemoryFacts,
} from '../memory/memory-prompt.ts';
import { IdleEvictor } from './idle-evictor.ts';
import { resolveActiveVoiceSettings } from '../voice/voice-config.ts';
import { buildVoiceOptions } from '../voice/voice-presets.ts';
import { buildVoicePromptSection } from '../voice/voice-prompt.ts';
import { VOICE_TOOL_NAME } from '../voice/voice-tool.ts';
import type { QuestionChannel } from '../features/question-channel.ts';
import type { ApprovalChannel } from '../features/approval-channel.ts';
import type {
  SessionEventLike,
  DshAgent,
  DshAgentHandle,
  DshAgentRegistry,
  AgentPresetsLike,
  PresetComposition,
  PresetEntry,
  PresetSwitchOutcome,
  SessionRecord,
  SessionStatus,
  TokenUsageStats,
  CompactionServiceLike,
  CompactOutcome,
} from './types.ts';

/** ManualCompactionError 各 code 的友好提示 */
const COMPACTION_ERROR_HINTS: Record<string, string> = {
  busy: '压缩服务忙，请稍后重试',
  cancelled: '压缩已取消',
  changed: '历史在压缩过程中发生变化，请重试',
  commit: '压缩提交失败',
  persistence: '压缩完成但保存失败',
};

/** system-prompt section 最小结构（name/order/text） */
interface PromptSection {
  name: string;
  order: number;
  text: string;
}

/** 群聊记忆 note 无昵称时的说话人短标识长度（openid 前 N 位） */
const SENDER_SHORT_ID_LEN = 8;

/** system-prompt/assemble waterfall 的 context 最小结构 */
interface AssembleContext {
  agent?: DshAgent;
}

/** system-prompt/assemble 的组装产物最小结构 */
interface AssembledPrompt {
  sections?: PromptSection[];
  [key: string]: unknown;
}

/** 复刻宿主 latestCompletedPrefixBoundary：最后一个 turn/end 起到下一 turn 开始前的边界 */
export function latestCompletedPrefixBoundary(events: readonly unknown[]): number | undefined {
  const list = events as Array<{ type?: string; seq?: number; surfaceOp?: string }>;
  let lastTurnEndSeq: number | undefined;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const candidate = list[i];
    if (candidate?.type === 'turn/end') {
      lastTurnEndSeq = candidate.seq;
      break;
    }
  }
  if (lastTurnEndSeq === undefined) return undefined;
  let boundary = lastTurnEndSeq;
  for (const next of list.slice(boundary + 1)) {
    if (next.type === 'turn/start'
      || (next.type === 'user/message' && next.surfaceOp === 'append')
      || next.type === 'agent/inbox/spliced') break;
    if (next.seq !== undefined) boundary = next.seq;
  }
  return boundary;
}

export class SessionManager {
  private sessions = new Map<string, SessionRecord>();
  private readonly evictor: IdleEvictor;
  private readonly modelResolver: ModelResolver;
  /** 长期记忆与关系状态（~/.dsh-qqbot/memory.json） */
  private readonly memoryStore: MemoryStore;
  private readonly ctx: Context;
  private readonly host: HostAdapter;
  private readonly agents: DshAgentRegistry;
  private readonly config: ImQQBotConfig;
  private readonly logger: Logger;
  /** 由 bootstrap 注入的问答通道（ask_user_question → QQ），会话回收时清理其待答问题 */
  public questionChannel?: QuestionChannel;
  /** 由 bootstrap 注入的审批通道（approval/request → QQ），会话回收时清理其待批审批 */
  public approvalChannel?: ApprovalChannel;

  constructor(
    ctx: Context,
    agents: DshAgentRegistry,
    config: ImQQBotConfig,
    logger: Logger,
  ) {
    this.ctx = ctx;
    this.agents = agents;
    this.config = config;
    this.logger = logger;
    this.host = createHostAdapter(ctx, logger);
    this.logger.info(`host adapter capabilities: ${this.host.capabilities.join(', ')}`);
    this.modelResolver = new ModelResolver(ctx, config, logger);
    this.memoryStore = new MemoryStore({ debugLog: (msg) => logger.debug(msg) });

    this.evictor = new IdleEvictor(
      this.sessions,
      config.sessionIdleTimeout,
      (key, record) => {
        this.logger.info(`evicting idle session: key=${key}`);
        this.sessions.delete(key);
        record.agent.cancel({ kind: 'user' });
        this.releaseToolBinding(record);
        void record.handle.dispose().catch(() => {});
        // 回收会话时统一清理其待答问题/待批审批，避免 pending 悬挂泄漏
        this.questionChannel?.cancelPending(key);
        this.approvalChannel?.cancelPending(key);
      },
    );

    this.registerScopePromptInjection();
  }

  /**
   * 通过 system-prompt/assemble waterfall 注入全局提示词与当前会话人格。
   *
   * 该事件在每次 turn 构建 request 时触发；此处按会话解析出生效人格
   * （per-chat 覆盖 > config.defaultPersona），叠加全局提示词 section。
   * 会话尚未建立（首次 assemble）或两者都未配置时原样返回，不做改动。
   */
  private registerScopePromptInjection(): void {
    const assemble = async (
      _assembly: unknown,
      context: AssembleContext,
      next: () => Promise<AssembledPrompt>,
    ): Promise<AssembledPrompt> => {
      const assembled = await next();
      if (!context.agent) return assembled;

      const record = this.findByAgent(context.agent);
      if (!record) return assembled;

      const persona = this.getEffectivePersona(record.scope, record.peerId);
      const voiceSettings = resolveActiveVoiceSettings(this.config.voice);
      // 语音可用时 qqbot_voice 无视人格白名单一路放行，所以这里也要把它写进
      // 「本会话绑定了哪些工具」的说明；否则模型看到说明里没有它就不敢调用。
      const sections = buildPersonaPromptSections(persona, this.config.globalPrompt, {
        extraTools: voiceSettings === undefined ? [] : [VOICE_TOOL_NAME],
      });
      // 身份说明夹在全局提示词与人格之间（order 82）：人格只写称呼与态度，
      // 不再写死 openid；标签含义统一由这里解释。按 order 插入，不依赖宿主排序。
      const identitySection = buildIdentityPromptSection(this.config.identity);
      // 记忆与关系状态（order 87）排在人格之后：模型先知道「自己是谁」，
      // 再知道「对面是谁、聊过什么」，避免关系描述盖过人格语气。
      const memorySection = buildMemoryPromptSection(
        this.memoryStore.get(this.sessionKey(record.scope, record.peerId)),
        this.config.memory,
      );
      // 语音回复说明（order 88）：只有语音真正可用（voice.apiKey 非空且
      // 运行时支持 WebSocket）时才注入。这里告诉模型「有语音这条路、什么时候适合、
      // 怎么用」——不然它不知道该调用 qqbot_voice，语音能力就等于不存在。
      const voiceSection = buildVoicePromptSection({
        settings: voiceSettings,
        personaVoice: persona?.expressions?.voice,
        voiceOptions: buildVoiceOptions(this.config.voice?.presets, this.config.voice?.model),
      });
      const ordered = [identitySection, memorySection, voiceSection].filter(
        (section): section is PromptSection => section !== undefined,
      );
      for (const section of ordered) {
        const insertAt = sections.findIndex((s) => s.order >= section.order);
        if (insertAt === -1) sections.push(section);
        else sections.splice(insertAt, 0, section);
      }
      if (sections.length === 0) return assembled;

      return {
        ...assembled,
        sections: [...(assembled.sections ?? []), ...sections],
      };
    };

    (this.ctx as unknown as {
      on(event: 'system-prompt/assemble', handler: typeof assemble): void;
    }).on('system-prompt/assemble', assemble);
  }

  /**
   * 动态获取 agentPresets 服务（可选，未注入时返回 undefined）
   */
  private getPresetsService(): AgentPresetsLike | undefined {
    try {
      return this.ctx.get('agentPresets') as AgentPresetsLike | undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * 从 session 持久化 header 读 session 当初的 preset（started 锁定语义）。
   * 读不到（服务缺失 / session 不存在 / 未记录 agentPreset）返回 undefined。
   */
  private async resolvePersistedPreset(sessionId: string): Promise<string | undefined> {
    let persistence: { load(id: string): Promise<{ meta?: { agentPreset?: string } }> } | undefined;
    try {
      persistence = this.ctx.get('sessionPersistence') as typeof persistence | undefined;
    } catch {
      return undefined;
    }
    if (!persistence) return undefined;
    try {
      const { meta } = await persistence.load(sessionId);
      return meta?.agentPreset;
    } catch {
      return undefined;
    }
  }

  // ── 模型相关（委托给 ModelResolver） ──

  getEffectiveModel(scope: ChatScope, peerId: string): ModelRoute | undefined {
    return this.modelResolver.getEffectiveRoute(this.sessionKey(scope, peerId));
  }

  /**
   * 获取指定 peer 的生效 preset（per-peer 覆盖 > config.preset）
   */
  getEffectivePreset(scope: ChatScope, peerId: string): string | undefined {
    return this.getEffectivePresetByKey(this.sessionKey(scope, peerId));
  }

  /** 按 sessionKey 解析生效 preset */
  private getEffectivePresetByKey(key: string): string | undefined {
    return this.modelResolver.getPreset(key) ?? this.config.preset;
  }

  /**
   * 列出所有可用 preset（/preset 命令用）
   */
  async listPresets(): Promise<PresetEntry[]> {
    const presets = this.getPresetsService();
    if (!presets) return [];
    try {
      const list = await presets.list();
      return list.map((p) => ({ id: p.id, name: p.name, description: p.description }));
    } catch (err) {
      this.logger.warn(`list presets failed: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }
  }

  /**
   * 切换模型（fork + 重建会话，保留历史）
   */
  async setModelOverride(scope: ChatScope, peerId: string, route: ModelRoute): Promise<void> {
    const key = this.sessionKey(scope, peerId);

    this.modelResolver.setOverride(key, route);

    const record = this.sessions.get(key);
    if (!record) {
      this.logger.info(`model pref saved (no active session): key=${key} → ${route.provider}/${route.model}`);
      return;
    }

    await this.rebuildSession(record, { route });
    this.logger.info(`model switched via fork: key=${key} → ${route.provider}/${route.model}`);
  }

  /**
   * 切换指定 peer 的 agent preset（per-peer 覆盖）
   *
   * 已开始的会话保持锁定（blank-session contract）：只持久化为新会话默认，
   * 不 fork/rebuild 当前会话，避免历史工具调用与新 preset 工具集冲突。
   */
  async setPresetOverride(scope: ChatScope, peerId: string, presetId: string): Promise<PresetSwitchOutcome> {
    const key = this.sessionKey(scope, peerId);

    // 1. 校验 preset 存在 + 可加载（broken 拒绝）
    const presets = this.getPresetsService();
    if (!presets) return { ok: false, reason: 'unavailable' };
    let resolved: { id: string; broken?: string };
    try {
      resolved = await presets.resolve(presetId);
    } catch (err) {
      return { ok: false, reason: 'unknown-preset', message: err instanceof Error ? err.message : String(err) };
    }
    if (resolved.broken !== undefined) {
      return { ok: false, reason: 'broken', message: resolved.broken };
    }

    // 2. 持久化 per-peer 覆盖（新会话生效）
    this.modelResolver.setPreset(key, presetId);

    const hasActive = this.sessions.has(key);
    this.logger.info(
      `preset pref saved: key=${key} → ${presetId}${hasActive ? ' (active session locked, next session applies)' : ''}`,
    );
    return { ok: true, presetId };
  }

  /**
   * 清除 per-peer preset 覆盖，回到 config.preset / 默认（新会话生效）
   */
  async clearPresetOverride(scope: ChatScope, peerId: string): Promise<PresetSwitchOutcome> {
    const key = this.sessionKey(scope, peerId);
    this.modelResolver.clearPreset(key);
    this.logger.info(`preset pref cleared: key=${key} (next session applies)`);
    return { ok: true };
  }

  // ── 人格预设（/persona） ──

  /** 列出配置中的人格预设 */
  listPersonas(): PersonaPreset[] {
    return [...(this.config.personas ?? [])];
  }

  /** 按 id 查找人格预设 */
  findPersonaById(id: string): PersonaPreset | undefined {
    return findPersona(this.config.personas, id);
  }

  /**
   * 解析指定 peer 当前生效的人格 id。
   *
   * 优先级：per-chat 覆盖 > config.defaultPersona；两者都指向已删除的人格时返回 undefined。
   */
  getEffectivePersonaId(scope: ChatScope, peerId: string): string | undefined {
    const key = this.sessionKey(scope, peerId);
    return resolvePersonaId(
      this.config.personas,
      this.config.defaultPersona,
      this.modelResolver.getPersona(key),
    );
  }

  /** 解析指定 peer 当前生效的人格预设 */
  getEffectivePersona(scope: ChatScope, peerId: string): PersonaPreset | undefined {
    return findPersona(this.config.personas, this.getEffectivePersonaId(scope, peerId));
  }

  /** 是否设置了 per-chat 人格覆盖（用于区分「跟随默认」与「手动指定」） */
  hasPersonaOverride(scope: ChatScope, peerId: string): boolean {
    return this.modelResolver.getPersona(this.sessionKey(scope, peerId)) !== undefined;
  }

  /**
   * 设置 per-chat 人格覆盖。
   *
   * 人格通过 system-prompt/assemble 每次 turn 注入，无需重建会话，
   * 下一条消息即时生效。
   */
  setPersonaOverride(scope: ChatScope, peerId: string, personaId: string): boolean {
    const persona = this.findPersonaById(personaId);
    if (!persona) return false;
    const key = this.sessionKey(scope, peerId);
    this.modelResolver.setPersona(key, personaId);
    this.logger.info(`persona switched: key=${key} → ${personaId} (next turn applies)`);
    this.refreshToolBinding(scope, peerId);
    return true;
  }

  /** 清除 per-chat 人格覆盖，回到 config.defaultPersona */
  clearPersonaOverride(scope: ChatScope, peerId: string): boolean {
    const key = this.sessionKey(scope, peerId);
    const cleared = this.modelResolver.clearPersona(key);
    if (cleared) {
      this.logger.info(`persona override cleared: key=${key}`);
      this.refreshToolBinding(scope, peerId);
    }
    return cleared;
  }

  /** 关闭当前会话的人格（写入哨兵覆盖，不影响其他会话与默认配置） */
  disablePersona(scope: ChatScope, peerId: string): void {
    const key = this.sessionKey(scope, peerId);
    this.modelResolver.setPersona(key, PERSONA_OFF);
    this.logger.info(`persona disabled: key=${key} (next turn applies)`);
    this.refreshToolBinding(scope, peerId);
  }

  // ── 人格工具绑定（/tools） ──

  /**
   * 当前可限制的工具名（`/tools` 展示与白名单校验用）。
   *
   * 传入 `agent` 才会带上 preset 挂载的工具（它们是 agent 的祖先层）；
   * 缺省 agent 只返回宿主全局层，会漏掉 preset 里的工具。
   */
  listToolNames(agent?: unknown): string[] {
    return listToolNames(this.getToolsService(), agent);
  }

  /** 按会话取工具清单：有活跃会话用它的 agent 作用域，否则退化为全局层视图 */
  listToolNamesFor(scope: ChatScope, peerId: string): string[] {
    return this.listToolNames(this.sessions.get(this.sessionKey(scope, peerId))?.agent);
  }

  /**
   * 确保会话存在（诊断类命令需要读 agent 作用域时使用）。
   *
   * 斜杠命令由中间件直接处理、不经过入站流程，不会自动建会话；没有会话
   * 就拿不到 agent 作用域，`tools.view()` 只能看到全局层（会漏掉 preset
   * 挂载的工具）。
   */
  async ensureSession(
    scope: ChatScope,
    peerId: string,
    senderId: string,
    replyTarget: ReplyTarget,
  ): Promise<void> {
    if (this.sessions.has(this.sessionKey(scope, peerId))) return;
    await this.getOrCreate(scope, peerId, senderId, replyTarget);
  }

  /**
   * 收敛人格白名单：没人格或人格没写 `tools` 时用默认放行清单，
   * 写了 `tools` 时再与默认清单求交（文件读写/命令执行等一律不放行）。
   *
   * @returns whitelist 实际放行的工具名；blocked 被策略挡掉的名字（仅告警）
   */
  private resolveWhitelist(requested?: readonly string[]): { whitelist: string[]; blocked: string[] } {
    let whitelist: string[];
    let blocked: string[] = [];
    if (requested === undefined) {
      whitelist = [...DEFAULT_TOOL_ALLOWLIST];
    } else {
      whitelist = [];
      for (const raw of requested) {
        const name = raw.trim();
        if (name === '') continue;
        if (DEFAULT_TOOL_ALLOWLIST.includes(name)) whitelist.push(name);
        else blocked.push(name);
      }
    }
    // 语音是「投递方式」而不是一项能力：语音可用时始终放行 qqbot_voice，
    // 即使人格显式写了 `tools: []`（否则该人格永远发不了语音）。
    if (resolveActiveVoiceSettings(this.config.voice) !== undefined && !whitelist.includes(VOICE_TOOL_NAME)) {
      whitelist.push(VOICE_TOOL_NAME);
    }
    // sticker 三工具也是消息投递能力：始终放行，不受 persona 白名单限制
    for (const name of STICKER_TOOL_NAMES) {
      if (!whitelist.includes(name)) whitelist.push(name);
    }
    return { whitelist, blocked };
  }

  /**
   * 解析某个会话的人格工具绑定。
   *
   * `restricted=false` 表示该人格未配置 `tools`（此时按默认放行清单限制）。
   */
  getPersonaToolBinding(scope: ChatScope, peerId: string): {
    persona: PersonaPreset | undefined;
    restricted: boolean;
    allowed: string[];
    unknown: string[];
    blocked: string[];
    available: string[];
  } {
    const persona = this.getEffectivePersona(scope, peerId);
    const available = this.listToolNamesFor(scope, peerId);
    const { whitelist, blocked } = this.resolveWhitelist(persona?.tools);
    const { allowed, unknown } = resolveToolBinding(whitelist, new Set(available));
    return {
      persona,
      restricted: persona !== undefined && persona.tools !== undefined,
      allowed,
      unknown,
      blocked,
      available,
    };
  }

  private getToolsService(): ToolsRestrictServiceLike | undefined {
    try {
      return this.ctx.get('tools') as ToolsRestrictServiceLike | undefined;
    } catch {
      return undefined;
    }
  }

  /**
   * 应用当前生效人格的工具白名单（硬约束）。
   *
   * 默认策略：即使人格没写 `tools`，也只放行 `DEFAULT_TOOL_ALLOWLIST`
   * （插件内置工具 + 只读的联网/提问能力），文件读写、PowerShell 等宿主工具
   * 在 QQ 会话里不可见也调不到。
   *
   * 已应用且人格未变时直接返回；切换人格时先释放旧限制再应用新限制，
   * 因此 `/persona` 切换无需重建会话即可生效。
   */
  private applyToolBinding(record: SessionRecord): void {
    const persona = this.getEffectivePersona(record.scope, record.peerId);
    const personaId = persona?.id ?? null;
    const current = record.toolRestriction;
    if (current !== undefined && current.personaId === personaId) return;

    const { whitelist, blocked } = this.resolveWhitelist(persona?.tools);
    if (blocked.length > 0) {
      this.logger.warn(
        `im-qqbot: 人格 ${personaId ?? 'none'} 配置了默认不开放的工具（已禁用）: ${blocked.join(', ')}`,
      );
    }

    current?.dispose?.();
    record.toolRestriction = undefined;

    const dispose = applyPersonaToolBinding(
      record.agent.ctx,
      record.agent,
      whitelist,
      personaId ?? '(default policy)',
      this.logger,
    );
    record.toolRestriction = { personaId, ...(dispose ? { dispose } : {}) };
    this.logger.info(
      `tool binding applied: key=${record.sessionKey} persona=${personaId ?? 'none'} `
      + `allow=${whitelist.join(',') || '(none)'}`,
    );
  }

  /** 释放会话的工具限制（会话回收/重建/移除前调用） */
  private releaseToolBinding(record: SessionRecord): void {
    record.toolRestriction?.dispose?.();
    record.toolRestriction = undefined;
  }

  /** 人格切换后立即刷新工具绑定（没有活跃会话时留待创建时应用） */
  private refreshToolBinding(scope: ChatScope, peerId: string): void {
    const record = this.sessions.get(this.sessionKey(scope, peerId));
    if (record) this.applyToolBinding(record);
  }

  // ── 记忆与关系状态（/memory） ──

  /** 读取指定会话的长期记忆与关系状态 */
  getChatMemory(scope: ChatScope, peerId: string): ChatMemory | undefined {
    return this.memoryStore.get(this.sessionKey(scope, peerId));
  }

  /**
   * 记录一次用户互动：累加互动次数，并按需自动捕获自述要点。
   *
   * 记忆独立于会话历史：`/new` 只换上下文，记忆仍保留；重启后同样保留。
   */
  recordInteraction(
    scope: ChatScope,
    peerId: string,
    senderId: string,
    senderName: string | undefined,
    text: string,
  ): void {
    if (!this.memoryEnabled) return;
    const key = this.sessionKey(scope, peerId);
    this.memoryStore.recordInteraction(key, scope, peerId);
    if (!this.config.memory.autoCapture) return;

    const facts = extractMemoryFacts(text);
    if (facts.length === 0) return;
    // 群聊同一会话有多个说话人：note 带说话人前缀，避免把 A 的自述算到 B 头上
    const prefix = scope === 'group'
      ? `[${senderName ?? senderId.slice(0, SENDER_SHORT_ID_LEN)}] `
      : '';
    for (const fact of facts) {
      this.memoryStore.addNote(
        key,
        scope,
        peerId,
        `${prefix}${fact}`,
        'auto',
        this.config.memory.maxNotes,
      );
    }
  }

  /** 手动添加一条要点记忆；记忆关闭或内容重复时返回 undefined */
  addMemoryNote(scope: ChatScope, peerId: string, text: string): MemoryNote | undefined {
    if (!this.memoryEnabled) return undefined;
    return this.memoryStore.addNote(
      this.sessionKey(scope, peerId),
      scope,
      peerId,
      text,
      'manual',
      this.config.memory.maxNotes,
    );
  }

  /** 删除第 index 条要点记忆（0-based）；越界或记忆关闭时返回 false */
  removeMemoryNote(scope: ChatScope, peerId: string, index: number): boolean {
    if (!this.memoryEnabled) return false;
    return this.memoryStore.removeNote(this.sessionKey(scope, peerId), index);
  }

  /** 清空当前会话的要点记忆（保留互动次数与关系阶段）；返回删除条数 */
  clearMemoryNotes(scope: ChatScope, peerId: string): number {
    if (!this.memoryEnabled) return 0;
    return this.memoryStore.clearNotes(this.sessionKey(scope, peerId));
  }

  /** 记忆功能是否开启（关闭时命令与自动捕获都不写盘） */
  private get memoryEnabled(): boolean {
    return this.config.memory.enabled;
  }

  /**
   * fork + 重建会话（保留历史，换 model）
   *
   * options.route 缺省时沿用当前生效值。preset 沿用当前生效 preset（getEffectivePresetByKey）。
   * fork 不可用或失败时降级为 dispose（下次消息重建）。
   */
  private async rebuildSession(
    record: SessionRecord,
    options: { route?: ModelRoute },
  ): Promise<void> {
    const key = record.sessionKey;

    // 对齐宿主官方 fork（commands.fork）：buildForkSeed 产物原样作 seed，
    // create 传 inheritedEventCount + isSeeded + parentSession
    const events = this.host.sessionEvents(record.agent.session);
    const boundary = latestCompletedPrefixBoundary(events);
    if (boundary === undefined) {
      this.logger.warn(`fork unavailable (no completed turn), fallback to dispose: key=${key}`);
      this.sessions.delete(key);
      record.agent.cancel({ kind: 'user' });
      this.releaseToolBinding(record);
      await record.handle.dispose().catch(() => {});
      return;
    }

    const seed = await this.host.buildForkSeed(events, boundary);
    if (seed === undefined) {
      this.logger.warn(`fork seed unavailable (old host), fallback to dispose: key=${key}`);
      this.sessions.delete(key);
      record.agent.cancel({ kind: 'user' });
      this.releaseToolBinding(record);
      await record.handle.dispose().catch(() => {});
      return;
    }

    const childId = SessionId(mintSessionId());
    const effectiveRoute = options.route ?? this.modelResolver.getEffectiveRoute(key);
    const composed = await this.composePreset(this.getEffectivePresetByKey(key));
    const created = await this.agents.create({
      sessionId: childId,
      seed,
      inheritedEventCount: boundary + 1,
      meta: {
        cwd: this.workspaceDir(),
        isSeeded: true,
        // 旧版宿主的 delivery 豁免要求 parentSession，新版忽略——都传
        parentSession: record.sessionId,
        ...(composed.agentPreset ? { agentPreset: composed.agentPreset } : {}),
      },
      ...(effectiveRoute ? { agentOptions: effectiveRoute } : {}),
      ...(composed.setup ? { setup: composed.setup } : {}),
    });

    this.modelResolver.setSessionId(key, childId);

    const oldHandle = record.handle;
    // 旧 agent 的 ctx 会被 dispose，先释放其工具限制，再按当前人格重新应用
    this.releaseToolBinding(record);
    record.sessionId = childId;
    record.agent = created.agent;
    record.handle = created;
    record.agentPreset = composed.agentPreset;
    record.lastActivity = Date.now();
    this.applyToolBinding(record);

    void oldHandle.dispose().catch(() => {});
    this.logger.info(`session rebuilt via fork: key=${key} preset=${composed.agentPreset ?? 'none'} sessionId=${childId}`);
  }

  clearModelOverride(scope: ChatScope, peerId: string): void {
    const key = this.sessionKey(scope, peerId);
    this.modelResolver.clearOverride(key);
    this.modelResolver.clearSessionId(key);
  }

  async listAvailableModels(): Promise<ModelEntry[]> {
    return this.modelResolver.listModels();
  }

  listProviders(): string[] {
    return this.modelResolver.listProviders();
  }

  // ── 会话状态 / 统计 ──

  getSessionRecord(scope: ChatScope, peerId: string): SessionRecord | undefined {
    return this.sessions.get(this.sessionKey(scope, peerId));
  }

  getStatus(scope: ChatScope, peerId: string): SessionStatus {
    const record = this.getSessionRecord(scope, peerId);
    const route = this.getEffectiveModel(scope, peerId);

    return {
      active: !!record,
      sessionId: record?.sessionId,
      provider: route?.provider,
      model: route?.model,
      preset: record?.agentPreset,
      lastActivity: record?.lastActivity,
      messageCount: this.countMessages(record),
    };
  }

  getTokenUsage(scope: ChatScope, peerId: string): TokenUsageStats {
    const record = this.getSessionRecord(scope, peerId);
    const stats: TokenUsageStats = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    if (!record) return stats;

    const events = this.host.sessionEvents(record.agent.session) as readonly SessionEventLike[];
    if (!events) return stats;

    for (const event of events) {
      if (event.type !== 'assistant/message' || !event.usage) continue;
      stats.input += event.usage.input ?? 0;
      stats.output += event.usage.output ?? 0;
      stats.cacheRead += event.usage.cacheRead ?? 0;
      stats.cacheWrite += event.usage.cacheWrite ?? 0;
    }

    return stats;
  }

  exportMarkdown(scope: ChatScope, peerId: string): string {
    const record = this.getSessionRecord(scope, peerId);
    if (!record) return '';

    const events = this.host.sessionEvents(record.agent.session) as readonly SessionEventLike[];
    if (!events || events.length === 0) return '';

    const lines: string[] = [`# QQ 会话导出\n`, `> session: ${record.sessionId}\n`];

    for (const event of events) {
      if (event.type === 'user/message') {
        const text = extractMessageText(event.message);
        if (text) lines.push(`## 用户\n\n${text}\n`);
      } else if (event.type === 'assistant/message') {
        const text = extractMessageText(event.message);
        if (text) lines.push(`## 助手\n\n${text}\n`);
      }
    }

    return lines.join('\n');
  }

  private countMessages(record: SessionRecord | undefined): number {
    if (!record) return 0;
    const events = this.host.sessionEvents(record.agent.session) as readonly SessionEventLike[];
    if (!events) return 0;

    let count = 0;
    for (const event of events) {
      if (event.type === 'user/message' || event.type === 'assistant/message') {
        count += 1;
      }
    }
    return count;
  }

  // ── Session 生命周期管理 ──

  private sessionKey(scope: ChatScope, peerId: string): string {
    return `qqbot:${this.config.appId}:${scope}:${peerId}`;
  }

  /** prefs 命中沿用；miss 返回 0.5.x 派生候选，由 getOrCreate 按 resume 结果迁移或铸造 */
  private currentSessionId(sessionKey: string): string {
    return this.modelResolver.getSessionId(sessionKey) ?? legacyDerivedSessionId(sessionKey);
  }

  /** 候选命中后落盘，后续永远走 prefs */
  private persistSessionId(sessionKey: string, sessionId: string): void {
    if (this.modelResolver.getSessionId(sessionKey) !== sessionId) {
      this.modelResolver.setSessionId(sessionKey, sessionId);
    }
  }

  private async composePreset(presetId?: string): Promise<PresetComposition> {
    const presets = this.getPresetsService();
    if (!presets) return {};

    try {
      const resolved = await presets.resolve(presetId);
      const resolvedId = resolved.id;
      return {
        agentPreset: resolvedId,
        setup: async (agentCtx: Context) => {
          await presets.mount(agentCtx, resolvedId);
        },
      };
    } catch (err) {
      this.logger.warn(
        `im-qqbot: preset ${presetId ?? '(default)'} unavailable: ${err instanceof Error ? err.message : String(err)} — using host composition`,
      );
      return {};
    }
  }

  /** 获取或恢复或创建会话（get → resume → create） */
  async getOrCreate(
    scope: ChatScope,
    peerId: string,
    senderId: string,
    replyTarget: ReplyTarget,
  ): Promise<SessionRecord> {
    const key = this.sessionKey(scope, peerId);
    const existing = this.sessions.get(key);

    if (existing) {
      existing.replyTarget = replyTarget;
      existing.lastActivity = Date.now();
      return existing;
    }

    const route = this.modelResolver.getEffectiveRoute(key);
    let sessionId = SessionId(this.currentSessionId(key));
    this.logger.info(`getOrCreate: key=${key} route=${route ? `${route.provider}/${route.model}` : 'host-default'} sessionId=${sessionId}`);

    let agent: DshAgent;
    let handle: DshAgentHandle | undefined;
    let agentPreset: string | undefined;

    const live = this.agents.get(sessionId);
    if (live) {
      agent = live;
      this.persistSessionId(key, sessionId);
      this.logger.info(`reusing live agent: key=${key}`);
    } else {
      // preset 只解析一次：resume/create 共用同一组合，避免重复 resolve/mount 目录。
      // 优先 session 当初的 preset（started 锁定语义），无则用当前 effective preset。
      const presetId = (await this.resolvePersistedPreset(sessionId)) ?? this.getEffectivePresetByKey(key);
      const composed = await this.composePreset(presetId);
      agentPreset = composed.agentPreset;
      try {
        const resumeRoute = this.modelResolver.getResumeRoute(key);
        const resumed = await this.agents.resume({
          resumeSessionId: sessionId,
          ...(resumeRoute ? { agentOptions: resumeRoute } : {}),
          ...(composed.setup ? { setup: composed.setup } : {}),
        });
        agent = resumed.agent;
        handle = resumed;
        // 0.5.x 迁移：候选命中老会话，沿用并落盘
        this.persistSessionId(key, sessionId);
        this.logger.info(`resumed session: key=${key} preset=${agentPreset ?? 'none'} route=${resumeRoute ? `${resumeRoute.provider}/${resumeRoute.model}` : 'session-own'}`);
      } catch {
        // 无存量会话：弃用候选，铸造新 id
        if (!this.modelResolver.getSessionId(key)) {
          sessionId = SessionId(mintSessionId());
          this.modelResolver.setSessionId(key, sessionId);
          this.logger.info(`migrated to minted session id: key=${key} sessionId=${sessionId}`);
        }
        const created = await this.agents.create({
          sessionId,
          meta: {
            cwd: this.workspaceDir(),
            ...(agentPreset ? { agentPreset } : {}),
          },
          ...(route ? { agentOptions: route } : {}),
          ...(composed.setup ? { setup: composed.setup } : {}),
        });
        agent = created.agent;
        handle = created;
        this.logger.info(`created new session: key=${key} preset=${agentPreset ?? 'none'}`);
      }
    }

    const record: SessionRecord = {
      sessionKey: key,
      sessionId,
      agent,
      handle: handle ?? { agent, dispose: async () => {} },
      replyTarget,
      scope,
      peerId,
      senderId,
      lastActivity: Date.now(),
      agentPreset,
    };

    this.sessions.set(key, record);
    // 首次创建/恢复后立即应用人格工具白名单，保证第一轮消息就受约束
    this.applyToolBinding(record);
    return record;
  }

  findBySessionId(sessionId: string): SessionRecord | undefined {
    for (const record of this.sessions.values()) {
      if (record.sessionId === sessionId) return record;
    }
    return undefined;
  }

  findByAgent(agent: DshAgent): SessionRecord | undefined {
    for (const record of this.sessions.values()) {
      if (record.agent === agent) return record;
    }
    return undefined;
  }

  async remove(scope: ChatScope, peerId: string): Promise<void> {
    const key = this.sessionKey(scope, peerId);
    const record = this.sessions.get(key);
    this.modelResolver.setSessionId(key, mintSessionId());

    if (!record) return;
    this.sessions.delete(key);
    record.agent.cancel({ kind: 'user' });
    this.releaseToolBinding(record);
    await record.handle.dispose().catch(() => {});
    this.logger.info(`session removed: key=${key}`);
  }

  /** Agent 工作目录：显式配置优先，缺省独立目录 ~/.dsh-qqbot/workspace（不随宿主进程 cwd） */
  private workspaceCache: string | undefined;
  private workspaceDir(): string {
    if (this.workspaceCache) return this.workspaceCache;
    const dir = this.config.cwd ?? resolve(homedir(), '.dsh-qqbot', 'workspace');
    mkdirSync(dir, { recursive: true });
    this.workspaceCache = dir;
    return dir;
  }

  /**
   * 原地压缩当前会话历史（保留 sessionId，用摘要替换旧历史）。
   *
   * compaction 是 preset 作用域服务，经 host adapter 从会话 preset 解析，
   * 全局注册的部署再兜底。这是「压缩上下文」的语义，区别于 remove() 的「换新会话」。
   */
  async compact(
    scope: ChatScope,
    peerId: string,
    revive?: { senderId: string; replyTarget: ReplyTarget },
  ): Promise<CompactOutcome> {
    const key = this.sessionKey(scope, peerId);
    let record = this.sessions.get(key);
    if (!record) {
      // 无活跃会话（重启/闲置回收）时从磁盘拉起，历史在磁盘上仍可压缩
      if (!revive) return { ok: false, reason: 'no-session' };
      record = await this.getOrCreate(scope, peerId, revive.senderId, revive.replyTarget);
    }
    if (record.agent.status !== 'idle') return { ok: false, reason: 'busy' };

    const compaction = (await this.host.serviceFor(record.agent, 'compaction')
      ?? this.host.globalService('compaction')) as CompactionServiceLike | undefined;
    if (!compaction) return { ok: false, reason: 'unavailable' };

    const route = this.modelResolver.getEffectiveRoute(key);
    const agentCtx = {
      session: record.agent.session,
      options: { provider: route?.provider, model: route?.model },
      runMaintenance: record.agent.runMaintenance.bind(record.agent),
    };

    try {
      const result = await compaction.compactNow(agentCtx, new AbortController().signal);
      if (result === null) return { ok: true, shadowed: 0, tokens: 0 };
      return { ok: true, shadowed: result.shadowedSeqs.length, tokens: result.shadowedTokenCount };
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      // summary = 摘要没有更小 = 历史不足以压缩，属正常结果而非失败
      if (code === 'summary') {
        return { ok: true, shadowed: 0, tokens: 0 };
      }
      // 其他 ManualCompactionError 预期失败，给友好文案（debug 记录，不 warn 刷屏）
      if (code !== undefined && code in COMPACTION_ERROR_HINTS) {
        this.logger.debug(`compact declined: key=${key} code=${code}`);
        return { ok: false, reason: 'failed', message: COMPACTION_ERROR_HINTS[code] };
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`compact failed: key=${key} err=${message}`);
      return { ok: false, reason: 'failed', message };
    }
  }

  async disposeAll(): Promise<void> {
    this.evictor.dispose();
    const records = [...this.sessions.values()];
    this.sessions.clear();
    for (const record of records) {
      record.agent.cancel({ kind: 'user' });
      this.releaseToolBinding(record);
    }
    await Promise.allSettled(records.map((r) => r.handle.dispose()));
    this.logger.info(`all sessions disposed (count=${records.length})`);
  }

  get size(): number {
    return this.sessions.size;
  }
}

/** 从消息对象中提取纯文本（用于导出/统计） */
function extractMessageText(
  message: SessionEventLike['message'],
): string {
  const blocks = message?.content;
  if (!blocks || !Array.isArray(blocks)) return '';

  const parts: string[] = [];
  for (const block of blocks) {
    if (block.type === 'text' && block.text) {
      parts.push(block.text);
    }
  }
  return parts.join('\n').trim();
}
