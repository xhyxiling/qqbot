/**
 * 群聊人格档案 — 人格分析的数据底座
 *
 * 入站的 `historyBuffer` 只保留最近 N 条，而且每次回复后都会清空，
 * 无法支撑「根据长期对话总结群友人格」。本模块把群聊/私聊消息滚动写入
 * `~/.dsh-qqbot/persona-archive.json`：
 *
 * - 按会话（`qqbot:${appId}:${scope}:${peerId}`）保存最近的 maxMessages 条；
 * - 超过 retentionDays 天的条目在加载与追加时清理；
 * - 同一 messageId 只写一次，避免中间件重放导致重复；
 * - 写盘合并成 1s 防抖，避免群聊高峰期每条消息都重写整个文件。
 *
 * 档案只在本机使用，不会发送给模型以外的任何地方；关闭
 * `personaAnalysis.enabled` 后中间件不再记录新消息（已有档案保留）。
 *
 * 采集边界（决定能记录到多少）：QQ 官方只向**普通群机器人**推送
 * `GROUP_AT_MESSAGE_CREATE`（被 @ 的群消息），群友没 @ 机器人的发言平台根本
 * 不下发；只有私域 / 开通「全量群消息」的机器人才会额外推送
 * `GROUP_MESSAGE_CREATE`。档案中间件本身两种事件都记录，不做 @ 过滤，
 * 因此「记录不全」几乎总是平台下发范围的问题。`stats()` 暴露的
 * `eventTypes` / `groupFullMessages` 就是给用户确认这一点的诊断依据。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
/** 群内全量消息事件（只有私域 / 开通全量权限的机器人能收到） */
export const GROUP_FULL_MESSAGE_EVENT = 'GROUP_MESSAGE_CREATE';
/** 每个会话默认保留的消息条数 */
export const DEFAULT_ARCHIVE_MAX_MESSAGES = 300;
/** 默认保留天数 */
export const DEFAULT_ARCHIVE_RETENTION_DAYS = 30;
/** 单条消息归档时的最大字符数（超长截断，避免文件与 prompt 被灌爆） */
export const ARCHIVE_MAX_CONTENT_CHARS = 1000;
/** 默认写盘防抖时长(ms) */
export const ARCHIVE_WRITE_DELAY_MS = 1000;
/** 档案会话 key（与 SessionManager 的 sessionKey 同构） */
export function personaArchiveKey(appId, scope, peerId) {
    return `qqbot:${appId}:${scope}:${peerId}`;
}
/**
 * 清洗归档文本：去掉 @ 标记、表情标签与 CQ 码，折叠空白后截断。
 *
 * 入站中间件在 @ 门控之前记录，此时 `contentSanitizer` 还没运行，
 * 因此这里自己兜一层，避免把 `<@!123>` 之类写进档案。
 */
