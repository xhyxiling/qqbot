/**
 * MemoryExtractor — 用 LLM 异步补全长期记忆
 *
 * 规则快路径只能识别固定句式；真实聊天里「我最近在准备考研」「这两天搬家了」
 * 这类信息更多。这里把某个人最近的一批发言攒起来，后台调用一次模型，
 * 抽取稳定事实后写回 MemoryStore（按 personId，群聊/私聊共用）。
 *
 * 约束：
 * - 全局并发 1，按 personId 去重排队，避免群聊高峰打满模型额度
 * - 每人攒够 threshold 条才触发；距上次触发超过 6 小时且还有待处理消息也触发
 * - 单次超时 60s；失败只记 debug，不影响聊天
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import { collectStreamText } from '../shared/llm-text.ts';
import type { LlmRuntimeLike, ModelRoute } from '../features/model-route.ts';
import type { ChatScope, Logger } from '../types.ts';
import type { FactKind, MemoryNote } from './memory-store.ts';

/** 抽取结果（LLM 返回并用 store 做二次去重） */
export interface ExtractedFact {
  text: string;
  kind: FactKind;
  confidence: number;
}

/** 距上次抽取超过该时长，有消息就补跑一次 */
export const EXTRACT_STALE_MS = 6 * 60 * 60 * 1000;
/** 单次抽取超时 */
export const EXTRACT_TIMEOUT_MS = 60_000;
/** 单次最多送给模型的消息条数 */
const MAX_BUFFERED_MESSAGES = 30;

const EXTRACT_SYSTEM_PROMPT = [
  '你是 QQ 聊天机器人的长期记忆抽取器。只从「用户本人」的发言中抽取值得长期记住的稳定事实。',
  '可抽取：称呼/昵称、所在地、学校/专业、工作、生日/年龄、喜好与讨厌、宠物、长期习惯、重要经历或关系。',
  '不要抽取：别人的信息、疑问句、临时情绪、一次性计划、群聊公共话题、对机器人提的请求。',
  '只输出 JSON 数组，不要解释、不要代码块。最多 5 条，text 用第一人称短句且不超过 40 字：',
  '[{"text":"我叫小明","kind":"profile","confidence":0.9}]',
  '没有可记的就输出 []。',
].join('\n');

interface PersonBuffer {
  texts: string[];
  scope: ChatScope;
  peerId: string;
  lastRunAt: number;
}

export interface MemoryExtractorOptions {
  llm: LlmRuntimeLike;
  /** 解析该会话当前生效模型 */
  getRoute: (scope: ChatScope, peerId: string) => ModelRoute | undefined;
  /** 已知事实（放进 prompt，避免重复抽取） */
  getKnownFacts: (personId: string) => readonly MemoryNote[];
  /** 抽取结果写回 */
  onFacts: (personId: string, facts: ExtractedFact[], scope: ChatScope, peerId: string) => void;
  /** 触发阈值（消息条数） */
  threshold?: number;
  logger?: Logger;
  now?: () => number;
  cooldownMs?: number;
  timeoutMs?: number;
}

export class MemoryExtractor {
  private readonly llm: LlmRuntimeLike;
  private readonly getRoute: MemoryExtractorOptions['getRoute'];
  private readonly getKnownFacts: MemoryExtractorOptions['getKnownFacts'];
  private readonly onFacts: MemoryExtractorOptions['onFacts'];
  private readonly threshold: number;
  private readonly logger?: Logger;
  private readonly now: () => number;
  private readonly cooldownMs: number;
  private readonly timeoutMs: number;

  private readonly buffers = new Map<string, PersonBuffer>();
  private readonly queue: string[] = [];
  private readonly queued = new Set<string>();
  private draining = false;
  private disposed = false;
  private controller: AbortController | undefined;

  constructor(options: MemoryExtractorOptions) {
    this.llm = options.llm;
    this.getRoute = options.getRoute;
    this.getKnownFacts = options.getKnownFacts;
    this.onFacts = options.onFacts;
    this.threshold = Math.max(2, Math.trunc(options.threshold ?? 8));
    this.logger = options.logger;
    this.now = options.now ?? Date.now;
    this.cooldownMs = Math.max(0, Math.trunc(options.cooldownMs ?? EXTRACT_STALE_MS));
    this.timeoutMs = Math.max(1, Math.trunc(options.timeoutMs ?? EXTRACT_TIMEOUT_MS));
  }

  /** 收到一条用户消息（已按 personId 归并） */
  enqueue(personId: string, text: string, scope: ChatScope, peerId: string): void {
    if (this.disposed || personId === '') return;
    const content = text.trim();
    if (content === '') return;

    let buffer = this.buffers.get(personId);
    if (buffer === undefined) {
      buffer = { texts: [], scope, peerId, lastRunAt: 0 };
      this.buffers.set(personId, buffer);
    }
    buffer.scope = scope;
    buffer.peerId = peerId;
    buffer.texts.push(content.slice(0, 300));
    if (buffer.texts.length > MAX_BUFFERED_MESSAGES) buffer.texts.splice(0, buffer.texts.length - MAX_BUFFERED_MESSAGES);

    const stale = buffer.lastRunAt > 0 && this.now() - buffer.lastRunAt >= this.cooldownMs;
    if (buffer.texts.length >= this.threshold || (stale && buffer.texts.length > 0)) {
      this.pump(personId);
    }
  }

