/** 记忆 section 的 order（人格 85 之后） */
export const MEMORY_SECTION_ORDER = 87;
/** 人物画像 section：与记忆同档，插入时排在会话记忆之前 */
export const PERSON_MEMORY_SECTION_ORDER = MEMORY_SECTION_ORDER;
/** 单次注入最多条数 */
export const MAX_PROMPT_FACTS = 6;
/** 单次注入的字符预算（只算事实正文） */
export const MAX_PROMPT_CHARS = 400;
/** 关系阶段：由累计互动次数推导（只影响亲近程度，不改变身份） */
export function relationshipStage(messageCount) {
    if (messageCount < 5)
        return '初识';
    if (messageCount < 20)
        return '眼熟';
    if (messageCount < 60)
        return '熟悉';
    if (messageCount < 200)
        return '亲近';
    return '很亲近';
}
/**
 * 从一段用户消息里抽取可长期记住的自述。
 *
 * 规则：
 * - 按句切分，疑问句不记录（"我叫什么来着？" 不是事实）
 * - 只匹配明确的自述句式，不猜、不做语义推断
 * - 结果做去重与长度裁剪
 */
export function extractMemoryFacts(text) {
    if (!text)
        return [];
    // 保留句末标点：疑问句判定依赖「？」（split 会把它吃掉）
    const sentences = (text.match(/[^。！？!?\n]+[。！？!?]?/g) ?? [])
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length <= 80);
    const facts = [];
    for (const sentence of sentences) {
        if (isQuestion(sentence))
            continue;
        if (mentionsSomeoneElse(sentence))
            continue;
        for (const pattern of CAPTURE_PATTERNS) {
            const match = sentence.match(pattern);
            if (match === null)
                continue;
            const fact = normalizeFact(match[0]);
            if (fact !== '' && !facts.includes(fact))
                facts.push(fact);
        }
    }
    return facts;
}
/** 自述句式（保守匹配：只收录主语明确的个人事实） */
const CAPTURE_PATTERNS = [
    /我叫(?:做)?[^，。！？!?\s]{1,20}/,
    /我的名字(?:叫|是)[^，。！？!?\s]{1,20}/,
    /我(?:很|超|特别|最)?喜欢[^，。！？!?]{1,25}/,
    /我(?:讨厌|不喜欢|害怕|最怕)[^，。！？!?]{1,25}/,
    /我的生日(?:是|在)?[^，。！？!?]{1,20}/,
    /我(?:住在|来自|老家在|家在|搬到)[^，。！？!?]{1,20}/,
    /我在[^，。！？!?]{2,20}(?:上学|上班|工作|读书)/,
    /我养了?[^，。！？!?]{1,20}/,
    /我(?:今年)?\s*\d{1,2}\s*岁/,
    /我的(?:专业|职业|工作|爱好)(?:是|叫)[^，。！？!?]{1,20}/,
    /我(?:已经)?(?:结婚|单身|有(?:男朋友|女朋友|对象))/,
];
function isQuestion(sentence) {
    if (/[?？]/.test(sentence))
        return true;
    // 无问号的「…吗 / …呢 / …么」也算疑问（宁可不记，也不把提问当事实）
    return /(?:吗|呢|么)$/.test(sentence.replace(/\s+/g, ''));
}
/** 转述别人的信息不记成本人事实（避免张冠李戴） */
function mentionsSomeoneElse(sentence) {
    return /(?:他说|她说|有人说|别人说|听说)/.test(sentence);
}
function normalizeFact(fact) {
    return fact
        .replace(/\s+/g, ' ')
        .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '')
        .trim()
        .slice(0, 60);
}
/**
 * 构建会话记忆注入 section。
 *
 * 没有要点且互动很少时返回 undefined，不给模型额外噪声；
 * 关闭 memory.enabled 后完全不注入。
 */
