/**
 * 斜杠命令注册中心
 *
 * 每个命令拆分为独立文件，此处仅编排。工厂函数注入依赖，统一导出命令列表。
 *
 * 命令按 category 分两类：
 *   - agent：底层 dsh agent 通用能力（new/compact/model/stop）
 *   - qqbot：插件自身特有（ping/version/status/persona/whoami/help）
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
import { newCommand, compactCommand } from './session.ts';
import { modelCommand } from './model.ts';
import { presetCommand } from './preset.ts';
import { personaCommand } from './persona.ts';
import { memoryCommand } from './memory.ts';
import { toolsCommand } from './tools.ts';
import { whoamiCommand } from './whoami.ts';
import { statusCommand } from './status.ts';
import { helpCommand } from './help.ts';
import { pingCommand, versionCommand, stopCommand } from './misc.ts';
import {
  buildRoleDeniedMessage,
  canUseCommand,
  hasIdentityConfig,
  resolveSenderRole,
} from '../identity/role.ts';
import type { ImQQBotConfig } from '../config.ts';

/**
 * 把 minRole 包装成 SDK 的 authorized 钩子。
 *
 * 身份名单未配置时 canUseCommand 恒为 true（无法区分身份，保持旧行为）。
 */
function withAuthorization(
  cmd: CategorizedCommand,
  config: ImQQBotConfig,
): CategorizedCommand {
  const minRole = cmd.minRole;
  if (!minRole) return cmd;
  return {
    ...cmd,
    authorized: (ctx) => {
      if (!hasIdentityConfig(config.identity)) return true;
      if (canUseCommand(ctx.message.senderId, config.identity, minRole)) return true;
      return buildRoleDeniedMessage(
        minRole,
        resolveSenderRole(ctx.message.senderId, config.identity),
      );
    },
  };
}

/**
 * 构建标准命令列表
 */
export function buildCommandList(deps: CommandDeps): CategorizedCommand[] {
  const commands: CategorizedCommand[] = [
    // 通用能力（底层 agent）
    newCommand(deps),
    compactCommand(deps),
    modelCommand(deps),
    presetCommand(deps),
    stopCommand(deps),
    // QQBot 特有
    pingCommand(),
    versionCommand(deps),
    statusCommand(deps),
    personaCommand(deps),
    memoryCommand(deps),
    toolsCommand(deps),
    whoamiCommand(deps),
  ];

  // help 需要访问完整列表（含自身），通过闭包惰性引用
  commands.push(helpCommand(deps, () => commands));

  return commands.map((cmd) => withAuthorization(cmd, deps.config));
}
