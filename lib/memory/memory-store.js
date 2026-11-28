/**
 * MemoryStore — 持久化「人物事实 + 会话关系」
 *
 * 结构（v3）：
 *   - people：按 personId（IdentityStore 归并后的「人」）存长期事实，
 *     群聊与私聊共用同一份；personId 不再直接等于原始 senderId。
 *   - chats：按会话存的互动统计，只属于当前群/私聊。
 *
 * 存储路径：~/.dsh-qqbot/memory.json（与会话历史独立，/new 与重启都不清除）
 * chat key 与 SessionManager 的 sessionKey 同构：qqbot:${appId}:${scope}:${peerId}
 *
 * v2 迁移：旧文件按 senderId 存画像，加载时原样转成 personId 并用
 * IdentityStore 补别名（记忆不丢）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { inferChannel } from "./identity-store.js";
/** 单条记忆文本的最大长度 */
export const MAX_NOTE_TEXT = 200;
/** 默认写盘防抖(ms) */
export const MEMORY_WRITE_DELAY_MS = 300;
/** 相似度高于该值视为同一条事实 */
const DUPLICATE_SIMILARITY = 0.8;
export class MemoryStore {
    chats = new Map();
    people = new Map();
    filePath;
    writeDelayMs;
    debugLog;
    writeTimer;
    constructor(options = {}) {
        this.filePath = options.path
            ?? resolve(homedir(), '.dsh-qqbot', options.channel ? `memory.${options.channel}.json` : 'memory.json');
        this.writeDelayMs = Math.max(0, Math.trunc(options.writeDelayMs ?? MEMORY_WRITE_DELAY_MS));
        this.debugLog = options.debugLog;
        const hadOwnFile = existsSync(this.filePath);
        this.load();
        // 首次启用分通道存储：从旧的 memory.json 按 id 形状拆到各自文件
        if (!hadOwnFile && options.channel !== undefined) {
            const legacy = options.legacyPath ?? resolve(homedir(), '.dsh-qqbot', 'memory.json');
            if (this.loadLegacy(legacy, options.channel))
                this.write();
        }
    }
    // ── 会话关系 ──
    get(key) {
        return this.chats.get(key);
    }
    /**
     * 记录一次互动：累加消息数，更新首/末次时间。
     * 首次互动时创建记录。
     */
    recordInteraction(key, scope, peerId, at = Date.now()) {
        let record = this.chats.get(key);
        if (record === undefined) {
            record = {
                scope,
                peerId,
                firstSeenAt: at,
                lastSeenAt: at,
                messageCount: 0,
                notes: [],
            };
            this.chats.set(key, record);
        }
        else if (record.lastSeenAt !== at) {
            record.lastSeenAt = at;
        }
        record.messageCount += 1;
        this.scheduleWrite();
        return record;
    }
    /**
     * 追加一条会话要点；内容为空 / 重复时返回 undefined。
     * maxNotes 超出后淘汰最旧的一条。
     */
    addNote(key, scope, peerId, text, source, maxNotes) {
        const normalized = normalizeNote(text);
        if (normalized === '')
            return undefined;
        const record = this.ensureRecord(key, scope, peerId);
        const exists = record.notes.some((n) => normalizeNote(n.text).toLowerCase() === normalized.toLowerCase());
        if (exists)
            return undefined;
        const note = { text: normalized.slice(0, MAX_NOTE_TEXT), at: Date.now(), source };
        record.notes.push(note);
        const limit = Math.max(1, maxNotes);
        if (record.notes.length > limit) {
            record.notes.splice(0, record.notes.length - limit);
        }
        this.scheduleWrite();
        return note;
    }
    /** 删除第 index 条会话要点（0-based）；越界返回 false */
    removeNote(key, index) {
        const record = this.chats.get(key);
        if (record === undefined || index < 0 || index >= record.notes.length)
            return false;
        record.notes.splice(index, 1);
        this.scheduleWrite();
        return true;
    }
    /** 清空某个会话的要点记忆（保留关系统计）；返回删除条数 */
    clearNotes(key) {
        const record = this.chats.get(key);
        if (record === undefined || record.notes.length === 0)
            return 0;
        const count = record.notes.length;
        record.notes = [];
        this.scheduleWrite();
        return count;
    }
    /** 删除整个会话记录（统计 + 记忆） */
    remove(key) {
        const deleted = this.chats.delete(key);
        if (deleted)
            this.scheduleWrite();
        return deleted;
    }
    // ── 人物画像（跨群/私聊共享） ──
    getPerson(personId) {
        return this.people.get(personId);
    }
    /** 所有已有人物 personId（用于 v2 迁移补别名） */
    listPersonIds() {
        return [...this.people.keys()];
    }
    /**
     * 记录一次与某个人的互动：累加消息数、刷新昵称与末次时间。
     * 与会话无关，因此在任何群或私聊里说话都会累积到同一份画像。
     */
    recordPersonInteraction(personId, senderName, at = Date.now()) {
        let record = this.people.get(personId);
        if (record === undefined) {
            record = {
                personId,
                ...(senderName !== undefined && senderName !== '' ? { senderName } : {}),
                firstSeenAt: at,
                lastSeenAt: at,
                messageCount: 0,
                notes: [],
            };
            this.people.set(personId, record);
        }
        record.lastSeenAt = Math.max(record.lastSeenAt, at);
        record.messageCount += 1;
        if (senderName !== undefined && senderName !== '')
            record.senderName = senderName;
        this.scheduleWrite();
        return record;
    }
    /** 追加一条人物画像要点；内容为空或重复时返回 undefined */
    addPersonNote(personId, text, source, maxNotes, meta = {}) {
        if (personId === '')
            return undefined;
        const planted = this.addPersonFacts(personId, [{
                text,
                ...(meta.kind !== undefined ? { kind: meta.kind } : {}),
                ...(meta.confidence !== undefined ? { confidence: meta.confidence } : {}),
            }], source, maxNotes, meta.sourceChat);
        return planted[0];
    }
    /**
     * 批量写入人物事实（规则 / LLM 抽取共用）。
     *
     * 合并规则：
     *   - 文本归一化后高度相似（>= 0.8）视为同一条，只刷新 lastAt/置信度
     *   - 同一「槽位」（姓名/住址/生日/年龄/职业/学历）且内容不同则覆盖旧值
     *   - 其余情况追加；超过 maxNotes 淘汰最旧的低置信条目
     */
    addPersonFacts(personId, facts, source, maxNotes, sourceChat) {
        if (personId === '')
            return [];
        const record = this.ensurePerson(personId);
        const written = [];
        for (const fact of facts) {
            const normalized = normalizeNote(fact.text);
            if (normalized === '')
                continue;
            const note = upsertFact(record, normalized, fact, source, sourceChat);
            if (note !== undefined)
                written.push(note);
        }
        const limit = Math.max(1, maxNotes);
        if (record.notes.length > limit) {
            record.notes.sort((a, b) => factWeight(b) - factWeight(a));
            record.notes.splice(limit, record.notes.length - limit);
            record.notes.sort((a, b) => a.at - b.at);
        }
        if (written.length > 0)
            this.scheduleWrite();
        return written;
    }
    /** 删除某人画像的第 index 条；越界返回 false */
    removePersonNote(personId, index) {
        const record = this.people.get(personId);
        if (record === undefined || index < 0 || index >= record.notes.length)
            return false;
        record.notes.splice(index, 1);
        this.scheduleWrite();
        return true;
    }
    /** 清空某人画像的要点（保留关系统计）；返回删除条数 */
    clearPersonNotes(personId) {
        const record = this.people.get(personId);
        if (record === undefined || record.notes.length === 0)
            return 0;
        const count = record.notes.length;
        record.notes = [];
        this.scheduleWrite();
        return count;
    }
    /** 记录事实被注入提示词的次数（用于后续排序/衰减） */
    touchPersonFacts(personId, texts) {
        const record = this.people.get(personId);
        if (record === undefined || texts.length === 0)
            return;
        const wanted = new Set(texts.map((text) => text.trim()));
        let changed = false;
        for (const note of record.notes) {
            if (!wanted.has(note.text))
                continue;
            note.hits = (note.hits ?? 0) + 1;
            note.lastAt = Date.now();
            changed = true;
        }
        if (changed)
            this.scheduleWrite();
    }
    /**
     * 身份归并后合并两份人物记忆：事实按同一套去重规则并入 target。
     */
    mergePeople(sourcePersonId, targetPersonId, maxNotes) {
        if (sourcePersonId === targetPersonId)
            return;
        const source = this.people.get(sourcePersonId);
        if (source === undefined)
            return;
        const target = this.ensurePerson(targetPersonId);
        target.messageCount += source.messageCount;
        target.firstSeenAt = Math.min(target.firstSeenAt, source.firstSeenAt);
        target.lastSeenAt = Math.max(target.lastSeenAt, source.lastSeenAt);
        if (target.senderName === undefined && source.senderName !== undefined) {
            target.senderName = source.senderName;
        }
        for (const note of source.notes) {
            upsertFact(target, normalizeNote(note.text), note, note.source, note.sourceChat);
        }
        const limit = Math.max(1, maxNotes);
        if (target.notes.length > limit)
            target.notes.splice(0, target.notes.length - limit);
        this.people.delete(sourcePersonId);
        this.scheduleWrite();
    }
    /** 立即落盘（退出 / 测试用） */
    flush() {
        if (this.writeTimer !== undefined) {
            clearTimeout(this.writeTimer);
            this.writeTimer = undefined;
        }
        this.write();
    }
    ensurePerson(personId) {
        let record = this.people.get(personId);
        if (record !== undefined)
            return record;
        const now = Date.now();
        record = { personId, firstSeenAt: now, lastSeenAt: now, messageCount: 0, notes: [] };
        this.people.set(personId, record);
        return record;
    }
    ensureRecord(key, scope, peerId) {
        let record = this.chats.get(key);
        if (record !== undefined)
            return record;
        const now = Date.now();
        record = { scope, peerId, firstSeenAt: now, lastSeenAt: now, messageCount: 0, notes: [] };
        this.chats.set(key, record);
        this.scheduleWrite();
        return record;
    }
    scheduleWrite() {
        if (this.writeDelayMs <= 0) {
            this.write();
            return;
        }
        if (this.writeTimer !== undefined)
            return;
        this.writeTimer = setTimeout(() => {
            this.writeTimer = undefined;
            this.write();
        }, this.writeDelayMs);
    }
    load() {
        try {
            if (!existsSync(this.filePath))
                return;
            const data = JSON.parse(readFileSync(this.filePath, 'utf8'));
            if (data.chats && typeof data.chats === 'object') {
                for (const [key, value] of Object.entries(data.chats)) {
                    if (!isChatMemory(value))
                        continue;
                    this.chats.set(key, {
                        scope: value.scope,
                        peerId: value.peerId,
                        firstSeenAt: value.firstSeenAt,
                        lastSeenAt: value.lastSeenAt,
                        messageCount: value.messageCount,
                        notes: value.notes.filter(isMemoryNote),
                    });
                }
            }
            if (data.people && typeof data.people === 'object') {
                for (const [key, value] of Object.entries(data.people)) {
                    const record = normalizePerson(key, value);
                    if (record !== undefined)
                        this.people.set(record.personId, record);
                }
            }
        }
        catch (err) {
            this.debugLog?.(`loadMemory failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    /**
     * 从旧版单文件 memory.json 迁移：只取属于本通道的会话与人物。
     * 官方 id 是 openid，OneBot id 是 QQ 号，按形状即可稳定分流。
     */
    loadLegacy(legacyPath, channel) {
        try {
            if (legacyPath === this.filePath || !existsSync(legacyPath))
                return false;
            const data = JSON.parse(readFileSync(legacyPath, 'utf8'));
            let loaded = false;
            if (data.chats && typeof data.chats === 'object') {
                for (const [key, value] of Object.entries(data.chats)) {
                    if (!isChatMemory(value) || inferChannel(value.peerId) !== channel)
                        continue;
                    this.chats.set(key, {
                        scope: value.scope,
                        peerId: value.peerId,
                        firstSeenAt: value.firstSeenAt,
                        lastSeenAt: value.lastSeenAt,
                        messageCount: value.messageCount,
                        notes: value.notes.filter(isMemoryNote),
                    });
                    loaded = true;
                }
            }
            if (data.people && typeof data.people === 'object') {
                for (const [key, value] of Object.entries(data.people)) {
                    const record = normalizePerson(key, value);
                    if (record === undefined || inferChannel(record.personId) !== channel)
                        continue;
                    this.people.set(record.personId, record);
                    loaded = true;
                }
            }
            return loaded;
        }
        catch (err) {
            this.debugLog?.(`migrateLegacyMemory failed: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
    }
    write() {
        try {
            mkdirSync(dirname(this.filePath), { recursive: true });
            const data = {
                version: 3,
                chats: Object.fromEntries(this.chats.entries()),
                people: Object.fromEntries(this.people.entries()),
            };
            writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
        }
        catch (err) {
            this.debugLog?.(`writeMemory failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
/** 归一化记忆文本：折叠空白、裁剪首尾标点与空格 */
function normalizeNote(text) {
    return text
        .replace(/\s+/g, ' ')
        .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '')
        .trim()
        .slice(0, MAX_NOTE_TEXT);
}
/** 单值「槽位」：同槽位的新事实覆盖旧事实（搬家、改名、换工作等） */
function factSlot(text) {
    const value = normalizeNote(text);
    if (/^(?:我叫|我的名字|叫我|我的昵称)/.test(value))
        return 'name';
    if (/生日/.test(value))
        return 'birthday';
    if (/(?:住在|来自|老家|家乡|家在|搬到|搬家)/.test(value))
        return 'residence';
    if (/(?:上学|读书|大学|高中|初中|小学|班级)/.test(value))
        return 'school';
    if (/专业/.test(value))
        return 'major';
    if (/(?:上班|工作|职业|公司|打工)/.test(value))
        return 'occupation';
    if (/今年?\s*\d{1,2}\s*岁|\d{1,2}\s*岁了/.test(value))
        return 'age';
    return undefined;
}
/** 字符二元组集合（中文按字，英文按 2-gram），用于近似去重 */
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
function similarity(a, b) {
    const left = bigrams(a);
    const right = bigrams(b);
    if (left.size === 0 || right.size === 0)
        return a === b ? 1 : 0;
    let intersection = 0;
    for (const item of left)
        if (right.has(item))
            intersection += 1;
    return intersection / (left.size + right.size - intersection);
}
/** 写入/合并一条事实，返回受影响的那条；重复且无变化时返回 undefined */
function upsertFact(record, normalized, input, source, sourceChat) {
    const now = Date.now();
    const kind = input.kind ?? classifyFact(normalized);
    const confidence = clamp01(input.confidence ?? (source === 'manual' ? 1 : 0.8));
    // 经历类事实不占「单值槽位」，避免「今天生日/今天工作很累」覆盖资料类事实
    const slot = kind === 'event' ? undefined : factSlot(normalized);
    const same = record.notes.find((note) => {
        const other = normalizeNote(note.text);
        if (other.toLowerCase() === normalized.toLowerCase())
            return true;
        if (slot !== undefined && factSlot(other) === slot)
            return true;
        return similarity(other, normalized) >= DUPLICATE_SIMILARITY;
    });
    if (same !== undefined) {
        const sameText = normalizeNote(same.text);
        const sameSlot = factSlot(sameText);
        if (slot !== undefined && sameSlot === slot && sameText !== normalized) {
            // 单值槽位（姓名/住址/生日/年龄/学校/专业/职业）被更新：新值覆盖旧值
            same.text = normalized.slice(0, MAX_NOTE_TEXT);
            same.kind = kind;
            same.confidence = Math.max(same.confidence ?? 0, confidence);
            same.lastAt = now;
            same.source = source;
            same.sourceChat = sourceChat;
            return same;
        }
        same.lastAt = now;
        same.confidence = Math.max(same.confidence ?? 0, confidence);
        if (source === 'manual')
            same.source = 'manual';
        return undefined;
    }
    const note = {
        text: normalized.slice(0, MAX_NOTE_TEXT),
        at: now,
        lastAt: now,
        kind,
        confidence,
        source,
        ...(sourceChat !== undefined ? { sourceChat } : {}),
        hits: 0,
    };
    record.notes.push(note);
    return note;
}
/** 事实类型启发式（规则抽取时用；LLM 会自己给） */
export function classifyFact(text) {
    if (/(?:喜欢|讨厌|不爱|爱吃|害怕|最怕|爱好)/.test(text))
        return 'preference';
    if (/(?:今天|昨天|明天|最近|刚才|刚刚|下周|上周|上次|那次|去年)/.test(text))
        return 'event';
    return 'profile';
}
function factWeight(note) {
    const confidence = note.confidence ?? 0.5;
    const hits = Math.min((note.hits ?? 0) / 5, 1);
    const ageDays = Math.max(0, (Date.now() - (note.lastAt ?? note.at)) / 86_400_000);
    const recency = Math.exp(-ageDays / 120);
    return 0.5 * confidence + 0.3 * recency + 0.2 * hits;
}
function clamp01(value) {
    if (!Number.isFinite(value))
        return 0.8;
    return Math.min(1, Math.max(0, value));
}
function isMemoryNote(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const note = value;
    return typeof note.text === 'string'
        && typeof note.at === 'number'
        && (note.source === 'auto' || note.source === 'manual' || note.source === 'llm');
}
function isChatMemory(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const record = value;
    return (record.scope === 'c2c' || record.scope === 'group')
        && typeof record.peerId === 'string'
        && typeof record.firstSeenAt === 'number'
        && typeof record.lastSeenAt === 'number'
        && typeof record.messageCount === 'number'
        && Array.isArray(record.notes);
}
/** 兼容 v2（senderId 主键）与 v3（personId 主键） */
function normalizePerson(key, value) {
    if (typeof value !== 'object' || value === null)
        return undefined;
    const record = value;
    const personId = typeof record.personId === 'string' && record.personId !== ''
        ? record.personId
        : typeof record.senderId === 'string' && record.senderId !== ''
            ? record.senderId
            : key;
    if (personId === '')
        return undefined;
    if (typeof record.firstSeenAt !== 'number'
        || typeof record.lastSeenAt !== 'number'
        || typeof record.messageCount !== 'number'
        || !Array.isArray(record.notes))
        return undefined;
    return {
        personId,
        ...(typeof record.senderName === 'string' && record.senderName !== ''
            ? { senderName: record.senderName }
            : {}),
        firstSeenAt: record.firstSeenAt,
        lastSeenAt: record.lastSeenAt,
        messageCount: record.messageCount,
        notes: record.notes.filter(isMemoryNote).map((note) => ({
            ...note,
            kind: note.kind ?? classifyFact(note.text),
            confidence: note.confidence ?? (note.source === 'manual' ? 1 : 0.8),
            lastAt: note.lastAt ?? note.at,
            hits: note.hits ?? 0,
        })),
    };
}
//# sourceMappingURL=memory-store.js.map