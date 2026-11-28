/**
 * IdentityStore — 把「同一个人的多个 QQ 身份」归并成一个人
 *
 * 为什么需要：
 *   - QQ 官方 Bot：私聊是 user_openid，群聊是 member_openid（每个群还各不同）
 *   - OneBot / NapCat：私聊和群聊都是同一个 QQ 号
 * 同一个真人在两套后端、私聊与不同群里的 senderId 完全不同，如果直接拿
 * senderId 当记忆主键，群聊和私聊的记忆永远无法互通。
 *
 * 本模块维护 personId → 别名列表 的映射，持久化在 ~/.dsh-qqbot/identities.json：
 *   - resolve() 按 (channel, senderId) 找到已有 personId，没有则创建
 *   - 绑定码（/memory bind）把两个身份显式归并
 *   - 配置里的 aliases 组在启动时自动归并
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
/** 默认写盘防抖(ms) */
export const IDENTITY_WRITE_DELAY_MS = 300;
/** 绑定码有效期(ms) */
export const BIND_CODE_TTL_MS = 10 * 60 * 1000;
/** 按 id 形状推断通道：纯数字 = OneBot QQ 号，其余 = 官方 openid */
export function inferChannel(senderId) {
    return /^\d+$/.test(senderId.trim()) ? 'onebot' : 'official';
}
function aliasKey(channel, senderId) {
    return `${channel}:${senderId.trim().toUpperCase()}`;
}
export class IdentityStore {
    people = new Map();
    aliasIndex = new Map();
    bindCodes = new Map();
    filePath;
    writeDelayMs;
    debugLog;
    writeTimer;
    constructor(options = {}) {
        this.filePath = options.path ?? resolve(homedir(), '.dsh-qqbot', 'identities.json');
        this.writeDelayMs = Math.max(0, Math.trunc(options.writeDelayMs ?? IDENTITY_WRITE_DELAY_MS));
        this.debugLog = options.debugLog;
        this.load();
    }
    /** 按 (channel, senderId) 解析 personId；不存在时创建 */
    resolve(channel, senderId, senderName, scope = 'c2c', at = Date.now()) {
        const id = senderId.trim();
        if (id === '')
            return '';
        const key = aliasKey(channel, id);
        const existing = this.aliasIndex.get(key);
        if (existing !== undefined) {
            const record = this.people.get(existing);
            if (record !== undefined && senderName !== undefined && senderName !== '' && record.displayName !== senderName) {
                record.displayName = senderName;
                record.updatedAt = at;
                this.scheduleWrite();
            }
            return existing;
        }
        let personId = id;
        let suffix = 1;
        while (this.people.has(personId)) {
            suffix += 1;
            personId = `${id}#${suffix}`;
        }
        const record = {
            personId,
            ...(senderName !== undefined && senderName !== '' ? { displayName: senderName } : {}),
            aliases: [{ channel, scope, senderId: id }],
            createdAt: at,
            updatedAt: at,
        };
        this.people.set(personId, record);
        this.aliasIndex.set(key, personId);
        this.scheduleWrite();
        return personId;
    }
    get(personId) {
        return this.people.get(personId);
    }
    /** 该 personId 是否已存在 */
    has(personId) {
        return this.people.has(personId);
    }
    /** 所有已知 personId（用于迁移 v2 记忆） */
    personIds() {
        return [...this.people.keys()];
    }
    /** 该 senderId 是否已出现在任意通道的别名里 */
    hasSender(senderId) {
        const id = senderId.trim();
        return this.aliasIndex.has(aliasKey('official', id)) || this.aliasIndex.has(aliasKey('onebot', id));
    }
    /**
     * 给某个 person 签发 6 位绑定码（10 分钟有效）。
     * 用户在一个会话里拿到码，再到另一个会话发送 `/memory bind <码>` 即可归并。
     */
    issueBindCode(personId, channel, at = Date.now()) {
        if (!this.people.has(personId))
            return undefined;
        this.pruneCodes(at);
        for (let attempt = 0; attempt < 20; attempt += 1) {
            const code = String(Math.floor(100000 + Math.random() * 900000));
            if (this.bindCodes.has(code))
                continue;
            this.bindCodes.set(code, { personId, channel, expiresAt: at + BIND_CODE_TTL_MS });
            return code;
        }
        return undefined;
    }
    /**
     * 在另一个会话里兑换绑定码：把当前身份挂到码所属的 person 上。
     * 如果当前身份已经属于另一个人，则把那个人整体归并过来。
     */
    redeemBindCode(code, channel, senderId, senderName, scope = 'c2c', at = Date.now()) {
        const normalized = code.trim();
        const pending = this.bindCodes.get(normalized);
        if (pending === undefined)
            return { ok: false, reason: 'invalid' };
        if (pending.expiresAt <= at) {
            this.bindCodes.delete(normalized);
            return { ok: false, reason: 'expired' };
        }
        // 官方侧与 OneBot 侧各自独立存储，绑定码不能跨侧使用（码保留，可在正确一侧兑换）
        if (pending.channel !== channel)
            return { ok: false, reason: 'cross-channel' };
        const targetPersonId = pending.personId;
        if (!this.people.has(targetPersonId)) {
            this.bindCodes.delete(normalized);
            return { ok: false, reason: 'invalid' };
        }
        const sourcePersonId = this.resolve(channel, senderId, senderName, scope, at);
        if (sourcePersonId === '' || sourcePersonId === targetPersonId) {
            this.bindCodes.delete(normalized);
            return { ok: false, reason: 'same' };
        }
        this.bindCodes.delete(normalized);
        this.mergePersons(sourcePersonId, targetPersonId, at);
        return { ok: true, personId: targetPersonId, mergedPersonId: sourcePersonId };
    }
    /**
     * 把 source 的所有别名与资料并入 target，并删除 source。
     * 返回是否真的发生了归并。
     */
    mergePersons(sourcePersonId, targetPersonId, at = Date.now()) {
        if (sourcePersonId === targetPersonId)
            return false;
        const source = this.people.get(sourcePersonId);
        const target = this.people.get(targetPersonId);
        if (source === undefined || target === undefined)
            return false;
        for (const alias of source.aliases) {
            const key = aliasKey(alias.channel, alias.senderId);
            if (this.aliasIndex.get(key) === sourcePersonId)
                this.aliasIndex.set(key, targetPersonId);
            if (!target.aliases.some((a) => aliasKey(a.channel, a.senderId) === key)) {
                target.aliases.push(alias);
            }
        }
        if (target.displayName === undefined && source.displayName !== undefined) {
            target.displayName = source.displayName;
        }
        target.createdAt = Math.min(target.createdAt, source.createdAt);
        target.updatedAt = Math.max(target.updatedAt, source.updatedAt, at);
        this.people.delete(sourcePersonId);
        this.scheduleWrite();
        return true;
    }
    /** 人工别名组：把同一通道内的一组 id 归并到第一个 id 对应的 person */
    linkGroup(channel, ids, at = Date.now()) {
        const cleaned = ids.map((id) => id.trim()).filter((id) => id !== '');
        if (cleaned.length < 2)
            return undefined;
        const targetPersonId = this.resolve(channel, cleaned[0], undefined, 'c2c', at);
        const merged = [];
        for (const id of cleaned.slice(1)) {
            const personId = this.resolve(channel, id, undefined, 'c2c', at);
            if (personId !== '' && personId !== targetPersonId && this.mergePersons(personId, targetPersonId, at)) {
                merged.push(personId);
            }
        }
        return { targetPersonId, mergedPersonIds: merged };
    }
    /** v2 记忆迁移：为只存在于记忆文件里的旧 personId 补一条本通道别名 */
    adoptExisting(personIds, channel, at = Date.now()) {
        for (const raw of personIds) {
            const id = raw.trim();
            if (id === '' || this.hasSender(id))
                continue;
            this.resolve(channel, id, undefined, 'c2c', at);
        }
    }
    flush() {
        if (this.writeTimer !== undefined) {
            clearTimeout(this.writeTimer);
            this.writeTimer = undefined;
        }
        this.write();
    }
    pruneCodes(at) {
        for (const [code, pending] of this.bindCodes) {
            if (pending.expiresAt <= at)
                this.bindCodes.delete(code);
        }
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
            if (!data.people || typeof data.people !== 'object')
                return;
            for (const [key, value] of Object.entries(data.people)) {
                const record = normalizeRecord(key, value);
                if (record === undefined)
                    continue;
                this.people.set(record.personId, record);
                for (const alias of record.aliases) {
                    this.aliasIndex.set(aliasKey(alias.channel, alias.senderId), record.personId);
                }
            }
        }
        catch (err) {
            this.debugLog?.(`loadIdentities failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    write() {
        try {
            mkdirSync(dirname(this.filePath), { recursive: true });
            const data = {
                version: 1,
                people: Object.fromEntries(this.people.entries()),
            };
            writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
        }
        catch (err) {
            this.debugLog?.(`writeIdentities failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
function normalizeRecord(key, value) {
    if (typeof value !== 'object' || value === null)
        return undefined;
    const record = value;
    const personId = typeof record.personId === 'string' && record.personId !== '' ? record.personId : key;
    if (personId === '')
        return undefined;
    const aliases = Array.isArray(record.aliases)
        ? record.aliases.filter((alias) => {
            if (typeof alias !== 'object' || alias === null)
                return false;
            const item = alias;
            return (item.channel === 'official' || item.channel === 'onebot')
                && (item.scope === 'c2c' || item.scope === 'group')
                && typeof item.senderId === 'string'
                && item.senderId !== '';
        })
        : [];
    return {
        personId,
        ...(typeof record.displayName === 'string' && record.displayName !== ''
            ? { displayName: record.displayName }
            : {}),
        aliases,
        createdAt: typeof record.createdAt === 'number' ? record.createdAt : Date.now(),
        updatedAt: typeof record.updatedAt === 'number' ? record.updatedAt : Date.now(),
    };
}
//# sourceMappingURL=identity-store.js.map