/**
 * MemoryStore — 持久化「人物画像 + 会话记忆」
 *
 * 两层结构：
 *   - people：按发送者 id（QQ 号 / openid）存的人物画像，跨群与私聊共享
 *   - chats：按会话存的关系统计与旧版要点，只属于当前群/私聊
 *
 * 存储路径：~/.dsh-qqbot/memory.json（与会话历史独立，/new 与重启都不清除）
 * chat key 与 SessionManager 的 sessionKey 同构：qqbot:${appId}:${scope}:${peerId}
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import type { ChatScope } from '../types.ts';

/** 一条要点记忆 */
export interface MemoryNote {
  /** 记忆内容（已裁剪） */
  text: string;
  /** 记录时间 */
  at: number;
  /** manual = /memory add；auto = 从用户自述中启发式捕获 */
  source: 'auto' | 'manual';
}

/** 单个会话的记忆与关系状态 */
export interface ChatMemory {
  scope: ChatScope;
  peerId: string;
  /** 第一次互动时间 */
  firstSeenAt: number;
  /** 最近一次互动时间 */
  lastSeenAt: number;
  /** 累计互动消息数（关系阶段依据） */
  messageCount: number;
  /** 要点记忆（旧 → 新） */
  notes: MemoryNote[];
}

/**
 * 单个人物画像（跨会话共享）。
 *
 * key 是发送者 id（OneBot 下就是 QQ 号，官方机器人下是 openid），
 * 因此同一个人在私聊和所有群里共用同一份记忆。
 */
export interface PersonMemory {
  senderId: string;
  /** 最近一次看到的昵称（可能变化） */
  senderName?: string;
  firstSeenAt: number;
  lastSeenAt: number;
  messageCount: number;
  notes: MemoryNote[];
}

interface MemoryFile {
  version: 2;
  chats: Record<string, ChatMemory>;
  people: Record<string, PersonMemory>;
}

/** 单个记忆文本的最大长度 */
export const MAX_NOTE_TEXT = 200;

export class MemoryStore {
  private readonly chats = new Map<string, ChatMemory>();
  private readonly people = new Map<string, PersonMemory>();
  private readonly filePath: string;
  private readonly debugLog?: (msg: string) => void;

  constructor(options: { path?: string; debugLog?: (msg: string) => void } = {}) {
    this.filePath = options.path ?? resolve(homedir(), '.dsh-qqbot', 'memory.json');
    this.debugLog = options.debugLog;
    this.load();
  }

  get(key: string): ChatMemory | undefined {
    return this.chats.get(key);
  }

  /**
   * 记录一次互动：累加消息数，更新首/末次时间。
   * 首次互动时创建记录。
   */
  recordInteraction(
    key: string,
    scope: ChatScope,
    peerId: string,
    at = Date.now(),
  ): ChatMemory {
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
    record.lastSeenAt = at;
    record.messageCount += 1;
    this.write();
    return record;
  }

  /**
   * 追加一条要点记忆；内容为空 / 重复（忽略大小写与标点差异）时返回 undefined。
   *
   * maxNotes 超出后淘汰最旧的一条。
   */
  addNote(
    key: string,
    scope: ChatScope,
    peerId: string,
    text: string,
    source: MemoryNote['source'],
    maxNotes: number,
  ): MemoryNote | undefined {
    const normalized = normalizeNote(text);
    if (normalized === '') return undefined;

    const record = this.ensureRecord(key, scope, peerId);
    const exists = record.notes.some((n) => normalizeNote(n.text).toLowerCase() === normalized.toLowerCase());
    if (exists) return undefined;

    const note: MemoryNote = { text: normalized.slice(0, MAX_NOTE_TEXT), at: Date.now(), source };
    record.notes.push(note);
    const limit = Math.max(1, maxNotes);
    if (record.notes.length > limit) {
      record.notes.splice(0, record.notes.length - limit);
    }
    this.write();
    return note;
  }

  /** 删除第 index 条（0-based）；越界返回 false */
  removeNote(key: string, index: number): boolean {
    const record = this.chats.get(key);
    if (record === undefined || index < 0 || index >= record.notes.length) return false;
    record.notes.splice(index, 1);
    this.write();
    return true;
  }

  /** 清空某个会话的要点记忆（保留关系统计）；返回删除条数 */
  clearNotes(key: string): number {
    const record = this.chats.get(key);
    if (record === undefined || record.notes.length === 0) return 0;
    const count = record.notes.length;
    record.notes = [];
    this.write();
    return count;
  }

  /** 删除整个会话记录（统计 + 记忆） */
  remove(key: string): boolean {
    const deleted = this.chats.delete(key);
    if (deleted) this.write();
    return deleted;
  }

  // ── 人物画像（跨群/私聊共享） ──

  getPerson(senderId: string): PersonMemory | undefined {
    return this.people.get(senderId);
  }

