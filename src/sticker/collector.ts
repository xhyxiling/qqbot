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
import { extname, basename, resolve } from 'node:path';
import type { Logger, RawAttachment } from '../types.ts';
import { classifyContentType, type DownloadedFile } from '../transport/attachment.ts';
import type { StickerCollectorConfig } from './types.ts';
import { StickerStore } from './storage.ts';
import type { Sticker } from './types.ts';
import { correctPathExt, correctBasenameExt, detectImageExt } from './signature.ts';
import { describeImage, type DescribeImageServices } from '../media/describe-image.ts';
import type { VisionConfig } from '../config.ts';

/** 允许的扩展名（与 QQ 网关一致） */
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp']);

/** 给视觉模型的 prompt：生成一句话画面描述 + 几个关键词标签 */
const STICKER_DESCRIBE_PROMPT =
  '这是一张聊天表情包/贴图。请用一句话描述画面内容（主体 + 动作/表情，不超过 30 字），'
  + '然后另起一行给出 3-6 个中文关键词标签（逗号分隔），标签要概括画面主体和情绪，适合做表情包检索。\n'
  + '如果画面是知名 IP 角色（如奶龙、奶蛙、皮卡丘、蜡笔小新、LINE FRIENDS、小黄人、熊猫头、doge 等），'
  + '必须在描述和标签里写出 IP 名；同系列角色要带上系列名（例如奶蛙 → 标签含「奶龙、奶蛙」），'
  + '这样用户搜系列名时能命中。实在认不出时描述外形特征即可，不要硬编。\n'
  + '格式示例：\n'
  + '奶蛙瘫坐在地上吐舌头\n'
  + '奶龙,奶蛙,瘫坐,吐舌头,摆烂';

export class StickerCollector {
  private readonly config: StickerCollectorConfig;
  private readonly store: StickerStore;
  private readonly logger: Logger;
  private readonly vision?: { services: DescribeImageServices; config: VisionConfig };
  private backfillCancelled = false;

  constructor(
    config: StickerCollectorConfig,
    store: StickerStore,
    logger: Logger,
    vision?: { services: DescribeImageServices; config: VisionConfig },
  ) {
    this.config = config;
    this.store = store;
    this.logger = logger;
    this.vision = vision;
  }

  /** 收藏大小限制（KB），供工具做前置校验并给出明确提示 */
  get sizeLimits(): { minKB: number; maxKB: number } {
    return { minKB: this.config.minSizeKB, maxKB: this.config.maxSizeKB };
  }

