import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { classifyContentType, isVoiceContentType, } from "./attachment.js";
import { clearGroupHistory } from "../features/history-store.js";
import { buildIdentityPrefix } from "../identity/role.js";
import { getActiveStickerEngine, cacheSessionAttachments, rememberSessionText, getRecentSessionText } from "../sticker/index.js";
// ── 主处理函数 ──
/**
 * 处理 QQ 入站消息（已经过 SDK 中间件链）
 */
export async function handleInbound(ctx, manager, config, logger) {
    const msg = ctx.message;
    const mwState = ctx.state;
    const { bot } = ctx;
    const scope = msg.kind === 'group' ? 'group' : 'c2c';
    const peerId = scope === 'group' ? (msg.groupOpenid ?? msg.senderId) : msg.senderId;
    const replyTarget = {
        scope,
        targetId: peerId,
        msgId: msg.messageId,
    };
    // ── 自动收藏群里的图片（异步旁路，不阻塞消息处理） ──
    const stickerSessionKey = `qqbot:${config.appId}:${scope}:${peerId}`;
    // 记住最近几条聊天文字，收藏表情时作为识别语境（图片消息自身通常没有文字）
    rememberSessionText(stickerSessionKey, msg.senderName, msg.content);
    const stickerEngine = getActiveStickerEngine();
    if (stickerEngine && mwState.downloadedFiles && mwState.downloadedFiles.length > 0) {
        // 旁路缓存下载的图片路径（手动收藏工具需要）
        cacheSessionAttachments(stickerSessionKey, mwState.downloadedFiles.map((d) => ({ localPath: d.localPath, filename: d.filename, size: 0 })));
        void stickerEngine.collector.collectFromDownloaded(msg.attachments, mwState.downloadedFiles, scope === 'group' ? (msg.groupOpenid ?? undefined) : undefined, msg.senderId, msg.content?.trim() || undefined, getRecentSessionText(stickerSessionKey)).catch(() => { });
    }
    // ── 组装 agentBody（下载结果经 mwState.downloadedFiles 提供） ──
    const agentBody = assembleAgentBody(msg, mwState, scope, config, logger);
    if (!agentBody)
        return;
    // 记录互动（长期记忆与关系状态）：与会话生命周期无关，
    // 先写记忆再 getOrCreate，`/new` 或闲置回收后记忆仍能延续。
    manager.recordInteraction(scope, peerId, msg.senderId, msg.senderName, msg.content ?? '');
    logger.info(`Processing: scope=${scope} peerId=${peerId} body="${agentBody.slice(0, 200)}"`);
    // ── 获取或创建会话 ──
    let record;
    try {
        record = await manager.getOrCreate(scope, peerId, msg.senderId, replyTarget);
    }
    catch (err) {
        logger.error(`ERROR creating session: ${err instanceof Error ? err.message : String(err)}`);
        // 兜底回复：会话创建失败时告知用户，避免静默无响应
        try {
            await bot.sendMarkdown(replyTarget, '⚠️ 处理消息时出现异常，请稍后重试。');
        }
        catch (sendErr) {
            logger.error(`fallback reply failed: ${sendErr instanceof Error ? sendErr.message : String(sendErr)}`);
        }
        return;
    }
    // ── 构建 UserMessage → followup ──
    const content = [{ type: 'text', text: agentBody }];
    // 语音标记复位：是否发语音由模型在本轮判断（调用 qqbot_voice），
    // 上一轮的请求不会延续到这一轮，避免「发完文字又补一条语音」的重复。
    delete record.voiceRequested;
    delete record.voiceInstruction;
    // 上一轮发表情留下的描述片段只作用于那一轮
    delete record.stickerDescTokens;
    const message = createUserMessage({
        content,
        source: { kind: 'user' },
    });
    record.agent.followup(message);
    logger.info(`→ followup sent: key=${scope}:${peerId}`);
    // 群消息回复后清空历史缓存（避免下次 @ 时重复组包）
    if (scope === 'group') {
        clearGroupHistory(config.appId, msg.groupOpenid ?? msg.senderId);
    }
    // 阻塞等待本轮 turn 收敛，避免后续消息在 turn 运行期间被 followup 打断
    try {
        await record.agent.whenIdle();
    }
    catch (err) {
        logger.warn(`whenIdle rejected: ${err instanceof Error ? err.message : String(err)}`);
    }
}
// ══════════════════════════════════════════════════════════════
// Body Assembly（5 层组装）
// ══════════════════════════════════════════════════════════════
/**
 * 组装 agentBody — AI 实际看到的完整上下文
 */
