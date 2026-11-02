/**
 * 群友人格档案存储 — 自动分析结果 + 设置面板表格视图
 *
 * 消息本身仍由 `persona-archive.ts` 按会话保存；这里只存「分析结果」，
 * 避免每条消息都写第二份数据。视图层把档案里的跨会话计数与分析结果合并，
 * 供设置面板按昵称 / openid / 性格特点筛选。
 *
 * 数据落在 `~/.dsh-qqbot/persona-profiles.json`，只在本机使用。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { getPersonaArchive, } from "./persona-archive.js";
/** 默认写盘防抖(ms) */
export const PROFILE_WRITE_DELAY_MS = 1000;
/** 设置面板一页最多返回多少行 */
export const PROFILE_LIST_MAX_LIMIT = 200;
/** 校验读取到的分析结果（损坏文件按空处理） */
function isAnalysis(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const analysis = value;
    return typeof analysis.summary === 'string'
        && Array.isArray(analysis.traits)
        && typeof analysis.style === 'string';
}
/** 校验读取到的档案 */
function isStoredProfile(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const profile = value;
    return typeof profile.senderId === 'string'
        && profile.senderId !== ''
        && typeof profile.analyzedMessageCount === 'number'
        && Number.isFinite(profile.analyzedMessageCount)
        && (profile.analysis === undefined || isAnalysis(profile.analysis));
}
export class PersonaProfileStore {
    profiles = new Map();
    filePath;
    writeDelayMs;
    debugLog;
    writeTimer;
    constructor(options = {}) {
        this.filePath = options.path ?? resolve(homedir(), '.dsh-qqbot', 'persona-profiles.json');
        this.writeDelayMs = Math.max(0, Math.trunc(options.writeDelayMs ?? PROFILE_WRITE_DELAY_MS));
        this.debugLog = options.debugLog;
        this.load();
    }
    get(senderId) {
        const profile = this.profiles.get(senderId);
        return profile === undefined ? undefined : cloneProfile(profile);
    }
    list() {
        return [...this.profiles.values()]
            .map(cloneProfile)
            .sort((a, b) => (Number(b.analysis !== undefined) - Number(a.analysis !== undefined))
            || (b.analyzedAt ?? 0) - (a.analyzedAt ?? 0)
            || b.updatedAt - a.updatedAt);
    }
    /** 写入成功分析结果（保留旧结果覆盖失败状态） */
    upsert(profile) {
        const previous = this.profiles.get(profile.senderId);
        const senderName = profile.senderName?.trim();
        this.profiles.set(profile.senderId, {
            senderId: profile.senderId,
            ...(senderName !== undefined && senderName !== ''
                ? { senderName }
                : previous?.senderName !== undefined ? { senderName: previous.senderName } : {}),
            analysis: profile.analysis,
            analyzedMessageCount: profile.analyzedMessageCount,
            analyzedChatCount: profile.analyzedChatCount,
            analyzedAt: profile.analyzedAt,
            provider: profile.provider,
            model: profile.model,
            ...(profile.lastAttemptAt !== undefined ? { lastAttemptAt: profile.lastAttemptAt } : {}),
            updatedAt: Date.now(),
        });
        this.scheduleWrite();
    }
    /** 记录一次分析尝试（失败时写入原因；成功后由 upsert 清空） */
    markAttempt(senderId, at, error) {
        const previous = this.profiles.get(senderId);
        const base = previous ?? {
            senderId,
            analyzedMessageCount: 0,
            analyzedChatCount: 0,
            updatedAt: at,
        };
        this.profiles.set(senderId, {
            ...base,
            lastAttemptAt: at,
            ...(error !== undefined && error !== ''
                ? { lastError: error.slice(0, 300) }
                : { lastError: undefined }),
            updatedAt: at,
        });
        // 清空 lastError 时用 delete，避免 JSON 里留下 undefined 键
        const saved = this.profiles.get(senderId);
        if (error === undefined || error === '')
            delete saved.lastError;
        this.scheduleWrite();
    }
    /** 更新展示昵称（消息里出现新昵称时） */
    touchName(senderId, senderName) {
        const name = senderName?.trim();
        if (name === undefined || name === '')
            return;
        const previous = this.profiles.get(senderId);
        if (previous === undefined || previous.senderName === name)
            return;
        this.profiles.set(senderId, { ...previous, senderName: name, updatedAt: Date.now() });
        this.scheduleWrite();
    }
    remove(senderId) {
        if (!this.profiles.delete(senderId))
            return false;
        this.scheduleWrite();
        return true;
    }
    flush() {
        if (this.writeTimer !== undefined) {
            clearTimeout(this.writeTimer);
            this.writeTimer = undefined;
        }
        this.write();
    }
    scheduleWrite() {
        if (this.writeDelayMs === 0) {
            this.write();
            return;
        }
        if (this.writeTimer !== undefined)
            return;
        this.writeTimer = setTimeout(() => {
            this.writeTimer = undefined;
            this.write();
        }, this.writeDelayMs);
        this.writeTimer.unref?.();
    }
    load() {
        try {
            if (!existsSync(this.filePath))
                return;
            const data = JSON.parse(readFileSync(this.filePath, 'utf8'));
            if (data.version !== 1 || typeof data.profiles !== 'object' || data.profiles === null)
                return;
            for (const [senderId, value] of Object.entries(data.profiles)) {
                if (!isStoredProfile(value))
                    continue;
                this.profiles.set(senderId, cloneProfile(value));
            }
        }
        catch (err) {
            this.debugLog?.(`loadPersonaProfiles failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    write() {
        try {
            mkdirSync(dirname(this.filePath), { recursive: true });
            const data = { version: 1, profiles: Object.fromEntries(this.profiles.entries()) };
            writeFileSync(this.filePath, JSON.stringify(data), 'utf8');
        }
        catch (err) {
            this.debugLog?.(`writePersonaProfiles failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
function cloneProfile(profile) {
    return {
        ...profile,
        ...(profile.analysis !== undefined
            ? {
                analysis: {
                    ...profile.analysis,
                    traits: [...profile.analysis.traits],
                    catchphrases: [...profile.analysis.catchphrases],
                    interests: [...profile.analysis.interests],
                },
            }
            : {}),
    };
}
// ── 共享实例 ──
let sharedStore;
/** 取进程内共享存储（路由与自动分析共用，避免两个实例互相覆盖写盘） */
export function getPersonaProfileStore(options = {}) {
    sharedStore ??= new PersonaProfileStore(options);
    return sharedStore;
}
/** 测试用：替换/清空共享实例 */
export function setPersonaProfileStoreForTests(store) {
    sharedStore?.flush();
    sharedStore = store;
}
/** 默认自动分析门槛（与配置默认值保持一致） */
const DEFAULT_AUTO_THRESHOLD = 20;
/**
 * 合并「档案统计」与「分析结果」，生成设置面板的行。
 *
 * 只出现在分析结果里（档案已被清理）的人也会保留一行，避免历史分析丢失。
 */
export function listPersonaProfileViews(config, query = {}, options = {}) {
    const archiveOptions = {
        ...(config.personaAnalysis?.maxMessages !== undefined
            ? { maxMessages: config.personaAnalysis.maxMessages }
            : {}),
        ...(config.personaAnalysis?.retentionDays !== undefined
            ? { retentionDays: config.personaAnalysis.retentionDays }
            : {}),
    };
    const archive = options.archive
        ?? (config.personaAnalysis?.enabled !== false ? getPersonaArchive(archiveOptions) : undefined);
    const store = options.store ?? getPersonaProfileStore();
    const stats = new Map();
    for (const member of archive?.membersAll() ?? [])
        stats.set(member.senderId, member);
    const stored = new Map();
    for (const profile of store.list())
        stored.set(profile.senderId, profile);
    const senderIds = new Set([...stats.keys(), ...stored.keys()]);
    const threshold = Math.max(1, Math.trunc(config.personaAnalysis?.autoAnalyzeThreshold ?? DEFAULT_AUTO_THRESHOLD));
    const autoEnabled = config.personaAnalysis?.autoAnalyze !== false;
    const views = [];
    for (const senderId of senderIds) {
        const member = stats.get(senderId);
        const profile = stored.get(senderId);
        const messageCount = member?.count ?? profile?.analyzedMessageCount ?? 0;
        const chats = (member?.chats ?? []).map((chat) => {
            const parsed = parseChatKey(chat.chatKey);
            return {
                chatKey: chat.chatKey,
                scope: parsed.scope,
                peerId: parsed.peerId,
                messageCount: chat.count,
                firstAt: chat.firstAt,
                lastAt: chat.lastAt,
            };
        });
        const senderName = member?.senderName ?? profile?.senderName;
        const covered = profile?.analyzedMessageCount ?? 0;
        const pending = autoEnabled && messageCount >= threshold && (profile?.analysis === undefined
            || messageCount - covered >= threshold);
        views.push({
            senderId,
            ...(senderName !== undefined ? { senderName } : {}),
            messageCount,
            chatCount: chats.length > 0 ? chats.length : (profile?.analyzedChatCount ?? 0),
            chats,
            ...(member !== undefined ? { firstAt: member.firstAt, lastAt: member.lastAt } : {}),
            ...(profile?.analysis !== undefined
                ? {
                    summary: profile.analysis.summary,
                    traits: [...profile.analysis.traits],
                    style: profile.analysis.style,
                    catchphrases: [...profile.analysis.catchphrases],
                    interests: [...profile.analysis.interests],
                    role: profile.analysis.role,
                    advice: profile.analysis.advice,
                    confidence: profile.analysis.confidence,
                    analyzedAt: profile.analyzedAt,
                    analyzedMessageCount: profile.analyzedMessageCount,
                    provider: profile.provider,
                    model: profile.model,
                }
                : { traits: [], catchphrases: [], interests: [] }),
            ...(profile?.lastError !== undefined ? { lastError: profile.lastError } : {}),
            pending,
        });
    }
    const nameNeedle = query.name?.trim().toLowerCase() ?? '';
    const openidNeedle = query.openid?.trim().toLowerCase() ?? '';
    const traitNeedle = query.trait?.trim().toLowerCase() ?? '';
    const filtered = views.filter((view) => {
        if (nameNeedle !== '' && !(view.senderName ?? '').toLowerCase().includes(nameNeedle))
            return false;
        if (openidNeedle !== '' && !view.senderId.toLowerCase().includes(openidNeedle))
            return false;
        if (traitNeedle !== '') {
            const haystack = [
                ...view.traits,
                view.summary ?? '',
                view.style ?? '',
                view.role ?? '',
                ...view.interests,
            ].join(' ').toLowerCase();
            if (!haystack.includes(traitNeedle))
                return false;
        }
        return true;
    });
    filtered.sort((a, b) => (b.pending ? 1 : 0) - (a.pending ? 1 : 0)
        || b.messageCount - a.messageCount
        || (b.lastAt ?? 0) - (a.lastAt ?? 0));
    const offset = Math.max(0, Math.trunc(query.offset ?? 0));
    const limit = Math.min(PROFILE_LIST_MAX_LIMIT, Math.max(1, Math.trunc(query.limit ?? PROFILE_LIST_MAX_LIMIT)));
    return {
        ok: true,
        total: filtered.length,
        profiles: filtered.slice(offset, offset + limit),
        // 采集统计（含各事件类型次数）：面板据此解释「只记录到 @ 消息」的原因
        ...(archive !== undefined ? { archive: archive.stats() } : {}),
    };
}
/** 从 `qqbot:${appId}:${scope}:${peerId}` 解析 scope/peerId；peerId 里可能有冒号，走后缀 */
export function parseChatKey(chatKey) {
    const parts = chatKey.split(':');
    if (parts.length >= 4) {
        const scope = parts[2];
        const peerId = parts.slice(3).join(':');
        return { scope: scope === 'group' ? 'group' : 'c2c', peerId };
    }
    return { scope: 'group', peerId: chatKey };
}
//# sourceMappingURL=persona-profiles.js.map