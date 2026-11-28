/**
 * 命令依赖类型
 *
 * 每个命令工厂函数接收 CommandDeps，由 commands/index.ts 统一注入。
 */
import type { SlashCommand } from '@tencent-connect/qqbot-nodejs';
import type { SessionManager } from '../session/index.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { SenderRole } from '../identity/role.ts';

export interface CommandDeps {
  manager: SessionManager;
  config: ImQQBotConfig;
}

/** 命令分类：agent = 底层 agent 通用能力，qqbot = 插件特有 */
export type CommandCategory = 'agent' | 'qqbot';

/**
 * 带分类的斜杠命令。
 *
 * - category 供 help 分组展示（SDK 忽略未知字段）
 * - minRole 是命令的最低身份要求，由 commands/index.ts 统一包装成 SDK 的
 *   authorized 钩子，help 也按同一规则过滤，保证「看不到」与「不能用」一致
 */
export interface CategorizedCommand extends SlashCommand {
  category: CommandCategory;
  /** 最低身份（缺省 = 所有人可用；'admin' = 主人/管理员） */
  minRole?: SenderRole;
}
