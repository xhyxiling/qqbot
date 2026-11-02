/**
 * /人格分析 命令单测
 *
 * 覆盖：@ 优先匹配（含 robot 自己/@全体 过滤）、昵称/openid 兜底、私聊直连、
 * 无目标时的用法提示、档案未启用 / 无 llm / 无归档的降级文案，
 * 以及成功分析后写入人格库。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SlashCommandHandlerContext } from '@tencent-connect/qqbot-nodejs';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { ImQQBotConfig } from '../config.ts';
import type { SessionManager } from '../session/index.ts';
import { PersonaArchive, personaArchiveKey } from '../features/persona-archive.ts';
import { PersonaProfileStore } from '../features/persona-profiles.ts';
import { personaAnalysisCommand, pickMentionedMember } from './persona-analysis.ts';
import type { CommandDeps } from './types.ts';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-qqbot-persona-cmd-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function makeConfig(overrides: Record<string, unknown> = {}): ImQQBotConfig {
  return {
    appId: 'app',
    appSecret: 'secret',
    provider: 'trae',
    model: 'deepseek-v4.1-flash',
    globalPrompt: '',
    personas: [],
    defaultPersona: '',
    textChunkLimit: 4000,
    personaAnalysis: {
      enabled: true, maxMessages: 300, retentionDays: 30, autoAnalyze: true, autoAnalyzeThreshold: 20,
    },
    ...overrides,
  } as unknown as ImQQBotConfig;
}

/** 模型输出的结构化 JSON */
const PROFILE_JSON = JSON.stringify({
  summary: '话少但很稳',
  traits: ['慢热', '理性'],
  style: '短句为主',
  catchphrases: ['行吧'],
  interests: ['技术'],
  role: '潜水科普',
  advice: '直接说重点',
  confidence: 'medium',
});

function makeLlm(text = PROFILE_JSON) {
  const calls: GenerateOptions[] = [];
  return {
    calls,
    async *stream(options: GenerateOptions) {
      calls.push(options);
      yield { type: 'text-delta', index: 0, text } as unknown as StreamChunk;
      yield { type: 'finish', reason: { kind: 'stop' } } as unknown as StreamChunk;
    },
  };
}

interface FakeCtxOptions {
  kind?: 'group' | 'c2c';
  senderId?: string;
  groupOpenid?: string;
  content?: string;
  mentions?: Array<Record<string, unknown>>;
  raw?: string;
}

function makeCtx(options: FakeCtxOptions = {}) {
  const sent: string[] = [];
  const ctx = {
    message: {
      kind: options.kind ?? 'group',
      senderId: options.senderId ?? 'u-owner',
      ...(options.groupOpenid !== undefined ? { groupOpenid: options.groupOpenid } : {}),
      content: options.content ?? '',
      ...(options.mentions !== undefined ? { mentions: options.mentions } : {}),
      messageId: 'm1',
    },
    command: { name: 'persona-analysis', args: [], raw: options.raw ?? '' },
    bot: {
      sendMarkdown: async (_target: unknown, content: string) => {
        sent.push(content);
      },
    },
    replyTarget: { scope: 'group', targetId: 'g1', msgId: 'm1' },
    signal: new AbortController().signal,
  } as unknown as SlashCommandHandlerContext;
  return { ctx, sent };
}

/** 两名群友：小明(u1) 6 条、小张(u2) 3 条，都在群 g1 */
function makeArchive(name = 'archive.json', groupId = 'g1'): PersonaArchive {
  const archive = new PersonaArchive({ path: join(dir, name), writeDelayMs: 0 });
  const chat = personaArchiveKey('app', 'group', groupId);
  const base = Date.now() - 60_000;
  for (let i = 0; i < 6; i++) {
    archive.append(chat, { senderId: 'u1', senderName: '小明', content: `小明第${i}句`, timestamp: base + i });
  }
  for (let i = 0; i < 3; i++) {
    archive.append(chat, { senderId: 'u2', senderName: '小张', content: `小张第${i}句`, timestamp: base + 100 + i });
  }
  return archive;
}

function makeDeps(options: {
  config?: ImQQBotConfig;
  archive?: PersonaArchive;
  profiles?: PersonaProfileStore;
  llm?: ReturnType<typeof makeLlm> | undefined;
  route?: { provider: string; model: string } | undefined;
} = {}): CommandDeps {
  const config = options.config ?? makeConfig();
  const archive = options.archive ?? makeArchive();
  const profiles = options.profiles ?? new PersonaProfileStore({ path: join(dir, 'profiles.json'), writeDelayMs: 0 });
  // 显式传 llm: undefined 表示「宿主没有 llm」，不传则用默认假模型
  const llm = 'llm' in options ? options.llm : makeLlm();
  const manager = {
    getEffectiveModel: () => ('route' in options ? options.route : { provider: 'trae', model: 'deepseek-v4.1-flash' }),
  } as unknown as SessionManager;
  return {
    manager,
    config,
    persona: {
      archive,
      profiles,
      ...(llm !== undefined ? { llm } : {}),
    },
  };
}