  /**
   * 记录一次与某个人的互动：累加消息数、刷新昵称与末次时间。
   * 与会话无关，因此在任何群或私聊里说话都会累积到同一份画像。
   */
  recordPersonInteraction(
    senderId: string,
    senderName?: string,
    at = Date.now(),
  ): PersonMemory {
    let record = this.people.get(senderId);
    if (record === undefined) {
      record = {
        senderId,
        ...(senderName !== undefined && senderName !== '' ? { senderName } : {}),
        firstSeenAt: at,
        lastSeenAt: at,
        messageCount: 0,
        notes: [],
      };
      this.people.set(senderId, record);
    }
    record.lastSeenAt = at;
    record.messageCount += 1;
    if (senderName !== undefined && senderName !== '') record.senderName = senderName;
    this.write();
    return record;
  }

  /** 追加一条人物画像要点；内容为空或重复时返回 undefined */
  addPersonNote(
    senderId: string,
    text: string,
    source: MemoryNote['source'],
    maxNotes: number,
  ): MemoryNote | undefined {
    const normalized = normalizeNote(text);
    if (normalized === '') return undefined;

    let record = this.people.get(senderId);
    if (record === undefined) {
      const now = Date.now();
      record = { senderId, firstSeenAt: now, lastSeenAt: now, messageCount: 0, notes: [] };
      this.people.set(senderId, record);
    }
    const exists = record.notes.some((n) => normalizeNote(n.text).toLowerCase() === normalized.toLowerCase());
    if (exists) return undefined;

    const note: MemoryNote = { text: normalized.slice(0, MAX_NOTE_TEXT), at: Date.now(), source };
    record.notes.push(note);
    const limit = Math.max(1, maxNotes);
    if (record.notes.length > limit) {
      record.notes.splice(0, record.notes.length - limit);
    }
    this.write();
    return note;
  }

  /** 删除某人画像的第 index 条；越界返回 false */
  removePersonNote(senderId: string, index: number): boolean {
    const record = this.people.get(senderId);
    if (record === undefined || index < 0 || index >= record.notes.length) return false;
    record.notes.splice(index, 1);
    this.write();
    return true;
  }

  /** 清空某人画像的要点（保留关系统计）；返回删除条数 */
  clearPersonNotes(senderId: string): number {
    const record = this.people.get(senderId);
    if (record === undefined || record.notes.length === 0) return 0;
    const count = record.notes.length;
    record.notes = [];
    this.write();
    return count;
  }

  private ensureRecord(key: string, scope: ChatScope, peerId: string): ChatMemory {
    let record = this.chats.get(key);
    if (record !== undefined) return record;
    const now = Date.now();
    record = { scope, peerId, firstSeenAt: now, lastSeenAt: now, messageCount: 0, notes: [] };
    this.chats.set(key, record);
    return record;
  }

  private load(): void {
    try {
      if (!existsSync(this.filePath)) return;
      const data = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<MemoryFile>;
      if (data.chats && typeof data.chats === 'object') {
        for (const [key, value] of Object.entries(data.chats)) {
          if (!isChatMemory(value)) continue;
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
      // v1 文件没有 people 字段：正常跳过，旧会话记忆仍保留
      if (data.people && typeof data.people === 'object') {
        for (const [key, value] of Object.entries(data.people)) {
          if (!isPersonMemory(value)) continue;
          this.people.set(key, {
            senderId: value.senderId,
            ...(typeof value.senderName === 'string' ? { senderName: value.senderName } : {}),
            firstSeenAt: value.firstSeenAt,
            lastSeenAt: value.lastSeenAt,
            messageCount: value.messageCount,
            notes: value.notes.filter(isMemoryNote),
          });
        }
      }
    } catch (err) {
      this.debugLog?.(`loadMemory failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private write(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const data: MemoryFile = {
        version: 2,
        chats: Object.fromEntries(this.chats.entries()),
        people: Object.fromEntries(this.people.entries()),
      };
      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      this.debugLog?.(`writeMemory failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** 归一化记忆文本：折叠空白、裁剪首尾标点与空格 */
function normalizeNote(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, '')
    .trim()
    .slice(0, MAX_NOTE_TEXT);
}

function isMemoryNote(value: unknown): value is MemoryNote {
  if (typeof value !== 'object' || value === null) return false;
  const note = value as Partial<MemoryNote>;
  return typeof note.text === 'string'
    && typeof note.at === 'number'
    && (note.source === 'auto' || note.source === 'manual');
}

function isChatMemory(value: unknown): value is ChatMemory {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<ChatMemory>;
  return (record.scope === 'c2c' || record.scope === 'group')
    && typeof record.peerId === 'string'
    && typeof record.firstSeenAt === 'number'
    && typeof record.lastSeenAt === 'number'
    && typeof record.messageCount === 'number'
    && Array.isArray(record.notes);
}

function isPersonMemory(value: unknown): value is PersonMemory {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<PersonMemory>;
  return typeof record.senderId === 'string'
    && typeof record.firstSeenAt === 'number'
    && typeof record.lastSeenAt === 'number'
    && typeof record.messageCount === 'number'
    && Array.isArray(record.notes);
}
