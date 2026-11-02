/**
 * qqbot_analyze_persona 单测
 *
 * 覆盖：目标选择/歧义、跨会话聚合、JSON 结构化输出、写入人格库，
 * 以及注册与 execute 的常见失败分支。
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
  PERSONA_ANALYSIS_TOOL_NAME,
  describeTargets,
  registerPersonaAnalysisTool,
  selectAnalysisTargets,
} from './persona-analysis-tool.ts';
import {
  PROFILE_ANALYSIS_MAX_TOKENS,
  PROFILE_ANALYSIS_SYSTEM_PROMPT,
} from './persona-profile-analysis.ts';
import {
  PersonaArchive,
  personaArchiveKey,
  type ArchivedMessage,
} from './persona-archive.ts';
import { PersonaProfileStore } from './persona-profiles.ts';

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-qqbot-persona-tool-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 一条归档消息 */
function message(
  senderId: string,
  content: string,
  timestamp = Date.now(),
  senderName?: string,
): ArchivedMessage {
  return { senderId, content, timestamp, ...(senderName !== undefined ? { senderName } : {}) };
}

/** 三个群友：小明 3 条、小张 2 条、路人 1 条 */
function sampleEntries(): ArchivedMessage[] {
  const base = Date.now() - 60_000;
  return [
    message('u-ming', '早', base, '小明'),
    message('u-zhang', '来了', base + 1000, '小张'),
    message('u-ming', '今天好热', base + 2000, '小明'),
    message('u-zhang', '确实', base + 3000, '小张'),
    message('u-ming', '开空调吧', base + 4000, '小明'),
    message('u-pass', '路过', base + 5000, '路人'),
  ];
}

function makeConfig(overrides: Partial<ImQQBotConfig> = {}): ImQQBotConfig {
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
      maxMessages: 300,
      retentionDays: 30,
      autoAnalyze: true,
      autoAnalyzeThreshold: 20,
    },
    ...overrides,
  } as unknown as ImQQBotConfig;
}

function makeCtx(services: { tools?: unknown; llm?: unknown }): { get(name: string): unknown } {
  return { get: (name: string) => services[name as keyof typeof services] };
}

function makeTools(): { register(definition: unknown): void } & { definitions: Array<Record<string, unknown>> } {
  const definitions: Array<Record<string, unknown>> = [];
  return {
    definitions,
    register(definition: unknown) {
      definitions.push(definition as Record<string, unknown>);
    },
  };
}

/** 模型输出的结构化 JSON */
const PROFILE_JSON = JSON.stringify({
  summary: '话少但很稳，遇事先想办法',
  traits: ['慢热', '理性', '热心'],
  style: '短句为主，很少用感叹号，偶尔发长段科普',
  catchphrases: ['行吧', '我看看'],
  interests: ['技术', '数码'],
  role: '平时潜水，遇到技术问题会突然出来科普',
  advice: '可以直接说重点；别拿他的沉默开玩笑',
  confidence: 'medium',
});

function makeLlm(text = PROFILE_JSON): {
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
  calls: GenerateOptions[];
} {
  const calls: GenerateOptions[] = [];
  return {
    calls,
    async *stream(options: GenerateOptions) {
      calls.push(options);
      yield { type: 'block-start', index: 0, blockType: 'text' } as unknown as StreamChunk;
      yield { type: 'text-delta', index: 0, text } as unknown as StreamChunk;
      yield { type: 'block-end', index: 0, block: { type: 'text', text } } as unknown as StreamChunk;
      yield { type: 'finish', reason: { kind: 'stop' } } as unknown as StreamChunk;
    },
  };
}

/** 假 manager：agent-1 → 指定会话，模型路由由调用方指定 */
function makeManager(
  record: { scope: 'group' | 'c2c'; peerId: string } | undefined,
  route?: { provider: string; model: string },
): { lookup: SessionModelLookup; agent: unknown } {
  const agent = { id: 'agent-1' };
  const lookup = {
    findByAgent: (candidate: unknown) => (record !== undefined && candidate === agent ? record : undefined),
    getEffectiveModel: () => route,
  } as unknown as SessionModelLookup;
  return { lookup, agent };
}

