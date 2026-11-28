/**
 * 反馈的模型归因 — 把主人的差评备注交给 LLM 理解，生成策略提案
 *
 * 与 `analyze.ts` 的关键词规则互补：
 *   - 模型能理解更自然的说法（「刚那句太抢戏了」「怎么老不理我」）；
 *   - 模型失败 / 未配置时由命令层回落到确定性规则，功能不会消失；
 *   - 输出仍只是提案，必须 `/evolve apply` 才生效，且只允许改概率与追加表达偏好。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import { collectStreamText } from '../shared/llm-text.ts';
import type { LlmRuntimeLike, ModelRoute } from '../features/model-route.ts';
import type { ChatScope, Logger } from '../types.ts';
import {
  PROBABILITY_CEIL,
  PROBABILITY_FLOOR,
  type FeedbackItem,
  type PolicyProposal,
  type PolicyValues,
} from './store.ts';

/** 默认主动发言概率（与 config.proactive 默认值一致） */
const DEFAULT_PROBABILITY = 0.06;
/** 单次最多返回的提案数 */
const MAX_PROPOSALS = 4;
const MAX_REASON_LEN = 160;
const MAX_STYLE_NOTE_LEN = 100;
const MAX_FEEDBACK_IN_PROMPT = 30;

const SYSTEM_PROMPT = [
  '你在帮一个 QQ 群聊天机器人根据主人的反馈调整回复策略。你只输出策略提案，不写代码，也不和用户对话。',
  '',
  '【可调整的范围】',
  '- 主动发言概率 probability：0.02–0.3 之间的小数，表示机器人主动插话的概率。',
  '- 表达偏好 styleNotes：追加 1–3 条简短的中文偏好（每条不超过 40 字），例如“回复更短，一两句说清”。',
  '- 其他参数（冷却、每小时/每天上限、开关）不允许修改。',
  '',
  '【归因规则】',
  '- 同类差评至少 2 条才提案；只有 1 条时视为噪声，不要为它提案。',
  '- 反馈认为太吵 / 别插话 / 话多 / 刷存在感 → 在当前概率基础上降低，通常 ×0.5，最低不要低于 0.02。',
  '- 反馈认为该回没回 / 装死 / 不理人 / 没反应 → 在当前概率基础上提高，通常 ×1.5，最高不要超过 0.3。',
  '- 反馈认为回复太长 / 啰嗦 / 像小作文 → 追加表达偏好“回复更短，一两句说清”，不要追加与已有偏好重复的内容。',
  '- 好评只作参考，不单独触发调整。',
  '',
  '【输出】',
  '只输出严格 JSON，不要 Markdown、不要解释。没有足够依据时 proposals 为空数组：',
  '{"proposals":[{"kind":"proactive","probability":0.03,"evidence":2,"reason":"2 条反馈认为太吵"},',
  '{"kind":"style","styleNotes":["回复更短，一两句说清"],"evidence":3,"reason":"3 条反馈认为太长"}]}',
  'kind 只能是 proactive 或 style；evidence 填支持这条提案的反馈条数。',
].join('\n');

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 备注里的换行压平，避免破坏提示词结构 */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function buildPrompt(
  items: readonly FeedbackItem[],
  current: PolicyValues,
): string {
  const bad = items.filter((item) => item.verdict === 'bad');
  const goodCount = items.length - bad.length;
  const recentBad = bad.slice(-MAX_FEEDBACK_IN_PROMPT).map((item, index) => {
    const note = item.note !== undefined && item.note !== '' ? oneLine(item.note) : '（未填备注）';
    return `${index + 1}. ${note}`;
  });
  const probability = current.proactive.probability ?? DEFAULT_PROBABILITY;
  return [
    '【当前策略】',
    `主动发言概率: ${probability}`,
    current.styleNotes.length > 0
      ? `已有表达偏好: ${current.styleNotes.map((note) => `「${oneLine(note)}」`).join('、')}`
      : '已有表达偏好: 无',
    '',
    '【差评反馈】（旧 → 新）',
    ...recentBad,
    '',
    `【好评数量】${goodCount} 条（只作参考）`,
    '',
    '请按规则归因，输出 JSON。',
  ].join('\n');
}

/**
 * 解析并校验模型输出（纯函数，便于单测）。
 *
 * - JSON 不合法 → undefined（调用方回落到规则归因）
 * - JSON 合法但没有可用提案 → []
 * - proactive 只保留 probability，并夹在安全范围内
 * - style 只保留非空、非重复、长度合规的偏好
 */