export function buildMemoryPromptSection(memory, config, now = Date.now()) {
    if (memory === undefined || !config?.enabled)
        return undefined;
    if (memory.notes.length === 0 && memory.messageCount < 5)
        return undefined;
    const days = Math.max(1, Math.ceil((now - memory.firstSeenAt) / 86_400_000));
    const lines = ['【关于当前对话的记忆】'];
    lines.push(`- 认识约 ${days} 天，互动 ${memory.messageCount} 次，关系阶段：${relationshipStage(memory.messageCount)}（只影响亲近程度，不改变身份设定）。`);
    if (memory.notes.length > 0) {
        lines.push('- 你记得这些事（只在相关话题时自然提起，不要复述清单，也不要编造未记录的内容）：');
        for (const note of memory.notes) {
            lines.push(`  - ${note.text}`);
        }
    }
    return { name: 'qqbot:memory', order: MEMORY_SECTION_ORDER, text: lines.join('\n') };
}
/**
 * 按当前消息挑选要注入的事实。
 *
 * 排序 = 关键词覆盖度 + 最近确认 + 置信度 + 使用次数；再按字符预算截断。
 * query 为空时退化为「置信度高 / 最近」优先。
 */
export function selectFactsForPrompt(notes, query, now = Date.now(), limit = MAX_PROMPT_FACTS, maxChars = MAX_PROMPT_CHARS) {
    if (notes.length === 0)
        return [];
    const queryGrams = bigrams(query ?? '');
    const scored = notes.map((note) => {
        const recency = Math.exp(-Math.max(0, now - (note.lastAt ?? note.at)) / (120 * 86_400_000));
        const confidence = note.confidence ?? 0.5;
        const hits = Math.min((note.hits ?? 0) / 5, 1);
        let coverage = 0;
        if (queryGrams.size > 0) {
            const grams = bigrams(note.text);
            let hit = 0;
            for (const gram of grams)
                if (queryGrams.has(gram))
                    hit += 1;
            coverage = hit / queryGrams.size;
        }
        const score = 0.6 * coverage + 0.2 * recency + 0.12 * confidence + 0.08 * hits;
        return { note, score };
    });
    scored.sort((a, b) => b.score - a.score || (b.note.at - a.note.at));
    const selected = [];
    let used = 0;
    for (const { note } of scored) {
        if (selected.length >= limit)
            break;
        const cost = note.text.length + 2;
        if (selected.length > 0 && used + cost > maxChars)
            continue;
        selected.push(note);
        used += cost;
    }
    return selected;
}
/**
 * 构建「正在跟你说话的人」画像 section。
 *
 * 画像按 personId 存，跨群与私聊共享：同一个人在陌生群里开口，模型也能叫出
 * 名字、记得喜好。只注入与当前话题相关的少量事实，并明确要求不要提来源，
 * 避免把别的群/私聊的聊天内容复述出来。
 */
export function buildPersonMemoryPromptSection(person, config, now = Date.now(), options = {}) {
    if (person === undefined || !config?.enabled || person.notes.length === 0)
        return undefined;
    const selected = selectFactsForPrompt(person.notes, options.query, now);
    if (selected.length === 0)
        return undefined;
    const who = person.senderName !== undefined && person.senderName !== ''
        ? `${person.senderName}`
        : '正在跟你说话的人';
    const lines = ['【关于正在跟你说话的人】'];
    lines.push(`- 对方是 ${who}。`);
    lines.push('- 你记得关于 TA 的事（只在相关话题时自然提起，不要复述清单，也不要编造未记录的内容）：');
    for (const note of selected) {
        lines.push(`  - ${note.text}`);
    }
    lines.push('- 这些印象来自你之前在别的群或私聊里和 TA 的相处：直接当作「你记得」，不要说明你是从哪里知道的；在群里尤其不要主动复述对方私聊里说过的事。');
    return { name: 'qqbot:person-memory', order: PERSON_MEMORY_SECTION_ORDER, text: lines.join('\n') };
}
/** 字符二元组集合（中文按字，英文按 2-gram） */
function bigrams(text) {
    const chars = [...text.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()];
    if (chars.length <= 1)
        return new Set(chars);
    const result = new Set();
    for (let i = 0; i < chars.length - 1; i += 1) {
        result.add(`${chars[i]}${chars[i + 1]}`);
    }
    return result;
}
//# sourceMappingURL=memory-prompt.js.map