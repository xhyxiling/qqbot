/** 输出 token 上限 */
export const PROFILE_ANALYSIS_MAX_TOKENS = 1800;
/** 聊天记录总字符预算 */
export const PROFILE_TRANSCRIPT_MAX_CHARS = 12_000;
/** 最多展示几个会话的原始记录（其余只在统计里出现） */
export const PROFILE_MAX_TRANSCRIPT_CHATS = 6;
/** 每个会话至少分配的字符预算 */
export const PROFILE_MIN_CHARS_PER_CHAT = 800;
/** 少于此条数不做性格判断 */
export const PROFILE_MIN_TRAITS_MESSAGES = 5;
/** 少于此条数标注样本偏少 */
export const PROFILE_CONFIDENCE_MESSAGES = 30;
/** openid 缩写 */
export function shortId(senderId) {
    return senderId.slice(0, 8);
}
/** 展示名：昵称优先，否则 openid 缩写 */
export function displayName(target) {
    const name = target.senderName?.trim();
    return name !== undefined && name !== '' ? name : shortId(target.senderId);
}
/** 本地时间（YYYY-MM-DD HH:mm） */
export function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
        + `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
/** 会话展示名（QQ 不提供群名，只能用群 openid 缩写） */
export function chatDisplayName(scope, peerId) {
    return scope === 'group' ? `群聊 ${shortId(peerId)}` : '私聊';
}
/** 单条消息在 prompt 里的大致字符数（时间 + 昵称 + 内容） */
function messageCost(message) {
    return message.content.length + displayName(message).length + 22;
}
/**
 * 在字符预算内抽样消息。
 *
 * 超预算时按等间隔抽取（覆盖整个时间跨度），仍超预算则从最旧开始丢弃，
 * 优先保留最近的发言；不会把一条消息截断成半句。
 */
export function sampleMessages(messages, maxChars) {
    if (maxChars <= 0 || messages.length === 0)
        return [];
    if (messages.length === 1)
        return [messages[0]];
    const costs = messages.map(messageCost);
    const total = costs.reduce((sum, cost) => sum + cost, 0);
    if (total <= maxChars)
        return [...messages];
    const average = total / messages.length;
    const maxCount = Math.max(1, Math.floor(maxChars / Math.max(1, average)));
    const stride = Math.max(1, Math.ceil(messages.length / maxCount));
    const picked = [];
    let used = 0;
    for (let i = 0; i < messages.length; i++) {
        if (i % stride !== 0 && i !== messages.length - 1)
            continue;
        picked.push(messages[i]);
        used += costs[i];
    }
    while (used > maxChars && picked.length > 1) {
        const removed = picked.shift();
        used -= messageCost(removed);
    }
    return picked;
}
/** 会话类型叙述 */
function scopeLabel(chats) {
    const hasGroup = chats.some((chat) => chat.scope === 'group');
    const hasC2c = chats.some((chat) => chat.scope === 'c2c');
    if (hasGroup && hasC2c)
        return '群聊与私聊';
    return hasGroup ? '群聊' : '私聊';
}
/**
 * 组装自动/手动分析用的 user prompt（纯函数，便于测试）。
 */
export function buildProfilePrompt(input) {
    const budget = Math.max(1, input.budget ?? PROFILE_TRANSCRIPT_MAX_CHARS);
    const chats = [...input.chats]
        .filter((chat) => chat.messages.length > 0)
        .sort((a, b) => b.messages.length - a.messages.length);
    const totalMessages = chats.reduce((sum, chat) => sum + chat.messages.length, 0);
    const firstAt = Math.min(...chats.map((chat) => chat.messages[0]?.timestamp ?? Number.POSITIVE_INFINITY));
    const lastAt = Math.max(...chats.map((chat) => chat.messages.at(-1)?.timestamp ?? 0));
    const range = Number.isFinite(firstAt) && lastAt > 0
        ? `${formatTimestamp(firstAt)} ~ ${formatTimestamp(lastAt)}`
        : '时间未知';
    const shown = chats.slice(0, PROFILE_MAX_TRANSCRIPT_CHATS);
    const perChat = Math.max(PROFILE_MIN_CHARS_PER_CHAT, Math.floor(budget / Math.max(1, shown.length)));
    const lines = [
        `【分析对象】${displayName({ senderId: input.senderId, ...(input.senderName !== undefined ? { senderName: input.senderName } : {}) })}`
            + `（openid: ${shortId(input.senderId)}）`,
        `【会话类型】${scopeLabel(chats)}`,
        '【归档说明】只包含机器人上线后收到并保留下来的消息；同一 openid 的发言跨会话合并。',
        `【发言统计】共 ${totalMessages} 条，覆盖 ${chats.length} 个会话 | ${range}`,
        `【会话分布】${chats.map((chat) => `${chatDisplayName(chat.scope, chat.peerId)}（${chat.messages.length} 条）`).join('、') || '无'}`,
    ];
    const focus = input.focus?.trim();
    if (focus !== undefined && focus !== '')
        lines.push(`【额外关注点】${focus}`);
    lines.push('');
    shown.forEach((chat, index) => {
        const sampled = sampleMessages(chat.messages, perChat);
        const prefix = shown.length > 1 ? `【会话 ${index + 1}｜${chatDisplayName(chat.scope, chat.peerId)}】` : '【聊天记录】';
        lines.push(`${prefix}${chat.messages.length} 条（本次送入 ${sampled.length} 条）`, ...sampled.map((message) => `${formatTimestamp(message.timestamp)} ${displayName(message)}: ${message.content}`), '');
    });
    return lines.join('\n').trim();
}
/** 结构化输出 system prompt */
export const PROFILE_ANALYSIS_SYSTEM_PROMPT = `你是一名群聊成员画像分析器：根据给定对象在聊天里的真实发言，归纳其语言习惯与性格倾向。

