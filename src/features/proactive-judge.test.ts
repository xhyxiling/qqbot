import { describe, expect, it } from 'vitest';
import { parseDirectedReplyChance, parseProactiveDecision } from './proactive-judge.ts';

describe('parseDirectedReplyChance', () => {
  it('0-100 与 0-1 都能解析', () => {
    expect(parseDirectedReplyChance('{"reply":72}')).toBeCloseTo(0.72);
    expect(parseDirectedReplyChance('判断：{"reply":50}')).toBeCloseTo(0.5);
    expect(parseDirectedReplyChance('{"reply":0.8}')).toBeCloseTo(0.8);
  });

  it('越界与异常按 0 / 1 夹紧', () => {
    expect(parseDirectedReplyChance('{"reply":150}')).toBe(1);
    expect(parseDirectedReplyChance('{"reply":-20}')).toBe(0);
    expect(parseDirectedReplyChance('')).toBe(0);
    expect(parseDirectedReplyChance('{"reply":"高"}')).toBe(0);
    expect(parseDirectedReplyChance('{bad}')).toBe(0);
  });
});

describe('parseProactiveDecision', () => {
  it('只认 speak === true', () => {
    expect(parseProactiveDecision('{"speak":true}')).toBe(true);
    expect(parseProactiveDecision('判断如下：{"speak":true,"reason":"话题开放"}')).toBe(true);
    expect(parseProactiveDecision('{"speak":false}')).toBe(false);
  });

  it('解析失败 / 类型不对时保守地不插话', () => {
    expect(parseProactiveDecision('')).toBe(false);
    expect(parseProactiveDecision('speak')).toBe(false);
    expect(parseProactiveDecision('{"speak":"true"}')).toBe(false);
    expect(parseProactiveDecision('{bad json}')).toBe(false);
  });
});
