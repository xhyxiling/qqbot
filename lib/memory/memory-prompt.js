/** 记忆 section 的 order（人格 85 之后） */
export const MEMORY_SECTION_ORDER = 87;
/** 人物画像 section：与记忆同档，插入时排在会话记忆之前 */
export const PERSON_MEMORY_SECTION_ORDER = MEMORY_SECTION_ORDER;
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
    /我(?:住在|来自|家在)[^，。！？!?]{1,20}/,
    /我在[^，。！？!?]{2,20}(?:上学|上班|工作|读书)/,
    /我养了?[^，。！？!?]{1,20}/,
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
 * 构建记忆注入 section。
 *
 * 新会话、无历史记忆时返回 undefined，不给模型额外噪声；
 * 关闭 memory.enabled 后完全不注入。
 */
export function buildMemoryPromptSection(memory, config, now = Date.now()) {
    if (memory === undefined || !config?.enabled)
        return undefined;
    // 互动很少且没有要点时，不足以形成「记忆」
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
 * 构建「正在跟你说话的人」画像 section。
 *
 * 画像按发送者 id 存，跨群与私聊共享：同一个人在陌生群里开口，模型也能叫出
 * 名字、记得喜好。只在有内容时注入；明确要求不要提「你在哪知道的」，
 * 避免把别的群/私聊的聊天内容复述出来。
 */
export function buildPersonMemoryPromptSection(person, config, now = Date.now()) {
    if (person === undefined || !config?.enabled)
        return undefined;
    if (person.notes.length === 0 && person.messageCount < 5)
        return undefined;
    const days = Math.max(1, Math.ceil((now - person.firstSeenAt) / 86_400_000));
    const who = person.senderName !== undefined && person.senderName !== ''
        ? `${person.senderName}（${person.senderId}）`
        : person.senderId;
    const lines = ['【关于正在跟你说话的人】'];
    lines.push(`- 对方是 ${who}，认识约 ${days} 天，累计互动 ${person.messageCount} 次。`);
    if (person.notes.length > 0) {
        lines.push('- 你记得关于 TA 的事（只在相关话题时自然提起，不要复述清单，也不要编造未记录的内容）：');
        for (const note of person.notes) {
            lines.push(`  - ${note.text}`);
        }
    }
    lines.push('- 这些印象来自你之前在别的群或私聊里和 TA 的相处：直接当作「你记得」，不要说明你是从哪里知道的。');
    return { name: 'qqbot:person-memory', order: PERSON_MEMORY_SECTION_ORDER, text: lines.join('\n') };
}
//# sourceMappingURL=memory-prompt.js.map