function getHandler(deps: CommandDeps) {
  return personaAnalysisCommand(deps).handler;
}

describe('pickMentionedMember', () => {
  it('优先取 member_openid 并带上昵称', () => {
    expect(pickMentionedMember([
      { is_you: true, member_openid: 'bot' },
      { member_openid: 'u1', nickname: '小明' },
    ], 'app')).toEqual({ senderId: 'u1', senderName: '小明' });
  });

  it('跳过 @全体 与机器人自己', () => {
    expect(pickMentionedMember([{ id: 'all' }, { is_you: true, member_openid: 'x' }], 'app'))
      .toBeUndefined();
    expect(pickMentionedMember([{ bot: true, member_openid: 'other-bot' }], 'app', '<@!other-bot>'))
      .toBeUndefined();
  });

  it('没有 mentions 时从正文 @ 标记兜底（机器人的已被清洗）', () => {
    expect(pickMentionedMember(undefined, 'app', ' <@!u1> 看下这个人 ')).toEqual({ senderId: 'u1' });
  });
});

describe('personaAnalysisCommand', () => {
  it('群聊里 @ 谁就分析谁，并写入人格库', async () => {
    const deps = makeDeps();
    const { ctx, sent } = makeCtx({
      kind: 'group',
      groupOpenid: 'g1',
      mentions: [{ is_you: true, member_openid: 'bot' }, { member_openid: 'u1', nickname: '小明' }],
    });

    const result = await getHandler(deps)(ctx);
    expect(result).toEqual({ kind: 'noop' });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain('# 小明 的人格档案');
    expect(sent[0]).toContain('慢热');
    expect(deps.persona?.profiles.get('u1')).toMatchObject({
      analyzedMessageCount: 6,
      analyzedChatCount: 1,
    });
  });

  it('跨群同一个人会一起分析（chatCount > 1）', async () => {
    const archive = makeArchive();
    const other = personaArchiveKey('app', 'group', 'g2');
    archive.append(other, { senderId: 'u1', senderName: '小明', content: '另一个群的话', timestamp: Date.now() });
    const deps = makeDeps({ archive });
    const { ctx, sent } = makeCtx({ groupOpenid: 'g1', mentions: [{ member_openid: 'u1' }] });

    await getHandler(deps)(ctx);
    expect(deps.persona?.profiles.get('u1')?.analyzedChatCount).toBe(2);
    expect(sent[0]).toContain('2 个会话');
  });

  it('@ 的人没有归档发言时提示先聊几句', async () => {
    const deps = makeDeps();
    const { ctx, sent } = makeCtx({ groupOpenid: 'g1', mentions: [{ member_openid: 'u-stranger' }] });

    const result = await getHandler(deps)(ctx);
    expect(result).toContain('还没有 @ 的这位群友的发言');
    expect(sent).toHaveLength(0);
  });

  it('没有 @ 也没有参数时给用法提示和快捷入口，不调用模型', async () => {
    const deps = makeDeps();
    const { ctx, sent } = makeCtx({ groupOpenid: 'g1' });

    const result = await getHandler(deps)(ctx);
    expect(result).toEqual({ kind: 'noop' });
    expect(sent[0]).toContain('人格分析用法');
    expect(sent[0]).toContain('text="/人格分析 u1"');
  });

  it('没有 @ 时退回昵称匹配', async () => {
    const deps = makeDeps();
    const { ctx, sent } = makeCtx({ groupOpenid: 'g1', raw: '小张' });

    await getHandler(deps)(ctx);
    expect(sent[0]).toContain('# 小张 的人格档案');
    expect(deps.persona?.profiles.get('u2')?.analysis).toBeDefined();
  });

  it('昵称匹配到多人时提示改用 @', async () => {
    const archive = new PersonaArchive({ path: join(dir, 'amb.json'), writeDelayMs: 0 });
    const chat = personaArchiveKey('app', 'group', 'g1');
    const now = Date.now();
    archive.append(chat, { senderId: 'u-a', senderName: '小明', content: 'a', timestamp: now });
    archive.append(chat, { senderId: 'u-b', senderName: '小明', content: 'b', timestamp: now + 1000 });
    const deps = makeDeps({ archive });
    const { ctx, sent } = makeCtx({ groupOpenid: 'g1', raw: '小明' });

    const result = await getHandler(deps)(ctx);
    expect(result).toContain('匹配到多位群友');
    expect(result).toContain('建议直接 @');
    expect(sent).toHaveLength(0);
  });

  it('私聊里没有 @ 时分析对面的人', async () => {
    const archive = new PersonaArchive({ path: join(dir, 'c2c.json'), writeDelayMs: 0 });
    const chat = personaArchiveKey('app', 'c2c', 'u-peer');
    archive.append(chat, { senderId: 'u-peer', senderName: '小明', content: '私聊的话', timestamp: Date.now() });
    const deps = makeDeps({ archive });
    const { ctx, sent } = makeCtx({ kind: 'c2c', senderId: 'u-peer' });

    await getHandler(deps)(ctx);
    expect(sent[0]).toContain('# 小明 的人格档案');
    expect(deps.persona?.profiles.get('u-peer')?.analyzedMessageCount).toBe(1);
  });

  it('档案关闭或服务缺失时提示去设置面板开启', async () => {
    const deps = makeDeps({ config: makeConfig({
      personaAnalysis: {
        enabled: false, maxMessages: 300, retentionDays: 30, autoAnalyze: true, autoAnalyzeThreshold: 20,
      },
    }) });
    const { ctx, sent } = makeCtx({ groupOpenid: 'g1', mentions: [{ member_openid: 'u1' }] });

    const result = await getHandler({ manager: deps.manager, config: deps.config })(ctx);
    expect(result).toContain('群友人格档案未启用');
    expect(sent).toHaveLength(0);
  });

  it('没有 llm 服务时给出可操作提示', async () => {
    const deps = makeDeps({ llm: undefined });
    const { ctx } = makeCtx({ groupOpenid: 'g1', mentions: [{ member_openid: 'u1' }] });

    const result = await getHandler(deps)(ctx);
    expect(result).toContain('需要 llm 服务');
  });

  it('档案为空时提示先积累', async () => {
    const deps = makeDeps({ archive: new PersonaArchive({ path: join(dir, 'empty.json'), writeDelayMs: 0 }) });
    const { ctx } = makeCtx({ groupOpenid: 'g1', mentions: [{ member_openid: 'u1' }] });

    const result = await getHandler(deps)(ctx);
    expect(result).toContain('还没有归档的聊天记录');
  });

  it('模型失败时把错误降级成一句提示', async () => {
    const failing = {
      async *stream() {
        yield { type: 'finish', reason: { kind: 'error', failure: { message: '模型超时' } } } as unknown as StreamChunk;
      },
    };
    const deps = makeDeps({ llm: failing as never });
    const { ctx, sent } = makeCtx({ groupOpenid: 'g1', mentions: [{ member_openid: 'u1' }] });

    const result = await getHandler(deps)(ctx);
    expect(String(result)).toContain('分析失败');
    expect(sent).toHaveLength(0);
    expect(deps.persona?.profiles.get('u1')).toBeUndefined();
  });

  it('会话路由缺失时回退到配置默认模型', async () => {
    const deps = makeDeps({ route: undefined });
    const { ctx, sent } = makeCtx({ groupOpenid: 'g1', mentions: [{ member_openid: 'u1' }] });

    await getHandler(deps)(ctx);
    expect(sent[0]).toContain('人格档案');
    expect(deps.persona?.profiles.get('u1')?.provider).toBe('trae');
  });

  it('命令注册了中文别名且仅管理员可用', () => {
    const deps = makeDeps();
    const command = personaAnalysisCommand(deps);
    expect(command.name).toEqual(['人格分析', 'persona-analysis']);
    expect(command.minRole).toBe('admin');
    expect(command.category).toBe('qqbot');
  });
});

describe('buildCommandList 集成', () => {
  it('命令列表里包含 /人格分析', async () => {
    const { buildCommandList } = await import('./index.ts');
    const commands = buildCommandList({
      manager: {} as never,
      config: makeConfig(),
    });
    const names = commands.flatMap((command) => (Array.isArray(command.name) ? command.name : [command.name]));
    expect(names).toContain('人格分析');
  });

  it('未注入 persona 服务时命令仍可注册', async () => {
    const { buildCommandList } = await import('./index.ts');
    const commands = buildCommandList({
      manager: {} as never,
      config: makeConfig(),
    });
    expect(commands.find((command) => Array.isArray(command.name)
      && command.name.includes('persona-analysis'))).toBeDefined();
  });
});
