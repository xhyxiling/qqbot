import { describe, expect, it } from 'vitest';
import { parseFeedbackProposals } from './llm-analyze.ts';
import { emptyPolicyValues, type PolicyValues } from './store.ts';

const base: PolicyValues = { proactive: { probability: 0.1 }, styleNotes: ['回复更短，一两句说清'] };

describe('parseFeedbackProposals', () => {
  it('非 JSON 返回 undefined（调用方回落规则归因）', () => {
    expect(parseFeedbackProposals('模型想了想，觉得不用改', base, 5)).toBeUndefined();
    expect(parseFeedbackProposals('{"proposals": [', base, 5)).toBeUndefined();
    expect(parseFeedbackProposals('{"foo":1}', base, 5)).toBeUndefined();
  });

  it('空数组表示模型认为不需要调整', () => {
    expect(parseFeedbackProposals('{"proposals":[]}', base, 5)).toEqual([]);
  });

  it('概率夹在 [0.02, 0.3]，与当前值相同则丢弃', () => {
    const high = parseFeedbackProposals(
      '{"proposals":[{"kind":"proactive","probability":0.9,"evidence":9,"reason":"该回没回"}]}',
      base,
      5,
    );
    expect(high?.[0]?.proactive?.probability).toBe(0.3);
    expect(high?.[0]?.evidence).toBe(5);

    const same = parseFeedbackProposals(
      '{"proposals":[{"kind":"proactive","probability":0.1,"evidence":2,"reason":"不变"}]}',
      base,
      5,
    );
    expect(same).toEqual([]);
  });

  it('表达偏好去重、去空、裁剪长度', () => {
    const proposals = parseFeedbackProposals(
      '{"proposals":[{"kind":"style","styleNotes":["  回复更短，一两句说清  ","","少用感叹号"],"evidence":3,"reason":"太长"}]}',
      base,
      5,
    );
    expect(proposals).toHaveLength(1);
    expect(proposals?.[0]?.styleNotes).toEqual(['少用感叹号']);
  });

  it('不支持的 kind 被忽略', () => {
    const proposals = parseFeedbackProposals(
      '{"proposals":[{"kind":"proactive","probability":0.05,"evidence":2},{"kind":"config","x":1}]}',
      emptyPolicyValues(),
      3,
    );
    expect(proposals).toHaveLength(1);
    expect(proposals?.[0]?.kind).toBe('proactive');
  });

  it('reason 缺失时使用默认文案', () => {
    const proposals = parseFeedbackProposals(
      '{"proposals":[{"kind":"proactive","probability":0.05,"evidence":2}]}',
      emptyPolicyValues(),
      3,
    );
    expect(proposals?.[0]?.reason).toBe('模型归因');
  });
});
