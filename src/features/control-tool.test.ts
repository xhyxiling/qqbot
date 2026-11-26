/**
 * qqbot_control 工具单测
 *
 * 重点：主人/管理员能用自然语言触发管理操作；其他人一律 not_applicable
 * （交给模型按普通聊天处理）；new/compact 只打标记，等轮末再执行。
 */
import { describe, expect, it, vi } from 'vitest';
import type { Context } from '@deepseek-ai/cordis';
import type { ImQQBotConfig } from '../config.ts';
import type { SessionRecord } from '../session/types.ts';
import {
  CONTROL_TOOL_NAME,
  registerControlTool,
  stripCommandTags,
  type ControlResult,
} from './control-tool.ts';

function makeConfig(): ImQQBotConfig {
  return {
    appId: 'app',
    textChunkLimit: 1000,
    defaultPersona: 'cat',
    personas: [
      { id: 'cat', name: '猫娘' },
      { id: 'cool', name: '高冷' },
    ],
    identity: { enabled: true, ownerOpenIds: ['owner1'], adminOpenIds: [], friendOpenIds: ['friend1'] },
    memory: { enabled: true, autoCapture: true, maxNotes: 20 },
  } as unknown as ImQQBotConfig;
}

function makeRecord(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    sessionKey: 'qqbot:app:c2c:owner1',
    sessionId: 's1',
    scope: 'c2c',
    peerId: 'owner1',
    senderId: 'owner1',
    agent: {},
    handle: {},
    replyTarget: { scope: 'c2c', targetId: 'owner1', msgId: 'm1' },
    lastActivity: 0,
    ...overrides,
  } as unknown as SessionRecord;
}

function setup(record: SessionRecord) {
  const config = makeConfig();
  const personas = config.personas ?? [];
  const manager = {
    findByAgent: vi.fn(() => record),
    listPersonas: vi.fn(() => personas),
    findPersonaById: vi.fn((id: string) => personas.find((p) => p.id === id)),
    getEffectivePersonaId: vi.fn(() => 'cat'),
    getEffectivePersona: vi.fn(() => personas[0]),
    hasGlobalPersonaOverride: vi.fn(() => false),
    setGlobalPersona: vi.fn(() => true),
    clearGlobalPersona: vi.fn(() => true),
    disableGlobalPersona: vi.fn(),
    addPersonNote: vi.fn((_senderId: string, text: string) => ({ text, at: 0, source: 'manual' })),
    getPersonMemory: vi.fn(() => undefined),
    getChatMemory: vi.fn(() => undefined),
    removePersonNote: vi.fn(() => true),
    clearPersonNotes: vi.fn(() => 1),
  };
  let definition: { execute: (args: unknown, exec: { agent?: unknown }) => Promise<ControlResult> } | undefined;
  const tools = { register: (def: unknown) => { definition = def as typeof definition; } };
  const ctx = { get: (name: string) => (name === 'tools' ? tools : undefined) } as unknown as Context;

  registerControlTool(ctx, { manager: manager as never, config, logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() } as never });
  if (definition === undefined) throw new Error('tool not registered');
  return { definition, manager };
}

describe('stripCommandTags', () => {
  it('把 qqbot-cmd-input 标签还原成可读文本', () => {
    expect(stripCommandTags('标题\n<qqbot-cmd-input text="/persona cat" show="/persona 猫娘"/>'))
      .toBe('标题\n「/persona 猫娘」');
  });
});

describe('qqbot_control', () => {
  it('主人切换人格：调用全局切换并返回结果', async () => {
    const { definition, manager } = setup(makeRecord());
    const result = await definition.execute({ action: 'persona', args: 'cool' }, { agent: {} });
    expect(result.ok).toBe(true);
    expect(manager.setGlobalPersona).toHaveBeenCalledWith('cool');
    expect(result.text).toContain('人格已全局切换');
    expect(CONTROL_TOOL_NAME).toBe('qqbot_control');
  });

  it('非主人调用：ok=false，且不触发任何设置变更', async () => {
    const { definition, manager } = setup(makeRecord({ senderId: 'friend1' }));
    const result = await definition.execute({ action: 'persona', args: 'cool' }, { agent: {} });
    expect(result).toEqual({ ok: false, text: '' });
    expect(manager.setGlobalPersona).not.toHaveBeenCalled();
  });

  it('new：只打轮末标记，不立即重建会话', async () => {
    const record = makeRecord();
    const { definition } = setup(record);
    const result = await definition.execute({ action: 'new' }, { agent: {} });
    expect(result.ok).toBe(true);
    expect(record.pendingControl?.action).toBe('new');
  });

  it('memory add：写进人物画像并回显', async () => {
    const { definition, manager } = setup(makeRecord());
    const result = await definition.execute({ action: 'memory', args: 'add 我喜欢喝美式' }, { agent: {} });
    expect(manager.addPersonNote).toHaveBeenCalledWith('owner1', '我喜欢喝美式');
    expect(result.text).toContain('已记住');
  });
});