/** 构造只含给定消息的档案 */
function archiveWith(
  entries: ArchivedMessage[],
  scope: 'group' | 'c2c',
  peerId: string,
  name = 'archive.json',
): PersonaArchive {
  const archive = new PersonaArchive({ path: join(dir, name), writeDelayMs: 0 });
  for (const entry of entries) archive.append(personaArchiveKey('app', scope, peerId), entry);
  return archive;
}

/** 从档案里取出成员汇总（selectAnalysisTargets 的新输入） */
function membersOf(archive: PersonaArchive) {
  return archive.membersAll();
}

describe('selectAnalysisTargets', () => {
  it('未指定成员时取消息量最高的一位', () => {
    const archive = archiveWith(sampleEntries(), 'group', 'g1');
    const selection = selectAnalysisTargets(membersOf(archive));
    expect(selection.targets.map((target) => target.senderId)).toEqual(['u-ming']);
    expect(selection.targets[0]?.messageCount).toBe(3);
    expect(selection.ambiguous).toEqual([]);
  });

  it('精确匹配 openid 或昵称', () => {
    const archive = archiveWith(sampleEntries(), 'group', 'g1');
    expect(selectAnalysisTargets(membersOf(archive), 'u-zhang').targets.map((target) => target.senderName))
      .toEqual(['小张']);
    expect(selectAnalysisTargets(membersOf(archive), '小明').targets.map((target) => target.senderId))
      .toEqual(['u-ming']);
  });

  it('支持 openid 前缀匹配', () => {
    const archive = archiveWith(sampleEntries(), 'group', 'g1');
    expect(selectAnalysisTargets(membersOf(archive), 'u-pas').targets.map((target) => target.senderId))
      .toEqual(['u-pass']);
  });

  it('昵称包含匹配到多人时返回歧义候选', () => {
    const archive = archiveWith(sampleEntries(), 'group', 'g1');
    const selection = selectAnalysisTargets(membersOf(archive), '小');
    expect(selection.targets).toEqual([]);
    expect(selection.ambiguous.map((target) => target.senderId)).toEqual(['u-ming', 'u-zhang']);
  });

  it('未命中时 targets 与 ambiguous 都为空', () => {
    const archive = archiveWith(sampleEntries(), 'group', 'g1');
    expect(selectAnalysisTargets(membersOf(archive), '不存在')).toEqual({ targets: [], ambiguous: [] });
  });
});

describe('describeTargets', () => {
  it('展示昵称、openid 缩写与条数', () => {
    const archive = archiveWith(sampleEntries(), 'group', 'g1');
    expect(describeTargets(selectAnalysisTargets(membersOf(archive)).targets))
      .toBe('小明（u-ming，3 条）');
  });

  it('没有昵称时用 openid 缩写', () => {
    const archive = archiveWith([message('abcdefghijk', 'a')], 'group', 'g1');
    expect(describeTargets(selectAnalysisTargets(membersOf(archive)).targets))
      .toBe('abcdefgh（abcdefgh，1 条）');
  });
});