【证据规则】
1. 只依据聊天记录说话，不编造；判断要能在记录里找到依据。
2. 严格区分「事实风格」与「推测性格」：后者用「看起来 / 更可能 / 倾向于」。
3. 记录少于 ${PROFILE_CONFIDENCE_MESSAGES} 条时 confidence 必须是 low 或 medium；少于 ${PROFILE_MIN_TRAITS_MESSAGES} 条时只描述语言习惯，traits 留空或只给中性标签，不做性格判断。
4. 记录里没有依据的内容（职业、年龄、外貌、收入、家庭、健康等）一律不猜；不做心理或医学诊断，不用 MBTI、星座等标签下定论。
5. 只评价发言风格与互动方式，不输出冒犯性绰号或负面评价；涉及第三人时只描述关系，不评判。

【输出格式】
只输出一个 JSON 对象，不要 Markdown 代码块、不要解释文字。字段如下：
{
  "summary": "一句话印象，≤40 字",
  "traits": ["3–6 个性格/气质标签，每个 ≤12 字，如：慢热、嘴硬心软"],
  "style": "说话风格，≤150 字：句长、标点、语气词、表情/颜文字、分条习惯、方言或错别字",
  "catchphrases": ["真正重复出现的口头禅/高频表达，最多 5 个"],
  "interests": ["从讨论话题归纳的兴趣/关注点，最多 5 个"],
  "role": "群内角色与互动关系，≤120 字",
  "advice": "和 TA 相处的 2–3 条可执行建议，≤120 字",
  "confidence": "low | medium | high"
}

