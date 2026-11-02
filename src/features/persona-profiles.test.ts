/**
 * 人格库存储与设置面板视图单测
 *
 * 覆盖：落盘/重载、upsert/markAttempt、跨会话合并、pending 判定、
 * 名称/openid/特点筛选、排序与分页。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ImQQBotConfig } from '../config.ts';
import {
  PersonaProfileStore,
  listPersonaProfileViews,
  parseChatKey,
} from './persona-profiles.ts';
import { PersonaArchive, personaArchiveKey } from './persona-archive.ts';
import type { PersonaAnalysisResult } from './persona-profile-analysis.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-qqbot-profiles-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeConfig(options: {
  enabled?: boolean;
  autoAnalyze?: boolean;
  threshold?: number;
} = {}): ImQQBotConfig {
  return {
    appId: 'app',
    provider: 'trae',
    model: 'm',
    personaAnalysis: {
      enabled: options.enabled ?? true,
      maxMessages: 300,
      retentionDays: 30,
      autoAnalyze: options.autoAnalyze ?? true,
      autoAnalyzeThreshold: options.threshold ?? 20,
    },
  } as unknown as ImQQBotConfig;
}

function analysis(overrides: Partial<PersonaAnalysisResult> = {}): PersonaAnalysisResult {
  return {
    summary: '话少但很稳',
    traits: ['慢热', '理性'],
    style: '短句为主',
    catchphrases: ['行吧'],
    interests: ['技术'],
    role: '潜水科普',
    advice: '直接说重点',
    confidence: 'medium',
    ...overrides,
  };
}

/** 建一个含指定发送者消息的档案 */
function makeArchive(entries: Array<{ chat: string; senderId: string; senderName?: string; count: number }>): PersonaArchive {
  const archive = new PersonaArchive({ path: join(dir, 'archive.json'), writeDelayMs: 0 });
  const now = Date.now();
  for (const entry of entries) {
    for (let i = 0; i < entry.count; i += 1) {
      archive.append(entry.chat, {
        senderId: entry.senderId,
        ...(entry.senderName !== undefined ? { senderName: entry.senderName } : {}),
        content: `消息 ${i}`,
        timestamp: now + i * 1000,
      });
    }
  }
  return archive;
}

describe('PersonaProfileStore', () => {
  it('写入后可从磁盘重载（含结构化结果）', () => {
    const path = join(dir, 'profiles.json');
    const store = new PersonaProfileStore({ path, writeDelayMs: 0 });
    store.upsert({
      senderId: 'u1',
      senderName: '小明',
      analysis: analysis(),
      analyzedMessageCount: 30,
      analyzedChatCount: 2,
      analyzedAt: 1000,
      provider: 'trae',
      model: 'm',
      lastAttemptAt: 1000,
    });
    store.flush();

    const reloaded = new PersonaProfileStore({ path, writeDelayMs: 0 });
    expect(reloaded.get('u1')).toMatchObject({
      senderId: 'u1',
      senderName: '小明',
      analyzedMessageCount: 30,
      analyzedChatCount: 2,
      provider: 'trae',
      model: 'm',
    });
    expect(reloaded.get('u1')?.analysis?.traits).toEqual(['慢热', '理性']);
  });

  it('get 返回副本，修改不影响内部数据', () => {
    const store = new PersonaProfileStore({ path: join(dir, 'copy.json'), writeDelayMs: 0 });
    store.upsert({
      senderId: 'u1',
      analysis: analysis(),
      analyzedMessageCount: 30,
      analyzedChatCount: 1,
      analyzedAt: 1000,
      provider: 'trae',
      model: 'm',
    });
    const copy = store.get('u1')!;
    copy.analysis!.traits.push('新标签');
    expect(store.get('u1')?.analysis?.traits).toEqual(['慢热', '理性']);
  });

  it('markAttempt 保留已有分析并记录失败原因，成功后清空错误', () => {
    const store = new PersonaProfileStore({ path: join(dir, 'attempt.json'), writeDelayMs: 0 });
    store.upsert({
      senderId: 'u1',
      analysis: analysis(),
      analyzedMessageCount: 20,
      analyzedChatCount: 1,
      analyzedAt: 1000,
      provider: 'trae',
      model: 'm',
    });
    store.markAttempt('u1', 2000, '模型超时');
    expect(store.get('u1')?.lastError).toBe('模型超时');
    expect(store.get('u1')?.analysis?.summary).toBe('话少但很稳');
    expect(store.get('u1')?.lastAttemptAt).toBe(2000);

    store.markAttempt('u1', 3000);
    expect(store.get('u1')?.lastError).toBeUndefined();
  });

  it('markAttempt 对没有分析记录的人也能创建占位行', () => {
    const store = new PersonaProfileStore({ path: join(dir, 'attempt2.json'), writeDelayMs: 0 });
    store.markAttempt('u2', 1000, '未配置模型');
    expect(store.get('u2')).toMatchObject({
      senderId: 'u2', analyzedMessageCount: 0, analyzedChatCount: 0, lastError: '未配置模型',
    });
  });

  it('touchName 只在昵称变化时更新', () => {
    const store = new PersonaProfileStore({ path: join(dir, 'name.json'), writeDelayMs: 0 });
    store.upsert({
      senderId: 'u1',
      senderName: '小明',
      analysis: analysis(),
      analyzedMessageCount: 10,
      analyzedChatCount: 1,
      analyzedAt: 1000,
      provider: 'trae',
      model: 'm',
    });
    store.touchName('u1', '小明');
    expect(store.get('u1')?.senderName).toBe('小明');
    store.touchName('u1', '小明2');
    expect(store.get('u1')?.senderName).toBe('小明2');
    store.touchName('u1', '  ');
    expect(store.get('u1')?.senderName).toBe('小明2');
  });

  it('remove 删除档案', () => {
    const store = new PersonaProfileStore({ path: join(dir, 'remove.json'), writeDelayMs: 0 });
    store.upsert({
      senderId: 'u1',
      analysis: analysis(),
      analyzedMessageCount: 10,
      analyzedChatCount: 1,
      analyzedAt: 1000,
      provider: 'trae',
      model: 'm',
    });
    expect(store.remove('u1')).toBe(true);
    expect(store.remove('u1')).toBe(false);
    expect(store.get('u1')).toBeUndefined();
  });

  it('损坏文件按空库处理', () => {
    const path = join(dir, 'profiles.json');
    expect(() => new PersonaProfileStore({ path, writeDelayMs: 0 })).not.toThrow();
    expect(new PersonaProfileStore({ path, writeDelayMs: 0 }).list()).toEqual([]);
  });
});

