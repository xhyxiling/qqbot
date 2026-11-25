import { getLatestSessionAttachment } from "./index.js";
import { existsSync } from 'node:fs';
import { sendMediaFile } from '../media/send-media.js';
export const PICK_STICKER_TOOL_NAME = 'qqbot_pick_sticker';
export const SAVE_STICKER_TOOL_NAME = 'qqbot_save_sticker';
export const SEND_STICKER_TOOL_NAME = 'qqbot_send_sticker';
export function registerStickerTools(ctx, engine, logger) {
    const tools = ctx.get('tools');
    if (!tools?.register) {
        logger.warn('im-qqbot: tools 服务不可用，qqbot_pick_sticker 工具未注册');
        return;
    }
    // ── qqbot_pick_sticker ──
    tools.register({
        name: PICK_STICKER_TOOL_NAME,
        description: '从 dsh-qqbot 的表情包收藏库里挑选一个最适合当前话题/情绪的表情。'
            + '返回表情的本地文件路径，可以直接传给 qqbot_send_file 发送。'
            + '适合：想让 bot 发个应景的表情包回应群聊 / 私聊话题时使用。',
        parameters: {
            type: 'object',
            properties: {
                topic: {
                    type: 'string',
                    description: '当前聊天话题/关键词，帮助选到应景的表情。可以是对话摘要或关键词。',
                },
                mood: {
                    type: 'string',
                    enum: ['happy', 'sad', 'angry', 'silly', 'serious', 'neutral'],
                    description: '当前聊天氛围/情绪，帮助选到适合的表情。',
                },
            },
            required: [],
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    picked: { type: 'boolean' },
                    filePath: { type: 'string' },
                    filename: { type: 'string' },
                    id: { type: 'string' },
                    reason: { type: 'string' },
                },
                required: ['picked'],
                additionalProperties: false,
            },
            render: (_args, value) => {
                const v = value;
                if (!v.picked) {
                    return [{ type: 'text', text: `没挑到合适的表情: ${v.reason ?? '表情库为空或频率限制'}` }];
                }
                return [{ type: 'text', text: `🎲 挑到了 ${v.filename} → ${v.filePath}` }];
            },
        },
        async execute(args) {
            const a = args;
            const selCtx = {
                topic: a.topic ?? '',
                mood: a.mood,
                trigger: 'matching',
            };
            const sticker = engine.selector.pick(selCtx);
            if (!sticker) {
                const status = engine.evolver.getStatus();
                return { picked: false, reason: `表情库 ${status.total} 个，频率门控未通过` };
            }
            return {
                picked: true,
                filePath: sticker.filePath,
                filename: sticker.filename,
                id: sticker.id,
                reason: `热度 ${sticker.hotScore}, 标签 [${sticker.tags.join(',')}]`,
            };
        },
    });
    logger.info(`im-qqbot: ${PICK_STICKER_TOOL_NAME} 已注册`);
}
/**
 * 注册 qqbot_send_sticker — 一步到位的组合工具
 *
 * 模型只需调用一次：同时挑表情 + 发送到当前会话。
 * 通过 exec.agent 反查当前会话，与 qqbot_send_file 共用发送逻辑。
 */
