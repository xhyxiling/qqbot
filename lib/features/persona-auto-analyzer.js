import { analyzeSenderProfile, loadSenderChats, PERSONA_ANALYZER_LABEL, } from "./persona-analyzer.js";
/** 默认触发阈值（与 config.ts 默认值一致） */
export const DEFAULT_AUTO_ANALYZE_THRESHOLD = 20;
/** 阈值上下限（与设置面板校验一致） */
export const MIN_AUTO_ANALYZE_THRESHOLD = 5;
export const MAX_AUTO_ANALYZE_THRESHOLD = 200;
/** 失败冷却(ms) */
export const AUTO_ANALYZE_COOLDOWN_MS = 10 * 60 * 1000;
/** 单次分析超时(ms) */
export const AUTO_ANALYZE_TIMEOUT_MS = 120_000;
/** 把配置里的阈值收敛到合法区间 */
function clampThreshold(value) {
    const raw = Math.trunc(value ?? DEFAULT_AUTO_ANALYZE_THRESHOLD);
    if (!Number.isFinite(raw))
        return DEFAULT_AUTO_ANALYZE_THRESHOLD;
    return Math.min(MAX_AUTO_ANALYZE_THRESHOLD, Math.max(MIN_AUTO_ANALYZE_THRESHOLD, raw));
}
export class PersonaAutoAnalyzer {
    archive;
    store;
    manager;
    llm;
    logger;
    config;
    threshold;
    cooldownMs;
    timeoutMs;
    now;
    /** 待分析队列（按 senderId 去重，保持到达顺序） */
    queue = new Map();
    running = false;
    disposed = false;
    controller;
    pumping;
    constructor(options) {
        this.archive = options.archive;
        this.store = options.store;
        this.manager = options.manager;
        this.llm = options.llm;
        this.logger = options.logger;
        this.config = options.config;
        this.threshold = clampThreshold(options.threshold);
        this.cooldownMs = Math.max(0, Math.trunc(options.cooldownMs ?? AUTO_ANALYZE_COOLDOWN_MS));
        this.timeoutMs = Math.max(1, Math.trunc(options.timeoutMs ?? AUTO_ANALYZE_TIMEOUT_MS));
        this.now = options.now ?? Date.now;
    }
    /** 自动分析是否可用（档案功能关闭 / 自动分析开关关闭时不排队） */
    get enabled() {
        return this.config.personaAnalysis?.enabled !== false
            && this.config.personaAnalysis?.autoAnalyze !== false;
    }
    /**
     * 中间件通知：某位群友刚写入一条新消息。
     *
     * 只做计数与冷却判断，不 await 模型；重复通知按 senderId 合并。
     */
    notify(notice) {
        if (this.disposed || !this.enabled)
            return;
        const count = this.archive.countBySender(notice.senderId);
        if (count < this.threshold)
            return;
        const profile = this.store.get(notice.senderId);
        if (profile?.analysis !== undefined && count - profile.analyzedMessageCount < this.threshold)
            return;
        const lastAttempt = profile?.lastAttemptAt;
        if (lastAttempt !== undefined && this.now() - lastAttempt < this.cooldownMs)
            return;
        this.queue.set(notice.senderId, {
            senderId: notice.senderId,
            ...(notice.senderName !== undefined ? { senderName: notice.senderName } : {}),
            scope: notice.scope,
            peerId: notice.peerId,
        });
        this.startPump();
    }
    /** 等待队列清空（测试 / 关停前使用） */
    async drain() {
        while (this.pumping !== undefined)
            await this.pumping;
    }
    /** 插件卸载：中断当前请求并清空队列 */
    dispose() {
        this.disposed = true;
        this.queue.clear();
        this.controller?.abort();
        this.controller = undefined;
    }
    startPump() {
        if (this.running || this.disposed)
            return;
        this.running = true;
        this.pumping = this.pump().finally(() => {
            this.running = false;
            this.pumping = undefined;
        });
    }
    /** 串行消费队列：一次只跑一位群友的分析 */
    async pump() {
        while (!this.disposed && this.queue.size > 0) {
            const entry = this.queue.entries().next().value;
            if (entry === undefined)
                return;
            this.queue.delete(entry[0]);
            await this.process(entry[1]);
        }
    }
    resolveRoute(entry) {
        const route = this.manager.getEffectiveModel(entry.scope, entry.peerId);
        if (route?.provider && route.model)
            return { provider: route.provider, model: route.model };
        if (this.config.provider && this.config.model) {
            return { provider: this.config.provider, model: this.config.model };
        }
        return undefined;
    }
    async process(entry) {
        if (this.disposed)
            return;
        const route = this.resolveRoute(entry);
        if (route === undefined) {
            this.store.markAttempt(entry.senderId, this.now(), '未配置模型（provider/model）');
            this.logger.warn(`im-qqbot: 自动人格档案跳过 ${entry.senderId}（未配置模型）`);
            return;
        }
        const chats = loadSenderChats(this.archive, entry.senderId);
        const messageCount = chats.reduce((sum, chat) => sum + chat.messages.length, 0);
        if (messageCount < this.threshold)
            return;
        const senderName = entry.senderName ?? chats
            .flatMap((chat) => chat.messages)
            .map((message) => message.senderName)
            .filter((name) => name !== undefined && name !== '')
            .at(-1);
        this.store.markAttempt(entry.senderId, this.now());
        const controller = new AbortController();
        this.controller = controller;
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        timer.unref?.();
        try {
            const result = await analyzeSenderProfile({
                llm: this.llm,
                route,
                senderId: entry.senderId,
                ...(senderName !== undefined ? { senderName } : {}),
                chats,
                signal: controller.signal,
            });
            if (this.disposed)
                return;
            const analyzedAt = this.now();
            this.store.upsert({
                senderId: entry.senderId,
                ...(senderName !== undefined ? { senderName } : {}),
                analysis: result.analysis,
                analyzedMessageCount: result.messageCount,
                analyzedChatCount: result.chatCount,
                analyzedAt,
                provider: result.provider,
                model: result.model,
                lastAttemptAt: analyzedAt,
            });
            this.logger.info(`im-qqbot: 自动人格档案已更新 ${entry.senderId}（messages=${result.messageCount} `
                + `chats=${result.chatCount} confidence=${result.analysis.confidence}）`);
        }
        catch (err) {
            if (this.disposed)
                return;
            const message = err instanceof Error ? err.message : String(err);
            this.store.markAttempt(entry.senderId, this.now(), message);
            this.logger.warn(`im-qqbot: 自动人格档案失败 ${entry.senderId}: ${message}`);
        }
        finally {
            clearTimeout(timer);
            if (this.controller === controller)
                this.controller = undefined;
        }
    }
}
/** 自动分析器标签（供外部日志/测试断言） */
export const PERSONA_AUTO_ANALYZER_LABEL = `${PERSONA_ANALYZER_LABEL}:auto`;
//# sourceMappingURL=persona-auto-analyzer.js.map