describe('registerPersonaAnalysisTool', () => {
  const signal = new AbortController().signal;

  /** 注册后取出 execute */
  function makeTool(options: {
    config?: ImQQBotConfig;
    archive?: PersonaArchive;
    profiles?: PersonaProfileStore;
    record?: { scope: 'group' | 'c2c'; peerId: string };
    route?: { provider: string; model: string };
    text?: string;
  } = {}) {
    const tools = makeTools();
    const llm = makeLlm(options.text);
    const { lookup, agent } = makeManager(options.record, options.route);
    registerPersonaAnalysisTool(
      makeCtx({ tools, llm }) as never,
      {
        manager: lookup,
        config: options.config ?? makeConfig(),
        archive: options.archive ?? archiveWith(sampleEntries(), 'group', 'g1'),
        ...(options.profiles !== undefined ? { profiles: options.profiles } : {}),
        logger: makeLogger(),
      },
    );
    const definition = tools.definitions.find((item) => item.name === PERSONA_ANALYSIS_TOOL_NAME) as {
      execute(args: unknown, exec: unknown): Promise<Record<string, unknown>>;
    };
    return { tools, execute: definition.execute, llm, agent };
  }

  it('注册一个工具，声明可选参数 member / focus', () => {
    const { tools } = makeTool();
    expect(tools.definitions).toHaveLength(1);
    const definition = tools.definitions[0]!;
    expect(definition.name).toBe(PERSONA_ANALYSIS_TOOL_NAME);
    expect((definition.parameters as { required?: string[] }).required).toBeUndefined();
    expect(Object.keys((definition.parameters as { properties: object }).properties))
      .toEqual(['member', 'focus']);
  });

  it('输出 schema 声明跨会话统计字段', () => {
    const { tools } = makeTool();
    const output = tools.definitions[0]!.output as {
      schema: { required: string[]; properties: Record<string, unknown> };
    };
    expect(output.schema.required).toEqual([
      'text', 'provider', 'model', 'senderId', 'senderName', 'messageCount', 'chatCount',
    ]);
    expect(Object.keys(output.schema.properties)).toContain('senderId');
  });

  it('tools/llm 服务缺失时告警且不注册', () => {
    const logger = makeLogger();
    registerPersonaAnalysisTool(makeCtx({ llm: makeLlm() }) as never, {
      manager: makeManager(undefined).lookup,
      config: makeConfig(),
      archive: archiveWith([], 'group', 'g1', 'empty.json'),
      logger,
    });
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('未注册'));
  });

  it('档案关闭时报未启用', async () => {
    const { execute, agent } = makeTool({
      config: makeConfig({
        personaAnalysis: {
          enabled: false, maxMessages: 300, retentionDays: 30, autoAnalyze: true, autoAnalyzeThreshold: 20,
        },
      }),
    });
    await expect(execute({}, { signal, agent })).rejects.toThrow(/群友人格档案未启用/);
  });

  it('找不到会话时报只支持 QQ 会话', async () => {
    const { execute } = makeTool();
    await expect(execute({}, { signal })).rejects.toThrow(/只能在 QQ 会话里分析/);
  });

  it('档案为空时提示先聊一段时间', async () => {
    const { execute, agent } = makeTool({
      archive: archiveWith([], 'group', 'g1', 'empty.json'),
      record: { scope: 'group', peerId: 'g1' },
    });
    await expect(execute({}, { signal, agent })).rejects.toThrow(/还没有归档的聊天记录/);
  });

  it('指定成员匹配到多人时列出候选', async () => {
    const { execute, agent } = makeTool({ record: { scope: 'group', peerId: 'g1' } });
    await expect(execute({ member: '小' }, { signal, agent }))
      .rejects.toThrow(/匹配到多位群友[\s\S]*小明[\s\S]*小张/);
  });

  it('指定成员不存在时提示可用的群友', async () => {
    const { execute, agent } = makeTool({ record: { scope: 'group', peerId: 'g1' } });
    await expect(execute({ member: '不存在' }, { signal, agent }))
      .rejects.toThrow(/档案里有记录的群友[\s\S]*小明/);
  });

  it('群聊成功：解析 JSON、返回统计并写入人格库', async () => {
    const route = { provider: 'trae', model: 'session-model' };
    const profiles = new PersonaProfileStore({ path: join(dir, 'profiles.json'), writeDelayMs: 0 });
    const { execute, llm, agent } = makeTool({ record: { scope: 'group', peerId: 'g1' }, route, profiles });
    const result = await execute({ member: '小明', focus: '关注他的语气' }, { signal, agent });

    expect(result).toMatchObject({
      provider: 'trae',
      model: 'session-model',
      senderId: 'u-ming',
      senderName: '小明',
      messageCount: 3,
      chatCount: 1,
    });
    expect(typeof result.text).toBe('string');
    expect(String(result.text)).toContain('话少但很稳');
    expect(String(result.text)).toContain('慢热');

    const call = llm.calls[0];
    expect(call.system).toBe(PROFILE_ANALYSIS_SYSTEM_PROMPT);
    expect(call.maxTokens).toBe(PROFILE_ANALYSIS_MAX_TOKENS);
    const prompt = (call.messages[0] as { content: Array<{ type: string; text?: string }> }).content
      .map((block) => block.text ?? '')
      .join('');
    expect(prompt).toContain('【额外关注点】关注他的语气');
    expect(prompt).toContain('【会话分布】');

    const stored = profiles.get('u-ming');
    expect(stored?.analysis?.traits).toEqual(['慢热', '理性', '热心']);
    expect(stored?.analyzedMessageCount).toBe(3);
    expect(stored?.analyzedChatCount).toBe(1);
  });

  it('跨群聚合同一 openid 的发言', async () => {
    const now = Date.now();
    const archive = new PersonaArchive({ path: join(dir, 'multi.json'), writeDelayMs: 0 });
    archive.append(personaArchiveKey('app', 'group', 'g1'), message('u1', '群一说的话', now, '小明'));
    archive.append(personaArchiveKey('app', 'group', 'g2'), message('u1', '群二说的话', now + 1000, '小明'));
    archive.append(personaArchiveKey('app', 'c2c', 'u1'), message('u1', '私聊说的话', now + 2000, '小明'));
    archive.append(personaArchiveKey('app', 'group', 'g2'), message('u2', '别人', now + 3000, '路人'));

    const { execute, agent } = makeTool({
      archive,
      record: { scope: 'group', peerId: 'g2' },
      route: { provider: 'trae', model: 'm' },
    });
    const result = await execute({ member: 'u1' }, { signal, agent });
    expect(result.messageCount).toBe(3);
    expect(result.chatCount).toBe(3);
  });

  it('未指定成员时分析当前会话里最活跃的一位', async () => {
    const { execute, agent } = makeTool({ record: { scope: 'group', peerId: 'g1' } });
    const result = await execute({}, { signal, agent });
    expect(result.senderId).toBe('u-ming');
    expect(result.messageCount).toBe(3);
  });

  it('私聊只分析对方，不会混入其他人的消息', async () => {
    const archive = new PersonaArchive({ path: join(dir, 'c2c.json'), writeDelayMs: 0 });
    const key = personaArchiveKey('app', 'c2c', 'peer-1');
    const base = Date.now();
    archive.append(key, message('peer-1', '我喜欢猫', base));
    archive.append(key, message('bot', '听起来不错', base + 1000));
    const { execute, agent } = makeTool({ archive, record: { scope: 'c2c', peerId: 'peer-1' } });
    const result = await execute({}, { signal, agent });
    expect(result.senderId).toBe('peer-1');
    expect(result.messageCount).toBe(1);
    expect(result.chatCount).toBe(1);
  });

  it('模型输出不是 JSON 时报错且不写库', async () => {
    const profiles = new PersonaProfileStore({ path: join(dir, 'bad.json'), writeDelayMs: 0 });
    const { execute, agent } = makeTool({
      record: { scope: 'group', peerId: 'g1' },
      route: { provider: 'trae', model: 'm' },
      profiles,
      text: '这不是 JSON',
    });
    await expect(execute({}, { signal, agent })).rejects.toThrow(/有效 JSON/);
    expect(profiles.get('u-ming')).toBeUndefined();
  });

  it('无法确定模型时报错', async () => {
    const { execute, agent } = makeTool({
      config: makeConfig({ provider: '', model: '' }),
      record: { scope: 'group', peerId: 'g1' },
    });
    await expect(execute({}, { signal, agent })).rejects.toThrow(/无法确定使用的模型/);
  });
});
