import { resolveSessionRoute, } from "./model-route.js";
import { personaArchiveKey, } from "./persona-archive.js";
import { analyzeSenderProfile, loadSenderChats, } from "./persona-analyzer.js";
import { formatProfileMarkdown, displayName as formatDisplayName, shortId, } from "./persona-profile-analysis.js";
/** 工具名（qqbot 前缀避免与其他通道冲突） */
export const PERSONA_ANALYSIS_TOOL_NAME = 'qqbot_analyze_persona';
/** 空串/纯空白视为未提供 */
function textOrUndefined(value) {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
/** 档案成员 → 分析对象（命令与工具共用） */
export function memberToTarget(member) {
    return {
        senderId: member.senderId,
        ...(member.senderName !== undefined ? { senderName: member.senderName } : {}),
        messageCount: member.count,
        chats: member.chats.map((chat) => ({ ...chat })),
    };
}
/**
 * 选择手动分析对象。
 *
 * - 未指定 member：取当前会话消息量最高的群友（没有则返回空）；
 * - 指定 member：先精确匹配 openid / 昵称，再匹配 openid 前缀，最后按昵称包含；
 *   任意一步匹配到多人时返回 ambiguous，让调用方提示用户补 openid。
 *
 * 传入的是**跨会话汇总**的成员列表，所以能命中只出现在其他群的同一个 openid。
 */
export function selectAnalysisTargets(members, member) {
    const all = members.map(memberToTarget);
    const needle = member?.trim().toLowerCase() ?? '';
    if (needle === '') {
        const first = all.find((target) => target.messageCount > 0);
        return { targets: first === undefined ? [] : [first], ambiguous: [] };
    }
    const exact = all.filter((target) => target.senderId.toLowerCase() === needle
        || (target.senderName ?? '').toLowerCase() === needle);
    if (exact.length === 1)
        return { targets: exact, ambiguous: [] };
    if (exact.length > 1)
        return { targets: [], ambiguous: exact };
    const byIdPrefix = all.filter((target) => target.senderId.toLowerCase().startsWith(needle));
    if (byIdPrefix.length === 1)
        return { targets: byIdPrefix, ambiguous: [] };
    if (byIdPrefix.length > 1)
        return { targets: [], ambiguous: byIdPrefix };
    const byName = all.filter((target) => (target.senderName ?? '').toLowerCase().includes(needle));
    if (byName.length === 1)
        return { targets: byName, ambiguous: [] };
    if (byName.length > 1)
        return { targets: [], ambiguous: byName };
    return { targets: [], ambiguous: [] };
}
/** 候选对象的一行说明（歧义/未命中时给用户看） */
export function describeTargets(targets) {
    return targets
        .slice(0, 10)
        .map((target) => `${formatDisplayName(target)}（${shortId(target.senderId)}，${target.messageCount} 条）`)
        .join('、');
}
/** 注册 qqbot_analyze_persona（服务缺失时优雅降级，不阻断插件启动） */
export function registerPersonaAnalysisTool(ctx, options) {
    const { manager, config, archive, profiles, logger } = options;
    const tools = ctx.get('tools');
    const llm = ctx.get('llm');
    if (!tools?.register || !llm?.stream) {
        logger.warn(`im-qqbot: tools/llm 服务不可用，${PERSONA_ANALYSIS_TOOL_NAME} 工具未注册`);
        return;
    }
    const definition = {
        name: PERSONA_ANALYSIS_TOOL_NAME,
        description: 'Analyze one group member\'s personality and speaking style from locally archived chat messages, '
            + 'merging everything the same openid said across groups and private chats. '
            + 'Use when the user asks 分析群友人格 / 分析某人性格 / 这个人说话是什么风格 / 根据群聊总结一个人. '
            + 'Pass `member` with a nickname or member openid; omit it to profile the most active member in this chat. '
            + 'Results are stored in the local persona library shown in the settings panel. '
            + 'The archive only contains messages received while the bot was running (after the feature was enabled), '
            + 'so stay evidence-based and mention when the sample is small.',
        parameters: {
            type: 'object',
            properties: {
                member: {
                    type: 'string',
                    description: 'Nickname or member openid to analyze. Omit to analyze the most active member in this chat.',
                },
                focus: {
                    type: 'string',
                    description: 'Optional aspect the user cares about, e.g. "只分析他怼人的时候" or "关注他聊技术的样子".',
                },
            },
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    text: { type: 'string' },
                    provider: { type: 'string' },
                    model: { type: 'string' },
                    senderId: { type: 'string' },
                    senderName: { type: 'string' },
                    messageCount: { type: 'number' },
                    chatCount: { type: 'number' },
                },
                required: ['text', 'provider', 'model', 'senderId', 'senderName', 'messageCount', 'chatCount'],
                additionalProperties: false,
            },
            render: (_args, value) => [
                { type: 'text', text: value.text },
            ],
        },
        async execute(args, exec) {
            const fields = (args ?? {});
            const member = textOrUndefined(fields.member);
            const focus = textOrUndefined(fields.focus);
            if (config.personaAnalysis?.enabled === false || archive === undefined) {
                throw new Error(`${PERSONA_ANALYSIS_TOOL_NAME}: 群友人格档案未启用。`
                    + '请在设置面板「群友人格」页签打开「群聊人格档案」并保存后重试。');
            }
            const record = exec.agent === undefined ? undefined : manager.findByAgent(exec.agent);
            if (record === undefined) {
                throw new Error(`${PERSONA_ANALYSIS_TOOL_NAME}: 只能在 QQ 会话里分析（找不到当前会话）`);
            }
            const members = archive.membersAll();
            if (members.length === 0) {
                throw new Error(`${PERSONA_ANALYSIS_TOOL_NAME}: 还没有归档的聊天记录。`
                    + '档案只从启用功能后开始积累，先在群里聊一段时间再试。');
            }
            let target;
            if (record.scope === 'c2c') {
                // 私聊只有对面一个人：直接分析 TA 的发言（可能存在多个私聊会话，按 openid 聚合）
                const existing = members.find((item) => item.senderId === record.peerId);
                const own = existing === undefined ? members[0] : existing;
                target = memberToTarget(own);
            }
            else {
                const currentChatKey = personaArchiveKey(config.appId, record.scope, record.peerId);
                const scoped = members.filter((item) => item.chats.some((chat) => chat.chatKey === currentChatKey));
                if (member === undefined) {
                    const selection = selectAnalysisTargets(scoped);
                    if (selection.targets.length === 0) {
                        throw new Error(`${PERSONA_ANALYSIS_TOOL_NAME}: 当前会话还没有归档的聊天记录，先在群里聊一段时间再试。`);
                    }
                    target = selection.targets[0];
                }
                else {
                    const selection = selectAnalysisTargets(members, member);
                    if (selection.ambiguous.length > 0) {
                        throw new Error(`${PERSONA_ANALYSIS_TOOL_NAME}: 「${member}」匹配到多位群友：`
                            + `${describeTargets(selection.ambiguous)}。请用完整昵称或 openid 重新指定。`);
                    }
                    if (selection.targets.length === 0) {
                        throw new Error(`${PERSONA_ANALYSIS_TOOL_NAME}: 没有找到「${member}」的发言。`
                            + `档案里有记录的群友：${describeTargets(members.map(memberToTarget))}`);
                    }
                    target = selection.targets[0];
                }
            }
            const route = resolveSessionRoute(manager, config, exec.agent);
            if (route === undefined) {
                throw new Error(`${PERSONA_ANALYSIS_TOOL_NAME}: 无法确定使用的模型，请在配置中设置 provider/model`);
            }
            const chats = loadSenderChats(archive, target.senderId);
            if (chats.length === 0) {
                throw new Error(`${PERSONA_ANALYSIS_TOOL_NAME}: 没有找到可以分析的消息（档案可能已被清理）`);
            }
            const result = await analyzeSenderProfile({
                llm,
                route,
                senderId: target.senderId,
                ...(target.senderName !== undefined ? { senderName: target.senderName } : {}),
                chats,
                ...(focus !== undefined ? { focus } : {}),
                signal: exec.signal,
            });
            const analyzedAt = Date.now();
            const senderName = target.senderName ?? formatDisplayName(target);
            profiles?.upsert({
                senderId: target.senderId,
                ...(target.senderName !== undefined ? { senderName: target.senderName } : {}),
                analysis: result.analysis,
                analyzedMessageCount: result.messageCount,
                analyzedChatCount: result.chatCount,
                analyzedAt,
                provider: result.provider,
                model: result.model,
                lastAttemptAt: analyzedAt,
            });
            logger.info(`im-qqbot: ${PERSONA_ANALYSIS_TOOL_NAME} 完成 (provider=${result.provider} model=${result.model} `
                + `sender=${shortId(target.senderId)} messages=${result.messageCount} chats=${result.chatCount})`);
            const chatStats = target.chats;
            const firstAt = chatStats.length > 0 ? Math.min(...chatStats.map((chat) => chat.firstAt)) : undefined;
            const lastAt = chatStats.length > 0 ? Math.max(...chatStats.map((chat) => chat.lastAt)) : undefined;
            const text = [
                `# ${senderName} 的人格档案`,
                '',
                formatProfileMarkdown(result.analysis, {
                    messageCount: result.messageCount,
                    chatCount: result.chatCount,
                    ...(firstAt !== undefined ? { firstAt } : {}),
                    ...(lastAt !== undefined ? { lastAt } : {}),
                }),
                '',
                '---',
                '结果已写入本地人格档案，可在设置面板「群友人格」页签查看与筛选。',
            ].join('\n');
            return {
                text,
                provider: result.provider,
                model: result.model,
                senderId: target.senderId,
                senderName,
                messageCount: result.messageCount,
                chatCount: result.chatCount,
            };
        },
    };
    tools.register(definition);
    logger.info(`im-qqbot: ${PERSONA_ANALYSIS_TOOL_NAME} 工具已注册（数据源：本地群聊档案）`);
}
//# sourceMappingURL=persona-analysis-tool.js.map