  /** 立即处理所有待办（退出前调用） */
  async flush(): Promise<void> {
    for (const personId of this.buffers.keys()) this.pump(personId);
    await this.drain();
  }

  /**
   * 身份归并后把待抽取的缓冲改挂到新的人身上，
   * 避免绑定后旧 id 的缓冲把已合并的记忆又写回来。
   */
  rekey(sourcePersonId: string, targetPersonId: string): void {
    if (this.disposed || sourcePersonId === targetPersonId) return;
    const from = this.buffers.get(sourcePersonId);
    if (from !== undefined) {
      const to = this.buffers.get(targetPersonId);
      if (to === undefined) {
        this.buffers.set(targetPersonId, { ...from, texts: [...from.texts] });
      } else {
        to.texts.push(...from.texts);
        if (to.texts.length > MAX_BUFFERED_MESSAGES) {
          to.texts.splice(0, to.texts.length - MAX_BUFFERED_MESSAGES);
        }
        to.scope = from.scope;
        to.peerId = from.peerId;
      }
      this.buffers.delete(sourcePersonId);
    }
    const index = this.queue.indexOf(sourcePersonId);
    if (index >= 0) {
      this.queue.splice(index, 1);
      this.queued.delete(sourcePersonId);
      this.pump(targetPersonId);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.controller?.abort();
    this.buffers.clear();
    this.queue.length = 0;
    this.queued.clear();
  }

  private pump(personId: string): void {
    if (this.disposed || this.queued.has(personId)) return;
    const buffer = this.buffers.get(personId);
    if (buffer === undefined || buffer.texts.length === 0) return;
    this.queued.add(personId);
    this.queue.push(personId);
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (!this.disposed && this.queue.length > 0) {
        const personId = this.queue.shift();
        if (personId === undefined) break;
        this.queued.delete(personId);
        const buffer = this.buffers.get(personId);
        if (buffer === undefined || buffer.texts.length === 0) continue;
        const texts = buffer.texts.splice(0, buffer.texts.length);
        buffer.lastRunAt = this.now();
        try {
          await this.run(personId, texts, buffer.scope, buffer.peerId);
        } catch (err) {
          this.logger?.debug(
            `memory extract failed: person=${personId} ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } finally {
      this.draining = false;
    }
  }

  private async run(
    personId: string,
    texts: readonly string[],
    scope: ChatScope,
    peerId: string,
  ): Promise<void> {
    const route = this.getRoute(scope, peerId);
    if (route === undefined) return;

    const known = this.getKnownFacts(personId).slice(0, 20).map((note) => `- ${note.text}`);
    const prompt = [
      '已知记忆：',
      known.length > 0 ? known.join('\n') : '（暂无）',
      '',
      '最近的发言（按时间顺序，说话人都是同一个人）：',
      ...texts.map((text, index) => `${index + 1}. ${text}`),
    ].join('\n');

    const message = createUserMessage({
      content: [{ type: 'text', text: prompt }],
      // v4 producer-owned source kind；本地 dsh-llm 类型尚为 v3 联合，做类型桥接
      source: { kind: 'plugin:dsh-im-qqbot' } as unknown as { kind: 'plugin'; plugin: string },
    });
    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const generate: GenerateOptions = {
        provider: route.provider,
        model: route.model,
        system: EXTRACT_SYSTEM_PROMPT,
        messages: [message],
        maxTokens: 400,
        signal: controller.signal,
      };
      const raw = await collectStreamText(this.llm.stream(generate), 'qqbot_memory_extract');
      const facts = parseExtractedFacts(raw);
      if (facts.length > 0) this.onFacts(personId, facts, scope, peerId);
    } finally {
      clearTimeout(timer);
      this.controller = undefined;
    }
  }
}

/** 解析模型返回的 JSON 数组；非法时返回空数组（不影响主流程） */
export function parseExtractedFacts(raw: string): ExtractedFact[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return [];

  let data: unknown;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];

  const facts: ExtractedFact[] = [];
  const seen = new Set<string>();
  for (const item of data) {
    if (typeof item !== 'object' || item === null) continue;
    const record = item as Record<string, unknown>;
    const text = typeof record.text === 'string'
      ? record.text.replace(/\s+/g, ' ').trim().slice(0, 60)
      : '';
    if (text === '' || seen.has(text)) continue;
    const kind: FactKind = record.kind === 'preference' || record.kind === 'event' ? record.kind : 'profile';
    const rawConfidence = typeof record.confidence === 'number' ? record.confidence : 0.7;
    const confidence = Number.isFinite(rawConfidence) ? Math.min(1, Math.max(0, rawConfidence)) : 0.7;
    seen.add(text);
    facts.push({ text, kind, confidence });
    if (facts.length >= 5) break;
  }
  return facts;
}
