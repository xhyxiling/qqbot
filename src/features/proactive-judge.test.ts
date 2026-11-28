import { describe, expect, it } from 'vitest';
import { parseProactiveDecision } from './proactive-judge.ts';

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
