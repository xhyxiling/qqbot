/**
 * 自动人格档案单测
 *
 * 覆盖：阈值触发、跨会话聚合、分析后增量门槛、失败冷却与重试、
 * 重复通知合并、开关关闭、模型回退、dispose 清空队列。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import type { SessionModelLookup } from './model-route.ts';
import {
  AUTO_ANALYZE_COOLDOWN_MS,
  PersonaAutoAnalyzer,
} from './persona-auto-analyzer.ts';
import {
  PersonaArchive,
  personaArchiveKey,
  type PersonaArchiveNotice,
} from './persona-archive.ts';
import { PersonaProfileStore } from './persona-profiles.ts';

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-qqbot-persona-auto-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeConfig(overrides: Partial<ImQQBotConfig['personaAnalysis']> = {}): ImQQBotConfig {
  return {
    appId: 'app',
    appSecret: 'secret',
    provider: 'trae',
    model: 'deepseek-v4.1-flash',
    globalPrompt: '',
    personas: [],
    defaultPersona: '',
    personaAnalysis: {
      enabled: true,
      maxMessages: 1000,
      retentionDays: 30,
      autoAnalyze: true,
      autoAnalyzeThreshold: 20,
      ...overrides,
    },
  } as unknown as ImQQBotConfig;
}

/** 模型输出的结构化 JSON */
const PROFILE_JSON = JSON.stringify({
  summary: '话少但很稳，遇事先想办法',
  traits: ['慢热', '理性', '热心'],
  style: '短句为主，很少用感叹号',
  catchphrases: ['行吧', '我看看'],
  interests: ['技术', '数码'],
  role: '平时潜水，遇到技术问题会突然出来科普',
  advice: '可以直接说重点',
  confidence: 'medium',
});

type Mode = 'ok' | 'fail';

/** 假 llm：按顺序消费 mode 列表（默认全部成功） */
function makeLlm(modes: Mode[] = ['ok']): {
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
  calls: GenerateOptions[];
} {
  const calls: GenerateOptions[] = [];
  let index = 0;
  return {
    calls,
    async *stream(options: GenerateOptions) {
      calls.push(options);
      const mode = modes[Math.min(index, modes.length - 1)] ?? 'ok';
      index += 1;
      if (mode === 'fail') {
        yield {
          type: 'finish',
          reason: { kind: 'error', failure: { message: '模型超时', code: 'E_TIMEOUT' } },
        } as unknown as StreamChunk;
        return;
      }
      yield { type: 'block-start', index: 0, blockType: 'text' } as unknown as StreamChunk;
      yield { type: 'text-delta', index: 0, text: PROFILE_JSON } as unknown as StreamChunk;
      yield { type: 'block-end', index: 0, block: { type: 'text', text: PROFILE_JSON } } as unknown as StreamChunk;
      yield { type: 'finish', reason: { kind: 'stop' } } as unknown as StreamChunk;
    },
  };
}

/** 假 manager：只实现 getEffectiveModel */
function makeManager(route?: { provider: string; model: string }): SessionModelLookup {
  return { getEffectiveModel: () => route } as unknown as SessionModelLookup;
}

interface HarnessOptions {
  config?: ImQQBotConfig;
  threshold?: number;
  cooldownMs?: number;
  modes?: Mode[];
  route?: { provider: string; model: string };
  now?: () => number;
}

