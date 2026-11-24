/**
 * 表情包元数据存储 — JSON 持久化 + 去重 + 自动备份
 *
 * 设计要点：
 * - 元数据存储在 ~/.dsh-qqbot/stickers.json，与 media 目录分离（media 是临时下载）
 * - 用文件 hash 去重（QQ 重发同一张图会有不同 URL）
 * - 定期脏标记 + 退出前 flush，避免频繁写盘
 */
import { promises as fs } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
/** 存储根目录（与 persona archive 同层级） */
export const STICKER_ROOT = resolve(homedir(), '.dsh-qqbot');
/** 构建元数据路径 */
export function resolveStickerMetadataPath(cfg) {
    if (cfg.metadataPath)
        return resolve(cfg.metadataPath);
    return resolve(STICKER_ROOT, 'stickers.json');
}
/** 内存中的日计数（每群每天最多收藏） */
const dailyCountMap = new Map();
let dailyResetTimer = null;
/**
 * 表情包元数据存储类 — 纯内存 Map + JSON 持久化
 *
 * 不做成 Cordis Service（本项目 sticker 模块就是普通类，生命周期
 * 由 bootstrap 创建和释放，与 SessionManager / PersonaArchive 一致）。
 */
export class StickerStore {
    stickers = new Map();
    dirty = false;
    metadataPath;
    backupRetention;
    logger;
    constructor(config, logger) {
        this.metadataPath = resolveStickerMetadataPath(config);
        this.backupRetention = config.backupRetention;
        this.logger = logger;
    }
    /** 加载（构造后立即调用） */
    async load() {
        try {
            const data = await fs.readFile(this.metadataPath, 'utf-8');
            const parsed = JSON.parse(data);
            for (const s of parsed.stickers || []) {
                this.stickers.set(s.id, s);
            }
            this.logger.info(`sticker-store: 已加载 ${this.stickers.size} 个表情元数据`);
        }
        catch {
            // 首次运行：创建空文件 + 目录
            await fs.mkdir(dirname(this.metadataPath), { recursive: true });
            await this.flush();
            this.logger.info('sticker-store: 初始化空表情库');
        }
        // 内存日计数重置（每 24h）
        if (!dailyResetTimer) {
            dailyResetTimer = setInterval(() => {
                dailyCountMap.clear();
            }, 24 * 60 * 60 * 1000);
        }
    }
    /** 刷盘（退出前调用 + 定期自动调用） */
    async flush() {
        if (!this.dirty)
            return;
        const data = {
            version: 1,
            savedAt: Date.now(),
            stickers: this.all(),
            stats: this.stats(),
        };
        // 备份旧文件（如有）
        if (await this.fileExists(this.metadataPath)) {
            await this.backup();
        }
        await fs.writeFile(this.metadataPath, JSON.stringify(data, null, 2), 'utf-8');
        this.dirty = false;
    }
    /** 进程退出时的清理 */
    dispose() {
        if (dailyResetTimer) {
            clearInterval(dailyResetTimer);
            dailyResetTimer = null;
        }
    }
    // ── 去重工具 ──
    /** 计算文件内容 hash（用来判断是否同一张图） */
    async hashFile(filePath) {
        const buf = await fs.readFile(filePath);
        return createHash('sha256').update(buf).digest('hex').slice(0, 16);
    }
    /** 基于已有信息快速生成 ID（不读文件） */
    quickId(filename, source) {
        return createHash('sha256').update(`${source}|${filename}`).digest('hex').slice(0, 16);
    }
    // ── CRUD ──
    /** 尝试收藏一个表情；已存在则返回 existing，新增则返回新对象 */
    async tryAdd(sticker) {
        const id = await this.hashFile(sticker.filePath);
        const existing = this.stickers.get(id);
        if (existing) {
            this.logger.debug(`sticker-store: 表情已存在 ${id}`);
            return existing;
        }
        const full = {
            ...sticker,
            id,
            useCount: 0,
            positiveReactions: 0,
            negativeReactions: 0,
            hotScore: 50, // 初始中等热度
        };
        this.stickers.set(id, full);
        this.markDirty();
        this.logger.info(`sticker-store: + 收藏 ${id} (${sticker.filename})`);
        return full;
    }
    get(id) {
        return this.stickers.get(id);
    }
    all() {
        return Array.from(this.stickers.values());
    }
    /** 按条件查找第一个 */
    find(predicate) {
        for (const s of this.stickers.values()) {
            if (predicate(s))
                return s;
        }
        return undefined;
    }
    /** 随机一个 */
    random() {
        const all = this.all();
        if (all.length === 0)
            return undefined;
        return all[Math.floor(Math.random() * all.length)];
    }
    /** 更新部分字段 */
    update(id, patch) {
        const existing = this.stickers.get(id);
        if (!existing)
            return undefined;
        const updated = { ...existing, ...patch };
        this.stickers.set(id, updated);
        this.markDirty();
        return updated;
    }
    /** 删除 */
    async remove(id) {
        const existed = this.stickers.delete(id);
        if (existed) {
            this.markDirty();
            this.logger.info(`sticker-store: - 淘汰 ${id}`);
        }
        return existed;
    }
    // ── 使用计数 & 反馈 ──
    markUsed(id) {
        const s = this.stickers.get(id);
        if (s) {
            s.useCount++;
            s.lastUsedAt = Date.now();
            this.markDirty();
        }
    }
    markPositive(id, weight = 1) {
        const s = this.stickers.get(id);
        if (s) {
            s.positiveReactions += weight;
            this.markDirty();
        }
    }
    markNegative(id, weight = 1) {
        const s = this.stickers.get(id);
        if (s) {
            s.negativeReactions += weight;
            this.markDirty();
        }
    }
    // ── 每日限额 ──
    /** 检查并递增某群的每日计数；超限返回 false */
    checkDailyLimit(groupId, maxPerDay) {
        const count = dailyCountMap.get(groupId) ?? 0;
        if (count >= maxPerDay)
            return false;
        dailyCountMap.set(groupId, count + 1);
        return true;
    }
    // ── 统计 ──
    stats() {
        const all = this.all();
        const totalSizeKB = all.reduce((s, x) => s + x.size, 0) / 1024;
        const tagSet = new Set();
        for (const s of all)
            for (const t of s.tags)
                tagSet.add(t);
        return {
            total: all.length,
            totalSizeKB: Math.round(totalSizeKB),
            uniqueTags: tagSet.size,
            avgHotScore: all.length > 0
                ? Math.round(all.reduce((s, x) => s + x.hotScore, 0) / all.length * 10) / 10
                : 0,
        };
    }
    // ── 内部 ──
    markDirty() {
        this.dirty = true;
    }
    async fileExists(p) {
        try {
            await fs.access(p);
            return true;
        }
        catch {
            return false;
        }
    }
    async backup() {
        try {
            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const dir = dirname(this.metadataPath);
            const backupPath = resolve(dir, `stickers.${ts}.bak`);
            await fs.copyFile(this.metadataPath, backupPath);
            // 清理超过保留份数的旧备份
            const files = (await fs.readdir(dir))
                .filter((f) => f.startsWith('stickers.') && f.endsWith('.bak'))
                .sort();
            while (files.length > this.backupRetention) {
                const old = files.shift();
                await fs.unlink(resolve(dir, old));
            }
        }
        catch {
            // 首次保存前没有旧文件，忽略
        }
    }
}
//# sourceMappingURL=storage.js.map