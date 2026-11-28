/**
 * OneBot 事件 → 插件内部入站消息（与 QQ 开放平台 SDK 的消息结构对齐）
 *
 * 目标：让现有中间件链与 handleInbound 零改动地消费 OneBot 消息，
 * 因此字段名沿用 SDK 的 snake_case / camelCase 混合结构。
 */
import { extname } from 'node:path';
// ── CQ 码解析（字符串格式消息） ──
const CQ_ESCAPES = [
    [/&#91;/g, '['],
    [/&#93;/g, ']'],
    [/&#44;/g, ','],
    [/&amp;/g, '&'],
];
function decodeCqText(text) {
    let out = text;
    for (const [pattern, replacement] of CQ_ESCAPES)
        out = out.replace(pattern, replacement);
    return out;
}
/** 把字符串格式（CQ 码）消息解析成消息段数组 */
export function parseCqString(raw) {
    const segments = [];
    const re = /\[CQ:([a-zA-Z0-9_.-]+)((?:,[^\]]*)?)\]/g;
    let lastIndex = 0;
    let match;
    while ((match = re.exec(raw)) !== null) {
        if (match.index > lastIndex) {
            segments.push({ type: 'text', data: { text: decodeCqText(raw.slice(lastIndex, match.index)) } });
        }
        const data = {};
        const body = match[2] ?? '';
        if (body.startsWith(',')) {
            for (const pair of body.slice(1).split(',')) {
                const eq = pair.indexOf('=');
                if (eq > 0)
                    data[pair.slice(0, eq)] = decodeCqText(pair.slice(eq + 1));
            }
        }
        segments.push({ type: match[1] ?? 'unknown', data });
        lastIndex = re.lastIndex;
    }
    if (lastIndex < raw.length) {
        segments.push({ type: 'text', data: { text: decodeCqText(raw.slice(lastIndex)) } });
    }
    return segments;
}
/** 消息字段归一化为消息段数组 */
export function toSegments(message) {
    if (Array.isArray(message))
        return message;
    if (typeof message === 'string')
        return parseCqString(message);
    return [];
}
// ── 消息段渲染 ──
function segmentText(segment, selfId, mentions) {
    const data = segment.data;
    switch (segment.type) {
        case 'text':
            return typeof data.text === 'string' ? data.text : '';
        case 'at': {
            const qq = String(data.qq ?? '');
            if (qq === 'all')
                return '@全体成员';
            if (qq === '')
                return '';
            mentions.push({ is_you: qq === selfId, id: qq });
            // @bot 本身已作为触发信号：从正文剔除，避免模型把 @10000 当成内容
            if (qq === selfId)
                return '';
            return `@${qq} `;
        }
        case 'mface':
            return '[动画表情]';
        case 'face':
            return '';
        case 'dice':
            return '[骰子]';
        case 'rps':
            return '[猜拳]';
        case 'forward':
            return '[聊天记录]';
        case 'share':
            return '[链接分享]';
        case 'location':
            return '[位置]';
        case 'music':
            return '[音乐分享]';
        case 'json':
        case 'xml':
            return '';
        case 'markdown':
            return typeof data.content === 'string' ? data.content : '';
        case 'image':
            return '[图片]';
        case 'record':
            return '[语音]';
        case 'video':
            return '[视频]';
        case 'file':
            return '[文件]';
        default:
            return '';
    }
}
/** 消息段 → 纯文本（@bot 段剔除，其他 @ 保留 qq 号） */
export function renderText(segments, selfId, mentions = []) {
    return segments
        .map((segment) => segmentText(segment, selfId, mentions))
        .join('')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}
// ── 附件提取 ──
function withExtension(name, fallback, ext) {
    const base = name.trim() === '' ? fallback : name;
    return extname(base) === '' ? `${base}${ext}` : base;
}
/** 消息段 → SDK 形态的附件列表（供 attachmentProcessor 下载） */
export function extractAttachments(segments) {
    const attachments = [];
    for (const segment of segments) {
        const data = segment.data;
        const size = Number(data.file_size ?? 0);
        const url = typeof data.url === 'string' ? data.url : '';
        const file = typeof data.file === 'string' ? data.file : '';
        if (segment.type === 'image') {
            attachments.push({
                content_type: 'image/png',
                filename: withExtension(file, `image_${Date.now()}.png`, '.png'),
                size: Number.isFinite(size) ? size : 0,
                url,
            });
            continue;
        }
        // 商城表情（表情包）：NapCat 有时会给 mface 带 url，一并当图片下载，
        // 否则主动发言/戳后续只能看到「[动画表情]」，无法描述内容。
        if (segment.type === 'mface') {
            if (url !== '') {
                attachments.push({
                    content_type: 'image/gif',
                    filename: withExtension(file, `sticker_${Date.now()}.gif`, '.gif'),
                    size: Number.isFinite(size) ? size : 0,
                    url,
                });
            }
            continue;
        }
        if (segment.type === 'video') {
            attachments.push({
                content_type: 'video/mp4',
                filename: withExtension(file, `video_${Date.now()}.mp4`, '.mp4'),
                size: Number.isFinite(size) ? size : 0,
                url,
            });
            continue;
        }
        if (segment.type === 'record') {
            const asr = typeof data.text === 'string' ? data.text : undefined;
            attachments.push({
                content_type: 'voice',
                filename: withExtension(file, `voice_${Date.now()}.amr`, '.amr'),
                size: Number.isFinite(size) ? size : 0,
                url,
                ...(asr !== undefined && asr !== '' ? { asr_refer_text: asr } : {}),
            });
            continue;
        }
        if (segment.type === 'file') {
            const name = typeof data.name === 'string' ? data.name : file;
            attachments.push({
                content_type: 'file',
                filename: withExtension(name, `file_${Date.now()}.bin`, '.bin'),
                size: Number.isFinite(size) ? size : 0,
                url,
            });
        }
    }
    return attachments;
}
/** 引用消息里 markdown 内嵌图片的最大下载数（进群欢迎语那种一屏十几张，别全下） */
const MAX_QUOTE_MD_IMAGES = 10;
/** markdown 里内嵌的图片：`![图片 #Wpx #Hpx](url)` / `[图片](url)` / `![](url)` */
const MD_IMAGE_RE = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)|\[图片[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
/** 从 markdown 正文里抽出图片 URL（QQ 机器人卡片消息把图直接写在文本里，不是 image 段） */
export function extractMarkdownImageUrls(text) {
    const urls = [];
    for (const match of text.matchAll(MD_IMAGE_RE)) {
        const url = match[1] ?? match[2];
        if (url !== undefined && !urls.includes(url))
            urls.push(url);
    }
    return urls;
}
/** 引用消息附件（camelCase，供 attachmentProcessor 下载） */
function extractQuoteAttachments(segments) {
    const out = [];
    for (const segment of segments) {
        const data = segment.data;
        const url = typeof data.url === 'string' ? data.url : '';
        const file = typeof data.file === 'string' ? data.file : '';
        if (segment.type === 'image') {
            out.push({ contentType: 'image/png', url, filename: withExtension(file, 'image', '.png') });
        }
        else if (segment.type === 'video') {
            out.push({ contentType: 'video/mp4', url, filename: withExtension(file, 'video', '.mp4') });
        }
        else if (segment.type === 'record') {
            const asr = typeof data.text === 'string' ? data.text : undefined;
            out.push({
                contentType: 'voice',
                url,
                filename: withExtension(file, 'voice', '.amr'),
                ...(asr !== undefined && asr !== '' ? { asrText: asr } : {}),
            });
        }
        else if (segment.type === 'file') {
            const name = typeof data.name === 'string' ? data.name : file;
            out.push({ contentType: 'file', url, filename: withExtension(name, 'file', '.bin') });
        }
    }
    // 机器人卡片/欢迎语的图是 markdown 文本里的 URL，没有 image 段；
    // 不抽出来就只能给模型一堆看不了的链接。按 URL 去重后补成图片附件。
    const known = new Set(out.map((attachment) => attachment.url).filter((url) => url !== ''));
    for (const segment of segments) {
        if (segment.type !== 'text' && segment.type !== 'markdown')
            continue;
        const raw = segment.type === 'markdown'
            ? (typeof segment.data.content === 'string' ? segment.data.content : '')
            : (typeof segment.data.text === 'string' ? segment.data.text : '');
        for (const url of extractMarkdownImageUrls(raw)) {
            if (known.has(url))
                continue;
            if (out.filter((attachment) => attachment.contentType === 'image/png').length >= MAX_QUOTE_MD_IMAGES)
                break;
            known.add(url);
            out.push({ contentType: 'image/png', url, filename: `quote_image_${known.size}.png` });
        }
    }
    return out;
}
// ── 主转换 ──
/**
 * 把 OneBot 消息事件转换成插件内部消息。
 *
 * @returns 无法处理（私聊/群聊之外的类型）时返回 undefined
 */
export async function buildInboundMessage(event, options) {
    const { selfId, logger } = options;
    if (event.message_type !== 'private' && event.message_type !== 'group')
        return undefined;
    const segments = toSegments(event.message);
    const mentions = [];
    const content = renderText(segments, selfId, mentions);
    const isGroup = event.message_type === 'group';
    const senderId = String(event.user_id);
    const groupOpenid = event.group_id !== undefined ? String(event.group_id) : undefined;
    const messageId = String(event.message_id);
    const targetId = isGroup ? (groupOpenid ?? senderId) : senderId;
    const senderName = event.sender?.card || event.sender?.nickname || undefined;
    const wasMentioned = mentions.some((mention) => mention.is_you === true)
        || content.includes(`@${selfId}`);
    const replyTarget = {
        scope: isGroup ? 'group' : 'c2c',
        targetId,
        msgId: messageId,
        channel: 'onebot',
    };
    // 引用消息：reply 段给出被引用消息 id，通过 get_msg 取回原文
    const replySegment = segments.find((segment) => segment.type === 'reply');
    const quotedId = replySegment !== undefined ? String(replySegment.data.id ?? '') : '';
    let quote;
    if (quotedId !== '' && options.getMessage !== undefined) {
        try {
            const detail = await options.getMessage(quotedId);
            if (detail !== undefined) {
                const quotedSegments = toSegments(detail.message);
                const quotedText = renderText(quotedSegments, selfId);
                const quoteAttachments = extractQuoteAttachments(quotedSegments);
                const quotedSenderId = detail.sender?.user_id !== undefined
                    ? String(detail.sender.user_id)
                    : undefined;
                quote = {
                    text: quotedText,
                    ...(quotedSenderId !== undefined
                        ? { entry: { senderId: quotedSenderId, content: quotedText } }
                        : {}),
                    ...(quoteAttachments.length > 0 ? { attachments: quoteAttachments } : {}),
                };
            }
        }
        catch (err) {
            logger.warn(`OneBot 引用消息解析失败 id=${quotedId}: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    const selfMentioned = wasMentioned || mentions.some((mention) => mention.is_you === true);
    const message = {
        rawEventType: isGroup
            ? (selfMentioned ? 'GROUP_AT_MESSAGE_CREATE' : 'GROUP_MESSAGE_CREATE')
            : 'C2C_MESSAGE_CREATE',
        kind: isGroup ? 'group' : 'c2c',
        senderId,
        ...(senderName !== undefined ? { senderName } : {}),
        content,
        messageId,
        timestamp: new Date((event.time ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        ...(groupOpenid !== undefined ? { groupOpenid } : {}),
        senderIsBot: false,
        mentions,
        attachments: extractAttachments(segments),
        replyTarget,
        msgIdx: messageId,
    };
    return { message, ...(quote !== undefined ? { quote } : {}) };
}
//# sourceMappingURL=message.js.map