/** 组装被测对象与依赖 */
function makeHarness(options: HarnessOptions = {}) {
  const config = options.config ?? makeConfig();
  const archive = new PersonaArchive({
    path: join(dir, 'archive.json'),
    maxMessages: 1000,
    retentionDays: 30,
    writeDelayMs: 0,
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
  const store = new PersonaProfileStore({ path: join(dir, 'profiles.json'), writeDelayMs: 0 });
  const llm = makeLlm(options.modes);
  const logger = makeLogger();
  const analyzer = new PersonaAutoAnalyzer({
    archive,
    store,
    manager: makeManager(options.route),
    config,
    llm,
    logger,
    threshold: options.threshold ?? 20,
    cooldownMs: options.cooldownMs ?? AUTO_ANALYZE_COOLDOWN_MS,
    timeoutMs: 60_000,
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
  return { config, archive, store, llm, logger, analyzer };
}

/** 往某个会话灌 count 条同一人的消息 */
function seed(
  archive: PersonaArchive,
  options: {
    senderId: string;
    count: number;
    scope?: 'group' | 'c2c';
    peerId?: string;
    senderName?: string;
    startAt?: number;
    appId?: string;
  },
): void {
  const scope = options.scope ?? 'group';
  const peerId = options.peerId ?? 'g1';
  const key = personaArchiveKey(options.appId ?? 'app', scope, peerId);
  // 归档会按保留期清理旧消息，默认时间必须落在保留期内
  const startAt = options.startAt ?? Date.now() - 60_000;
  for (let i = 0; i < options.count; i++) {
    archive.append(key, {
      senderId: options.senderId,
      ...(options.senderName !== undefined ? { senderName: options.senderName } : {}),
      content: `第 ${i + 1} 句话`,
      timestamp: startAt + i * 1000,
    });
  }
}

function noticeOf(options: {
  senderId: string;
  senderName?: string;
  scope?: 'group' | 'c2c';
  peerId?: string;
}): PersonaArchiveNotice {
  const scope = options.scope ?? 'group';
  const peerId = options.peerId ?? 'g1';
  return {
    chatKey: personaArchiveKey('app', scope, peerId),
    senderId: options.senderId,
    ...(options.senderName !== undefined ? { senderName: options.senderName } : {}),
    scope,
    peerId,
  };
}

describe('PersonaAutoAnalyzer', () => {
  it('未达到阈值时不调用模型', async () => {
    const { archive, llm, store, analyzer } = makeHarness({ threshold: 20 });
    seed(archive, { senderId: 'u1', count: 19 });
    analyzer.notify(noticeOf({ senderId: 'u1' }));
    await analyzer.drain();

    expect(llm.calls).toHaveLength(0);
    expect(store.get('u1')).toBeUndefined();
  });

  it('达到阈值自动分析并写入人格库', async () => {
    let clock = Date.now();
    const { archive, llm, store, analyzer } = makeHarness({ threshold: 20, now: () => clock });
    seed(archive, { senderId: 'u1', count: 20, senderName: '小明', startAt: clock });
    analyzer.notify(noticeOf({ senderId: 'u1', senderName: '小明' }));
    await analyzer.drain();

    expect(llm.calls).toHaveLength(1);
    const profile = store.get('u1');
    expect(profile?.analysis?.summary).toBe('话少但很稳，遇事先想办法');
    expect(profile?.analysis?.traits).toEqual(['慢热', '理性', '热心']);
    expect(profile).toMatchObject({
      senderId: 'u1',
      senderName: '小明',
      analyzedMessageCount: 20,
      analyzedChatCount: 1,
      analyzedAt: clock,
      provider: 'trae',
      model: 'deepseek-v4.1-flash',
    });
    expect(profile?.lastError).toBeUndefined();
  });

  it('分析后新增不足阈值时不重复分析', async () => {
    let clock = Date.now();
    const { archive, llm, store, analyzer } = makeHarness({ threshold: 20, now: () => clock });
    seed(archive, { senderId: 'u1', count: 20, startAt: clock });
    analyzer.notify(noticeOf({ senderId: 'u1' }));
    await analyzer.drain();
    expect(llm.calls).toHaveLength(1);

    // 冷却期之外再追加 5 条：40 - 20 之类的增量仍不足 20，应跳过
    clock += AUTO_ANALYZE_COOLDOWN_MS + 60_000;
    seed(archive, { senderId: 'u1', count: 5, startAt: clock });
    analyzer.notify(noticeOf({ senderId: 'u1' }));
    await analyzer.drain();

    expect(llm.calls).toHaveLength(1);
    expect(store.get('u1')?.analyzedMessageCount).toBe(20);
  });

  it('新增条数再次达到阈值时更新档案', async () => {
    let clock = Date.now();
    const { archive, llm, store, analyzer } = makeHarness({ threshold: 20, now: () => clock });
    seed(archive, { senderId: 'u1', count: 20, startAt: clock });
    analyzer.notify(noticeOf({ senderId: 'u1' }));
    await analyzer.drain();
    expect(llm.calls).toHaveLength(1);

    clock += AUTO_ANALYZE_COOLDOWN_MS + 60_000;
    seed(archive, { senderId: 'u1', count: 20, startAt: clock + 100_000 });
    analyzer.notify(noticeOf({ senderId: 'u1' }));
    await analyzer.drain();

    expect(llm.calls).toHaveLength(2);
    expect(store.get('u1')?.analyzedMessageCount).toBe(40);
    expect(store.get('u1')?.analyzedAt).toBe(clock);
  });

  it('跨群与私聊的同一 openid 合并分析', async () => {
    let clock = Date.now();
    const { archive, llm, store, analyzer } = makeHarness({ threshold: 20, now: () => clock });
    seed(archive, { senderId: 'u1', count: 12, scope: 'group', peerId: 'g1', startAt: clock });
    seed(archive, { senderId: 'u1', count: 5, scope: 'group', peerId: 'g2', startAt: clock + 100_000 });
    seed(archive, { senderId: 'u1', count: 3, scope: 'c2c', peerId: 'u1', startAt: clock + 200_000 });

    analyzer.notify(noticeOf({ senderId: 'u1', scope: 'group', peerId: 'g2' }));
    await analyzer.drain();

    expect(llm.calls).toHaveLength(1);
    expect(store.get('u1')).toMatchObject({ analyzedMessageCount: 20, analyzedChatCount: 3 });
  });

  it('同一个人重复通知只分析一次', async () => {
    const { archive, llm, analyzer } = makeHarness({ threshold: 20 });
    seed(archive, { senderId: 'u1', count: 20 });
    analyzer.notify(noticeOf({ senderId: 'u1' }));
    analyzer.notify(noticeOf({ senderId: 'u1' }));
    analyzer.notify(noticeOf({ senderId: 'u1' }));
    await analyzer.drain();

    expect(llm.calls).toHaveLength(1);
  });

  it('失败后写入错误并冷却，冷却结束可重试成功', async () => {
    let clock = Date.now();
    const { archive, llm, store, analyzer } = makeHarness({
      threshold: 20,
      now: () => clock,
      modes: ['fail', 'ok'],
    });
    seed(archive, { senderId: 'u1', count: 20, startAt: clock });
    analyzer.notify(noticeOf({ senderId: 'u1' }));
    await analyzer.drain();

    expect(llm.calls).toHaveLength(1);
    const failed = store.get('u1');
    expect(failed?.lastError).toBe('模型超时');
    expect(failed?.analysis).toBeUndefined();
    expect(failed?.lastAttemptAt).toBe(clock);

    // 冷却期内再通知不重试
    clock += 60_000;
    analyzer.notify(noticeOf({ senderId: 'u1' }));
    await analyzer.drain();
    expect(llm.calls).toHaveLength(1);

    // 冷却结束后重试，这次成功并清空错误
    clock += AUTO_ANALYZE_COOLDOWN_MS;
    analyzer.notify(noticeOf({ senderId: 'u1' }));
    await analyzer.drain();
    expect(llm.calls).toHaveLength(2);
    expect(store.get('u1')?.analysis?.summary).toBe('话少但很稳，遇事先想办法');
    expect(store.get('u1')?.lastError).toBeUndefined();
  });

  it('自动分析关闭时不排队', async () => {
    const { archive, llm, analyzer } = makeHarness({ config: makeConfig({ autoAnalyze: false }) });
    seed(archive, { senderId: 'u1', count: 30 });
    analyzer.notify(noticeOf({ senderId: 'u1' }));
    await analyzer.drain();

    expect(analyzer.enabled).toBe(false);
    expect(llm.calls).toHaveLength(0);
  });

  it('人格档案关闭时同样不分析', async () => {
    const { archive, llm, analyzer } = makeHarness({ config: makeConfig({ enabled: false }) });
    seed(archive, { senderId: 'u1', count: 30 });
    analyzer.notify(noticeOf({ senderId: 'u1' }));
    await analyzer.drain();

    expect(llm.calls).toHaveLength(0);
  });

  it('会话无模型路由时回退到配置默认模型', async () => {
    const { archive, llm, analyzer } = makeHarness({ threshold: 20 });
    seed(archive, { senderId: 'u1', count: 20 });
    analyzer.notify(noticeOf({ senderId: 'u1' }));
    await analyzer.drain();

    expect(llm.calls[0]?.provider).toBe('trae');
    expect(llm.calls[0]?.model).toBe('deepseek-v4.1-flash');
  });

  it('会话有专属模型路由时优先使用', async () => {
    const { archive, llm, analyzer } = makeHarness({
      threshold: 20,
      route: { provider: 'openai', model: 'gpt-4o-mini' },
    });
    seed(archive, { senderId: 'u1', count: 20 });
    analyzer.notify(noticeOf({ senderId: 'u1' }));
    await analyzer.drain();

    expect(llm.calls[0]?.provider).toBe('openai');
    expect(llm.calls[0]?.model).toBe('gpt-4o-mini');
  });

  it('配置缺少模型时记录错误且不写分析结果', async () => {
    const config = makeConfig();
    const { archive, store, llm, analyzer } = makeHarness({ config });
    // 去掉默认模型：模拟既无会话路由也无配置模型
    (config as { provider?: string }).provider = undefined;
    (config as { model?: string }).model = undefined;
    seed(archive, { senderId: 'u1', count: 20 });
    analyzer.notify(noticeOf({ senderId: 'u1' }));
    await analyzer.drain();

    expect(llm.calls).toHaveLength(0);
    expect(store.get('u1')?.lastError).toContain('未配置模型');
    expect(store.get('u1')?.analysis).toBeUndefined();
  });

  it('dispose 后清空队列，未开始的条目不再分析', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const calls: GenerateOptions[] = [];
    const llm = {
      calls,
      async *stream(options: GenerateOptions) {
        calls.push(options);
        await gate;
        yield { type: 'text-delta', index: 0, text: PROFILE_JSON } as unknown as StreamChunk;
        yield { type: 'finish', reason: { kind: 'stop' } } as unknown as StreamChunk;
      },
    };

    const config = makeConfig();
    const archive = new PersonaArchive({ path: join(dir, 'archive.json'), maxMessages: 1000, writeDelayMs: 0 });
    const store = new PersonaProfileStore({ path: join(dir, 'profiles.json'), writeDelayMs: 0 });
    const analyzer = new PersonaAutoAnalyzer({
      archive, store, manager: makeManager(), config, llm: llm as never,
      logger: makeLogger(), threshold: 20, timeoutMs: 60_000,
    });

    seed(archive, { senderId: 'u1', count: 20, peerId: 'g1' });
    seed(archive, { senderId: 'u2', count: 20, peerId: 'g2' });
    analyzer.notify(noticeOf({ senderId: 'u1', peerId: 'g1' }));
    analyzer.notify(noticeOf({ senderId: 'u2', peerId: 'g2' }));
    analyzer.dispose();

    release();
    await analyzer.drain();

    expect(calls).toHaveLength(1);
    // u1 只留下“已尝试”占位（markAttempt），没有分析结果；u2 完全没被处理
    expect(store.get('u1')?.analysis).toBeUndefined();
    expect(store.get('u2')).toBeUndefined();
  });
});
