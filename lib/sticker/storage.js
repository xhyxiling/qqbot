/**
 * 表情包元数据存储 — JSON 持久化 + 去重 + 自动备份
 *
 * 设计要点：
 * - 元数据存储在 ~/.dsh-qqbot/stickers.json，与 media 目录分离（media 是临时下载）
 * - 用文件 hash 去重（QQ 重发同一张图会有不同 URL）
 * - 定期脏标记 + 退出前 flush，避免频繁写盘
 */
import { promises as fs } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { IMAGE_EXTS, correctPathExt, correctBasenameExt, detectImageExt } from "./signature.js";
/** 存储根目录（与 persona archive 同层级） */
export const STICKER_ROOT = resolve(homedir(), '.dsh-qqbot');
/** 默认媒体附件目录（复用 attachment.ts 的 MEDIA_ROOT） */
export const DEFAULT_IMAGES_DIR = resolve(STICKER_ROOT, 'media');
/** 构建元数据路径 */
export function resolveStickerMetadataPath(cfg) {
    if (cfg.metadataPath)
        return resolve(cfg.metadataPath);
    return resolve(STICKER_ROOT, 'stickers.json');
}
/** 构建图片存储目录：空 = 复用 media（TTL 清理），指定 = 独立存储（永久保留） */
export function resolveStickerImagesDir(cfg) {
    if (cfg.imagesDir)
        return resolve(cfg.imagesDir);
    return DEFAULT_IMAGES_DIR;
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
    imagesDir;
    useIndependentDir;
    backupRetention;
    logger;
    constructor(config, logger) {
        this.metadataPath = resolveStickerMetadataPath(config);
        this.imagesDir = resolveStickerImagesDir(config);
        this.useIndependentDir = !!config.imagesDir; // true 表示指定了独立目录
        this.backupRetention = config.backupRetention;
        this.logger = logger;
    }
    /** 加载（构造后立即调用）— 附带元数据自恢复 */
    async load() {
        try {
            const data = await fs.readFile(this.metadataPath, 'utf-8');
            const parsed = JSON.parse(data);
            let fixed = 0;
            let tagsCleaned = 0;
            for (const s of parsed.stickers || []) {
                const repaired = await this.repairMetadataExt(s);
                if (repaired !== s) {
                    this.logger.info(`sticker-store: 修复扩展名 ${s.filePath} → ${repaired.filePath}`);
                    fixed++;
                }
                const cleaned = this.cleanGarbageTags(repaired);
                if (cleaned !== repaired) {
                    tagsCleaned++;
                }
                this.stickers.set(cleaned.id, cleaned);
            }
            if (fixed > 0 || tagsCleaned > 0) {
                this.logger.info(`sticker-store: 加载时修复 ${fixed} 条扩展名、清理 ${tagsCleaned} 条垃圾标签`);
                this.markDirty();
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
    /**
     * 尝试纠正一条 Sticker 元数据的扩展名：
     *   - 首选：读取文件头，按真实格式纠正 filePath/filename/mimeType
     *   - 次选：原路径不存在，但换个扩展名可能存在（.jpg ↔ .gif/.png/.webp）
     * 返回纠正后的 Sticker；无法修复时返回原值不变。
     */
    async repairMetadataExt(s) {
        try {
            let buf;
            try {
                buf = await fs.readFile(s.filePath);
            }
            catch {
                // 原路径不存在 → 尝试同目录换扩展名
                const stem = s.filePath.slice(0, -extname(s.filePath).length);
                for (const ext of IMAGE_EXTS) {
                    if (ext === extname(s.filePath).toLowerCase())
                        continue;
                    const tryPath = stem + ext;
                    try {
                        buf = await fs.readFile(tryPath);
                        const repaired = {
                            ...s,
                            filePath: tryPath,
                            filename: basename(tryPath),
                        };
                        // 继续按文件头再纠正一次
                        return this.applySignatureFix(repaired, buf);
                    }
                    catch {
                        // 试下一个扩展名
                    }
                }
                // 所有候选都不存在，放弃修复
                return s;
            }
            return this.applySignatureFix(s, buf);
        }
        catch {
            return s;
        }
    }
    /** 按文件头纠正扩展名 + MIME（路径本身已存在但后缀不对） */
    applySignatureFix(s, buf) {
        const detected = detectImageExt(buf);
        if (!detected)
            return s;
        const correctedPath = correctPathExt(s.filePath, buf);
        const correctedName = correctBasenameExt(s.filePath, buf);
        if (correctedPath === s.filePath && s.mimeType === detected.mime)
            return s;
        return {
            ...s,
            filePath: correctedPath,
            filename: correctedName,
            mimeType: detected.mime,
        };
    }
    /**
     * 清理垃圾标签：过滤掉纯 hash（[0-9a-f]{8,}）和长数字（\d{10,}），
     * 这些是旧版自动从文件名抽出来的无用标签。没变则返回原引用。
     */
    cleanGarbageTags(s) {
        if (!s.tags || s.tags.length === 0)
            return s;
        const isJunk = (w) => /^[0-9a-f]{8,}$/i.test(w) || /^\d{10,}$/.test(w);
        const kept = s.tags.filter((t) => !isJunk(t));
        if (kept.length === s.tags.length)
            return s;
        return { ...s, tags: kept };
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
    /** 库里是否已收藏该文件（按 hash 去重），用于避免重复调 vision */
    async alreadyHas(filePath) {
        const id = await this.hashFile(filePath);
        return this.stickers.has(id);
    }
    /** 给已收藏的图补写画面描述 + 合并标签（backfill 用） */
    updateDescription(id, description, extraTags) {
        const s = this.stickers.get(id);
        if (!s)
            return;
        const next = { ...s, description: description.slice(0, 60) };
        // 合并时也过滤垃圾标签（防御：s.tags 可能残留旧版 hash/时间戳）
        const isJunk = (w) => /^[0-9a-f]{8,}$/i.test(w) || /^\d{10,}$/.test(w);
        const kept = s.tags.filter((t) => !isJunk(t));
        if (extraTags && extraTags.length > 0) {
            const seen = new Set(kept.map((t) => t.toLowerCase()));
            for (const t of extraTags) {
                const tl = t.trim().toLowerCase();
                if (tl.length >= 2 && tl.length <= 20 && !isJunk(tl) && !seen.has(tl)) {
                    seen.add(tl);
                    kept.push(tl);
                }
            }
        }
        next.tags = kept.slice(0, 8);
        this.stickers.set(id, next);
        this.markDirty();
    }
    /** 基于已有信息快速生成 ID（不读文件） */
    quickId(filename, source) {
        return createHash('sha256').update(`${source}|${filename}`).digest('hex').slice(0, 16);
    }
    // ── CRUD ──
    /** 尝试收藏一个表情；已存在则返回 existing，新增则返回新对象
     *  如果配置了独立 imagesDir，会把文件 copy 过去避免 media cleaner 清掉
     *
     *  去重策略：按新文件的 hash 匹配。如果 Map 里有同 hash 记录但指向的文件
     *  已经不存在（脏记录），先删除旧记录再走添加流程。 */
    async tryAdd(sticker) {
        // 去重
        const id = await this.hashFile(sticker.filePath);
        const existing = this.stickers.get(id);
        if (existing) {
            // 命中旧记录，但旧记录指向的文件可能已被 TTL / 手动删除
            const alive = await this.fileExists(existing.filePath);
            if (alive) {
                this.logger.debug(`sticker-store: 表情已存在 ${id}`);
                return existing;
            }
            // 脏记录：删除，继续走添加流程（会重新 copy 到独立目录）
            this.logger.info(`sticker-store: 清理脏记录 ${id}（文件已不存在 ${existing.filePath}）`);
            this.stickers.delete(id);
            this.markDirty();
        }
        // 如果配置了独立目录，把文件 copy 过去
        let finalPath = sticker.filePath;
        if (this.useIndependentDir) {
            const copiedPath = await this.copyToIndependentDir(sticker.filePath, id);
            if (copiedPath) {
                finalPath = copiedPath;
                this.logger.debug(`sticker-store: 已 copy 到独立目录 ${finalPath}`);
            }
            else {
                this.logger.warn(`sticker-store: copy 到独立目录失败，保留原路径 ${sticker.filePath}`);
            }
        }
        const full = {
            ...sticker,
            id,
            filePath: finalPath,
            useCount: 0,
            positiveReactions: 0,
            negativeReactions: 0,
            hotScore: 50,
        };
        this.stickers.set(id, full);
        this.markDirty();
        this.logger.info(`sticker-store: + 收藏 ${id} (${full.filename})`);
        return full;
    }
    /** 把文件 copy 到独立存储目录（避免 media TTL 清理）
     *  — 复制后目标文件可能是纠正过扩展名的（collector 传进来的 localPath 可能已纠正） */
    async copyToIndependentDir(srcPath, id) {
        try {
            await fs.mkdir(this.imagesDir, { recursive: true });
            // 用源文件的真实扩展名（可能已被下载层纠正）
            const rawExt = extname(srcPath).toLowerCase() || '.png';
            const destPath = resolve(this.imagesDir, `${id}${rawExt}`);
            // 孤儿补录时源文件本来就在 imagesDir 里，同路径 copy 会报错，直接复用
            if (resolve(srcPath) === destPath)
                return destPath;
            await fs.copyFile(srcPath, destPath);
            return destPath;
        }
        catch (err) {
            this.logger.error(`sticker-store: copyFile 失败: ${err instanceof Error ? err.message : String(err)}`);
            return null;
        }
    }
    /** 图片独立存储目录（孤儿扫描用） */
    get imagesDirPath() {
        return this.imagesDir;
    }
    /** 是否配置了独立图片目录（只有独立目录才安全做孤儿扫描，media 目录是临时文件） */
    get hasIndependentDir() {
        return this.useIndependentDir;
    }
    get(id) {
        return this.stickers.get(id);
    }
    all() {
        return Array.from(this.stickers.values());
    }
    /**
     * 按收藏时间编号（#1 最早）— 编号稳定，不受热度/使用次数变化影响，
     * 这样 prompt 里列出的 #N 与 send_sticker 的 sticker_no 始终对应同一张图。
     */
    numbered() {
        return [...this.stickers.values()]
            .sort((a, b) => a.firstCollectedAt - b.firstCollectedAt || a.id.localeCompare(b.id))
            .map((sticker, i) => ({ no: i + 1, sticker }));
    }
    /** 按编号取表情 */
    byNo(no) {
        return this.numbered().find((x) => x.no === no)?.sticker;
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