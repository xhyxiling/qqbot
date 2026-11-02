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
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { Middleware } from '@tencent-connect/qqbot-nodejs';
import type { ImQQBotConfig } from '../config.ts';
import type { ChatScope, Logger } from '../types.ts';

/** 一条归档消息 */
export interface ArchivedMessage {
  /** 发送者 openid */
  senderId: string;
  /** 发送者昵称（平台未提供时缺省） */
  senderName?: string;
  /** 纯文本内容（已清洗、已截断） */
  content: string;
  /** 归档时间（毫秒） */
  timestamp: number;
  /** 平台消息 id（用于去重） */
  messageId?: string;
}

/** 某个发送者在归档里的统计 */
export interface ArchiveMemberStats {
  senderId: string;
  senderName?: string;
  /** 消息条数 */
  count: number;
  /** 最早一条的时间 */
  firstAt: number;
  /** 最新一条的时间 */
  lastAt: number;
}

/** 发送者在一个会话里的分项统计 */
export interface ArchiveMemberChat {
  chatKey: string;
  count: number;
  firstAt: number;
  lastAt: number;
}

/** 发送者跨会话的汇总统计（同一 openid 在多个群/私聊里的发言） */
export interface ArchiveMemberSummary extends ArchiveMemberStats {
  chats: ArchiveMemberChat[];
}

/** 档案文件结构 */
interface ArchiveFile {
  version: 1;
  chats: Record<string, ArchivedMessage[]>;
}

/** 每个会话默认保留的消息条数 */
export const DEFAULT_ARCHIVE_MAX_MESSAGES = 300;
/** 默认保留天数 */
export const DEFAULT_ARCHIVE_RETENTION_DAYS = 30;
/** 单条消息归档时的最大字符数（超长截断，避免文件与 prompt 被灌爆） */
export const ARCHIVE_MAX_CONTENT_CHARS = 1000;
/** 默认写盘防抖时长(ms) */
export const ARCHIVE_WRITE_DELAY_MS = 1000;

/** 档案构造参数 */
export interface PersonaArchiveOptions {
  /** 档案文件路径（缺省 ~/.dsh-qqbot/persona-archive.json） */
  path?: string;
  /** 每个会话最多保留条数（缺省 300） */
  maxMessages?: number;
  /** 保留天数（缺省 30） */
  retentionDays?: number;
  /** 写盘防抖(ms)；0 = 每次追加都立即写盘（测试友好） */
  writeDelayMs?: number;
  /** 当前时间函数（测试注入） */
  now?: () => number;
  /** 内部错误日志（不打断消息处理） */
  debugLog?: (msg: string) => void;
}

/** 档案会话 key（与 SessionManager 的 sessionKey 同构） */
export function personaArchiveKey(appId: string, scope: ChatScope, peerId: string): string {
  return `qqbot:${appId}:${scope}:${peerId}`;
}

/**
 * 清洗归档文本：去掉 @ 标记、表情标签与 CQ 码，折叠空白后截断。
 *
 * 入站中间件在 @ 门控之前记录，此时 `contentSanitizer` 还没运行，
 * 因此这里自己兜一层，避免把 `<@!123>` 之类写进档案。
 */
export function cleanArchiveText(raw: string | undefined): string {
  return (raw ?? '')
    .replace(/<@!?[^>]*>/g, ' ')
    .replace(/\[<face[^>]*>\]/gi, ' ')
    .replace(/\[CQ:[^\]]+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ARCHIVE_MAX_CONTENT_CHARS);
}

/** 时间戳是否在保留期内 */
function isFresh(timestamp: number, cutoff: number): boolean {
  return Number.isFinite(timestamp) && timestamp >= cutoff;
}

