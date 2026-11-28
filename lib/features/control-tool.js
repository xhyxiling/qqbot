import { canUseCommand, isOwnerOrAdmin } from "../identity/role.js";
import { buildCommandList } from "../commands/index.js";
import { sanitizeName } from "../identity/names-store.js";
/** 工具名 */
export const CONTROL_TOOL_NAME = 'qqbot_control';
/** 支持的 action */
export const CONTROL_ACTIONS = [
    'persona',
    'memory',
    'new',
    'compact',
    'model',
    'preset',
    'rename_bot',
    'rename_qq',
    'feedback',
    'evolve',
    'status',
    'tools',
    'whoami',
    'help',
    'ping',
    'version',
];
/** action → 命令名（new/compact 不走命令，轮末执行） */
const ACTION_COMMAND = {
    persona: 'persona',
    memory: 'memory',
    model: 'model',
    preset: 'preset',
    feedback: 'feedback',
    evolve: 'evolve',
    status: 'bot-status',
    tools: 'tools',
    whoami: 'whoami',
    help: 'bot-help',
    ping: 'bot-ping',
    version: 'bot-version',
};
/** 把 <qqbot-cmd-input .../> 标签还原成可读文本，避免模型照抄标签 */
export function stripCommandTags(text) {
    return text
        .replace(/<qqbot-cmd-input[^>]*?show="([^"]*)"[^>]*?\/>/g, '「$1」')
        .replace(/<qqbot-cmd-input[^>]*?\/>/g, '')
        .trim();
}
/** 命令名字段归一化成数组 */
function commandNames(name) {
    return typeof name === 'string' ? [name] : [...name];
}
/**
 * 调用 OneBot set_qq_profile 修改账号昵称。
 *
 * 只有 OneBot/NapCat 通道支持；官方正式机器人没有这个能力。
 */
async function setQqNickname(config, name) {
    const base = config.onebot.httpUrl.replace(/\/+$/, '');
    const headers = { 'content-type': 'application/json' };
    if (config.onebot.accessToken !== '') {
        headers.Authorization = `Bearer ${config.onebot.accessToken}`;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, 8000);
    try {
        const response = await fetch(`${base}/set_qq_profile`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ nickname: name }),
            signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok || (body.status !== undefined && body.status !== 'ok')) {
            return { ok: false, error: body.message ?? `HTTP ${response.status}` };
        }
        return { ok: true };
    }
    catch (err) {
        return { ok: false, error: `连不上 OneBot 接口（${err instanceof Error ? err.message : String(err)}）` };
    }
    finally {
        clearTimeout(timer);
    }
}
const DESCRIPTION = 'Owner/admin control channel for changing this bot\'s own settings through natural language. '
    + 'Call it when the owner or an admin asks you to switch persona ("换成猫娘人格", "用傲娇的语气"), '
    + 'remember/forget something about them ("记住我喜欢喝美式", "把我那条忘了"), start a new session '
    + '("重新开始聊", "清空上下文"), compact history, switch model or preset, rename you or the QQ account, '
    + 'record feedback about your replies ("刚才太吵了", "这次回得不错") via feedback, '
    + 'or turn accumulated feedback into policy proposals ("你自己调整一下", "应用吧") via evolve, '
    + 'or check the bot status. '
    + 'Never ask the user to type slash commands — just call this tool. '
    + '`args` is the command argument: persona id or display name (or "default"/"off"), "add 内容"/"del 3"/"clear" for memory, '
    + '"provider/model" or model id for model, preset id for preset, the new name for rename_bot/rename_qq, '
    + '"good|bad 备注" for feedback, ""/"apply"/"apply 2"/"discard"/"status"/"history"/"rollback" for evolve. '
    + 'rename_bot only changes how you call yourself; rename_qq changes the QQ account profile nickname. '
    + 'The two names are independent. '
    + 'Other users (friends/strangers) cannot use it; do not call it for them.';
/**
 * 注册 qqbot_control 工具（tools 服务不可用时告警跳过，不阻断启动）
 */
