import { describe, expect, it } from 'vitest';
import type { ProactiveConfig } from '../config.ts';
import {
  createProactiveState,
  isProactiveCandidate,
  noteActivity,
  noteSpoke,
  registerAmbient,
  shouldSpeak,
} from './proactive.ts';

const config: ProactiveConfig = {
  enabled: true,
  channels: ['onebot'],
  probability: 1,
  modelJudge: true,
  minIntervalSec: 60,
  maxPerHour: 3,
  maxPerDay: 5,
  debounceMs: 3000,
  minChars: 2,
  ignorePrefixes: ['/', '#'],
};

describe('proactive candidate', () => {
  it('正常聊天进入候选', () => {
    expect(isProactiveCandidate('在干嘛', config)).toBe(true);
    expect(isProactiveCandidate('这个颜色是不是有点深', config)).toBe(true);
  });

  it('纯笑声 / 标点 / 表情 / 数字 / 链接不接', () => {
    expect(isProactiveCandidate('哈哈哈', config)).toBe(false);
    expect(isProactiveCandidate('hhhh', config)).toBe(false);
    expect(isProactiveCandidate('6', config)).toBe(false);
    expect(isProactiveCandidate('？？？', config)).toBe(false);
    expect(isProactiveCandidate('https://example.com/a', config)).toBe(false);
  });

  it('命令前缀和过短消息不接', () => {
    expect(isProactiveCandidate('/memory', config)).toBe(false);
    expect(isProactiveCandidate('#话题', config)).toBe(false);
    expect(isProactiveCandidate('嗯', config)).toBe(false);
  });
});

describe('proactive gating', () => {
  it('说话后至少再听两句，且受最小间隔限制', () => {
    const state = createProactiveState(1_000);
    registerAmbient(state, 1_000);
    expect(shouldSpeak(state, config, 1_000, () => 0)).toBe(false);

    registerAmbient(state, 2_000);
    expect(shouldSpeak(state, config, 2_000, () => 0)).toBe(true);

    noteSpoke(state, 2_000);
    registerAmbient(state, 3_000);
    registerAmbient(state, 4_000);
    expect(shouldSpeak(state, config, 4_000, () => 0)).toBe(false); // 冷却中
    expect(shouldSpeak(state, config, 62_000, () => 0)).toBe(true);
  });

  it('概率未命中就放弃本批次', () => {
    const state = createProactiveState(1_000);
    registerAmbient(state, 1_000);
    registerAmbient(state, 2_000);
    expect(shouldSpeak(state, { ...config, probability: 0.5 }, 2_000, () => 0.99)).toBe(false);
  });

  it('每小时 / 每天上限会拦住', () => {
    const state = createProactiveState(1_000);
    for (let i = 0; i < 3; i += 1) {
      registerAmbient(state, 1_000 + i * 10_000);
      registerAmbient(state, 1_010 + i * 10_000);
      noteSpoke(state, 1_000 + i * 10_000);
    }
    registerAmbient(state, 200_000);
    registerAmbient(state, 201_000);
    expect(shouldSpeak(state, config, 201_000, () => 0)).toBe(false);
  });

  it('正常 @ 回复只重置冷却，不占用主动发言配额', () => {
    const state = createProactiveState(1_000);
    noteActivity(state, 1_000);
    expect(state.hourCount).toBe(0);
    expect(state.dayCount).toBe(0);
    expect(state.messagesSinceSpoke).toBe(0);
    expect(state.lastSpokeAt).toBe(1_000);
  });
});