function assembleAgentBody(msg, state, scope, config, logger) {
    const isGroup = scope === 'group';
    const wasMentioned = state.mention?.wasMentioned ?? false;
    const userContent = buildUserContent(msg, state, logger);
    if (isEmptyMessage(userContent, msg.attachments, isGroup, wasMentioned))
        return null;
    const quotePart = buildQuotePart(state.quote);
    const identityPrefix = buildIdentityPrefix(msg.senderId, config.identity);
    const userMessage = buildUserMessage(userContent, quotePart, msg.senderId, msg.senderName, isGroup, wasMentioned, identityPrefix);
    const dynamicCtx = buildDynamicCtx(msg, state);
    const base = dynamicCtx ? `${dynamicCtx}${userMessage}` : userMessage;
    const agentBody = buildAgentBody(base, state.history, isGroup, wasMentioned, config);
    return agentBody;
}
/**
 * 判断消息是否为空：无文本/语音/附件，且非群聊 @。
 * 群聊被 @ 视为有效触发信号，即使内容为空也保留给 agent。
 */
function isEmptyMessage(userContent, attachments, isGroup, wasMentioned) {
    if (userContent)
        return false;
    if (attachments && attachments.length > 0)
        return false;
    if (isGroup && wasMentioned)
        return false;
    return true;
}
/**
 * Layer 1: 用户文本内容 + 语音转录 + 附件类型标签（媒体路径由 buildDynamicCtx 提供）
 */
function buildUserContent(msg, state, logger) {
    const parts = [];
    const text = (msg.content ?? '').trim();
    if (text) {
        parts.push(text);
    }
    const voiceTexts = extractVoiceTexts(msg.attachments, state.processedAttachments, logger);
    if (voiceTexts.length > 0) {
        for (const vt of voiceTexts) {
            const durationTag = vt.duration ? ` (${vt.duration}s)` : '';
            parts.push(`[Voice message${durationTag}] ${vt.text}`);
        }
    }
    // 附件类型标签（媒体路径由 buildDynamicCtx 提供，这里只提示「带了什么」）
    const attachmentTags = buildAttachmentTags(msg.attachments);
    if (attachmentTags) {
        parts.push(attachmentTags);
    }
    return parts.join('\n');
}
/**
 * Layer 2: 引用消息块
 */
function buildQuotePart(quote) {
    if (!quote?.text && !quote?.entry?.content)
        return '';
    const quoteText = quote.text || quote.entry?.content || 'Original content unavailable';
    return `[Quoted message begins]\n${quoteText}\n[Quoted message ends]\n[Current message]\n`;
}
/**
 * Layer 3: 带发送者标签的用户消息
 *
 * 私聊同样带身份标签：QQ 私聊消息不含昵称，只有 `[身份: 主人]` 这类标签
 * 才能让人格知道对面是谁（旧实现私聊完全不注入 sender 信息）。
 */
function buildUserMessage(userContent, quotePart, senderId, senderName, isGroup, wasMentioned, identityPrefix) {
    if (!isGroup) {
        return `${identityPrefix}${quotePart}${userContent}`;
    }
    const mentionTag = wasMentioned ? ' (@you)' : '';
    const displayName = senderName ?? shortSenderId(senderId);
    const senderTag = `[${displayName} (${senderId})]`;
    return `${identityPrefix}${quotePart}${senderTag} ${userContent}${mentionTag}`;
}
/**
 * Layer 4: 媒体元数据上下文（图片/视频/文件本地路径 + 语音 ASR + 引用附件）
 */
