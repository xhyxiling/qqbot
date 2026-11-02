/**
 * 群聊人格档案单测
 *
 * 覆盖：文本清洗、去重、条数上限、保留期清理、落盘/重载、成员统计，
 * 以及归档中间件的写入与跳过规则。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Middleware, MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import {
  ARCHIVE_MAX_CONTENT_CHARS,
  PersonaArchive,
  cleanArchiveText,
  createPersonaArchiveMiddleware,
  personaArchiveKey,
} from './persona-archive.ts';

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-qqbot-archive-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeArchive(options: {
  name?: string;
  maxMessages?: number;
  retentionDays?: number;
  now?: () => number;
} = {}): PersonaArchive {
  return new PersonaArchive({
    path: join(dir, options.name ?? 'persona-archive.json'),
    maxMessages: options.maxMessages,
    retentionDays: options.retentionDays ?? 30,
    writeDelayMs: 0,
    now: options.now,
  });
}

/** 构造只带 message 的假上下文 */
function makeCtx(message: Partial<MiddlewareContext['message']>): MiddlewareContext {
  return { message } as unknown as MiddlewareContext;
}

describe('cleanArchiveText', () => {
  it('去掉 @ 标记、表情标签与 CQ 码并折叠空白', () => {
    expect(cleanArchiveText(' <@!123> 你 [<face id="1">] 好 [CQ:image,file=x] '))
      .toBe('你 好');
  });

  it('空值与纯空白返回空串', () => {
    expect(cleanArchiveText(undefined)).toBe('');
    expect(cleanArchiveText(' \n\t ')).toBe('');
  });

  it('超长内容截断到上限', () => {
    const text = 'a'.repeat(ARCHIVE_MAX_CONTENT_CHARS + 50);
    expect(cleanArchiveText(text)).toHaveLength(ARCHIVE_MAX_CONTENT_CHARS);
  });
});