export function registerControlTool(ctx, options) {
    const { manager, config, logger } = options;
    let tools;
    try {
        tools = ctx.get('tools');
    }
    catch {
        tools = undefined;
    }
    if (!tools?.register) {
        logger.warn(`im-qqbot: tools 服务不可用，${CONTROL_TOOL_NAME} 未注册`);
        return;
    }
    const definition = {
        name: CONTROL_TOOL_NAME,
        description: DESCRIPTION,
        parameters: {
            type: 'object',
            properties: {
                action: {
                    type: 'string',
                    enum: [...CONTROL_ACTIONS],
                    description: 'What to do. "new" and "compact" run after this reply is delivered.',
                },
                args: {
                    type: 'string',
                    description: 'Argument passed to the action. persona: persona id or display name / "default" / "off"; '
                        + 'memory: "add 内容" | "del 序号" | "clear" | omitted to view; '
                        + 'model: "provider/model" or model id or "default"; preset: preset id or "reset"; '
                        + 'rename_bot / rename_qq: the new name; '
                        + 'feedback: "good|bad 备注"（备注用对方的原话浓缩一句）; '
                        + 'evolve: 省略生成提案，"apply" 全部应用，"apply 2" 只应用第 2 条，'
                        + '"discard" 放弃，"status"/"history"/"rollback" 查看与回滚。',
                },
            },
            required: ['action'],
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    ok: { type: 'boolean' },
                    text: { type: 'string' },
                },
                required: ['ok', 'text'],
                additionalProperties: false,
            },
            render: (_args, value) => {
                const result = value;
                if (!result.ok) {
                    // 主人/管理员能收到具体原因（如通道不支持改昵称）；普通人拿到的 text 为空，按普通聊天接住
                    if (result.text.trim()) {
                        return [{
                                type: 'text',
                                text: `执行结果（用你的语气转述给用户，不要提工具/命令/系统/权限）：\n${stripCommandTags(result.text)}`,
                            }];
                    }
                    return [{
                            type: 'text',
                            text: '（这一步用不了）把这句话当成普通聊天接住：用你的语气自然回应或轻轻岔开，'
                                + '不要提权限、管理员、命令、工具，也不要说「做不到」「没资格」。',
                        }];
                }
                if (!result.text.trim()) {
                    return [{ type: 'text', text: '已完成。用你的语气简短告诉对方结果即可。' }];
                }
                return [{
                        type: 'text',
                        text: `执行结果（用你的语气转述给用户，不要提工具/命令/斜杠/系统/权限）：\n${stripCommandTags(result.text)}`,
                    }];
            },
        },
        async execute(rawArgs, exec) {
            const record = manager.findByAgent(exec.agent);
            if (record === undefined) {
                throw new Error(`${CONTROL_TOOL_NAME}: 只能在 QQ 会话里使用`);
            }
            const args = (rawArgs ?? {});
            const action = typeof args.action === 'string' ? args.action.trim() : '';
            const arg = typeof args.args === 'string' ? args.args.trim() : '';
            // 管理操作只对主人/管理员开放；其他人一律当普通聊天处理
            if (!isOwnerOrAdmin(record.senderId, config.identity)) {
                logger.info(`im-qqbot: ${CONTROL_TOOL_NAME} 被非管理员调用 key=${record.sessionKey} action=${action}`);
                return { ok: false, text: '' };
            }
            if (action === 'new' || action === 'compact') {
                record.pendingControl = { action, at: Date.now() };
                logger.info(`im-qqbot: ${CONTROL_TOOL_NAME} 安排轮末执行 key=${record.sessionKey} action=${action}`);
                return {
                    ok: true,
                    text: action === 'new'
                        ? '已安排在本轮回复后开启新会话（上下文清空，长期记忆保留）。'
                        : '已安排在本轮回复后压缩上下文历史。',
                };
            }
            // 命名：机器人自称与 QQ 账号昵称相互独立，改一个不影响另一个
            if (action === 'rename_bot' || action === 'rename_qq') {
                const name = sanitizeName(arg);
                if (name === '') {
                    return {
                        ok: false,
                        text: action === 'rename_bot' ? '要给机器人起什么名字？' : '要把 QQ 昵称改成什么？',
                    };
                }
                if (action === 'rename_bot') {
                    manager.setBotName(name);
                    logger.info(`im-qqbot: ${CONTROL_TOOL_NAME} 机器人改名为 ${name}`);
                    return { ok: true, text: `我的名字已经改成「${name}」了。` };
                }
                if (config.backend === 'official') {
                    return { ok: false, text: '当前走的是官方机器人通道，改不了 QQ 账号昵称。' };
                }
                const renamed = await setQqNickname(config, name);
                if (!renamed.ok) {
                    logger.warn(`im-qqbot: ${CONTROL_TOOL_NAME} 改 QQ 昵称失败: ${renamed.error}`);
                    return { ok: false, text: `改 QQ 昵称没成功：${renamed.error}` };
                }
                manager.setQqAccountName(name);
                logger.info(`im-qqbot: ${CONTROL_TOOL_NAME} QQ 账号昵称改为 ${name}`);
                return { ok: true, text: `QQ 账号昵称已经改成「${name}」了。` };
            }
            const commandName = ACTION_COMMAND[action];
            if (commandName === undefined) {
                return { ok: false, text: `不支持的操作: ${action || '(空)'}` };
            }
            const commands = buildCommandList({ manager, config });
            const command = commands.find((cmd) => commandNames(cmd.name)
                .includes(commandName));
            if (command === undefined) {
                return { ok: false, text: `该操作当前不可用：${action}` };
            }
            if (!canUseCommand(record.senderId, config.identity, command.minRole)) {
                return { ok: false, text: '' };
            }
            // 收集命令通过 bot.sendMarkdown 发出的内容（命令内部走分块发送）
            const collected = [];
            const fakeBot = {
                sendMarkdown: async (_target, content) => {
                    if (typeof content === 'string' && content.trim() !== '')
                        collected.push(content);
                },
            };
            const fakeCtx = {
                bot: fakeBot,
                replyTarget: record.replyTarget,
                receivedAt: Date.now(),
                message: {
                    kind: record.scope === 'group' ? 'group' : 'c2c',
                    senderId: record.senderId,
                    groupOpenid: record.scope === 'group' ? record.peerId : undefined,
                    messageId: record.replyTarget.msgId,
                    timestamp: new Date().toISOString(),
                },
                command: { name: commandName, args: arg ? arg.split(/\s+/) : [], raw: arg },
            };
            try {
                const returned = await command.handler(fakeCtx);
                const text = collected.join('\n\n')
                    || (typeof returned === 'string' ? returned : '');
                logger.info(`im-qqbot: ${CONTROL_TOOL_NAME} 执行 key=${record.sessionKey} `
                    + `action=${action} args=${arg === '' ? '无' : arg}`);
                return { ok: true, text };
            }
            catch (err) {
                logger.warn(`im-qqbot: ${CONTROL_TOOL_NAME} 执行失败 action=${action}: `
                    + `${err instanceof Error ? err.message : String(err)}`);
                return { ok: false, text: '' };
            }
        },
    };
    tools.register(definition);
    logger.info(`im-qqbot: ${CONTROL_TOOL_NAME} 工具已注册（主人可用自然语言管理设置）`);
}
//# sourceMappingURL=control-tool.js.map