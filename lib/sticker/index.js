import { DEFAULT_STICKER_CONFIG } from "./types.js";
import { StickerStore } from "./storage.js";
import { StickerCollector } from "./collector.js";
import { StickerSelector } from "./selector.js";
import { StickerEvolver } from "./evolver.js";
export { DEFAULT_STICKER_CONFIG, StickerStore, StickerCollector, StickerSelector, StickerEvolver };
/**
 * 表情包引擎 — 一个聚合了收藏/选择/进化的高层对象
 * bootstrap 创建一个实例，传进 handleInbound / 注册工具时使用
 */
export class StickerEngine {
    store;
    collector;
    selector;
    evolver;
    logger;
    started = false;
    constructor(config, logger) {
        this.logger = logger;
        this.store = new StickerStore(config.storage, logger);
        this.collector = new StickerCollector(config.collector, this.store, logger);
        this.selector = new StickerSelector(config.selector, this.store, logger);
        this.evolver = new StickerEvolver(config.evolver, this.store, logger);
    }
    /** 启动（bootstrap 里调用） — 加载元数据 + 启动进化定时器 */
    async start() {
        if (this.started)
            return;
        await this.store.load();
        const stats = this.store.stats();
        this.logger.info(`sticker-engine: 就绪 — ${stats.total} 个表情, ${stats.uniqueTags} 个标签, ` +
            `平均热度 ${stats.avgHotScore}, 占用 ${stats.totalSizeKB}KB`);
        this.evolver.start();
        this.started = true;
    }
    /** 关闭（shutdown 时调用）— 刷盘 + 停定时器 */
    async dispose() {
        this.evolver.stop();
        await this.store.flush();
        this.store.dispose();
        this.logger.info('sticker-engine: 已关闭');
    }
}
/** 合并配置（缺省补默认值） */
export function mergeStickerConfig(partial = {}) {
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
// 用模块变量持有 singleton：bootstrap 设置 -> inbound 读取。
let _activeEngine = null;
/** bootstrap 完成后调用，注册当前活跃的 StickerEngine */
export function registerStickerEngine(engine) {
    _activeEngine = engine;
}
/** inbound 里取活跃引擎（可能为 null = 未启用或未启动） */
export function getActiveStickerEngine() {
    return _activeEngine;
}
//# sourceMappingURL=index.js.map