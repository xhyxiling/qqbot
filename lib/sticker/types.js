/**
 * 表情包模块类型定义 — 复用项目已有的风格（无装饰器、Schema 手动声明）
 */
/** 默认配置 */
export const DEFAULT_STICKER_CONFIG = {
    enabled: false,
    collector: {
        enabled: true,
        watchGroups: [],
        skipSenders: [],
        minSizeKB: 5,
        maxSizeKB: 2048,
        maxPerGroupPerDay: 50,
        autoTag: true,
    },
    selector: {
        enabled: true,
        strategy: 'mood-match',
        minIntervalSec: 120,
        maxIntervalSec: 600,
        maxConsecutiveStickers: 3,
        proactiveProbability: 0.15,
    },
    evolver: {
        enabled: true,
        checkIntervalHours: 24,
        hotExpireDays: 7,
        minKeepCount: 50,
        maxEvictPerRun: 10,
        learningRate: 0.1,
    },
    storage: {
        metadataPath: '', // 运行时解析到 ~/.dsh-qqbot/stickers.json
        imagesDir: '', // 空 = 复用 ~/.dsh-qqbot/media；填了就独立存储
        autoBackup: true,
        backupRetention: 5,
    },
};
//# sourceMappingURL=types.js.map