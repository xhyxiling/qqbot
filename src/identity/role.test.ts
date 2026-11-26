import { describe, it, expect } from 'vitest';
import {
  buildIdentityPrefix,
  buildIdentityPromptSection,
  buildRoleDeniedMessage,
  canUseCommand,
  hasIdentityConfig,
  isOwnerOrAdmin,
  resolveSenderRole,
  ROLE_LABELS,
} from './role.ts';
import type { IdentityConfig } from '../config.ts';

const OWNER = '8E4BF9DF3A321BC03F55845EE32C623D';

function config(overrides: Partial<IdentityConfig> = {}): IdentityConfig {
  return {
    enabled: true,
    ownerOpenIds: [],
    adminOpenIds: [],
    friendOpenIds: [],
    ...overrides,
  };
}

describe('hasIdentityConfig', () => {
  it('名单为空 / 关闭开关 / 缺省时视为未配置', () => {
    expect(hasIdentityConfig(undefined)).toBe(false);
    expect(hasIdentityConfig(config())).toBe(false);
    expect(hasIdentityConfig(config({ enabled: false, ownerOpenIds: [OWNER] }))).toBe(false);
  });

  it('任一名单有条目即视为已配置', () => {
    expect(hasIdentityConfig(config({ ownerOpenIds: [OWNER] }))).toBe(true);
    expect(hasIdentityConfig(config({ friendOpenIds: ['X'] }))).toBe(true);
  });
});

describe('resolveSenderRole', () => {
  it('按名单判定，主人优先于管理员/朋友', () => {
    const identity = config({
      ownerOpenIds: [OWNER],
      adminOpenIds: ['ADMIN1'],
      friendOpenIds: ['FRIEND1'],
    });
    expect(resolveSenderRole(OWNER, identity)).toBe('owner');
    expect(resolveSenderRole('ADMIN1', identity)).toBe('admin');
    expect(resolveSenderRole('FRIEND1', identity)).toBe('friend');
    expect(resolveSenderRole('SOMEONE', identity)).toBe('stranger');
  });

  it('同一 openid 同时出现在多份名单时按最高权限', () => {
    const identity = config({
      ownerOpenIds: [OWNER],
      adminOpenIds: [OWNER],
    });
    expect(resolveSenderRole(OWNER, identity)).toBe('owner');
  });

  it('忽略空白与大小写', () => {
    const identity = config({ ownerOpenIds: [` ${OWNER.toLowerCase()} `] });
    expect(resolveSenderRole(OWNER, identity)).toBe('owner');
  });

  it('关闭识别 / 空 senderId / 缺省配置均为陌生人', () => {
    expect(resolveSenderRole(OWNER, config({ enabled: false, ownerOpenIds: [OWNER] }))).toBe('stranger');
    expect(resolveSenderRole(undefined, config({ ownerOpenIds: [OWNER] }))).toBe('stranger');
    expect(resolveSenderRole('  ', config({ ownerOpenIds: [OWNER] }))).toBe('stranger');
    expect(resolveSenderRole(OWNER, undefined)).toBe('stranger');
  });
});

describe('isOwnerOrAdmin', () => {
  it('未配置 / 关闭识别时放行', () => {
    expect(isOwnerOrAdmin(OWNER, undefined)).toBe(true);
    expect(isOwnerOrAdmin(OWNER, config())).toBe(true);
    expect(isOwnerOrAdmin('SOMEONE', config({ enabled: false, ownerOpenIds: [OWNER] }))).toBe(true);
  });

  it('只放行主人和管理员', () => {
    const identity = config({
      ownerOpenIds: [OWNER],
      adminOpenIds: ['ADMIN1'],
      friendOpenIds: ['FRIEND1'],
    });
    expect(isOwnerOrAdmin(OWNER, identity)).toBe(true);
    expect(isOwnerOrAdmin('ADMIN1', identity)).toBe(true);
    expect(isOwnerOrAdmin('FRIEND1', identity)).toBe(false);
    expect(isOwnerOrAdmin('SOMEONE', identity)).toBe(false);
    expect(isOwnerOrAdmin(undefined, identity)).toBe(false);
  });

  it('与身份标签一致：忽略空白与大小写', () => {
    const identity = config({ ownerOpenIds: [` ${OWNER.toLowerCase()} `] });
    expect(isOwnerOrAdmin(OWNER, identity)).toBe(true);
  });
});

describe('buildIdentityPrefix', () => {
  it('命中主人时注入标签（含尾随空格）', () => {
    const identity = config({ ownerOpenIds: [OWNER] });
    expect(buildIdentityPrefix(OWNER, identity)).toBe('[身份: 主人] ');
  });

  it('陌生人同样带标签（已配置名单时）', () => {
    const identity = config({ ownerOpenIds: [OWNER] });
    expect(buildIdentityPrefix('SOMEONE', identity)).toBe(`[身份: ${ROLE_LABELS.stranger}] `);
  });

  it('未配置名单 / 关闭识别时不改变消息格式', () => {
    expect(buildIdentityPrefix(OWNER, undefined)).toBe('');
    expect(buildIdentityPrefix(OWNER, config())).toBe('');
    expect(buildIdentityPrefix(OWNER, config({ enabled: false, ownerOpenIds: [OWNER] }))).toBe('');
  });
});

describe('canUseCommand', () => {
  it('未配置身份名单 / 关闭识别时一律放行（保持旧行为）', () => {
    expect(canUseCommand(OWNER, config(), 'admin')).toBe(true);
    expect(canUseCommand(OWNER, undefined, 'admin')).toBe(true);
    expect(canUseCommand(OWNER, config({ enabled: false, ownerOpenIds: [OWNER] }), 'admin')).toBe(true);
  });

  it('配置名单后 admin 指令只放行主人/管理员', () => {
    const identity = config({
      ownerOpenIds: [OWNER],
      adminOpenIds: ['ADMIN1'],
      friendOpenIds: ['FRIEND1'],
    });
    expect(canUseCommand(OWNER, identity, 'admin')).toBe(true);
    expect(canUseCommand('ADMIN1', identity, 'admin')).toBe(true);
    expect(canUseCommand('FRIEND1', identity, 'admin')).toBe(false);
    expect(canUseCommand('SOMEONE', identity, 'admin')).toBe(false);
  });

  it('命令未声明 minRole 时所有人可用', () => {
    const identity = config({ ownerOpenIds: [OWNER] });
    expect(canUseCommand('SOMEONE', identity, undefined)).toBe(true);
  });
});

describe('buildRoleDeniedMessage', () => {
  it('提示最低身份与当前身份', () => {
    expect(buildRoleDeniedMessage('admin', 'stranger')).toBe(
      `⚠️ 该指令仅限「${ROLE_LABELS.admin}」使用（你当前身份：${ROLE_LABELS.stranger}）`,
    );
  });
});

describe('buildIdentityPromptSection', () => {
  it('已配置名单时生成 order=82 的说明 section', () => {
    const section = buildIdentityPromptSection(config({ ownerOpenIds: [OWNER] }));
    expect(section?.name).toBe('qqbot:identity');
    expect(section?.order).toBe(82);
    expect(section?.text).toContain('[身份: 主人]');
  });

  it('未配置名单时不注入', () => {
    expect(buildIdentityPromptSection(undefined)).toBeUndefined();
    expect(buildIdentityPromptSection(config())).toBeUndefined();
  });
});
