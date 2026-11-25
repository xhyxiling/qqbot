/**
 * 表情包收藏器 — 从已下载的媒体附件中自动收藏表情
 *
 * 与原 dsh-plugin-qq-bot-sticker-evolver 的关键差异：
 *   - 不再自己下载图片：QQ 附件下载已经在 attachment.ts 的 downloadMediaAttachments
 *     里做好了，下载目录是 ~/.dsh-qqbot/media；collector 只消费 localPath
 *   - 去重用 hashFile（storage 里的方法）
 *   - 每日限额在 storage 里统一管理
 *
 * 入口：在 inbound.ts 的 handleInbound 里调用 collectFromDownloaded
 */
import { promises as fs } from 'node:fs';
import { extname, basename } from 'node:path';
import type { Logger, RawAttachment } from '../types.ts';
import { classifyContentType, type DownloadedFile } from '../transport/attachment.ts';
import type { StickerCollectorConfig } from './types.ts';
import { StickerStore } from './storage.ts';
import type { Sticker } from './types.ts';

/** 允许的扩展名（与 QQ 网关一致） */
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);

/** 猜 MIME from 文件扩展名 */
function guessMime(ext: string): string {
  const mimeMap: Record<string, string> = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.png': 'image/png', '.gif': 'image/gif',
    '.webp': 'image/webp', '.bmp': 'image/bmp',
  };
  return mimeMap[ext] ?? 'image/png';
}

export class StickerCollector {
  private readonly config: StickerCollectorConfig;
  private readonly store: StickerStore;
  private readonly logger: Logger;

  constructor(config: StickerCollectorConfig, store: StickerStore, logger: Logger) {
    this.config = config;
    this.store = store;
    this.logger = logger;
  }

  /**
   * 从单个文件路径收藏 — 给手动收藏工具用
   * @returns 新收藏的 Sticker，null 表示已存在或未收藏
   */
  async collectFile(filePath: string, source?: { groupId?: string; senderId?: string }): Promise<Sticker | null> {
    if (!this.config.enabled) return null;
    try {
      await fs.access(filePath);
    } catch {
      return null;
    }

    const ext = extname(filePath).toLowerCase();
    if (!IMAGE_EXTS.has(ext)) return null;

    const stat = await fs.stat(filePath);
    const sizeKB = stat.size / 1024;
    if (sizeKB < this.config.minSizeKB || sizeKB > this.config.maxSizeKB) return null;

    const tags = this.config.autoTag ? this.extractTags(filePath) : [];

    const added = await this.store.tryAdd({
      filePath,
      filename: basename(filePath),
      mimeType: guessMime(ext),
      size: stat.size,
      sourceGroup: source?.groupId,
      sourceSender: source?.senderId,
      firstCollectedAt: Date.now(),
      tags,
      quality: 3,
    });

    if (added) {
      this.logger.info(`sticker-collector: 手动收藏 ${added.filename}`);
    }
    return added;
  }

  /**
   * 从已经下载好的附件里尝试收藏表情
   *
   * @param attachments 原始 QQ 附件列表
   * @param downloadedFiles middleware 下载好的本地文件
   * @param groupOpenid 来源群（可选，C2C 则空）
   * @param senderOpenid 发送者 openid
   * @returns 新收藏的表情列表（已存在的不返回）
   */
  async collectFromDownloaded(
    attachments: RawAttachment[] | undefined,
    downloadedFiles: DownloadedFile[] | undefined,
    groupOpenid: string | undefined,
    senderOpenid: string,
  ): Promise<Sticker[]> {
    if (!this.config.enabled) return [];
    if (!attachments || !downloadedFiles || downloadedFiles.length === 0) return [];

    // 权限门控
    if (this.config.watchGroups.length > 0 && groupOpenid && !this.config.watchGroups.includes(groupOpenid)) {
      return [];
    }
    if (this.config.skipSenders.includes(senderOpenid)) return [];

    // 每日限额
    if (groupOpenid) {
      if (!this.store.checkDailyLimit(groupOpenid, this.config.maxPerGroupPerDay)) {
        this.logger.debug(`sticker-collector: 群 ${groupOpenid} 已达每日上限`);
        return [];
      }
    }

    // 建立 filename → DownloadedFile 映射
    const byFilename = new Map(downloadedFiles.map((d) => [d.filename, d]));

    const results: Sticker[] = [];
    for (const att of attachments) {
      const kind = classifyContentType(att.content_type);
      if (kind !== 'image') continue; // 只收藏图片

      const dl = byFilename.get(att.filename);
      if (!dl) continue; // 没下载成功跳过

      // 以纠正后的本地路径判断真实图片格式
      const ext = extname(dl.localPath).toLowerCase();
      if (!IMAGE_EXTS.has(ext)) continue;

      // 大小检查
      const sizeKB = att.size / 1024;
      if (sizeKB < this.config.minSizeKB || sizeKB > this.config.maxSizeKB) {
        this.logger.debug(`sticker-collector: 跳过 ${att.filename} (${sizeKB.toFixed(0)}KB 超限)`);
        continue;
      }

      // 检查文件是否真的存在（防 media cleaner 已清掉）
      try {
        await fs.access(dl.localPath);
      } catch {
        this.logger.debug(`sticker-collector: 文件已不存在 ${dl.localPath}`);
        continue;
      }

      // 猜 MIME
      const mimeMap: Record<string, string> = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.png': 'image/png', '.gif': 'image/gif',
        '.webp': 'image/webp', '.bmp': 'image/bmp',
      };
      const mimeType = mimeMap[ext] ?? 'image/png';

      const tags = this.config.autoTag ? this.extractTags(att.filename) : [];

      const added = await this.store.tryAdd({
        filePath: dl.localPath,
        filename: basename(dl.localPath),
        mimeType,
        size: att.size,
        sourceGroup: groupOpenid,
        sourceSender: senderOpenid,
        firstCollectedAt: Date.now(),
        tags,
        quality: 3,
      });

      if (added && added.useCount === 0 && added.hotScore === 50) {
        // tryAdd 新增的（existing 会有 useCount>0 以外的区别：这里 hotScore 都是 50，
        // 用 firstCollectedAt === Date.now() 也不够精确）— 简化判断：只要是返回值就加入
        results.push(added);
      }
    }

    return results;
  }

  /** 从文件名推断标签 */
  private extractTags(filename: string): string[] {
    const base = basename(filename, extname(filename));
    return base
      .split(/[_-\s]+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2 && w.length <= 30)
      .slice(0, 5);
  }
}
