/**
 * 表情包元数据存储 — JSON 持久化 + 去重 + 自动备份
 *
 * 设计要点：
 * - 元数据存储在 ~/.dsh-qqbot/stickers.json，与 media 目录分离（media 是临时下载）
 * - 用文件 hash 去重（QQ 重发同一张图会有不同 URL）
 * - 定期脏标记 + 退出前 flush，避免频繁写盘
 */
import { promises as fs } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import type { Logger } from '../types.ts';
import type { Sticker, StickerStorageConfig } from './types.ts';
import { IMAGE_EXTS, correctPathExt, correctBasenameExt, detectImageExt } from './signature.ts';

/** 存储根目录（与 persona archive 同层级） */
export const STICKER_ROOT = resolve(homedir(), '.dsh-qqbot');

/** 默认媒体附件目录（复用 attachment.ts 的 MEDIA_ROOT） */
export const DEFAULT_IMAGES_DIR = resolve(STICKER_ROOT, 'media');

/** 构建元数据路径 */
export function resolveStickerMetadataPath(cfg: StickerStorageConfig): string {
  if (cfg.metadataPath) return resolve(cfg.metadataPath);
  return resolve(STICKER_ROOT, 'stickers.json');
}

/** 构建图片存储目录：空 = 复用 media（TTL 清理），指定 = 独立存储（永久保留） */
export function resolveStickerImagesDir(cfg: StickerStorageConfig): string {
  if (cfg.imagesDir) return resolve(cfg.imagesDir);
  return DEFAULT_IMAGES_DIR;
}

/** 元数据文件 schema */
interface StickerStoreFile {
  version: 1;
  savedAt: number;
  stickers: Sticker[];
  stats: StickerStoreStats;
}

interface StickerStoreStats {
  total: number;
  totalSizeKB: number;
  uniqueTags: number;
  avgHotScore: number;
}

/** 内存中的日计数（每群每天最多收藏） */
const dailyCountMap = new Map<string, number>();
let dailyResetTimer: ReturnType<typeof setInterval> | null = null;

/**
 * 表情包元数据存储类 — 纯内存 Map + JSON 持久化
 *
 * 不做成 Cordis Service（本项目 sticker 模块就是普通类，生命周期
 * 由 bootstrap 创建和释放，与 SessionManager / PersonaArchive 一致）。
 */
export class StickerStore {
  private stickers = new Map<string, Sticker>();
  private dirty = false;
  private readonly metadataPath: string;
  private readonly imagesDir: string;
  private readonly useIndependentDir: boolean;
  private readonly backupRetention: number;
  private readonly logger: Logger;

  constructor(config: StickerStorageConfig, logger: Logger) {
    this.metadataPath = resolveStickerMetadataPath(config);
    this.imagesDir = resolveStickerImagesDir(config);
    this.useIndependentDir = !!config.imagesDir; // true 表示指定了独立目录
    this.backupRetention = config.backupRetention;
    this.logger = logger;
  }

