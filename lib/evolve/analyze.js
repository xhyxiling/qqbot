import { PROBABILITY_CEIL, PROBABILITY_FLOOR } from "./store.js";
/** 同类差评达到该条数才提案 */
export const MIN_EVIDENCE = 2;
const TOO_NOISY = /太吵|别回|少回|话多|插话|闭嘴/;
const TOO_SILENT = /该回没回|没回|装死|没反应|不理/;
const TOO_LONG = /太长|啰嗦|字数太多|小作文/;
/** 默认主动发言概率（与 config.proactive 默认值一致） */
const DEFAULT_PROBABILITY = 0.06;
function round3(value) {
    return Math.round(value * 1000) / 1000;
}
function notesOf(items) {
    const unique = [...new Set(items.map((item) => item.note ?? '').filter((note) => note !== ''))];
    return unique.length > 0 ? unique.join('；') : '未填写备注';
}
/**
 * 根据反馈生成提案（纯函数）。
 *
 * @param items 全部反馈（只统计 verdict=bad）
 * @param current 当前策略（用于判断是否已有同样偏好、计算概率基数）
 */
export function analyzeFeedback(items, current) {
    const bad = items.filter((item) => item.verdict === 'bad');
    const noisy = bad.filter((item) => item.note !== undefined && TOO_NOISY.test(item.note));
    const silent = bad.filter((item) => item.note !== undefined && TOO_SILENT.test(item.note));
    const verbose = bad.filter((item) => item.note !== undefined && TOO_LONG.test(item.note));
    const proposals = [];
    // 主动发言频率：每个方向最多调整一次（2 条即成立），最终夹在 [0.02, 0.3]。
    // 不做按条数指数叠加，避免几条反馈就把参数推到边界。
    if (noisy.length >= MIN_EVIDENCE || silent.length >= MIN_EVIDENCE) {
        const base = current.proactive.probability ?? DEFAULT_PROBABILITY;
        const factor = (noisy.length >= MIN_EVIDENCE ? 0.5 : 1)
            * (silent.length >= MIN_EVIDENCE ? 1.5 : 1);
        const probability = Math.min(PROBABILITY_CEIL, Math.max(PROBABILITY_FLOOR, round3(base * factor)));
        if (Math.abs(probability - base) >= 0.0005) {
            const parts = [];
            if (noisy.length > 0)
                parts.push(`${noisy.length} 条认为太吵/插话`);
            if (silent.length > 0)
                parts.push(`${silent.length} 条认为该回没回`);
            proposals.push({
                kind: 'proactive',
                reason: `主动发言概率 ${formatPercent(base)} → ${formatPercent(probability)}`
                    + `（${parts.join('，')}：${notesOf([...noisy, ...silent])}）`,
                evidence: noisy.length + silent.length,
                proactive: { probability },
            });
        }
    }
    // 表达偏好：已有的同义偏好不重复追加
    if (verbose.length >= MIN_EVIDENCE) {
        const exists = current.styleNotes.some((note) => /更短|简短|一两句/.test(note));
        if (!exists) {
            proposals.push({
                kind: 'style',
                reason: `回复更短、一两句说清（${verbose.length} 条认为太长：${notesOf(verbose)}）`,
                evidence: verbose.length,
                styleNotes: ['回复更短，一两句说清，不要铺陈'],
            });
        }
    }
    return proposals;
}
/** 0.06 → 6% */
function formatPercent(value) {
    return `${Math.round(value * 1000) / 10}%`;
}
//# sourceMappingURL=analyze.js.map