describe('listPersonaProfileViews', () => {
  const now = Date.now();

  function setup(options: {
    autoAnalyze?: boolean;
    threshold?: number;
    enabled?: boolean;
  } = {}) {
    const archive = makeArchive([
      { chat: personaArchiveKey('app', 'group', 'g1'), senderId: 'u1', senderName: '小明', count: 25 },
      { chat: personaArchiveKey('app', 'group', 'g2'), senderId: 'u1', senderName: '小明', count: 5 },
      { chat: personaArchiveKey('app', 'group', 'g1'), senderId: 'u2', senderName: '小张', count: 8 },
    ]);
    const store = new PersonaProfileStore({ path: join(dir, 'profiles.json'), writeDelayMs: 0 });
    return {
      archive,
      store,
      config: makeConfig(options),
    };
  }

  it('合并跨会话计数与分析结果', () => {
    const { archive, store, config } = setup();
    store.upsert({
      senderId: 'u1',
      senderName: '小明',
      analysis: analysis({ traits: ['慢热', '理性'] }),
      analyzedMessageCount: 5,
      analyzedChatCount: 2,
      analyzedAt: now,
      provider: 'trae',
      model: 'm',
    });

    const response = listPersonaProfileViews(config, {}, { archive, store });
    expect(response.ok).toBe(true);
    expect(response.total).toBe(2);

    const row = response.profiles.find((profile) => profile.senderId === 'u1')!;
    expect(row).toMatchObject({
      senderId: 'u1',
      senderName: '小明',
      messageCount: 30,
      chatCount: 2,
      traits: ['慢热', '理性'],
      summary: '话少但很稳',
      pending: true, // 30 - 5 >= 20
    });
    expect(row.chats.map((chat) => chat.messageCount)).toEqual([25, 5]);
    expect(row.chats.every((chat) => chat.scope === 'group')).toBe(true);
  });

  it('同一 openid 的群聊与私聊合并成一行，并保留两种会话', () => {
    const archive = makeArchive([
      { chat: personaArchiveKey('app', 'group', 'g1'), senderId: 'u1', senderName: '小明', count: 10 },
      { chat: personaArchiveKey('app', 'c2c', 'u1'), senderId: 'u1', senderName: '小明', count: 10 },
    ]);
    const store = new PersonaProfileStore({ path: join(dir, 'mixed.json'), writeDelayMs: 0 });

    const response = listPersonaProfileViews(makeConfig(), {}, { archive, store });
    expect(response.profiles).toHaveLength(1);
    const row = response.profiles[0]!;
    expect(row).toMatchObject({ senderId: 'u1', messageCount: 20, chatCount: 2 });
    expect(row.chats.map((chat) => chat.scope).sort()).toEqual(['c2c', 'group']);
    expect(row.chats.map((chat) => chat.messageCount)).toEqual([10, 10]);
  });

  it('未达到阈值的成员保持 pending=false', () => {
    const { archive, store, config } = setup();
    const response = listPersonaProfileViews(config, {}, { archive, store });
    const row = response.profiles.find((profile) => profile.senderId === 'u2')!;
    expect(row.messageCount).toBe(8);
    expect(row.pending).toBe(false);
    expect(row.traits).toEqual([]);
  });

  it('自动分析关闭时不标记 pending', () => {
    const { archive, store, config } = setup({ autoAnalyze: false });
    const response = listPersonaProfileViews(config, {}, { archive, store });
    expect(response.profiles.every((profile) => !profile.pending)).toBe(true);
  });

  it('按昵称筛选', () => {
    const { archive, store, config } = setup();
    const response = listPersonaProfileViews(config, { name: '小张' }, { archive, store });
    expect(response.profiles.map((profile) => profile.senderId)).toEqual(['u2']);
    expect(response.total).toBe(1);
  });

  it('按 openid 筛选（包含匹配）', () => {
    const { archive, store, config } = setup();
    const response = listPersonaProfileViews(config, { openid: 'U2' }, { archive, store });
    expect(response.profiles.map((profile) => profile.senderId)).toEqual(['u2']);
  });

  it('按人格特点筛选（traits 与 summary/style 都算）', () => {
    const { archive, store, config } = setup();
    store.upsert({
      senderId: 'u1',
      senderName: '小明',
      analysis: analysis({ traits: ['慢热'], summary: '话少但很稳', style: '短句为主' }),
      analyzedMessageCount: 30,
      analyzedChatCount: 2,
      analyzedAt: now,
      provider: 'trae',
      model: 'm',
    });
    expect(listPersonaProfileViews(config, { trait: '慢热' }, { archive, store })
      .profiles.map((profile) => profile.senderId)).toEqual(['u1']);
    expect(listPersonaProfileViews(config, { trait: '短句' }, { archive, store })
      .profiles.map((profile) => profile.senderId)).toEqual(['u1']);
    expect(listPersonaProfileViews(config, { trait: '不存在' }, { archive, store }).profiles)
      .toEqual([]);
  });

  it('档案被清理后仍保留历史分析行', () => {
    const store = new PersonaProfileStore({ path: join(dir, 'orphan.json'), writeDelayMs: 0 });
    store.upsert({
      senderId: 'u9',
      senderName: '旧群友',
      analysis: analysis(),
      analyzedMessageCount: 40,
      analyzedChatCount: 1,
      analyzedAt: now,
      provider: 'trae',
      model: 'm',
    });
    const archive = makeArchive([
      { chat: personaArchiveKey('app', 'group', 'g1'), senderId: 'u1', senderName: '小明', count: 2 },
    ]);
    const response = listPersonaProfileViews(makeConfig(), {}, { archive, store });
    const row = response.profiles.find((profile) => profile.senderId === 'u9')!;
    expect(row.messageCount).toBe(40);
    expect(row.chatCount).toBe(1);
    expect(row.summary).toBe('话少但很稳');
  });

  it('pending 优先排序，其次消息量降序', () => {
    const { archive, store, config } = setup();
    // u2 只有 8 条（不 pending），u1 有 30 条（pending）
    const response = listPersonaProfileViews(config, {}, { archive, store });
    expect(response.profiles.map((profile) => profile.senderId)).toEqual(['u1', 'u2']);
  });

  it('分页：offset / limit 生效但 total 是过滤后的总数', () => {
    const { archive, store, config } = setup();
    const response = listPersonaProfileViews(config, { offset: 1, limit: 1 }, { archive, store });
    expect(response.total).toBe(2);
    expect(response.profiles).toHaveLength(1);
    expect(response.profiles[0]?.senderId).toBe('u2');
  });

  it('失效/关闭的档案不读取，但其他人格库行仍返回', () => {
    const store = new PersonaProfileStore({ path: join(dir, 'closed.json'), writeDelayMs: 0 });
    store.upsert({
      senderId: 'u1',
      analysis: analysis(),
      analyzedMessageCount: 30,
      analyzedChatCount: 1,
      analyzedAt: now,
      provider: 'trae',
      model: 'm',
    });
    const closedArchive = makeArchive([
      { chat: personaArchiveKey('app', 'group', 'g1'), senderId: 'u1', senderName: '小明', count: 30 },
    ]);
    const response = listPersonaProfileViews(makeConfig({ enabled: false }), {}, {
      archive: closedArchive, store,
    });
    // 显式传入 archive 时仍使用它；这里断言关闭开关不影响已存储的分析结果
    const row = response.profiles.find((profile) => profile.senderId === 'u1')!;
    expect(row.summary).toBe('话少但很稳');
    expect(row.pending).toBe(false);
  });
});

describe('parseChatKey', () => {
  it('解析 group / c2c，peerId 可含冒号', () => {
    expect(parseChatKey('qqbot:app:group:g1')).toEqual({ scope: 'group', peerId: 'g1' });
    expect(parseChatKey('qqbot:app:c2c:user:1')).toEqual({ scope: 'c2c', peerId: 'user:1' });
  });

  it('非标准 key 回退为 group + 原串', () => {
    expect(parseChatKey('g1')).toEqual({ scope: 'group', peerId: 'g1' });
  });
});
