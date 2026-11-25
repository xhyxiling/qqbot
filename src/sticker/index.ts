/**
 * 表情包模块主入口 — 组装 store / collector / selector / evolver
 *
 * 与 dsh-plugin-qq-bot-sticker-evolver 独立包的差异：
 *   1. 不做成 Cordis Service（没有 @deepseek-ai/cordis 装饰器），是普通 class
 *   2. 收藏器直接消费 qqbot 已下载的附件路径，不自己下载
 *   3. selector 输出 filePath，直接传给 qqbot_send_file
 *
 * 生命周期：bootstrapGateway 创建并 start，shutdown 时 dispose
 */
import type { Logger } from '../types.ts';
import type { StickerConfig } from './types.ts';
import { DEFAULT_STICKER_CONFIG } from './types.ts';
import { StickerStore } from './storage.ts';
import { StickerCollector } from './collector.ts';
import { StickerSelector } from './selector.ts';
import { StickerEvolver } from './evolver.ts';
import type { VisionConfig } from '../config.ts';
import type { DescribeImageServices } from '../media/describe-image.ts';

export { DEFAULT_STICKER_CONFIG, StickerStore, StickerCollector, StickerSelector, StickerEvolver };
export type { StickerConfig, StickerSelectionContext } from './types.ts';
export type { EvolutionReport, EvolutionStatus } from './evolver.ts';
export type { DescribeImageServices } from '../media/describe-image.ts';

/** 视觉服务注入：llm + attachments 运行时 + vision 配置 */
export interface StickerVisionDeps {
  services: DescribeImageServices;
  config: VisionConfig;
}

/**
 * 表情包引擎 — 一个聚合了收藏/选择/进化的高层对象
 * bootstrap 创建一个实例，传进 handleInbound / 注册工具时使用
 */
export class StickerEngine {
  readonly store: StickerStore;
  readonly collector: StickerCollector;
  readonly selector: StickerSelector;
  readonly evolver: StickerEvolver;
  private readonly logger: Logger;
  private readonly vision?: StickerVisionDeps;
  private started = false;
  private backfillTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: StickerConfig, logger: Logger, vision?: StickerVisionDeps) {
    this.logger = logger;
    this.vision = vision;

    this.store = new StickerStore(config.storage, logger);
    this.collector = new StickerCollector(config.collector, this.store, logger, vision);
    this.selector = new StickerSelector(config.selector, this.store, logger);
    this.evolver = new StickerEvolver(config.evolver, this.store, logger);
  }

  /** 启动（bootstrap 里调用） — 加载元数据 + 启动进化定时器 */
  async start(): Promise<void> {
    if (this.started) return;
    await this.store.load();

    const stats = this.store.stats();
    this.logger.info(
      `sticker-engine: 就绪 — ${stats.total} 个表情, ${stats.uniqueTags} 个标签, ` +
      `平均热度 ${stats.avgHotScore}, 占用 ${stats.totalSizeKB}KB`
    );

    this.evolver.start();
    this.started = true;

    // 启动 5 秒后：先补录有文件没记录的孤儿表情，再给缺描述的图补画面描述
    // （不阻塞启动；失败仅 warn）
    this.backfillTimer = setTimeout(() => {
      this.collector.importOrphans(50)
        .then((n) => {
          if (n > 0) this.logger.info(`sticker-engine: 启动时补录 ${n} 张孤儿表情`);
          return this.vision ? this.collector.backfillMissingDescriptions(30) : 0;
        })
        .catch((err) => {
          this.logger.warn(`sticker-engine: 启动补录/补描述失败: ${err instanceof Error ? err.message : String(err)}`);
        });
    }, 5000);
  }

  /** 关闭（shutdown 时调用）— 刷盘 + 停定时器 */
  async dispose(): Promise<void> {
    if (this.backfillTimer) {
      clearTimeout(this.backfillTimer);
      this.backfillTimer = null;
    }
    this.collector.cancelBackfill();
    this.evolver.stop();
    await this.store.flush();
    this.store.dispose();
    this.logger.info('sticker-engine: 已关闭');
  }
}

/** 合并配置（缺省补默认值） */
export function mergeStickerConfig(partial: Partial<StickerConfig> = {}): StickerConfig {
  return {
    ...DEFAULT_STICKER_CONFIG,
    ...partial,
    collector: { ...DEFAULT_STICKER_CONFIG.collector, ...partial.collector },
    selector: { ...DEFAULT_STICKER_CONFIG.selector, ...partial.selector },
    evolver: { ...DEFAULT_STICKER_CONFIG.evolver, ...partial.evolver },
    storage: { ...DEFAULT_STICKER_CONFIG.storage, ...partial.storage },
  };
}

// ── 模块级单例持有者 ──
// Cordis Context 是 Service Locator（带 readonly proxy），不能直接 ctx.stickerEngine = xxx。
// 用模块变量持有 singleton：bootstrap 设置 -> inbound / tools 读取。
let _activeEngine: StickerEngine | null = null;

/** bootstrap 完成后调用，注册当前活跃的 StickerEngine */
export function registerStickerEngine(engine: StickerEngine | null): void {
  _activeEngine = engine;
}

/** inbound / tools 里取活跃引擎（可能为 null = 未启用或未启动） */
export function getActiveStickerEngine(): StickerEngine | null {
  return _activeEngine;
}

// ── 会话附件缓存 ──
// inbound 收到带图消息时把本地路径记下来，让工具侧能"最近的图"直接收藏
// 结构: Map<sessionKey, DownloadedFile[]>
const _sessionAttachments = new Map<string, Array<{ localPath: string; filename: string; size: number; timestamp: number }>>();
const MAX_ATTACHMENTS_PER_SESSION = 10; // 每个会话最多缓存 10 条
const ATTACHMENT_TTL_MS = 10 * 60 * 1000; // 10 分钟过期

/** inbound 收到下载好的图片时调用，缓存到会话 */
export function cacheSessionAttachments(
  sessionKey: string,
  files: Array<{ localPath: string; filename: string; size: number }> | undefined,
): void {
  if (!files || files.length === 0) return;
  const now = Date.now();
  const existing = _sessionAttachments.get(sessionKey) ?? [];
  const fresh = files.map((f) => ({ ...f, timestamp: now }));
  // 合并后截取最近 N 条
  const merged = [...fresh, ...existing].slice(0, MAX_ATTACHMENTS_PER_SESSION);
  _sessionAttachments.set(sessionKey, merged);

  // 定期清理过期
  for (const [key, list] of _sessionAttachments) {
    const valid = list.filter((item) => now - item.timestamp < ATTACHMENT_TTL_MS);
    if (valid.length === 0) _sessionAttachments.delete(key);
    else if (valid.length !== list.length) _sessionAttachments.set(key, valid);
  }
}

/** 工具侧取最近的缓存图片（不传时返回最新 1 张） */
export function getLatestSessionAttachment(sessionKey: string): { localPath: string; filename: string } | null {
  const list = _sessionAttachments.get(sessionKey);
  if (!list || list.length === 0) return null;
  // 按时间倒序，最新的在最前
  list.sort((a, b) => b.timestamp - a.timestamp);
  return { localPath: list[0]!.localPath, filename: list[0]!.filename };
}
