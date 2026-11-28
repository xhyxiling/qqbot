import { newCommand, compactCommand } from "./session.js";
import { modelCommand } from "./model.js";
import { presetCommand } from "./preset.js";
import { personaCommand } from "./persona.js";
import { memoryCommand } from "./memory.js";
import { toolsCommand } from "./tools.js";
import { whoamiCommand } from "./whoami.js";
import { statusCommand } from "./status.js";
import { helpCommand } from "./help.js";
import { pingCommand, versionCommand, stopCommand } from "./misc.js";
import { buildRoleDeniedMessage, canUseCommand, hasIdentityConfig, resolveSenderRole, } from "../identity/role.js";
/**
 * 把 minRole 包装成 SDK 的 authorized 钩子。
 *
 * 身份名单未配置时 canUseCommand 恒为 true（无法区分身份，保持旧行为）。
 */
function withAuthorization(cmd, config) {
    const minRole = cmd.minRole;
    if (!minRole)
        return cmd;
    return {
        ...cmd,
        authorized: (ctx) => {
            if (!hasIdentityConfig(config.identity))
                return true;
            if (canUseCommand(ctx.message.senderId, config.identity, minRole))
                return true;
            return buildRoleDeniedMessage(minRole, resolveSenderRole(ctx.message.senderId, config.identity));
        },
    };
}
/**
 * 构建标准命令列表
 */
export function buildCommandList(deps) {
    const commands = [
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
//# sourceMappingURL=index.js.map