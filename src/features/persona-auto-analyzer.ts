/**
 * 自动人格档案 — 群友累计发言达到阈值后自动分析
 *
 * 中间件每写入一条新消息就 `notify()` 一次；这里只做轻量判断（计数、冷却），
 * 真正的模型调用进入串行队列，避免群聊高峰期并发打满模型额度：
 *
 * - 累计发言 ≥ `autoAnalyzeThreshold`（默认 20）才触发；
 * - 已有档案时，只有「新增条数 ≥ 阈值」才重新分析（持续更新）；
 * - 失败后冷却 10 分钟再重试，避免同一人反复打爆；
 * - 全局并发 1，同一个人不会排队多次；
 * - 超时 120s 自动中断，插件卸载时 `dispose()` 清空队列。
 */
import type { ImQQBotConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import {
  analyzeSenderProfile,
  loadSenderChats,
  PERSONA_ANALYZER_LABEL,
} from './persona-analyzer.ts';
import type { LlmRuntimeLike, SessionModelLookup } from './model-route.ts';
import type { PersonaArchiveNotice, PersonaArchive } from './persona-archive.ts';
import type { PersonaProfileStore } from './persona-profiles.ts';

/** 默认触发阈值（与 config.ts 默认值一致） */
export const DEFAULT_AUTO_ANALYZE_THRESHOLD = 20;
/** 阈值上下限（与设置面板校验一致） */
export const MIN_AUTO_ANALYZE_THRESHOLD = 5;
export const MAX_AUTO_ANALYZE_THRESHOLD = 200;
/** 失败冷却(ms) */
export const AUTO_ANALYZE_COOLDOWN_MS = 10 * 60 * 1000;
/** 单次分析超时(ms) */
export const AUTO_ANALYZE_TIMEOUT_MS = 120_000;

/** 构造参数 */
export interface PersonaAutoAnalyzerOptions {
  archive: PersonaArchive;
  store: PersonaProfileStore;
  /** 解析本会话生效模型（会话级 /model 覆盖优先） */
  manager: SessionModelLookup;
  config: ImQQBotConfig;
  llm: LlmRuntimeLike;
  logger: Logger;
  /** 覆盖阈值（测试用） */
  threshold?: number;
  /** 覆盖冷却(ms)，测试用 */
  cooldownMs?: number;
  /** 覆盖超时(ms)，测试用 */
  timeoutMs?: number;
  /** 当前时间函数（测试注入） */
  now?: () => number;
}

/** 队列条目：只保留分析必需的身份与会话信息 */
interface QueueEntry {
  senderId: string;
  senderName?: string;
  scope: PersonaArchiveNotice['scope'];
  peerId: string;
}

/** 把配置里的阈值收敛到合法区间 */
function clampThreshold(value: number | undefined): number {
  const raw = Math.trunc(value ?? DEFAULT_AUTO_ANALYZE_THRESHOLD);
  if (!Number.isFinite(raw)) return DEFAULT_AUTO_ANALYZE_THRESHOLD;
  return Math.min(MAX_AUTO_ANALYZE_THRESHOLD, Math.max(MIN_AUTO_ANALYZE_THRESHOLD, raw));
}

export class PersonaAutoAnalyzer {
  private readonly archive: PersonaArchive;
  private readonly store: PersonaProfileStore;
  private readonly manager: SessionModelLookup;
  private readonly llm: LlmRuntimeLike;
  private readonly logger: Logger;
  private readonly config: ImQQBotConfig;
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  /** 待分析队列（按 senderId 去重，保持到达顺序） */
  private readonly queue = new Map<string, QueueEntry>();
  private running = false;
  private disposed = false;
  private controller: AbortController | undefined;
  private pumping: Promise<void> | undefined;

  constructor(options: PersonaAutoAnalyzerOptions) {
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
  get enabled(): boolean {
    return this.config.personaAnalysis?.enabled !== false
      && this.config.personaAnalysis?.autoAnalyze !== false;
  }

  /**
   * 中间件通知：某位群友刚写入一条新消息。
   *
   * 只做计数与冷却判断，不 await 模型；重复通知按 senderId 合并。
   */
  notify(notice: PersonaArchiveNotice): void {
    if (this.disposed || !this.enabled) return;

    const count = this.archive.countBySender(notice.senderId);
    if (count < this.threshold) return;

    const profile = this.store.get(notice.senderId);
    if (profile?.analysis !== undefined && count - profile.analyzedMessageCount < this.threshold) return;

    const lastAttempt = profile?.lastAttemptAt;
    if (lastAttempt !== undefined && this.now() - lastAttempt < this.cooldownMs) return;

    this.queue.set(notice.senderId, {
      senderId: notice.senderId,
      ...(notice.senderName !== undefined ? { senderName: notice.senderName } : {}),
      scope: notice.scope,
      peerId: notice.peerId,
    });
    this.startPump();
  }

  /** 等待队列清空（测试 / 关停前使用） */
  async drain(): Promise<void> {
    while (this.pumping !== undefined) await this.pumping;
  }

  /** 插件卸载：中断当前请求并清空队列 */
  dispose(): void {
    this.disposed = true;
    this.queue.clear();
    this.controller?.abort();
    this.controller = undefined;
  }

  private startPump(): void {
    if (this.running || this.disposed) return;
    this.running = true;
    this.pumping = this.pump().finally(() => {
      this.running = false;
      this.pumping = undefined;
    });
  }

  /** 串行消费队列：一次只跑一位群友的分析 */
  private async pump(): Promise<void> {
    while (!this.disposed && this.queue.size > 0) {
      const entry = this.queue.entries().next().value as [string, QueueEntry] | undefined;
      if (entry === undefined) return;
      this.queue.delete(entry[0]);
      await this.process(entry[1]);
    }
  }

  private resolveRoute(entry: QueueEntry): { provider: string; model: string } | undefined {
    const route = this.manager.getEffectiveModel(entry.scope, entry.peerId);
    if (route?.provider && route.model) return { provider: route.provider, model: route.model };
    if (this.config.provider && this.config.model) {
      return { provider: this.config.provider, model: this.config.model };
    }
    return undefined;
  }

  private async process(entry: QueueEntry): Promise<void> {
    if (this.disposed) return;

    const route = this.resolveRoute(entry);
    if (route === undefined) {
      this.store.markAttempt(entry.senderId, this.now(), '未配置模型（provider/model）');
      this.logger.warn(`im-qqbot: 自动人格档案跳过 ${entry.senderId}（未配置模型）`);
      return;
    }

    const chats = loadSenderChats(this.archive, entry.senderId);
    const messageCount = chats.reduce((sum, chat) => sum + chat.messages.length, 0);
    if (messageCount < this.threshold) return;

    const senderName = entry.senderName ?? chats
      .flatMap((chat) => chat.messages)
      .map((message) => message.senderName)
      .filter((name): name is string => name !== undefined && name !== '')
      .at(-1);

    this.store.markAttempt(entry.senderId, this.now());

    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    (timer as unknown as { unref?: () => void }).unref?.();

    try {
      const result = await analyzeSenderProfile({
        llm: this.llm,
        route,
        senderId: entry.senderId,
        ...(senderName !== undefined ? { senderName } : {}),
        chats,
        signal: controller.signal,
      });
      if (this.disposed) return;

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
      this.logger.info(
        `im-qqbot: 自动人格档案已更新 ${entry.senderId}（messages=${result.messageCount} `
        + `chats=${result.chatCount} confidence=${result.analysis.confidence}）`,
      );
    } catch (err) {
      if (this.disposed) return;
      const message = err instanceof Error ? err.message : String(err);
      this.store.markAttempt(entry.senderId, this.now(), message);
      this.logger.warn(`im-qqbot: 自动人格档案失败 ${entry.senderId}: ${message}`);
    } finally {
      clearTimeout(timer);
      if (this.controller === controller) this.controller = undefined;
    }
  }
}

/** 自动分析器标签（供外部日志/测试断言） */
export const PERSONA_AUTO_ANALYZER_LABEL = `${PERSONA_ANALYZER_LABEL}:auto`;