describe('PersonaArchive', () => {
  it('按追加顺序读取，返回副本不影响内部数据', () => {
    const archive = makeArchive();
    const key = personaArchiveKey('app', 'group', 'g1');
    const now = Date.now();
    archive.append(key, { senderId: 'u1', content: '第一句', timestamp: now, messageId: 'm1' });
    archive.append(key, { senderId: 'u2', content: '第二句', timestamp: now + 1000, messageId: 'm2' });

    const list = archive.list(key);
    expect(list.map((item) => item.content)).toEqual(['第一句', '第二句']);
    list[0]!.content = '改动';
    expect(archive.list(key)[0]?.content).toBe('第一句');
  });

  it('同一 messageId 只记录一次', () => {
    const archive = makeArchive();
    const key = personaArchiveKey('app', 'group', 'g1');
    const now = Date.now();
    archive.append(key, { senderId: 'u1', content: '原文', timestamp: now, messageId: 'm1' });
    archive.append(key, { senderId: 'u1', content: '重放', timestamp: now + 1000, messageId: 'm1' });
    expect(archive.list(key)).toHaveLength(1);
  });

  it('超过 maxMessages 淘汰最旧的消息', () => {
    const archive = makeArchive({ maxMessages: 3 });
    const key = personaArchiveKey('app', 'group', 'g1');
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      archive.append(key, { senderId: 'u1', content: `第${i}条`, timestamp: now + i * 1000, messageId: `m${i}` });
    }
    expect(archive.list(key).map((item) => item.content)).toEqual(['第2条', '第3条', '第4条']);
  });

  it('追加时清理超过保留期的旧消息', () => {
    let now = 1000;
    const archive = makeArchive({ now: () => now });
    const key = personaArchiveKey('app', 'group', 'g1');
    archive.append(key, { senderId: 'u1', content: '很旧的话', timestamp: now, messageId: 'm1' });

    now += 31 * 24 * 60 * 60 * 1000;
    archive.append(key, { senderId: 'u1', content: '新的话', timestamp: now, messageId: 'm2' });

    expect(archive.list(key).map((item) => item.content)).toEqual(['新的话']);
  });

  it('落盘后重载能恢复内容，并在加载时按保留期清理', () => {
    let now = 1000;
    const path = join(dir, 'persona-archive.json');
    const first = new PersonaArchive({
      path, maxMessages: 10, retentionDays: 30, writeDelayMs: 0, now: () => now,
    });
    const key = personaArchiveKey('app', 'group', 'g1');
    first.append(key, { senderId: 'u1', senderName: '小明', content: '旧消息', timestamp: now, messageId: 'm1' });
    now += 40 * 24 * 60 * 60 * 1000;
    first.append(key, { senderId: 'u2', content: '新消息', timestamp: now, messageId: 'm2' });

    const reloaded = new PersonaArchive({
      path, maxMessages: 10, retentionDays: 30, writeDelayMs: 0, now: () => now,
    });
    expect(reloaded.list(key).map((item) => item.content)).toEqual(['新消息']);
    expect(reloaded.list(key)[0]?.senderId).toBe('u2');
  });

  it('文件损坏时按空档案处理，不抛错', () => {
    const path = join(dir, 'broken.json');
    expect(() => new PersonaArchive({ path, writeDelayMs: 0 })).not.toThrow();
  });

  it('members 按消息量降序统计', () => {
    const archive = makeArchive();
    const key = personaArchiveKey('app', 'group', 'g1');
    const now = Date.now();
    archive.append(key, { senderId: 'u1', senderName: '小明', content: 'a', timestamp: now });
    archive.append(key, { senderId: 'u2', content: 'b', timestamp: now + 1000 });
    archive.append(key, { senderId: 'u1', senderName: '小明', content: 'c', timestamp: now + 2000 });

    const members = archive.members(key);
    expect(members).toHaveLength(2);
    expect(members[0]).toMatchObject({
      senderId: 'u1', senderName: '小明', count: 2, firstAt: now, lastAt: now + 2000,
    });
    expect(members[1]).toMatchObject({ senderId: 'u2', count: 1 });
  });

  it('listBySender 过滤指定发送者，limit 取最近若干条', () => {
    const archive = makeArchive();
    const key = personaArchiveKey('app', 'group', 'g1');
    const now = Date.now();
    for (let i = 0; i < 4; i++) {
      archive.append(key, {
        senderId: i % 2 === 0 ? 'u1' : 'u2',
        content: `m${i}`,
        timestamp: now + i * 1000,
      });
    }
    expect(archive.listBySender(key, 'u2').map((item) => item.content)).toEqual(['m1', 'm3']);
    expect(archive.list(key, 2).map((item) => item.content)).toEqual(['m2', 'm3']);
  });

  it('clear 清空指定会话', () => {
    const archive = makeArchive();
    const key = personaArchiveKey('app', 'group', 'g1');
    archive.append(key, { senderId: 'u1', content: 'hi', timestamp: 1000 });
    archive.clear(key);
    expect(archive.list(key)).toEqual([]);
  });

  it('append 返回是否真正新增（重复/空内容返回 false）', () => {
    const archive = makeArchive();
    const key = personaArchiveKey('app', 'group', 'g1');
    const now = Date.now();
    expect(archive.append(key, { senderId: 'u1', content: 'hi', timestamp: now, messageId: 'm1' })).toBe(true);
    expect(archive.append(key, { senderId: 'u1', content: 'hi', timestamp: now, messageId: 'm1' })).toBe(false);
    expect(archive.append(key, { senderId: 'u1', content: '   ', timestamp: now })).toBe(false);
  });

  it('membersAll 跨会话合并同一 openid 并给出会话分布', () => {
    const archive = makeArchive();
    const now = Date.now();
    const g1 = personaArchiveKey('app', 'group', 'g1');
    const g2 = personaArchiveKey('app', 'group', 'g2');
    archive.append(g1, { senderId: 'u1', senderName: '小明', content: 'a', timestamp: now });
    archive.append(g1, { senderId: 'u2', senderName: '小张', content: 'b', timestamp: now + 1000 });
    archive.append(g2, { senderId: 'u1', senderName: '小明', content: 'c', timestamp: now + 2000 });

    const members = archive.membersAll();
    expect(members).toHaveLength(2);
    expect(members[0]).toMatchObject({
      senderId: 'u1', senderName: '小明', count: 2, firstAt: now, lastAt: now + 2000,
    });
    expect(members[0]!.chats).toHaveLength(2);
    // 条数相同按最近发言时间倒序（g2 更新，排在前面）
    expect(members[0]!.chats.map((chat) => [chat.chatKey, chat.count])).toEqual([
      [g2, 1], [g1, 1],
    ]);
    expect(members[1]).toMatchObject({ senderId: 'u2', count: 1 });
  });

  it('countBySender / chatsForSender 跨会话统计', () => {
    const archive = makeArchive();
    const now = Date.now();
    archive.append(personaArchiveKey('app', 'group', 'g1'), {
      senderId: 'u1', content: 'a', timestamp: now,
    });
    archive.append(personaArchiveKey('app', 'group', 'g1'), {
      senderId: 'u1', content: 'b', timestamp: now + 1000,
    });
    archive.append(personaArchiveKey('app', 'c2c', 'u1'), {
      senderId: 'u1', content: 'c', timestamp: now + 2000,
    });
    archive.append(personaArchiveKey('app', 'group', 'g2'), {
      senderId: 'u2', content: 'd', timestamp: now + 3000,
    });

    expect(archive.countBySender('u1')).toBe(3);
    expect(archive.chatKeys()).toHaveLength(3);
    const chats = archive.chatsForSender('u1');
    expect(chats.map((chat) => chat.count)).toEqual([2, 1]);
    expect(chats[0]!.chatKey).toBe(personaArchiveKey('app', 'group', 'g1'));
  });
});