  /**
   * 调视觉模型给图片生成描述 + 标签。
   * 失败（超时/无网/配置不全）时返回 undefined，调用方降级用原逻辑，不阻塞收藏。
   */
  private async maybeDescribe(filePath: string): Promise<{ description: string; tags: string[] } | undefined> {
    if (!this.config.autoDescribe || !this.vision) return undefined;
    const { services, config: vision } = this.vision;
    if (!vision.enabled || !vision.provider || !vision.model) return undefined;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), vision.timeoutMs);
    try {
      const text = await describeImage(services, vision, filePath, STICKER_DESCRIBE_PROMPT, controller.signal, 'sticker-describe');
      const { description, tags } = this.parseDescribeOutput(text);
      if (description) return { description, tags };
      return undefined;
    } catch (err) {
      this.logger.debug(`sticker-collector: 视觉描述失败 ${basename(filePath)}: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 解析视觉模型输出：第一行描述，第二行标签 */
  private parseDescribeOutput(text: string): { description: string; tags: string[] } {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const description = lines[0] ?? '';
    // 最后一行如果是逗号/顿号分隔的短词，当标签；否则从描述里抽
    let tags: string[] = [];
    const tagLine = lines[lines.length - 1] ?? '';
    if (lines.length > 1 && /[,，、]/.test(tagLine) && tagLine.length < 60) {
      tags = tagLine.split(/[,，、]/).map((t) => t.trim()).filter((t) => t.length >= 2 && t.length <= 12);
    }
    return { description: description.slice(0, 60), tags: tags.slice(0, 6) };
  }

  /** 取消正在进行的 backfill（engine dispose 时调用） */
  cancelBackfill(): void {
    this.backfillCancelled = true;
  }

  /**
   * 扫描独立图片目录，把有文件但没元数据记录的「孤儿」表情补录进库。
   * 只在显式配置了 imagesDir 时执行（media 目录是临时下载文件，不能扫）。
   * 典型成因：多进程并发写 json 时记录被覆盖，文件留在目录里。
   * @returns 补录成功数量
   */
  async importOrphans(limit = 50): Promise<number> {
    if (!this.config.enabled) return 0;
    if (!this.store.hasIndependentDir) return 0;

    const dir = this.store.imagesDirPath;
    let names: string[];
    try {
      names = await fs.readdir(dir);
    } catch {
      return 0;
    }

    const candidates = names
      .filter((n) => IMAGE_EXTS.has(extname(n).toLowerCase()))
      .map((n) => resolve(dir, n));

    let imported = 0;
    for (const filePath of candidates.slice(0, limit)) {
      if (this.backfillCancelled) break;
      if (await this.store.alreadyHas(filePath)) continue;
      const added = await this.collectFile(filePath);
      if (added) imported++;
    }

    if (imported > 0) {
      this.logger.info(`sticker-collector: 补录孤儿表情 ${imported} 张`);
      await this.store.flush();
    }
    return imported;
  }

  /**
   * 给库里还没有画面描述的存量图补全 description + 标签（启动后异步调用）。
   * 幂等：已有 description 的跳过；失败的跳过不阻塞；dispose 时取消。
   * @returns 成功补全的数量
   */
  async backfillMissingDescriptions(limit = 30): Promise<number> {
    if (!this.config.autoDescribe || !this.vision) return 0;
    this.backfillCancelled = false;
    const missing = this.store.all().filter((s) => !s.description).slice(0, limit);
    if (missing.length === 0) return 0;

    this.logger.info(`sticker-collector: 开始补全 ${missing.length} 张存量图的画面描述`);
    let done = 0;
    for (const s of missing) {
      if (this.backfillCancelled) break;
      const described = await this.maybeDescribe(s.filePath);
      if (described?.description) {
        this.store.updateDescription(s.id, described.description, described.tags);
        done++;
      }
    }
    if (done > 0) {
      await this.store.flush();
      this.logger.info(`sticker-collector: 存量图描述补全完成，共 ${done} 张`);
    }
    return done;
  }

  /**
   * 从单个文件路径收藏 — 给手动收藏工具用
   * @returns 新收藏的 Sticker，null 表示已存在或未收藏
   */
  async collectFile(
    filePath: string,
    source?: { groupId?: string; senderId?: string },
    context?: string,
  ): Promise<Sticker | null> {
    if (!this.config.enabled) return null;
    let buf: Buffer;
    try {
      buf = await fs.readFile(filePath);
    } catch {
      return null;
    }

    // 按真实文件头纠正路径扩展名
    const correctedPath = correctPathExt(filePath, buf);
    const correctedName = correctBasenameExt(filePath, buf);
    const detected = detectImageExt(buf);
    if (!detected) return null;

    // 扩展名没被下载层纠正过（比如缓存里还是 .jpg 的 GIF）：
    // 先落一份到纠正后的路径，后续 hash / copy 才能读到真实文件
    if (correctedPath !== filePath) {
      try {
        await fs.copyFile(filePath, correctedPath);
      } catch (err) {
        this.logger.warn(`sticker-collector: 复制到纠正路径失败 ${correctedPath}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    }

    const stat = await fs.stat(filePath);
    const sizeKB = stat.size / 1024;
    if (sizeKB < this.config.minSizeKB || sizeKB > this.config.maxSizeKB) return null;

    // 已存在的图不重复调 vision（省钱）
    const alreadyExists = await this.store.alreadyHas(correctedPath);
    const described = !alreadyExists ? await this.maybeDescribe(correctedPath) : undefined;
    const tags = this.mergeTags(described?.tags, context, correctedPath);

    const added = await this.store.tryAdd({
      filePath: correctedPath,
      filename: correctedName,
      mimeType: detected.mime,
      size: stat.size,
      sourceGroup: source?.groupId,
      sourceSender: source?.senderId,
      firstCollectedAt: Date.now(),
      tags,
      description: described?.description,
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
    context?: string,
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

      const alreadyExists = await this.store.alreadyHas(dl.localPath);
      const described = !alreadyExists ? await this.maybeDescribe(dl.localPath) : undefined;
      const finalTags = this.mergeTags(described?.tags, context, att.filename);

      const added = await this.store.tryAdd({
        filePath: dl.localPath,
        filename: basename(dl.localPath),
        mimeType,
        size: att.size,
        sourceGroup: groupOpenid,
        sourceSender: senderOpenid,
        firstCollectedAt: Date.now(),
        tags: finalTags,
        description: described?.description,
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

  /**
   * 合并多个来源的标签，优先级：vision 模型生成 > 聊天上下文 > 文件名
   * autoTag=false 时只保留 vision 生成的标签（如果有）。
   */
  private mergeTags(visionTags?: string[], context?: string, filename?: string): string[] {
    const isLikelyHash = (w: string) => /^[0-9a-f]{8,}$/i.test(w) || /^\d{10,}$/.test(w);
    const clean = (w: string) => {
      const t = w.trim().toLowerCase();
      if (t.length < 2 || t.length > 20) return null;
      if (isLikelyHash(t)) return null;
      return t;
    };

    const pool: string[] = [];
    const seen = new Set<string>();
    const push = (w: string | null | undefined) => {
      if (!w) return;
      const c = clean(w);
      if (c && !seen.has(c)) { seen.add(c); pool.push(c); }
    };

    // 1. 视觉模型标签（最高优先级）
    for (const t of visionTags ?? []) push(t);

    if (this.config.autoTag) {
      // 2. 聊天上下文
      if (context) {
        for (const word of context.split(/[\s,，。！!?？、《》()（）\[\]【】"'""''\-—]+/)) push(word);
      }
      // 3. 文件名兜底（去掉 hash 和长数字）
      if (filename) {
        const base = basename(filename, extname(filename));
        for (const word of base.split(/[_-\s]+/)) push(word);
      }
    }

    return pool.slice(0, 8);
  }
}