/** 校验读取到的条目（损坏文件按空处理，不让插件启动失败） */
function isArchivedMessage(value: unknown): value is ArchivedMessage {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<ArchivedMessage>;
  return typeof entry.senderId === 'string'
    && entry.senderId !== ''
    && typeof entry.content === 'string'
    && entry.content !== ''
    && typeof entry.timestamp === 'number'
    && Number.isFinite(entry.timestamp);
}

export class PersonaArchive {
  private readonly chats = new Map<string, ArchivedMessage[]>();
  private readonly filePath: string;
  private readonly maxMessages: number;
  private readonly retentionDays: number;
  private readonly writeDelayMs: number;
  private readonly now: () => number;
  private readonly debugLog?: (msg: string) => void;
  private writeTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: PersonaArchiveOptions = {}) {
    this.filePath = options.path ?? resolve(homedir(), '.dsh-qqbot', 'persona-archive.json');
    this.maxMessages = Math.min(1000, Math.max(1, Math.trunc(options.maxMessages ?? DEFAULT_ARCHIVE_MAX_MESSAGES)));
    this.retentionDays = Math.min(365, Math.max(1, Math.trunc(options.retentionDays ?? DEFAULT_ARCHIVE_RETENTION_DAYS)));
    this.writeDelayMs = Math.max(0, Math.trunc(options.writeDelayMs ?? ARCHIVE_WRITE_DELAY_MS));
    this.now = options.now ?? Date.now;
    this.debugLog = options.debugLog;
    this.load();
  }

  /** 追加一条消息；空内容、重复 messageId、超期条目会被跳过或清理；返回是否新增 */
  append(chatKey: string, entry: Omit<ArchivedMessage, 'content'> & { content: string }): boolean {
    const content = cleanArchiveText(entry.content);
    if (content === '') return false;

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

    if (list.length > this.maxMessages) list.splice(0, list.length - this.maxMessages);
    this.chats.set(chatKey, list);
    this.scheduleWrite();
    return true;
  }

  /** 读取某个会话的归档（旧 → 新）；limit 缺省返回全部 */
  list(chatKey: string, limit?: number): ArchivedMessage[] {
    const list = this.chats.get(chatKey) ?? [];
    const count = limit === undefined ? list.length : Math.max(0, Math.trunc(limit));
    return list.slice(Math.max(0, list.length - count)).map((item) => ({ ...item }));
  }

  /** 按发送者过滤 */
  listBySender(chatKey: string, senderId: string, limit?: number): ArchivedMessage[] {
    return this.list(chatKey, limit).filter((item) => item.senderId === senderId);
  }

  /** 会话内的发送者统计（按消息数降序） */
  members(chatKey: string): ArchiveMemberStats[] {
    const buckets = new Map<string, ArchiveMemberStats>();
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
  chatKeys(): string[] {
    return [...this.chats.keys()];
  }

  /**
   * 跨会话的发送者统计：同一 openid 出现在多个群/私聊时合并计数。
   *
   * 说明：openid 由平台下发，实测同一个人私聊与群聊拿到的是同一个 openid，
   * 因此会自然合并成一行；若某个群下发的 openid 不同则单独成档，
   * 不按昵称猜测合并（避免把两个同名群友合成一个人）。
   */
  membersAll(): ArchiveMemberSummary[] {
    const buckets = new Map<string, ArchiveMemberSummary>();
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
        } else {
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
  countBySender(senderId: string): number {
    let count = 0;
    for (const list of this.chats.values()) {
      for (const entry of list) {
        if (entry.senderId === senderId) count += 1;
      }
    }
    return count;
  }

  /** 发送者出现过的会话及其消息（按条数降序） */
  chatsForSender(senderId: string): ArchiveMemberChat[] {
    const chats: ArchiveMemberChat[] = [];
    for (const [chatKey, list] of this.chats) {
      let count = 0;
      let firstAt = Number.POSITIVE_INFINITY;
      let lastAt = 0;
      for (const entry of list) {
        if (entry.senderId !== senderId) continue;
        count += 1;
        firstAt = Math.min(firstAt, entry.timestamp);
        lastAt = Math.max(lastAt, entry.timestamp);
      }
      if (count > 0) chats.push({ chatKey, count, firstAt, lastAt });
    }
    return chats.sort((a, b) => b.count - a.count || b.lastAt - a.lastAt);
  }

  /** 清空某个会话的归档 */
  clear(chatKey: string): void {
    if (!this.chats.delete(chatKey)) return;
    this.scheduleWrite();
  }

  /** 立即落盘（退出前/测试用） */
  flush(): void {
    if (this.writeTimer !== undefined) {
      clearTimeout(this.writeTimer);
      this.writeTimer = undefined;
    }
    this.write();
  }

  private cutoff(): number {
    return this.now() - this.retentionDays * 24 * 60 * 60 * 1000;
  }

  private scheduleWrite(): void {
    if (this.writeDelayMs === 0) {
      this.write();
      return;
    }
    if (this.writeTimer !== undefined) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined;
      this.write();
    }, this.writeDelayMs);
    // 不让防抖定时器拖住进程退出；未落盘的最后 1s 消息可接受丢失
    (this.writeTimer as unknown as { unref?: () => void }).unref?.();
  }

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return;
      const data = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<ArchiveFile>;
      if (data.version !== 1 || typeof data.chats !== 'object' || data.chats === null) return;
      const cutoff = this.cutoff();
      for (const [chatKey, value] of Object.entries(data.chats)) {
        if (!Array.isArray(value)) continue;
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
        if (list.length > 0) this.chats.set(chatKey, list);
      }
    } catch (err) {
      this.debugLog?.(`loadPersonaArchive failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private write(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const data: ArchiveFile = { version: 1, chats: Object.fromEntries(this.chats.entries()) };
      writeFileSync(this.filePath, JSON.stringify(data), 'utf8');
    } catch (err) {
      this.debugLog?.(`writePersonaArchive failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** 斜杠命令不进入人格档案：它们不是自然语言发言，容易污染风格总结 */
const SLASH_COMMAND_PATTERN = /^\/[^\s/]/;

/** 归档成功通知（自动分析据此判断是否需要生成人格档案） */
export interface PersonaArchiveNotice {
  chatKey: string;
  senderId: string;
  senderName?: string;
  scope: ChatScope;
  peerId: string;
}

/**
 * 构造归档中间件：放在 @ 门控之前，未 @bot 的群聊消息也会被记录；
 * 放在访问控制之后，被拒绝的群/用户不会写盘。
 *
 * @param onArchived - 新消息真正写入后的通知；必须同步返回，不能阻塞消息链
 */
export function createPersonaArchiveMiddleware(
  config: ImQQBotConfig,
  archive: PersonaArchive,
  logger: Logger,
  onArchived?: (notice: PersonaArchiveNotice) => void,
): Middleware {
  return (ctx, next) => {
    try {
      const msg = ctx.message;
      if (msg.senderIsBot === true) return next();
      if (msg.kind !== 'group' && msg.kind !== 'c2c') return next();

      const content = cleanArchiveText(msg.content);
      if (content === '' || SLASH_COMMAND_PATTERN.test(content)) return next();

      const scope: ChatScope = msg.kind === 'group' ? 'group' : 'c2c';
      const peerId = scope === 'group' ? (msg.groupOpenid ?? msg.senderId) : msg.senderId;
      if (!peerId || !msg.senderId) return next();

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
    } catch (err) {
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

let sharedArchive: PersonaArchive | undefined;
let sharedArchiveKey = '';

/** 取进程内共享档案（配置变化时替换；替换前落盘旧实例） */
export function getPersonaArchive(options: PersonaArchiveOptions = {}): PersonaArchive {
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
export function setPersonaArchiveForTests(archive?: PersonaArchive): void {
  sharedArchive?.flush();
  sharedArchive = archive;
  sharedArchiveKey = archive === undefined ? '' : 'test';
}