  /** 加载（构造后立即调用）— 附带元数据自恢复 */
  async load(): Promise<void> {
    try {
      const data = await fs.readFile(this.metadataPath, 'utf-8');
      const parsed = JSON.parse(data) as StickerStoreFile;
      let fixed = 0;
      for (const s of parsed.stickers || []) {
        const repaired = await this.repairMetadataExt(s);
        if (repaired) {
          this.logger.info(`sticker-store: 修复扩展名 ${s.filePath} → ${repaired.filePath}`);
          fixed++;
        }
        this.stickers.set(repaired.id, repaired);
      }
      if (fixed > 0) {
        this.logger.info(`sticker-store: 加载时修复了 ${fixed} 条元数据扩展名`);
        this.markDirty();
      }
      this.logger.info(`sticker-store: 已加载 ${this.stickers.size} 个表情元数据`);
    } catch {
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
  private async repairMetadataExt(s: Sticker): Promise<Sticker> {
    try {
      let buf: Buffer;
      try {
        buf = await fs.readFile(s.filePath);
      } catch {
        // 原路径不存在 → 尝试同目录换扩展名
        const stem = s.filePath.slice(0, -extname(s.filePath).length);
        for (const ext of IMAGE_EXTS) {
          if (ext === extname(s.filePath).toLowerCase()) continue;
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
          } catch {
            // 试下一个扩展名
          }
        }
        // 所有候选都不存在，放弃修复
        return s;
      }
      return this.applySignatureFix(s, buf);
    } catch {
      return s;
    }
  }

  /** 按文件头纠正扩展名 + MIME（路径本身已存在但后缀不对） */
  private applySignatureFix(s: Sticker, buf: Buffer): Sticker {
    const detected = detectImageExt(buf);
    if (!detected) return s;
    const correctedPath = correctPathExt(s.filePath, buf);
    const correctedName = correctBasenameExt(s.filePath, buf);
    if (correctedPath === s.filePath && s.mimeType === detected.mime) return s;
    return {
      ...s,
      filePath: correctedPath,
      filename: correctedName,
      mimeType: detected.mime,
    };
  }

  /** 刷盘（退出前调用 + 定期自动调用） */
  async flush(): Promise<void> {
    if (!this.dirty) return;

    const data: StickerStoreFile = {
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
  dispose(): void {
    if (dailyResetTimer) {
      clearInterval(dailyResetTimer);
      dailyResetTimer = null;
    }
  }

  // ── 去重工具 ──

  /** 计算文件内容 hash（用来判断是否同一张图） */
  async hashFile(filePath: string): Promise<string> {
    const buf = await fs.readFile(filePath);
    return createHash('sha256').update(buf).digest('hex').slice(0, 16);
  }

  /** 基于已有信息快速生成 ID（不读文件） */
  quickId(filename: string, source: string): string {
    return createHash('sha256').update(`${source}|${filename}`).digest('hex').slice(0, 16);
  }

  // ── CRUD ──

  /** 尝试收藏一个表情；已存在则返回 existing，新增则返回新对象
   *  如果配置了独立 imagesDir，会把文件 copy 过去避免 media cleaner 清掉
   *
   *  去重策略：按新文件的 hash 匹配。如果 Map 里有同 hash 记录但指向的文件
   *  已经不存在（脏记录），先删除旧记录再走添加流程。 */
  async tryAdd(sticker: Omit<Sticker, 'id' | 'useCount' | 'positiveReactions' | 'negativeReactions' | 'hotScore'>): Promise<Sticker | null> {
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
    let finalPath: string = sticker.filePath;
    if (this.useIndependentDir) {
      const copiedPath = await this.copyToIndependentDir(sticker.filePath, id);
      if (copiedPath) {
        finalPath = copiedPath;
        this.logger.debug(`sticker-store: 已 copy 到独立目录 ${finalPath}`);
      } else {
        this.logger.warn(`sticker-store: copy 到独立目录失败，保留原路径 ${sticker.filePath}`);
      }
    }

    const full: Sticker = {
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
  private async copyToIndependentDir(srcPath: string, id: string): Promise<string | null> {
    try {
      await fs.mkdir(this.imagesDir, { recursive: true });
      // 用源文件的真实扩展名（可能已被下载层纠正）
      const rawExt = extname(srcPath).toLowerCase() || '.png';
      const destPath = resolve(this.imagesDir, `${id}${rawExt}`);
      await fs.copyFile(srcPath, destPath);
      return destPath;
    } catch (err) {
      this.logger.error(`sticker-store: copyFile 失败: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  get(id: string): Sticker | undefined {
    return this.stickers.get(id);
  }

  all(): Sticker[] {
    return Array.from(this.stickers.values());
  }

  /** 按条件查找第一个 */
  find(predicate: (s: Sticker) => boolean): Sticker | undefined {
    for (const s of this.stickers.values()) {
      if (predicate(s)) return s;
    }
    return undefined;
  }

  /** 随机一个 */
  random(): Sticker | undefined {
    const all = this.all();
    if (all.length === 0) return undefined;
    return all[Math.floor(Math.random() * all.length)];
  }

  /** 更新部分字段 */
  update(id: string, patch: Partial<Sticker>): Sticker | undefined {
    const existing = this.stickers.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...patch };
    this.stickers.set(id, updated);
    this.markDirty();
    return updated;
  }

  /** 删除 */
  async remove(id: string): Promise<boolean> {
    const existed = this.stickers.delete(id);
    if (existed) {
      this.markDirty();
      this.logger.info(`sticker-store: - 淘汰 ${id}`);
    }
    return existed;
  }

  // ── 使用计数 & 反馈 ──

  markUsed(id: string): void {
    const s = this.stickers.get(id);
    if (s) {
      s.useCount++;
      s.lastUsedAt = Date.now();
      this.markDirty();
    }
  }

  markPositive(id: string, weight = 1): void {
    const s = this.stickers.get(id);
    if (s) {
      s.positiveReactions += weight;
      this.markDirty();
    }
  }

  markNegative(id: string, weight = 1): void {
    const s = this.stickers.get(id);
    if (s) {
      s.negativeReactions += weight;
      this.markDirty();
    }
  }

  // ── 每日限额 ──

  /** 检查并递增某群的每日计数；超限返回 false */
  checkDailyLimit(groupId: string, maxPerDay: number): boolean {
    const count = dailyCountMap.get(groupId) ?? 0;
    if (count >= maxPerDay) return false;
    dailyCountMap.set(groupId, count + 1);
    return true;
  }

  // ── 统计 ──

  stats(): StickerStoreStats {
    const all = this.all();
    const totalSizeKB = all.reduce((s, x) => s + x.size, 0) / 1024;
    const tagSet = new Set<string>();
    for (const s of all) for (const t of s.tags) tagSet.add(t);

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

  private markDirty(): void {
    this.dirty = true;
  }

  private async fileExists(p: string): Promise<boolean> {
    try { await fs.access(p); return true; } catch { return false; }
  }

  private async backup(): Promise<void> {
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
        const old = files.shift()!;
        await fs.unlink(resolve(dir, old));
      }
    } catch {
      // 首次保存前没有旧文件，忽略
    }
  }
}