export function parseFeedbackProposals(
  raw: string,
  current: PolicyValues,
  maxEvidence: number,
): PolicyProposal[] | undefined {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;

  let data: unknown;
  try {
    data = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return undefined;
  }
  if (typeof data !== 'object' || data === null) return undefined;
  const list = (data as { proposals?: unknown }).proposals;
  if (!Array.isArray(list)) return undefined;

  const proposals: PolicyProposal[] = [];
  for (const entry of list) {
    if (proposals.length >= MAX_PROPOSALS) break;
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as {
      kind?: unknown;
      probability?: unknown;
      styleNotes?: unknown;
      evidence?: unknown;
      reason?: unknown;
    };
    const reason = typeof record.reason === 'string' && record.reason.trim() !== ''
      ? oneLine(record.reason).slice(0, MAX_REASON_LEN)
      : '模型归因';
    const evidenceRaw = typeof record.evidence === 'number' ? record.evidence : maxEvidence;
    const evidence = Math.max(1, Math.min(maxEvidence, Math.trunc(evidenceRaw)));

    if (record.kind === 'proactive') {
      const value = typeof record.probability === 'number' ? record.probability : Number(record.probability);
      if (!Number.isFinite(value)) continue;
      const probability = clamp(value, PROBABILITY_FLOOR, PROBABILITY_CEIL);
      const base = current.proactive.probability ?? DEFAULT_PROBABILITY;
      if (Math.abs(probability - base) < 0.0005) continue;
      proposals.push({
        kind: 'proactive',
        reason,
        evidence,
        proactive: { probability },
      });
      continue;
    }

    if (record.kind === 'style' && Array.isArray(record.styleNotes)) {
      const notes: string[] = [];
      for (const rawNote of record.styleNotes) {
        if (typeof rawNote !== 'string') continue;
        const note = oneLine(rawNote).slice(0, MAX_STYLE_NOTE_LEN);
        if (note === '' || notes.includes(note)) continue;
        if (current.styleNotes.some((existing) => existing.includes(note) || note.includes(existing))) continue;
        notes.push(note);
      }
      if (notes.length === 0) continue;
      proposals.push({ kind: 'style', reason, evidence, styleNotes: notes });
    }
  }

  return proposals;
}

export class FeedbackAnalyzer {
  private readonly llm: LlmRuntimeLike;
  private readonly getRoute: (scope: ChatScope, peerId: string) => ModelRoute | undefined;
  private readonly logger?: Logger;
  private readonly timeoutMs: number;
  private controller: AbortController | undefined;

  constructor(options: {
    llm: LlmRuntimeLike;
    getRoute: (scope: ChatScope, peerId: string) => ModelRoute | undefined;
    logger?: Logger;
    timeoutMs?: number;
  }) {
    this.llm = options.llm;
    this.getRoute = options.getRoute;
    this.logger = options.logger;
    this.timeoutMs = Math.max(1_000, Math.trunc(options.timeoutMs ?? 15_000));
  }

  /**
   * 返回 undefined 表示模型不可用 / 调用失败，调用方应回落到关键词规则；
   * 返回数组（可能为空）表示模型正常给出了结论。
   */
  async analyze(
    items: readonly FeedbackItem[],
    current: PolicyValues,
    scope: ChatScope,
    peerId: string,
  ): Promise<PolicyProposal[] | undefined> {
    const route = this.getRoute(scope, peerId);
    if (route === undefined) return undefined;

    const message = createUserMessage({
      content: [{ type: 'text', text: buildPrompt(items, current) }],
      source: { kind: 'plugin:dsh-im-qqbot' } as unknown as { kind: 'plugin'; plugin: string },
    });
    const controller = new AbortController();
    this.controller = controller;
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const generate: GenerateOptions = {
        provider: route.provider,
        model: route.model,
        system: SYSTEM_PROMPT,
        messages: [message],
        maxTokens: 400,
        signal: controller.signal,
      };
      const raw = await collectStreamText(this.llm.stream(generate), 'qqbot_evolve_analyze');
      const proposals = parseFeedbackProposals(raw, current, Math.max(1, items.length));
      this.logger?.debug(`evolve analyze: proposals=${proposals?.length ?? 'fallback'} raw=${raw.slice(0, 160)}`);
      return proposals;
    } catch (err) {
      this.logger?.debug(`evolve analyze failed: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    } finally {
      clearTimeout(timer);
      this.controller = undefined;
    }
  }

  dispose(): void {
    this.controller?.abort();
    this.controller = undefined;
  }
}