export function registerSendStickerTool(ctx, engine, mediaSender, manager, logger) {
    const tools = ctx.get('tools');
    if (!tools?.register)
        return;
    tools.register({
        name: SEND_STICKER_TOOL_NAME,
        description: '从表情包收藏库挑选并直接发送一个应景的表情到当前 QQ 会话。'
            + '等于 qqbot_pick_sticker + qqbot_send_file 的组合，一次调用完成。',
        parameters: {
            type: 'object',
            properties: {
                topic: { type: 'string', description: '当前聊天话题/关键词' },
                mood: {
                    type: 'string',
                    enum: ['happy', 'sad', 'angry', 'silly', 'serious', 'neutral'],
                    description: '当前聊天氛围/情绪',
                },
            },
            required: [],
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    sent: { type: 'boolean' },
                    filename: { type: 'string' },
                    fileUuid: { type: 'string' },
                    messageId: { type: 'string' },
                    reason: { type: 'string' },
                },
                required: ['sent'],
                additionalProperties: false,
            },
            render: (_args, value) => {
                const v = value;
                if (!v.sent)
                    return [{ type: 'text', text: `没发出去: ${v.reason ?? '未知原因'}` }];
                return [{ type: 'text', text: `🎨 已发送 ${v.filename}` }];
            },
        },
        async execute(args, exec) {
            const replyTarget = exec.agent === undefined
                ? undefined
                : manager.findByAgent(exec.agent)?.replyTarget;
            if (!replyTarget) {
                return { sent: false, reason: '只能在 QQ 会话里使用这个工具' };
            }
            const a = args;
            const sticker = engine.selector.pick({
                topic: a.topic ?? '',
                mood: a.mood,
                trigger: 'matching',
            });
            if (!sticker) {
                return { sent: false, reason: '没挑到合适的表情' };
            }
            if (!existsSync(sticker.filePath)) {
                return { sent: false, reason: `文件已不存在: ${sticker.filePath}` };
            }
            const result = await sendMediaFile(mediaSender, replyTarget, sticker.filePath);
            if (result.outcome === 'missing') {
                return { sent: false, reason: `文件不存在或不可读: ${sticker.filePath}` };
            }
            if (result.outcome === 'failed') {
                return { sent: false, reason: `发送失败: ${result.error}` };
            }
            logger.info(`im-qqbot: qqbot_send_sticker 发送 ${sticker.filename} (${result.size} bytes) → ${replyTarget.scope}:${replyTarget.targetId}`);
            return {
                sent: true,
                filename: sticker.filename,
                fileUuid: result.fileUuid ?? '',
                ...(result.messageId !== undefined ? { messageId: result.messageId } : {}),
            };
        },
    });
    logger.info(`im-qqbot: ${SEND_STICKER_TOOL_NAME} 已注册`);
}
// ── qqbot_save_sticker — 手动收藏 ──
/** 主人/admin 才能用这个工具（stranger/friend 调会被拒绝） */
export function registerSaveStickerTool(ctx, engine, manager, config, logger) {
    const tools = ctx.get('tools');
    if (!tools?.register)
        return;
    tools.register({
        name: SAVE_STICKER_TOOL_NAME,
        description: '把当前会话最近的一张图片收藏进表情包库。'
            + '适合用户说"@bot 收藏一下这个表情包"时调用。'
            + '不传 filePath 时自动用当前会话最近收到的那张图。'
            + '⚠️ 只有主人（owner）或管理员（admin）能调用，普通成员会被拒绝。',
        parameters: {
            type: 'object',
            properties: {
                filePath: {
                    type: 'string',
                    description: '要收藏的图片本地路径（留空 = 自动用当前会话最近收到的那张图）',
                },
                tags: {
                    type: 'array',
                    items: { type: 'string' },
                    description: '给这张图加标签（用于后续 selector 匹配），最多 5 个',
                },
            },
            required: [],
            additionalProperties: false,
        },
        output: {
            schema: {
                type: 'object',
                properties: {
                    saved: { type: 'boolean' },
                    filename: { type: 'string' },
                    id: { type: 'string' },
                    reason: { type: 'string' },
                    alreadyExists: { type: 'boolean' },
                },
                required: ['saved'],
                additionalProperties: false,
            },
            render: (_args, value) => {
                const v = value;
                if (!v.saved)
                    return [{ type: 'text', text: `收藏失败: ${v.reason ?? '未知原因'}` }];
                if (v.alreadyExists)
                    return [{ type: 'text', text: `这张图之前已经收藏过啦 ✅ ${v.filename}` }];
                return [{ type: 'text', text: `✨ 收藏成功！${v.filename} 已入库` }];
            },
        },
        async execute(args, exec) {
            // 1. 权限门控
            const record = manager.findByAgent(exec.agent);
            if (!record) {
                return { saved: false, reason: '只能在 QQ 会话里使用这个工具' };
            }
            // 检查 sender 是否在 owner/admin 名单里
            const identity = config.identity;
            const ownerOpenIds = identity?.ownerOpenIds ?? [];
            const adminOpenIds = identity?.adminOpenIds ?? [];
            const isOwner = ownerOpenIds.includes(record.senderId);
            const isAdmin = adminOpenIds.includes(record.senderId);
            if (identity?.enabled && !isOwner && !isAdmin) {
                logger.info(`save_sticker 被拒绝: senderId=${record.senderId} 不是 owner/admin`);
                return {
                    saved: false,
                    reason: '只有主人或管理员才能手动收藏表情包',
                };
            }
            // 2. 确定 filePath
            const a = args;
            let filePath = a.filePath?.trim() ?? '';
            if (!filePath) {
                // 不传 = 自动用缓存的最近图
                const latest = getLatestSessionAttachment(record.sessionKey);
                if (!latest) {
                    return { saved: false, reason: '当前会话最近 10 分钟内没有收到过图片，无法自动收藏' };
                }
                filePath = latest.localPath;
            }
            if (!existsSync(filePath)) {
                return { saved: false, reason: `文件不存在: ${filePath}` };
            }
            // 3. 收藏
            const sourceGroup = record.scope === 'group' ? record.peerId : undefined;
            const result = await engine.collector.collectFile(filePath, {
                groupId: sourceGroup,
                senderId: record.senderId,
            });
            if (!result) {
                return { saved: false, reason: '收藏器未启用或文件不合法（非图片/超大/超小）' };
            }
            // 如果已经存在（tryAdd 返回的是已有对象）
            // 简单判断：新收藏 hotScore=50 且 firstCollectedAt 刚创建；老对象 useCount>0 可能有区别
            // 这里 tryAdd 本身返回 existing 时也是同一个对象，我们用 quickId 判断是否是新加的
            return {
                saved: true,
                filename: result.filename,
                id: result.id,
                reason: `热度 ${result.hotScore}, 标签 [${result.tags.join(',')}]`,
                alreadyExists: result.useCount > 0, // 简化：已有 useCount 的就是之前收藏过的
            };
        },
    });
    logger.info(`im-qqbot: ${SAVE_STICKER_TOOL_NAME} 已注册`);
}
//# sourceMappingURL=tools.js.map