function buildDynamicCtx(msg, state) {
    const lines = [];
    if (msg.attachments && msg.attachments.length > 0) {
        const downloadedByFilename = new Map((state.downloadedFiles ?? []).map(d => [d.filename, d]));
        const voices = [];
        // 一次遍历归类 + 生成媒体行
        for (const att of msg.attachments) {
            const kind = classifyContentType(att.content_type);
            if (kind === 'voice') {
                voices.push(att);
                continue;
            }
            const d = downloadedByFilename.get(att.filename);
            lines.push(`- ${renderMediaLine(kind, att.filename, d?.localPath, att.url, att.size)}`);
        }
        // 语音：有 ASR 文本才带文本，否则只带链接（纯文本模型无法消费音频）
        if (voices.length > 0) {
            const asrTexts = voices.map(a => a.asr_refer_text).filter(Boolean);
            if (asrTexts.length > 0) {
                lines.push(`- ASR: ${asrTexts.join(' | ')}`);
            }
            else {
                const urls = voices.map(a => a.url).filter(Boolean);
                if (urls.length > 0)
                    lines.push(`- Voice: ${urls.join(', ')}`);
            }
        }
    }
    // 引用消息的附件（独立于当前消息媒体，不受上一步为空影响）
    const quoteAttachments = state.quote?.attachments;
    if (quoteAttachments && quoteAttachments.length > 0) {
        const downloadedQuote = new Map((state.downloadedQuoteFiles ?? []).map(d => [d.filename, d]));
        lines.push('[Reference attachments]');
        for (const qa of quoteAttachments) {
            const kind = classifyContentType(qa.contentType);
            const d = downloadedQuote.get(qa.filename ?? '');
            if (kind === 'voice') {
                if (qa.asrText)
                    lines.push(`  - Voice: ${qa.asrText}`);
                continue;
            }
            lines.push(`  - ${renderMediaLine(kind, qa.filename, d?.localPath, qa.url, undefined)}`);
        }
    }
    return lines.length > 0 ? lines.join('\n') + '\n\n' : '';
}
/**
 * 渲染单个媒体附件（image/video/file）的上下文行内容，不含列表前缀。
 * 当前消息与引用消息共用，保证附件格式统一。语音不在此处理（见 buildDynamicCtx）。
 */
function renderMediaLine(kind, filename, localPath, url, size) {
    switch (kind) {
        case 'image':
            return localPath
                ? `Image: ${localPath}`
                : `Image: ${url ?? filename ?? 'image'}`;
        case 'video':
            return localPath
                ? `Video: ${localPath}`
                : `Video: ${filename ?? 'video'} (download failed)`;
        case 'file':
            return localPath
                ? `File: ${localPath}`
                : `File: ${filename ?? 'file'} (${formatFileSize(size ?? 0)})`;
    }
}
/**
 * Layer 5: 最终 agentBody 拼合
 *
 * 历史消息（群聊上下文）同样带身份标签，避免模型把上一条的主体当成
 * 当前说话人，也让人格在「上一句是谁说的」时仍能分辨亲疏。
 */
function buildAgentBody(base, history, isGroup, wasMentioned, config) {
    if (!isGroup || !wasMentioned || !history || history.length === 0) {
        return base;
    }
    const historyLines = history.map(h => {
        const name = h.senderName ?? shortSenderId(h.senderId);
        const identityPrefix = buildIdentityPrefix(h.senderId, config.identity);
        return `${identityPrefix}[${name} (${h.senderId})] ${h.content}`;
    });
    return [
        '[Chat history begins]',
        ...historyLines,
        '',
        '[Chat history ends]',
        '[Current message]',
        base,
    ].join('\n');
}
function extractVoiceTexts(attachments, processed, _logger) {
    const results = [];
    if (processed) {
        for (const pa of processed) {
            if (pa.type === 'voice' && pa.voiceText) {
                results.push({
                    text: pa.voiceText,
                    duration: pa.duration,
                    source: pa.voiceSource ?? 'stt',
                });
            }
        }
    }
    if (results.length === 0 && attachments) {
        for (const att of attachments) {
            if (isVoiceContentType(att.content_type) && att.asr_refer_text) {
                results.push({
                    text: att.asr_refer_text.trim(),
                    source: 'asr',
                });
            }
        }
    }
    return results;
}
/**
 * 附件类型标签（Layer 1 用户消息主体里的轻量提示）。
 * 只标注「带了什么类型的附件」，去重；媒体本地路径在 buildDynamicCtx 提供。
 */
function buildAttachmentTags(attachments) {
    if (!attachments || attachments.length === 0)
        return '';
    const labels = {
        image: '[图片]',
        video: '[视频]',
        file: '[文件]',
    };
    const seen = new Set();
    const tags = [];
    for (const att of attachments) {
        const kind = classifyContentType(att.content_type);
        if (kind === 'voice' || seen.has(kind))
            continue;
        seen.add(kind);
        const label = labels[kind];
        if (label)
            tags.push(label);
    }
    return tags.join(' ');
}
function formatFileSize(bytes) {
    if (bytes < 1024)
        return `${bytes}B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
/** 发送者短标识长度（openid 前 N 位，无昵称时兜底） */
const SENDER_SHORT_ID_LEN = 8;
/** 无昵称时用 openid 前 N 位作为匿名标识 */
function shortSenderId(senderId) {
    return senderId.slice(0, SENDER_SHORT_ID_LEN);
}
//# sourceMappingURL=inbound.js.map