traits 用于设置面板筛选，优先使用稳定、可复用的词（如 慢热、健谈、毒舌、热心、理性、情绪化），不要写成长句。`;
/** 从模型输出里提取 JSON 对象（容忍 ```json 包裹与前后解释文字） */
function extractJson(text) {
    const trimmed = text.trim();
    const unfenced = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
        return JSON.parse(unfenced);
    }
    catch {
        const start = trimmed.indexOf('{');
        const end = trimmed.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(trimmed.slice(start, end + 1));
            }
            catch {
                // 继续抛下面的统一错误
            }
        }
    }
    throw new Error('模型返回的不是有效 JSON');
}
function asText(value, maxChars) {
    if (typeof value !== 'string')
        return '';
    return value.trim().slice(0, maxChars);
}
function asList(value, maxItems, maxChars) {
    if (!Array.isArray(value))
        return [];
    const seen = new Set();
    const result = [];
    for (const item of value) {
        if (typeof item !== 'string')
            continue;
        const text = item.trim().slice(0, maxChars);
        if (text === '' || seen.has(text))
            continue;
        seen.add(text);
        result.push(text);
        if (result.length >= maxItems)
            break;
    }
    return result;
}
/**
 * 解析模型返回的结构化人格档案。
 *
 * @param messageCount - 用于校正可信度：少于 5 条强制 low，少于 30 条不允许 high
 */
export function parseProfileAnalysis(text, messageCount) {
    const raw = extractJson(text);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        throw new Error('模型返回的 JSON 不是对象');
    }
    const summary = asText(raw.summary, 80);
    const style = asText(raw.style, 300);
    const role = asText(raw.role, 240);
    const advice = asText(raw.advice, 240);
    if (summary === '' && style === '' && role === '') {
        throw new Error('模型返回的 JSON 缺少 summary/style/role');
    }
    const confidenceRaw = asText(raw.confidence, 20).toLowerCase();
    let confidence = confidenceRaw === 'high' ? 'high' : confidenceRaw === 'medium' ? 'medium' : 'low';
    if (messageCount < PROFILE_MIN_TRAITS_MESSAGES)
        confidence = 'low';
    else if (messageCount < PROFILE_CONFIDENCE_MESSAGES && confidence === 'high')
        confidence = 'medium';
    return {
        summary: summary || style.slice(0, 80),
        traits: asList(raw.traits, 8, 24),
        style,
        catchphrases: asList(raw.catchphrases, 6, 40),
        interests: asList(raw.interests, 6, 40),
        role,
        advice,
        confidence,
    };
}
/** 可信度文案 */
export function confidenceLabel(confidence) {
    return confidence === 'high' ? '高' : confidence === 'medium' ? '中' : '低';
}
/** 把结构化档案格式化为 Markdown（手动工具回给模型的文本） */
export function formatProfileMarkdown(analysis, stats) {
    const range = stats.firstAt !== undefined && stats.lastAt !== undefined
        ? `${formatTimestamp(stats.firstAt)} ~ ${formatTimestamp(stats.lastAt)}`
        : '时间未知';
    return [
        '## 一句话印象',
        analysis.summary || '（样本不足，暂无稳定印象）',
        '',
        '## 性格特点',
        analysis.traits.length > 0 ? analysis.traits.map((trait) => `\`${trait}\``).join(' ') : '样本不足，暂不打标签',
        '',
        '## 说话风格',
        analysis.style || '（记录里看不出稳定风格）',
        '',
        '## 口头禅与高频表达',
        analysis.catchphrases.length > 0 ? analysis.catchphrases.join('；') : '没有明显重复的口头禅',
        '',
        '## 兴趣与关注点',
        analysis.interests.length > 0 ? analysis.interests.join('；') : '记录里看不出稳定兴趣',
        '',
        '## 群内角色与互动关系',
        analysis.role || '（样本不足，暂无判断）',
        '',
        '## 相处建议',
        analysis.advice || '（样本不足，暂无建议）',
        '',
        '## 可信度',
        `样本 ${stats.messageCount} 条（${stats.chatCount} 个会话，${range}）· ${confidenceLabel(analysis.confidence)}`,
    ].join('\n');
}
//# sourceMappingURL=persona-profile-analysis.js.map