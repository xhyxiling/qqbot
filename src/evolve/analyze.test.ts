import { describe, expect, it } from 'vitest';
import { analyzeFeedback, MIN_EVIDENCE } from './analyze.ts';
import { emptyPolicyValues, mergeProposals, type FeedbackItem, type PolicyValues } from './store.ts';

function bad(note: string, at = 0): FeedbackItem {
  return { at, scope: 'group', peerId: 'g1', senderId: 'u1', verdict: 'bad', note };
}

function good(note?: string): FeedbackItem {
  return {
    at: 0,
    scope: 'group',
    peerId: 'g1',
    senderId: 'u1',
    verdict: 'good',
    ...(note !== undefined ? { note } : {}),
  };
}

const base: PolicyValues = { proactive: { probability: 0.1 }, styleNotes: [] };

describe('analyzeFeedback', () => {
  it('同类差评不足 2 条不提案', () => {
    expect(analyzeFeedback([bad('太吵了')], base)).toEqual([]);
    expect(analyzeFeedback([bad('太吵了'), good('很好')], base)).toEqual([]);
  });

  it('2 条「太吵」把概率减半', () => {
    const proposals = analyzeFeedback([bad('太吵了'), bad('别插话')], base);
    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.kind).toBe('proactive');
    expect(proposals[0]?.proactive?.probability).toBeCloseTo(0.05, 5);
  });

  it('2 条「该回没回」把概率提高 1.5 倍', () => {
    const proposals = analyzeFeedback([bad('该回没回'), bad('装死不理人')], base);
    expect(proposals[0]?.proactive?.probability).toBeCloseTo(0.15, 5);
  });

  it('概率夹在 [0.02, 0.3]', () => {
    const lowBase: PolicyValues = { proactive: { probability: 0.03 }, styleNotes: [] };
    const noisy = Array.from({ length: 8 }, () => bad('太吵'));
    expect(analyzeFeedback(noisy, lowBase)[0]?.proactive?.probability).toBe(0.02);

    const highBase: PolicyValues = { proactive: { probability: 0.25 }, styleNotes: [] };
    const silent = Array.from({ length: 8 }, () => bad('没反应'));
    expect(analyzeFeedback(silent, highBase)[0]?.proactive?.probability).toBe(0.3);
  });

  it('2 条「太长」生成表达偏好，已存在时不重复', () => {
    const proposals = analyzeFeedback([bad('太长'), bad('太啰嗦')], base);
    expect(proposals.some((p) => p.kind === 'style')).toBe(true);

    const withNote: PolicyValues = { proactive: {}, styleNotes: ['回复更短，一两句说清'] };
    expect(analyzeFeedback([bad('太长'), bad('太啰嗦')], withNote)).toEqual([]);
  });

  it('好评不参与归因', () => {
    expect(analyzeFeedback([good('太吵'), good('太吵')], base)).toEqual([]);
  });

  it('至少需要 MIN_EVIDENCE 条', () => {
    expect(MIN_EVIDENCE).toBe(2);
  });
});

describe('mergeProposals', () => {
  it('合并概率并追加偏好，重复偏好只留一条', () => {
    const next = mergeProposals(emptyPolicyValues(), [
      { kind: 'proactive', reason: 'x', evidence: 2, proactive: { probability: 0.05 } },
      { kind: 'style', reason: 'y', evidence: 2, styleNotes: ['回复更短，一两句说清'] },
      { kind: 'style', reason: 'z', evidence: 2, styleNotes: ['回复更短，一两句说清'] },
    ]);
    expect(next.proactive.probability).toBe(0.05);
    expect(next.styleNotes).toEqual(['回复更短，一两句说清']);
  });

  it('越界概率被夹回安全范围', () => {
    const high = mergeProposals(emptyPolicyValues(), [
      { kind: 'proactive', reason: 'x', evidence: 2, proactive: { probability: 0.99 } },
    ]);
    expect(high.proactive.probability).toBe(0.3);
    const low = mergeProposals(emptyPolicyValues(), [
      { kind: 'proactive', reason: 'x', evidence: 2, proactive: { probability: 0 } },
    ]);
    expect(low.proactive.probability).toBe(0.02);
  });
});