export function cleanArchiveText(raw) {
    return (raw ?? '')
        .replace(/<@!?[^>]*>/g, ' ')
        .replace(/\[<face[^>]*>\]/gi, ' ')
        .replace(/\[CQ:[^\]]+\]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, ARCHIVE_MAX_CONTENT_CHARS);
}
/** 时间戳是否在保留期内 */
function isFresh(timestamp, cutoff) {
    return Number.isFinite(timestamp) && timestamp >= cutoff;
}
/** 校验读取到的条目（损坏文件按空处理，不让插件启动失败） */
function isArchivedMessage(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const entry = value;
    return typeof entry.senderId === 'string'
        && entry.senderId !== ''
        && typeof entry.content === 'string'
        && entry.content !== ''
        && typeof entry.timestamp === 'number'
        && Number.isFinite(entry.timestamp);
}
export class PersonaArchive {
    chats = new Map();
    /** 入站事件类型计数（诊断平台下发范围） */
    eventTypes = new Map();
    /** 跳过计数（诊断为什么没记上） */
    skippedCounts = new Map();
    filePath;
    maxMessages;
    retentionDays;
    writeDelayMs;
    now;
    debugLog;
    writeTimer;
    constructor(options = {}) {
        this.filePath = options.path ?? resolve(homedir(), '.dsh-qqbot', 'persona-archive.json');
        this.maxMessages = Math.min(1000, Math.max(1, Math.trunc(options.maxMessages ?? DEFAULT_ARCHIVE_MAX_MESSAGES)));
        this.retentionDays = Math.min(365, Math.max(1, Math.trunc(options.retentionDays ?? DEFAULT_ARCHIVE_RETENTION_DAYS)));
        this.writeDelayMs = Math.max(0, Math.trunc(options.writeDelayMs ?? ARCHIVE_WRITE_DELAY_MS));
        this.now = options.now ?? Date.now;
        this.debugLog = options.debugLog;
        this.load();
    }
    /** 追加一条消息；空内容、重复 messageId、超期条目会被跳过或清理；返回是否新增 */
    append(chatKey, entry) {
        const content = cleanArchiveText(entry.content);
        if (content === '')
            return false;
        const cutoff = this.cutoff();
        const list = (this.chats.get(chatKey) ?? []).filter((item) => isFresh(item.timestamp, cutoff));
        // 同一 messageId 只记一次：SDK 重连/重放可能让同一消息再次入站
        const messageId = entry.messageId?.trim();
        if (messageId !== undefined && messageId !== ''
            && list.some((item) => item.messageId === messageId)) {
            this.chats.set(chatKey, list);
            return false;
        }
        const senderName = entry.senderName?.trim();
        list.push({
            senderId: entry.senderId,
            ...(senderName !== undefined && senderName !== '' ? { senderName } : {}),
            content,
            timestamp: entry.timestamp,
            ...(messageId !== undefined && messageId !== '' ? { messageId } : {}),
        });
        if (list.length > this.maxMessages)
            list.splice(0, list.length - this.maxMessages);
        this.chats.set(chatKey, list);
        this.scheduleWrite();
        return true;
    }
    /** 读取某个会话的归档（旧 → 新）；limit 缺省返回全部 */
    list(chatKey, limit) {
        const list = this.chats.get(chatKey) ?? [];
        const count = limit === undefined ? list.length : Math.max(0, Math.trunc(limit));
        return list.slice(Math.max(0, list.length - count)).map((item) => ({ ...item }));
    }
    /** 按发送者过滤 */
    listBySender(chatKey, senderId, limit) {
        return this.list(chatKey, limit).filter((item) => item.senderId === senderId);
    }
    /** 会话内的发送者统计（按消息数降序） */
    members(chatKey) {
        const buckets = new Map();
        for (const entry of this.chats.get(chatKey) ?? []) {
            const existing = buckets.get(entry.senderId);
            if (existing === undefined) {
                buckets.set(entry.senderId, {
                    senderId: entry.senderId,
                    ...(entry.senderName !== undefined ? { senderName: entry.senderName } : {}),
                    count: 1,
                    firstAt: entry.timestamp,
                    lastAt: entry.timestamp,
                });
                continue;
            }
            existing.count += 1;
            existing.firstAt = Math.min(existing.firstAt, entry.timestamp);
            existing.lastAt = Math.max(existing.lastAt, entry.timestamp);
            if (existing.senderName === undefined && entry.senderName !== undefined) {
                existing.senderName = entry.senderName;
            }
        }
        return [...buckets.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
    }
    /** 所有已归档会话的 key（跨群聚合时用） */
    chatKeys() {
        return [...this.chats.keys()];
    }
    /**
     * 跨会话的发送者统计：同一 openid 出现在多个群/私聊时合并计数。
     *
     * 说明：openid 由平台下发，实测同一个人私聊与群聊拿到的是同一个 openid，
     * 因此会自然合并成一行；若某个群下发的 openid 不同则单独成档，
     * 不按昵称猜测合并（避免把两个同名群友合成一个人）。
     */
    membersAll() {
        const buckets = new Map();
        for (const [chatKey, list] of this.chats) {
            for (const entry of list) {
                let summary = buckets.get(entry.senderId);
                if (summary === undefined) {
                    summary = {
                        senderId: entry.senderId,
                        ...(entry.senderName !== undefined ? { senderName: entry.senderName } : {}),
                        count: 0,
                        firstAt: entry.timestamp,
                        lastAt: entry.timestamp,
                        chats: [],
                    };
                    buckets.set(entry.senderId, summary);
                }
                summary.count += 1;
                summary.firstAt = Math.min(summary.firstAt, entry.timestamp);
                summary.lastAt = Math.max(summary.lastAt, entry.timestamp);
                if (entry.senderName !== undefined && entry.senderName !== '') {
                    summary.senderName = entry.senderName;
                }
                const chat = summary.chats.find((item) => item.chatKey === chatKey);
                if (chat === undefined) {
                    summary.chats.push({
                        chatKey,
                        count: 1,
                        firstAt: entry.timestamp,
                        lastAt: entry.timestamp,
                    });
                }
                else {
                    chat.count += 1;
                    chat.firstAt = Math.min(chat.firstAt, entry.timestamp);
                    chat.lastAt = Math.max(chat.lastAt, entry.timestamp);
                }
            }
        }
        for (const summary of buckets.values()) {
            summary.chats.sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
        }
        return [...buckets.values()].sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
    }
    /** 发送者在所有会话里的消息总量（自动分析门槛判断用） */
    countBySender(senderId) {
        let count = 0;
        for (const list of this.chats.values()) {
            for (const entry of list) {
                if (entry.senderId === senderId)
                    count += 1;
            }
        }
        return count;
    }
    /** 发送者出现过的会话及其消息（按条数降序） */
    chatsForSender(senderId) {
        const chats = [];
        for (const [chatKey, list] of this.chats) {
            let count = 0;
            let firstAt = Number.POSITIVE_INFINITY;
            let lastAt = 0;
            for (const entry of list) {
                if (entry.senderId !== senderId)
                    continue;
                count += 1;
                firstAt = Math.min(firstAt, entry.timestamp);
                lastAt = Math.max(lastAt, entry.timestamp);
            }
            if (count > 0)
                chats.push({ chatKey, count, firstAt, lastAt });
        }
        return chats.sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
    }
    /**
     * 记录一次入站事件类型（诊断用）。
     *
     * 普通群机器人只会收到 `GROUP_AT_MESSAGE_CREATE`；这里把所有到达的事件
     * 都累计下来，面板才能明确区分「平台没下发」与「插件没记」。
     */
    noteEvent(eventType) {
        const type = eventType?.trim();
        if (type === undefined || type === '')
            return;
        this.eventTypes.set(type, (this.eventTypes.get(type) ?? 0) + 1);
        this.scheduleWrite();
    }
    /** 记录一条被跳过的消息（诊断用，不写正文） */
    noteSkip(reason) {
        this.skippedCounts.set(reason, (this.skippedCounts.get(reason) ?? 0) + 1);
        this.scheduleWrite();
    }
    /** 采集统计：面板展示「已归档多少、平台下发过什么」 */
    stats() {
        let messageCount = 0;
        let lastArchivedAt;
        const members = new Set();
        for (const list of this.chats.values()) {
            messageCount += list.length;
            for (const entry of list) {
                members.add(entry.senderId);
                if (lastArchivedAt === undefined || entry.timestamp > lastArchivedAt) {
                    lastArchivedAt = entry.timestamp;
                }
            }
        }
        return {
            chatCount: this.chats.size,
            messageCount,
            memberCount: members.size,
            ...(lastArchivedAt !== undefined ? { lastArchivedAt } : {}),
            eventTypes: Object.fromEntries([...this.eventTypes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
            groupFullMessages: (this.eventTypes.get(GROUP_FULL_MESSAGE_EVENT) ?? 0) > 0,
            skipped: {
                bot: this.skippedCounts.get('bot') ?? 0,
                slashCommand: this.skippedCounts.get('slashCommand') ?? 0,
                empty: this.skippedCounts.get('empty') ?? 0,
                other: this.skippedCounts.get('other') ?? 0,
            },
        };
    }
    /** 清空某个会话的归档 */
    clear(chatKey) {
        if (!this.chats.delete(chatKey))
            return;
        this.scheduleWrite();
    }
    /** 立即落盘（退出前/测试用） */
    flush() {
        if (this.writeTimer !== undefined) {
            clearTimeout(this.writeTimer);
            this.writeTimer = undefined;
        }
        this.write();
    }
    cutoff() {
        return this.now() - this.retentionDays * 24 * 60 * 60 * 1000;
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
        // 不让防抖定时器拖住进程退出；未落盘的最后 1s 消息可接受丢失
        this.writeTimer.unref?.();
    }
    load() {
        try {
            if (!existsSync(this.filePath))
                return;
            const data = JSON.parse(readFileSync(this.filePath, 'utf8'));
            if (data.version !== 1 || typeof data.chats !== 'object' || data.chats === null)
                return;
            this.loadCapture(data.capture);
            const cutoff = this.cutoff();
            for (const [chatKey, value] of Object.entries(data.chats)) {
                if (!Array.isArray(value))
                    continue;
                const list = value
                    .filter(isArchivedMessage)
                    .filter((item) => isFresh(item.timestamp, cutoff))
                    .map((item) => ({
                    senderId: item.senderId,
                    ...(item.senderName !== undefined ? { senderName: item.senderName } : {}),
                    content: cleanArchiveText(item.content),
                    timestamp: item.timestamp,
                    ...(item.messageId !== undefined ? { messageId: item.messageId } : {}),
                }))
                    .filter((item) => item.content !== '')
                    .slice(-this.maxMessages);
                if (list.length > 0)
                    this.chats.set(chatKey, list);
            }
        }
        catch (err) {
            this.debugLog?.(`loadPersonaArchive failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    /** 恢复上次进程的采集统计（损坏字段忽略） */
    loadCapture(capture) {
        if (typeof capture !== 'object' || capture === null)
            return;
        for (const [key, value] of Object.entries(capture.eventTypes ?? {})) {
            if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
                continue;
            this.eventTypes.set(key, Math.trunc(value));
        }
        for (const key of ['bot', 'slashCommand', 'empty', 'other']) {
            const value = capture.skipped?.[key];
            if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
                continue;
            this.skippedCounts.set(key, Math.trunc(value));
        }
    }
    write() {
        try {
            mkdirSync(dirname(this.filePath), { recursive: true });
            const data = {
                version: 1,
                chats: Object.fromEntries(this.chats.entries()),
                capture: {
                    eventTypes: Object.fromEntries(this.eventTypes.entries()),
                    skipped: Object.fromEntries(this.skippedCounts.entries()),
                },
            };
            writeFileSync(this.filePath, JSON.stringify(data), 'utf8');
        }
        catch (err) {
            this.debugLog?.(`writePersonaArchive failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
/** 斜杠命令不进入人格档案：它们不是自然语言发言，容易污染风格总结 */
const SLASH_COMMAND_PATTERN = /^\/[^\s/]/;
/**
 * 构造归档中间件：放在 @ 门控之前，未 @bot 的群聊消息也会被记录；
 * 放在访问控制之后，被拒绝的群/用户不会写盘。
 *
 * 注意：中间件能否真正拿到「未 @ 的群消息」取决于平台下发范围——普通群机器人
 * 只会收到 `GROUP_AT_MESSAGE_CREATE`。这里不做任何 @ 过滤，并把每个入站事件
 * 类型与跳过原因记进档案统计，供 `/人格分析` 与设置面板明确告知用户。
 *
 * @param onArchived - 新消息真正写入后的通知；必须同步返回，不能阻塞消息链
 */
export function createPersonaArchiveMiddleware(config, archive, logger, onArchived) {
    return (ctx, next) => {
        try {
            const msg = ctx.message;
            const eventType = msg.rawEventType;
            archive.noteEvent(eventType);
            const skip = (reason) => {
                archive.noteSkip(reason);
                logger.debug?.(`im-qqbot: 档案跳过消息 (reason=${reason}, event=${eventType ?? 'unknown'})`);
            };
            if (msg.senderIsBot === true) {
                skip('bot');
                return next();
            }
            if (msg.kind !== 'group' && msg.kind !== 'c2c') {
                skip('other');
                return next();
            }
            const content = cleanArchiveText(msg.content);
            if (content === '') {
                skip('empty');
                return next();
            }
            if (SLASH_COMMAND_PATTERN.test(content)) {
                skip('slashCommand');
                return next();
            }
            const scope = msg.kind === 'group' ? 'group' : 'c2c';
            const peerId = scope === 'group' ? (msg.groupOpenid ?? msg.senderId) : msg.senderId;
            if (!peerId || !msg.senderId) {
                skip('other');
                return next();
            }
            const chatKey = personaArchiveKey(config.appId, scope, peerId);
            const added = archive.append(chatKey, {
                senderId: msg.senderId,
                ...(msg.senderName !== undefined ? { senderName: msg.senderName } : {}),
                content,
                timestamp: Date.now(),
                ...(msg.messageId !== undefined ? { messageId: msg.messageId } : {}),
            });
            if (added) {
                onArchived?.({
                    chatKey,
                    senderId: msg.senderId,
                    ...(msg.senderName !== undefined ? { senderName: msg.senderName } : {}),
                    scope,
                    peerId,
                });
            }
        }
        catch (err) {
            // 归档/通知失败不能影响正常消息处理
            logger.debug?.(`im-qqbot: 群聊档案写入失败: ${err instanceof Error ? err.message : String(err)}`);
        }
        return next();
    };
}
// ── 共享实例 ──
// 设置面板的路由和网关在同一进程里，需要读取同一份档案；重复 new 会让
// 两个实例各自持有内存副本并互相覆盖写盘。测试直接 new PersonaArchive，
// 不经过这里。
let sharedArchive;
let sharedArchiveKey = '';
/** 取进程内共享档案（配置变化时替换；替换前落盘旧实例） */
export function getPersonaArchive(options = {}) {
    const key = [
        options.path ?? 'default',
        options.maxMessages ?? DEFAULT_ARCHIVE_MAX_MESSAGES,
        options.retentionDays ?? DEFAULT_ARCHIVE_RETENTION_DAYS,
        options.writeDelayMs ?? ARCHIVE_WRITE_DELAY_MS,
    ].join('|');
    if (sharedArchive === undefined || key !== sharedArchiveKey) {
        sharedArchive?.flush();
        sharedArchive = new PersonaArchive(options);
        sharedArchiveKey = key;
    }
    return sharedArchive;
}
/** 测试用：替换/清空共享实例（传 undefined 表示下次重新创建） */
export function setPersonaArchiveForTests(archive) {
    sharedArchive?.flush();
    sharedArchive = archive;
    sharedArchiveKey = archive === undefined ? '' : 'test';
}
//# sourceMappingURL=persona-archive.js.map