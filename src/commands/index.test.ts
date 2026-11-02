import { describe, it, expect } from 'vitest';
import { buildCommandList } from './index.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { SlashCommandHandlerContext } from '@tencent-connect/qqbot-nodejs';

const OWNER = '8E4BF9DF3A321BC03F55845EE32C623D';

function makeConfig(ownerOpenIds: string[]): ImQQBotConfig {
  return {
    identity: { enabled: true, ownerOpenIds, adminOpenIds: [], friendOpenIds: [] },
  } as unknown as ImQQBotConfig;
}

/** 命令工厂只构造元数据，不会在注册阶段访问 manager */
function build(ownerOpenIds: string[]) {
  const commands = buildCommandList({
    manager: {} as never,
    config: makeConfig(ownerOpenIds),
  });
  const ctx = (senderId: string): SlashCommandHandlerContext =>
    ({ message: { senderId } }) as unknown as SlashCommandHandlerContext;
  return { commands, ctx };
}

function findCommand(commands: ReturnType<typeof build>['commands'], name: string) {
  return commands.find((c) => {
    const names = Array.isArray(c.name) ? c.name : [c.name];
    return names.includes(name);
  });
}

describe('buildCommandList — 权限包装', () => {
  it('管理类命令声明 minRole，公开命令不声明', () => {
    const { commands } = build([OWNER]);
    const admin = ['new', 'compact', 'model', 'preset', 'persona', '人格分析', 'memory', 'tools', 'bot-status', 'stop'];
    for (const name of admin) {
      expect(findCommand(commands, name)?.minRole).toBe('admin');
    }
    const open = ['bot-ping', 'bot-version', 'whoami', 'bot-help'];
    for (const name of open) {
      expect(findCommand(commands, name)?.minRole).toBeUndefined();
    }
  });

  it('主人/管理员通过，朋友/陌生人被拒绝', () => {
    const { commands, ctx } = build([OWNER]);
    const model = findCommand(commands, 'model');
    expect(model?.authorized?.(ctx(OWNER))).toBe(true);
    const denied = model?.authorized?.(ctx('SOMEONE'));
    expect(typeof denied).toBe('string');
    expect(denied).toContain('仅限「管理员」');
  });

  it('身份名单为空时不启用权限控制', () => {
    const { commands, ctx } = build([]);
    expect(findCommand(commands, 'model')?.authorized?.(ctx('SOMEONE'))).toBe(true);
  });

  it('/tools 是诊断命令：不进命令菜单，但管理员仍可手动调用', () => {
    const { commands } = build([OWNER]);
    expect(findCommand(commands, 'tools')?.hidden).toBe(true);
  });
});
