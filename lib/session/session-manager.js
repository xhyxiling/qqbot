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
import { legacyDerivedSessionId, mintSessionId } from "./session-id.js";
import { SessionId } from '@deepseek-ai/dsh-session';
import { createHostAdapter } from "../host/adapter.js";
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { ModelResolver } from "../model/model-resolver.js";
import { findPersona, PERSONA_OFF, resolvePersonaId } from "../personas/persona-utils.js";
import { applyPersonaToolBinding, listToolNames, resolveToolBinding, } from "../personas/persona-tools.js";
import { DEFAULT_TOOL_ALLOWLIST, STICKER_TOOL_NAMES, CONTROL_TOOL_NAME, CURRENT_PERSONA_TOOL_NAME, } from "../shared/tool-catalog.js";
import { NamesStore } from "../identity/names-store.js";
import { MemoryStore, classifyFact, } from "../memory/memory-store.js";
import { IdentityStore, inferChannel } from "../memory/identity-store.js";
import { MemoryExtractor } from "../memory/memory-extractor.js";
import { ProactiveJudge } from "../features/proactive-judge.js";
import { extractMemoryFacts } from "../memory/memory-prompt.js";
import { IdleEvictor } from "./idle-evictor.js";
import { buildSessionPromptSections } from "./prompt-assembly.js";
import { resolveActiveVoiceSettings } from "../voice/voice-config.js";
import { VOICE_TOOL_NAME } from "../voice/voice-tool.js";
import { DESCRIBE_IMAGE_TOOL_NAME } from "../media/vision-tool.js";
import { getActiveStickerEngine } from "../sticker/index.js";
/** ManualCompactionError 各 code 的友好提示 */
const COMPACTION_ERROR_HINTS = {
    busy: '压缩服务忙，请稍后重试',
    cancelled: '压缩已取消',
    changed: '历史在压缩过程中发生变化，请重试',
    commit: '压缩提交失败',
    persistence: '压缩完成但保存失败',
};
/** 复刻宿主 latestCompletedPrefixBoundary：最后一个 turn/end 起到下一 turn 开始前的边界 */
export function latestCompletedPrefixBoundary(events) {
    const list = events;
    let lastTurnEndSeq;
    for (let i = list.length - 1; i >= 0; i -= 1) {
        const candidate = list[i];
        if (candidate?.type === 'turn/end') {
            lastTurnEndSeq = candidate.seq;
            break;
        }
    }
    if (lastTurnEndSeq === undefined)
        return undefined;
    let boundary = lastTurnEndSeq;
    for (const next of list.slice(boundary + 1)) {
        if (next.type === 'turn/start'
            || (next.type === 'user/message' && next.surfaceOp === 'append')
            || next.type === 'agent/inbox/spliced')
            break;
        if (next.seq !== undefined)
            boundary = next.seq;
    }
    return boundary;
}
/** 记忆按通道分开存储：官方侧与 OneBot 侧互不混用 */
const CHANNELS = ['official', 'onebot'];
export class SessionManager {
    sessions = new Map();
    evictor;
    modelResolver;
    /**
     * 长期记忆与关系状态：按通道分开存储。
     * 官方侧 ~/.dsh-qqbot/memory.official.json（主键 openid）
     * OneBot 侧 ~/.dsh-qqbot/memory.onebot.json（主键 QQ 号）
     */
    memoryStores;
    /** 身份归一：同一人在同一通道内的多个 senderId（identities.json） */
    identityStore;
    /** LLM 异步记忆抽取：每个通道一个，互不混合（llm 可用时由 bootstrap 注入） */
    memoryExtractors = {};
    /** 主动发言前的模型判断（llm 可用时由 bootstrap 注入） */
    proactiveJudge;
    /** 机器人自称 / QQ 账号昵称（~/.dsh-qqbot/names.json） */
    namesStore;
    ctx;
    host;
    agents;
    config;
    logger;
    /** 由 bootstrap 注入的问答通道（ask_user_question → QQ），会话回收时清理其待答问题 */
    questionChannel;
    /** 由 bootstrap 注入的审批通道（approval/request → QQ），会话回收时清理其待批审批 */
    approvalChannel;
    constructor(ctx, agents, config, logger) {
        this.ctx = ctx;
        this.agents = agents;
        this.config = config;
        this.logger = logger;
        this.host = createHostAdapter(ctx, logger);
        this.logger.info(`host adapter capabilities: ${this.host.capabilities.join(', ')}`);
        this.modelResolver = new ModelResolver(ctx, config, logger);
        this.memoryStores = {
            official: new MemoryStore({ channel: 'official', debugLog: (msg) => logger.debug(msg) }),
            onebot: new MemoryStore({ channel: 'onebot', debugLog: (msg) => logger.debug(msg) }),
        };
        this.identityStore = new IdentityStore({ debugLog: (msg) => logger.debug(msg) });
        // 旧版 memory.json 已在各通道加载时拆分；这里为旧 personId 补本通道别名
        for (const channel of CHANNELS) {
            this.identityStore.adoptExisting(this.memoryStores[channel].listPersonIds(), channel);
        }
        this.applyConfiguredAliases();
        this.namesStore = new NamesStore(undefined, (msg) => logger.debug(msg));
        this.evictor = new IdleEvictor(this.sessions, config.sessionIdleTimeout, (key, record) => {
            this.logger.info(`evicting idle session: key=${key}`);
            this.sessions.delete(key);
            record.agent.cancel({ kind: 'user' });
            this.releaseToolBinding(record);
            void record.handle.dispose().catch(() => { });
            // 回收会话时统一清理其待答问题/待批审批，避免 pending 悬挂泄漏
            this.questionChannel?.cancelPending(key);
            this.approvalChannel?.cancelPending(key);
        });
        this.registerScopePromptInjection();
    }
    /**
     * 通过 system-prompt/assemble waterfall 注入全局提示词与人格。
     *
     * 该事件在每次 turn 构建 request 时触发；人格是全局的（全局覆盖 > config.defaultPersona），
     * 记忆分「人物画像（跨会话）」与「本会话关系」两层，叠加全局提示词 section。
     * 会话尚未建立（首次 assemble）或两者都未配置时原样返回，不做改动。
     * 这里只负责取会话数据，section 的具体拼装见 ./prompt-assembly.ts。
     */
    registerScopePromptInjection() {
        const assemble = async (_assembly, context, next) => {
            const assembled = await next();
            if (!context.agent)
                return assembled;
            const record = this.findByAgent(context.agent);
            if (!record)
                return assembled;
            // 官方侧与 OneBot 侧各用各的记忆库：openid 与 QQ 号不混用。
            // 先把「本会话关系」与「同通道人物画像」取出来，再交给纯组装函数。
            const channel = record.replyTarget.channel ?? 'official';
            const memoryStore = this.memoryStores[channel];
            const personId = this.config.memory.enabled
                ? this.identityStore.resolve(channel, record.senderId, undefined, record.scope)
                : '';
            // 表情库快照：用稳定编号（按收藏时间）注入，prompt 里的 #N 与
            // send_sticker 的 sticker_no 一一对应。
            const stickerEngine = getActiveStickerEngine();
            const sections = buildSessionPromptSections({
                config: this.config,
                persona: this.getEffectivePersona(record.scope, record.peerId),
                chatMemory: memoryStore.get(this.sessionKey(record.scope, record.peerId)),
                personMemory: personId === '' ? undefined : memoryStore.getPerson(personId),
                names: this.namesStore.get(),
                ...(record.lastUserText !== undefined ? { lastUserText: record.lastUserText } : {}),
                sticker: {
                    total: stickerEngine?.store.all().length ?? 0,
                    catalog: stickerEngine?.store.numbered().map(({ no, sticker }) => ({
                        no,
                        description: sticker.description,
                        tags: sticker.tags,
                    })) ?? [],
                },
            });
            if (sections.length === 0)
                return assembled;
            return {
                ...assembled,
                sections: [...(assembled.sections ?? []), ...sections],
            };
        };
        this.ctx.on('system-prompt/assemble', assemble);
    }
    /**
     * 动态获取 agentPresets 服务（可选，未注入时返回 undefined）
     */
    getPresetsService() {
        try {
            return this.ctx.get('agentPresets');
        }
        catch {
            return undefined;
        }
    }
    /**
     * 从 session 持久化 header 读 session 当初的 preset（started 锁定语义）。
     * 读不到（服务缺失 / session 不存在 / 未记录 agentPreset）返回 undefined。
     */
    async resolvePersistedPreset(sessionId) {
        let persistence;
        try {
            persistence = this.ctx.get('sessionPersistence');
        }
        catch {
            return undefined;
        }
        if (!persistence)
            return undefined;
        try {
            const { meta } = await persistence.load(sessionId);
            return meta?.agentPreset;
        }
        catch {
            return undefined;
        }
    }
    // ── 模型相关（委托给 ModelResolver） ──
    getEffectiveModel(scope, peerId) {
        return this.modelResolver.getEffectiveRoute(this.sessionKey(scope, peerId));
    }
    /**
     * 获取指定 peer 的生效 preset（per-peer 覆盖 > config.preset）
     */
    getEffectivePreset(scope, peerId) {
        return this.getEffectivePresetByKey(this.sessionKey(scope, peerId));
    }
    /** 按 sessionKey 解析生效 preset */
    getEffectivePresetByKey(key) {
        return this.modelResolver.getPreset(key) ?? this.config.preset;
    }
    /**
     * 列出所有可用 preset（/preset 命令用）
     */
    async listPresets() {
        const presets = this.getPresetsService();
        if (!presets)
            return [];
        try {
            const list = await presets.list();
            return list.map((p) => ({ id: p.id, name: p.name, description: p.description }));
        }
        catch (err) {
            this.logger.warn(`list presets failed: ${err instanceof Error ? err.message : String(err)}`);
            return [];
        }
    }
    /**
     * 切换模型（fork + 重建会话，保留历史）
     */
    async setModelOverride(scope, peerId, route) {
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
    async setPresetOverride(scope, peerId, presetId) {
        const key = this.sessionKey(scope, peerId);
        // 1. 校验 preset 存在 + 可加载（broken 拒绝）
        const presets = this.getPresetsService();
        if (!presets)
            return { ok: false, reason: 'unavailable' };
        let resolved;
        try {
            resolved = await presets.resolve(presetId);
        }
        catch (err) {
            return { ok: false, reason: 'unknown-preset', message: err instanceof Error ? err.message : String(err) };
        }
        if (resolved.broken !== undefined) {
            return { ok: false, reason: 'broken', message: resolved.broken };
        }
        // 2. 持久化 per-peer 覆盖（新会话生效）
        this.modelResolver.setPreset(key, presetId);
        const hasActive = this.sessions.has(key);
        this.logger.info(`preset pref saved: key=${key} → ${presetId}${hasActive ? ' (active session locked, next session applies)' : ''}`);
        return { ok: true, presetId };
    }
    /**
     * 清除 per-peer preset 覆盖，回到 config.preset / 默认（新会话生效）
     */
    async clearPresetOverride(scope, peerId) {
        const key = this.sessionKey(scope, peerId);
        this.modelResolver.clearPreset(key);
        this.logger.info(`preset pref cleared: key=${key} (next session applies)`);
        return { ok: true };
    }
    // ── 人格预设（/persona） ──
    /** 列出配置中的人格预设 */
    listPersonas() {
        return [...(this.config.personas ?? [])];
    }
    /** 按 id 查找人格预设 */
    findPersonaById(id) {
        return findPersona(this.config.personas, id);
    }
    /**
     * 解析当前生效的人格 id（全局，所有群/私聊统一）。
     *
     * 优先级：全局覆盖 > config.defaultPersona；指向已删除的人格时返回 undefined。
     * 参数保留是为了兼容既有调用点，不再参与解析。
     */
    getEffectivePersonaId(_scope, _peerId) {
        return resolvePersonaId(this.config.personas, this.config.defaultPersona, this.modelResolver.getGlobalPersona());
    }
    /** 解析当前生效的人格预设（全局） */
    getEffectivePersona(_scope, _peerId) {
        return findPersona(this.config.personas, this.getEffectivePersonaId());
    }
    /** 是否设置了全局人格覆盖（用于区分「跟随默认」与「手动指定」） */
    hasGlobalPersonaOverride() {
        return this.modelResolver.getGlobalPersona() !== undefined;
    }
    /**
     * 全局切换人格：所有群与私聊立刻统一生效。
     *
     * 人格通过 system-prompt/assemble 每次 turn 注入，无需重建会话，
     * 下一条消息即时生效；工具绑定需要刷新所有活跃会话。
     */
    setGlobalPersona(personaId) {
        const persona = this.findPersonaById(personaId);
        if (!persona)
            return false;
        this.modelResolver.setGlobalPersona(personaId);
        this.logger.info(`global persona switched → ${personaId} (next turn applies)`);
        this.refreshAllToolBindings();
        return true;
    }
    /** 清除全局人格覆盖，回到 config.defaultPersona */
    clearGlobalPersona() {
        const cleared = this.modelResolver.clearGlobalPersona();
        if (cleared) {
            this.logger.info('global persona override cleared');
            this.refreshAllToolBindings();
        }
        return cleared;
    }
    /** 全局关闭人格（写入哨兵覆盖，所有会话一起关闭） */
    disableGlobalPersona() {
        this.modelResolver.setGlobalPersona(PERSONA_OFF);
        this.logger.info('global persona disabled (next turn applies)');
        this.refreshAllToolBindings();
    }
    // ── 人格工具绑定（/tools） ──
    /**
     * 当前可限制的工具名（`/tools` 展示与白名单校验用）。
     *
     * 传入 `agent` 才会带上 preset 挂载的工具（它们是 agent 的祖先层）；
     * 缺省 agent 只返回宿主全局层，会漏掉 preset 里的工具。
     */
    listToolNames(agent) {
        return listToolNames(this.getToolsService(), agent);
    }
    /** 按会话取工具清单：有活跃会话用它的 agent 作用域，否则退化为全局层视图 */
    listToolNamesFor(scope, peerId) {
        return this.listToolNames(this.sessions.get(this.sessionKey(scope, peerId))?.agent);
    }
    /**
     * 确保会话存在（诊断类命令需要读 agent 作用域时使用）。
     *
     * 斜杠命令由中间件直接处理、不经过入站流程，不会自动建会话；没有会话
     * 就拿不到 agent 作用域，`tools.view()` 只能看到全局层（会漏掉 preset
     * 挂载的工具）。
     */
    async ensureSession(scope, peerId, senderId, replyTarget) {
        if (this.sessions.has(this.sessionKey(scope, peerId)))
            return;
        await this.getOrCreate(scope, peerId, senderId, replyTarget);
    }
    /**
     * 收敛人格白名单：没人格或人格没写 `tools` 时用默认放行清单，
     * 写了 `tools` 时再与默认清单求交（文件读写/命令执行等一律不放行）。
     *
     * @returns whitelist 实际放行的工具名；blocked 被策略挡掉的名字（仅告警）
     */
    resolveWhitelist(requested) {
        let whitelist;
        let blocked = [];
        if (requested === undefined) {
            whitelist = [...DEFAULT_TOOL_ALLOWLIST];
        }
        else {
            whitelist = [];
            for (const raw of requested) {
                const name = raw.trim();
                if (name === '')
                    continue;
                if (DEFAULT_TOOL_ALLOWLIST.includes(name))
                    whitelist.push(name);
                else
                    blocked.push(name);
            }
        }
        // 语音是「投递方式」而不是一项能力：语音可用时始终放行 qqbot_voice，
        // 即使人格显式写了 `tools: []`（否则该人格永远发不了语音）。
        if (resolveActiveVoiceSettings(this.config.voice) !== undefined && !whitelist.includes(VOICE_TOOL_NAME)) {
            whitelist.push(VOICE_TOOL_NAME);
        }
        // 看图属于「感知」而不是可选能力：始终放行 qqbot_describe_image，
        // 即使人格写了 `tools: []`——否则别人发图/表情包时模型只有路径没法看，
        // 连对方发的是不是表情包都判断不了。工具未注册时该名字会被忽略，无副作用。
        if (!whitelist.includes(DESCRIBE_IMAGE_TOOL_NAME)) {
            whitelist.push(DESCRIBE_IMAGE_TOOL_NAME);
        }
        // sticker 三工具也是消息投递能力：始终放行，不受 persona 白名单限制
        for (const name of STICKER_TOOL_NAMES) {
            if (!whitelist.includes(name))
                whitelist.push(name);
        }
        // 管理工具属于「机器人自身设置入口」：人格写 tools:[] 也不能把它关掉，
        // 否则主人一旦切到封闭人格就再也换不回来了
        if (!whitelist.includes(CONTROL_TOOL_NAME))
            whitelist.push(CONTROL_TOOL_NAME);
        // 取当前人格同理：每轮回复前都要调用，不能被人格白名单关掉
        if (!whitelist.includes(CURRENT_PERSONA_TOOL_NAME))
            whitelist.push(CURRENT_PERSONA_TOOL_NAME);
        return { whitelist, blocked };
    }
    /**
     * 解析某个会话的人格工具绑定。
     *
     * `restricted=false` 表示该人格未配置 `tools`（此时按默认放行清单限制）。
     */
    getPersonaToolBinding(scope, peerId) {
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
    getToolsService() {
        try {
            return this.ctx.get('tools');
        }
        catch {
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
    applyToolBinding(record) {
        const persona = this.getEffectivePersona(record.scope, record.peerId);
        const personaId = persona?.id ?? null;
        const current = record.toolRestriction;
        if (current !== undefined && current.personaId === personaId)
            return;
        const { whitelist, blocked } = this.resolveWhitelist(persona?.tools);
        if (blocked.length > 0) {
            this.logger.warn(`im-qqbot: 人格 ${personaId ?? 'none'} 配置了默认不开放的工具（已禁用）: ${blocked.join(', ')}`);
        }
        current?.dispose?.();
        record.toolRestriction = undefined;
        const dispose = applyPersonaToolBinding(record.agent.ctx, record.agent, whitelist, personaId ?? '(default policy)', this.logger);
        record.toolRestriction = { personaId, ...(dispose ? { dispose } : {}) };
        this.logger.info(`tool binding applied: key=${record.sessionKey} persona=${personaId ?? 'none'} `
            + `allow=${whitelist.join(',') || '(none)'}`);
    }
    /** 释放会话的工具限制（会话回收/重建/移除前调用） */
    releaseToolBinding(record) {
        record.toolRestriction?.dispose?.();
        record.toolRestriction = undefined;
    }
    /** 人格切换后立即刷新所有活跃会话的工具绑定（无会话时留待创建时应用） */
    refreshAllToolBindings() {
        for (const record of this.sessions.values())
            this.applyToolBinding(record);
    }
    // ── 记忆与关系状态（/memory） ──
    /** 通道缺省时按 id 形状兜底：纯数字 = OneBot QQ 号，其余 = 官方 openid */
    memoryChannel(id, channel) {
        return channel ?? inferChannel(id);
    }
    /** 读取指定会话的长期记忆与关系状态（按通道取各自的库） */
    getChatMemory(scope, peerId, channel) {
        const store = this.memoryStores[this.memoryChannel(peerId, channel)];
        return store.get(this.sessionKey(scope, peerId));
    }
    /**
     * 记录一次用户互动：累加对应通道的会话统计与人物互动次数，
     * 并按需自动捕获自述要点（只写入本通道的画像）。
     *
     * 记忆独立于会话历史：`/new` 只换上下文，记忆仍保留；重启后同样保留。
     */
    recordInteraction(scope, peerId, senderId, senderName, text, channel) {
        if (!this.memoryEnabled)
            return;
        const ch = this.memoryChannel(senderId, channel);
        const store = this.memoryStores[ch];
        const key = this.sessionKey(scope, peerId);
        store.recordInteraction(key, scope, peerId);
        // 同一通道内按 personId 累积（官方侧跨群仍需绑定，OneBot 侧 QQ 号天然唯一）
        const personId = this.identityStore.resolve(ch, senderId, senderName, scope);
        if (personId === '')
            return;
        store.recordPersonInteraction(personId, senderName);
        if (this.config.memory.autoCapture) {
            for (const fact of extractMemoryFacts(text)) {
                store.addPersonNote(personId, fact, 'auto', this.config.memory.maxNotes, {
                    kind: classifyFact(fact),
                    sourceChat: key,
                });
            }
        }
        // LLM 慢路径：攒够消息后异步抽取更完整的长期事实（每个通道独立抽取）
        this.memoryExtractors[ch]?.enqueue(personId, text, scope, peerId);
    }
    /** 解析 senderId 对应的 personId（同一通道内的「人」） */
    resolvePersonId(senderId, channel) {
        return this.identityStore.resolve(this.memoryChannel(senderId, channel), senderId, undefined, 'c2c');
    }
    /** 读取某人在指定通道内的画像 */
    getPersonMemory(senderId, channel) {
        const ch = this.memoryChannel(senderId, channel);
        const personId = this.resolvePersonId(senderId, ch);
        return personId === '' ? undefined : this.memoryStores[ch].getPerson(personId);
    }
    /** 机器人自称 / QQ 账号昵称（两者独立） */
    getBotNames() {
        return this.namesStore.get();
    }
    /** 设置机器人自称（只影响提示词，不改 QQ 资料）；name 传空串清除 */
    setBotName(name) {
        this.namesStore.setBotName(name);
    }
    /** 记录 QQ 账号当前昵称（实际改资料由调用方完成）；name 传空串清除 */
    setQqAccountName(name) {
        this.namesStore.setQqAccountName(name);
    }
    /**
     * 让 LLM 记忆抽取可用（bootstrap 在拿到宿主 llm 服务后调用）。
     * 关闭 memory.llmExtract 或没有 llm 时保持 undefined，只走规则快路径。
     */
    attachMemoryLlm(llm) {
        if (llm?.stream === undefined || !this.config.memory.enabled || !this.config.memory.llmExtract)
            return;
        for (const channel of CHANNELS) {
            const store = this.memoryStores[channel];
            this.memoryExtractors[channel] = new MemoryExtractor({
                llm,
                getRoute: (scope, peerId) => this.getEffectiveModel(scope, peerId) ?? (this.config.provider && this.config.model
                    ? { provider: this.config.provider, model: this.config.model }
                    : undefined),
                getKnownFacts: (personId) => store.getPerson(personId)?.notes ?? [],
                onFacts: (personId, facts, scope, peerId) => {
                    // 身份可能已在抽取期间被绑定合并：丢弃已不存在的旧 person，避免复活
                    if (!this.identityStore.has(personId))
                        return;
                    store.addPersonFacts(personId, facts, 'llm', this.config.memory.maxNotes, this.sessionKey(scope, peerId));
                },
                threshold: this.config.memory.extractThreshold,
                logger: this.logger,
            });
        }
    }
    /**
     * 让主动发言前的模型判断可用（bootstrap 拿到宿主 llm 后调用）。
     * 没有 llm 时保持 undefined，退化为「概率 + 回复模型自己输出 [SILENT]」。
     */
    attachProactiveLlm(llm) {
        if (llm?.stream === undefined)
            return;
        this.proactiveJudge = new ProactiveJudge({
            llm,
            getRoute: (scope, peerId) => this.getEffectiveModel(scope, peerId) ?? (this.config.provider && this.config.model
                ? { provider: this.config.provider, model: this.config.model }
                : undefined),
            logger: this.logger,
        });
    }
    /**
     * 概率命中后，再让模型判断现在插话会不会打断别人。
     * 配置关闭 / 没有 llm 时返回 true，保持原有行为。
     */
    async judgeProactive(input, scope, peerId) {
        if (this.config.proactive?.enabled !== true || this.config.proactive.modelJudge !== true) {
            return true;
        }
        if (this.proactiveJudge === undefined)
            return true;
        return this.proactiveJudge.shouldSpeak(scope, peerId, input);
    }
    /** 手动给某人画像加一条要点；记忆关闭或内容重复时返回 undefined */
    addPersonNote(senderId, text, channel) {
        if (!this.memoryEnabled)
            return undefined;
        const ch = this.memoryChannel(senderId, channel);
        const personId = this.resolvePersonId(senderId, ch);
        return this.memoryStores[ch].addPersonNote(personId, text, 'manual', this.config.memory.maxNotes);
    }
    /** 删除某人画像的第 index 条要点（0-based） */
    removePersonNote(senderId, index, channel) {
        if (!this.memoryEnabled)
            return false;
        const ch = this.memoryChannel(senderId, channel);
        const personId = this.resolvePersonId(senderId, ch);
        return this.memoryStores[ch].removePersonNote(personId, index);
    }
    /** 清空某人画像的要点（保留关系统计）；返回删除条数 */
    clearPersonNotes(senderId, channel) {
        if (!this.memoryEnabled)
            return 0;
        const ch = this.memoryChannel(senderId, channel);
        const personId = this.resolvePersonId(senderId, ch);
        return this.memoryStores[ch].clearPersonNotes(personId);
    }
    /** 签发绑定码：把一个会话里的身份挂到当前 person 上（仅在当前通道内有效） */
    issueMemoryBindCode(senderId, channel) {
        if (!this.memoryEnabled)
            return { ok: false, reason: 'disabled' };
        const ch = this.memoryChannel(senderId, channel);
        const personId = this.resolvePersonId(senderId, ch);
        const code = this.identityStore.issueBindCode(personId, ch);
        return code === undefined ? { ok: false, reason: 'unavailable' } : { ok: true, code };
    }
    /** 兑换绑定码：只归并同一通道内的两个身份及其记忆，跨通道拒绝 */
    redeemMemoryBindCode(code, senderId, channel) {
        if (!this.memoryEnabled)
            return { ok: false, reason: 'disabled' };
        const ch = this.memoryChannel(senderId, channel);
        const result = this.identityStore.redeemBindCode(code, ch, senderId, undefined, 'c2c');
        if (!result.ok)
            return result;
        if (result.mergedPersonId !== undefined) {
            this.memoryStores[ch].mergePeople(result.mergedPersonId, result.personId, this.config.memory.maxNotes);
            this.memoryExtractors[ch]?.rekey(result.mergedPersonId, result.personId);
        }
        return { ok: true, merged: result.mergedPersonId !== undefined };
    }
    /** 手动添加一条会话要点记忆；记忆关闭或内容重复时返回 undefined */
    addMemoryNote(scope, peerId, text, channel) {
        if (!this.memoryEnabled)
            return undefined;
        const store = this.memoryStores[this.memoryChannel(peerId, channel)];
        return store.addNote(this.sessionKey(scope, peerId), scope, peerId, text, 'manual', this.config.memory.maxNotes);
    }
    /** 删除第 index 条会话要点记忆（0-based）；越界或记忆关闭时返回 false */
    removeMemoryNote(scope, peerId, index, channel) {
        if (!this.memoryEnabled)
            return false;
        const store = this.memoryStores[this.memoryChannel(peerId, channel)];
        return store.removeNote(this.sessionKey(scope, peerId), index);
    }
    /** 清空当前会话的要点记忆（保留互动次数与关系阶段）；返回删除条数 */
    clearMemoryNotes(scope, peerId, channel) {
        if (!this.memoryEnabled)
            return 0;
        const store = this.memoryStores[this.memoryChannel(peerId, channel)];
        return store.clearNotes(this.sessionKey(scope, peerId));
    }
    /**
     * 人工别名组：只在同一通道内归并。
     *
     * 官方 openid 与 OneBot QQ 号属于两套独立存储，跨通道不合并；
     * 主人名单里的官方 id 只在官方库内合并、QQ 号只在 OneBot 库内合并。
     */
    applyConfiguredAliases() {
        const byChannel = { official: [], onebot: [] };
        const addGroup = (ids) => {
            const split = { official: [], onebot: [] };
            for (const id of ids) {
                const value = id.trim();
                if (value === '')
                    continue;
                split[inferChannel(value)].push(value);
            }
            for (const channel of CHANNELS) {
                if (split[channel].length >= 2)
                    byChannel[channel].push(split[channel]);
            }
        };
        addGroup(this.config.identity?.ownerOpenIds ?? []);
        for (const group of this.config.memory.aliases ?? [])
            addGroup(group);
        for (const channel of CHANNELS) {
            const store = this.memoryStores[channel];
            for (const group of byChannel[channel]) {
                const linked = this.identityStore.linkGroup(channel, group);
                if (linked === undefined)
                    continue;
                for (const merged of linked.mergedPersonIds) {
                    store.mergePeople(merged, linked.targetPersonId, this.config.memory.maxNotes);
                }
            }
        }
    }
    /** 记忆功能是否开启（关闭时命令与自动捕获都不写盘） */
    get memoryEnabled() {
        return this.config.memory.enabled;
    }
    /**
     * fork + 重建会话（保留历史，换 model）
     *
     * options.route 缺省时沿用当前生效值。preset 沿用当前生效 preset（getEffectivePresetByKey）。
     * fork 不可用或失败时降级为 dispose（下次消息重建）。
     */
    async rebuildSession(record, options) {
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
            await record.handle.dispose().catch(() => { });
            return;
        }
        const seed = await this.host.buildForkSeed(events, boundary);
        if (seed === undefined) {
            this.logger.warn(`fork seed unavailable (old host), fallback to dispose: key=${key}`);
            this.sessions.delete(key);
            record.agent.cancel({ kind: 'user' });
            this.releaseToolBinding(record);
            await record.handle.dispose().catch(() => { });
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
        void oldHandle.dispose().catch(() => { });
        this.logger.info(`session rebuilt via fork: key=${key} preset=${composed.agentPreset ?? 'none'} sessionId=${childId}`);
    }
    clearModelOverride(scope, peerId) {
        const key = this.sessionKey(scope, peerId);
        this.modelResolver.clearOverride(key);
        this.modelResolver.clearSessionId(key);
    }
    async listAvailableModels() {
        return this.modelResolver.listModels();
    }
    listProviders() {
        return this.modelResolver.listProviders();
    }
    // ── 会话状态 / 统计 ──
    getSessionRecord(scope, peerId) {
        return this.sessions.get(this.sessionKey(scope, peerId));
    }
    getStatus(scope, peerId) {
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
    getTokenUsage(scope, peerId) {
        const record = this.getSessionRecord(scope, peerId);
        const stats = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
        if (!record)
            return stats;
        const events = this.host.sessionEvents(record.agent.session);
        if (!events)
            return stats;
        for (const event of events) {
            if (event.type !== 'assistant/message' || !event.usage)
                continue;
            stats.input += event.usage.input ?? 0;
            stats.output += event.usage.output ?? 0;
            stats.cacheRead += event.usage.cacheRead ?? 0;
            stats.cacheWrite += event.usage.cacheWrite ?? 0;
        }
        return stats;
    }
    exportMarkdown(scope, peerId) {
        const record = this.getSessionRecord(scope, peerId);
        if (!record)
            return '';
        const events = this.host.sessionEvents(record.agent.session);
        if (!events || events.length === 0)
            return '';
        const lines = [`# QQ 会话导出\n`, `> session: ${record.sessionId}\n`];
        for (const event of events) {
            if (event.type === 'user/message') {
                const text = extractMessageText(event.message);
                if (text)
                    lines.push(`## 用户\n\n${text}\n`);
            }
            else if (event.type === 'assistant/message') {
                const text = extractMessageText(event.message);
                if (text)
                    lines.push(`## 助手\n\n${text}\n`);
            }
        }
        return lines.join('\n');
    }
    countMessages(record) {
        if (!record)
            return 0;
        const events = this.host.sessionEvents(record.agent.session);
        if (!events)
            return 0;
        let count = 0;
        for (const event of events) {
            if (event.type === 'user/message' || event.type === 'assistant/message') {
                count += 1;
            }
        }
        return count;
    }
    // ── Session 生命周期管理 ──
    sessionKey(scope, peerId) {
        return `qqbot:${this.config.appId}:${scope}:${peerId}`;
    }
    /** prefs 命中沿用；miss 返回 0.5.x 派生候选，由 getOrCreate 按 resume 结果迁移或铸造 */
    currentSessionId(sessionKey) {
        return this.modelResolver.getSessionId(sessionKey) ?? legacyDerivedSessionId(sessionKey);
    }
    /** 候选命中后落盘，后续永远走 prefs */
    persistSessionId(sessionKey, sessionId) {
        if (this.modelResolver.getSessionId(sessionKey) !== sessionId) {
            this.modelResolver.setSessionId(sessionKey, sessionId);
        }
    }
    async composePreset(presetId) {
        const presets = this.getPresetsService();
        if (!presets)
            return {};
        try {
            const resolved = await presets.resolve(presetId);
            const resolvedId = resolved.id;
            return {
                agentPreset: resolvedId,
                setup: async (agentCtx) => {
                    await presets.mount(agentCtx, resolvedId);
                },
            };
        }
        catch (err) {
            this.logger.warn(`im-qqbot: preset ${presetId ?? '(default)'} unavailable: ${err instanceof Error ? err.message : String(err)} — using host composition`);
            return {};
        }
    }
    /** 获取或恢复或创建会话（get → resume → create） */
    async getOrCreate(scope, peerId, senderId, replyTarget) {
        const key = this.sessionKey(scope, peerId);
        const existing = this.sessions.get(key);
        if (existing) {
            // 群聊会话是群内多人共享的：senderId 必须跟随当前这条消息的发送者，
            // 否则工具权限门控会一直拿着「会话创建者」的身份去判定后来的人
            // （主人进群发言也会被判成陌生人）。
            existing.senderId = senderId;
            existing.replyTarget = replyTarget;
            existing.lastActivity = Date.now();
            return existing;
        }
        const route = this.modelResolver.getEffectiveRoute(key);
        let sessionId = SessionId(this.currentSessionId(key));
        this.logger.info(`getOrCreate: key=${key} route=${route ? `${route.provider}/${route.model}` : 'host-default'} sessionId=${sessionId}`);
        let agent;
        let handle;
        let agentPreset;
        const live = this.agents.get(sessionId);
        if (live) {
            agent = live;
            this.persistSessionId(key, sessionId);
            this.logger.info(`reusing live agent: key=${key}`);
        }
        else {
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
            }
            catch {
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
        const record = {
            sessionKey: key,
            sessionId,
            agent,
            handle: handle ?? { agent, dispose: async () => { } },
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
    findBySessionId(sessionId) {
        for (const record of this.sessions.values()) {
            if (record.sessionId === sessionId)
                return record;
        }
        return undefined;
    }
    findByAgent(agent) {
        for (const record of this.sessions.values()) {
            if (record.agent === agent)
                return record;
        }
        return undefined;
    }
    async remove(scope, peerId) {
        const key = this.sessionKey(scope, peerId);
        const record = this.sessions.get(key);
        this.modelResolver.setSessionId(key, mintSessionId());
        if (!record)
            return;
        this.sessions.delete(key);
        record.agent.cancel({ kind: 'user' });
        this.releaseToolBinding(record);
        await record.handle.dispose().catch(() => { });
        this.logger.info(`session removed: key=${key}`);
    }
    /** Agent 工作目录：显式配置优先，缺省独立目录 ~/.dsh-qqbot/workspace（不随宿主进程 cwd） */
    workspaceCache;
    workspaceDir() {
        if (this.workspaceCache)
            return this.workspaceCache;
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
    async compact(scope, peerId, revive) {
        const key = this.sessionKey(scope, peerId);
        let record = this.sessions.get(key);
        if (!record) {
            // 无活跃会话（重启/闲置回收）时从磁盘拉起，历史在磁盘上仍可压缩
            if (!revive)
                return { ok: false, reason: 'no-session' };
            record = await this.getOrCreate(scope, peerId, revive.senderId, revive.replyTarget);
        }
        if (record.agent.status !== 'idle')
            return { ok: false, reason: 'busy' };
        const compaction = (await this.host.serviceFor(record.agent, 'compaction')
            ?? this.host.globalService('compaction'));
        if (!compaction)
            return { ok: false, reason: 'unavailable' };
        const route = this.modelResolver.getEffectiveRoute(key);
        const agentCtx = {
            session: record.agent.session,
            options: { provider: route?.provider, model: route?.model },
            runMaintenance: record.agent.runMaintenance.bind(record.agent),
        };
        try {
            const result = await compaction.compactNow(agentCtx, new AbortController().signal);
            if (result === null)
                return { ok: true, shadowed: 0, tokens: 0 };
            return { ok: true, shadowed: result.shadowedSeqs.length, tokens: result.shadowedTokenCount };
        }
        catch (err) {
            const code = err?.code;
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
    async disposeAll() {
        this.evictor.dispose();
        for (const channel of CHANNELS) {
            this.memoryExtractors[channel]?.dispose();
            delete this.memoryExtractors[channel];
            this.memoryStores[channel].flush();
        }
        this.proactiveJudge?.dispose();
        this.proactiveJudge = undefined;
        this.identityStore.flush();
        const records = [...this.sessions.values()];
        this.sessions.clear();
        for (const record of records) {
            record.agent.cancel({ kind: 'user' });
            this.releaseToolBinding(record);
        }
        await Promise.allSettled(records.map((r) => r.handle.dispose()));
        this.logger.info(`all sessions disposed (count=${records.length})`);
    }
    get size() {
        return this.sessions.size;
    }
}
/** 从消息对象中提取纯文本（用于导出/统计） */
function extractMessageText(message) {
    const blocks = message?.content;
    if (!blocks || !Array.isArray(blocks))
        return '';
    const parts = [];
    for (const block of blocks) {
        if (block.type === 'text' && block.text) {
            parts.push(block.text);
        }
    }
    return parts.join('\n').trim();
}
//# sourceMappingURL=session-manager.js.map