describe('createPersonaArchiveMiddleware', () => {
  const config = { appId: 'app' } as ImQQBotConfig;

  it('记录未 @bot 的群聊消息并清洗 @ 标记', async () => {
    const archive = makeArchive();
    const middleware = createPersonaArchiveMiddleware(config, archive, makeLogger());
    let nextCalled = false;

    await middleware(
      makeCtx({
        kind: 'group',
        senderId: 'u1',
        senderName: '小明',
        groupOpenid: 'g1',
        messageId: 'm1',
        senderIsBot: false,
        content: '<@!bot> 今天好热',
      }),
      async () => { nextCalled = true; },
    );

    const list = archive.list(personaArchiveKey('app', 'group', 'g1'));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ senderId: 'u1', senderName: '小明', content: '今天好热', messageId: 'm1' });
    expect(nextCalled).toBe(true);
  });

  it('记录私聊消息', async () => {
    const archive = makeArchive();
    const middleware = createPersonaArchiveMiddleware(config, archive, makeLogger());

    await middleware(
      makeCtx({ kind: 'c2c', senderId: 'u1', messageId: 'm1', content: '在吗' }),
      async () => {},
    );

    expect(archive.list(personaArchiveKey('app', 'c2c', 'u1')).map((item) => item.content)).toEqual(['在吗']);
  });

  it('跳过机器人、斜杠命令、空内容与非 QQ 场景', async () => {
    const archive = makeArchive();
    const middleware = createPersonaArchiveMiddleware(config, archive, makeLogger());
    const cases: Array<Partial<MiddlewareContext['message']>> = [
      { kind: 'group', senderId: 'u1', groupOpenid: 'g1', content: 'hi', senderIsBot: true },
      { kind: 'group', senderId: 'u1', groupOpenid: 'g1', content: '/new' },
      { kind: 'group', senderId: 'u1', groupOpenid: 'g1', content: '   ' },
      { kind: 'guild', senderId: 'u1', content: 'hi' },
    ];
    for (const message of cases) {
      let nextCalled = false;
      await middleware(makeCtx(message), async () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
    }
    expect(archive.list(personaArchiveKey('app', 'group', 'g1'))).toEqual([]);
  });

  it('归档失败不影响后续中间件', async () => {
    const logger = makeLogger();
    // 让 append 抛错，验证异常被吞掉且 next() 仍被调用
    const middleware = createPersonaArchiveMiddleware(config, {
      append: () => { throw new Error('boom'); },
    } as unknown as PersonaArchive, logger);
    let nextCalled = false;
    await middleware(
      makeCtx({ kind: 'group', senderId: 'u1', groupOpenid: 'g1', content: 'hi' }),
      async () => { nextCalled = true; },
    );
    expect(nextCalled).toBe(true);
    expect(logger.debug).toHaveBeenCalled();
  });

  it('只有真正写入后才触发 onArchived 通知', async () => {
    const archive = makeArchive();
    const notices: Array<{ senderId: string; scope: string; peerId: string }> = [];
    const middleware = createPersonaArchiveMiddleware(
      config, archive, makeLogger(),
      (notice) => { notices.push(notice); },
    );

    await middleware(
      makeCtx({
        kind: 'group', senderId: 'u1', senderName: '小明', groupOpenid: 'g1',
        messageId: 'm1', senderIsBot: false, content: '今天好热',
      }),
      async () => {},
    );
    // 同一 messageId 重放：append 返回 false，不应再次通知
    await middleware(
      makeCtx({
        kind: 'group', senderId: 'u1', senderName: '小明', groupOpenid: 'g1',
        messageId: 'm1', senderIsBot: false, content: '今天好热',
      }),
      async () => {},
    );

    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ senderId: 'u1', scope: 'group', peerId: 'g1' });
  });
});
