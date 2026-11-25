/**
 * 表情包模块类型定义 — 复用项目已有的风格（无装饰器、Schema 手动声明）
 */

/** 表情包元数据 */
export interface Sticker {
  /** 唯一 ID (hash) */
  id: string;
  /** 本地文件路径（QQ 已下载的附件路径） */
  filePath: string;
  /** 文件名 */
  filename: string;
  /** MIME 类型 */
  mimeType: string;
  /** 文件大小 (bytes) */
  size: number;
  /** 来源群 openid */
  sourceGroup?: string;
  /** 来源发送者 openid */
  sourceSender?: string;
  /** 首次收藏时间戳 */
  firstCollectedAt: number;
  /** 最近使用时间戳 */
  lastUsedAt?: number;
  /** 使用次数 */
  useCount: number;
  /** 正向反馈次数（被引用/被夸） */
  positiveReactions: number;
  /** 负向反馈次数（被忽略/撤回） */
  negativeReactions: number;
  /** 自动推断的标签 */
  tags: string[];
  /** 视觉模型生成的一句话画面描述（如「橘猫翻白眼」），selector 匹配时也用 */
  description?: string;
  /** 热度分数 (0-100) */
  hotScore: number;
  /** 质量评分 (1-5) */
  quality: number;
}

/** 发送上下文（决定选哪个表情） */
export interface StickerSelectionContext {
  /** 目标群 openid */
  groupId?: string;
  /** 当前聊天话题/关键词（模型已分析好的） */
  topic: string;
  /** 情绪/氛围提示 */
  mood?: 'happy' | 'sad' | 'angry' | 'silly' | 'serious' | 'neutral';
  /** 触发类型 */
  trigger: 'proactive' | 'matching' | 'explore';
  /** 群友反应（可选，用来做个性化） */
  groupPersonas?: Record<string, string>;
}

/** 收藏子配置 */
export interface StickerCollectorConfig {
  enabled: boolean;
  /** 只收藏这些群（空数组 = 所有群） */
  watchGroups: string[];
  /** 跳过的发送者 openid */
  skipSenders: string[];
  /** 最小/最大大小 (KB) */
  minSizeKB: number;
  maxSizeKB: number;
  /** 每群每日最多收藏 */
  maxPerGroupPerDay: number;
  /** 自动从文件名提取标签 */
  autoTag: boolean;
  /** 收藏时是否调视觉模型生成画面描述（更准的 tags 来源） */
  autoDescribe: boolean;
}

/** 选择子配置 */
export interface StickerSelectorConfig {
  enabled: boolean;
  /** 发送策略 */
  strategy: 'hot' | 'random' | 'mood-match' | 'topic-match' | 'explore';
  /** 最小/最大发送间隔 (秒) */
  minIntervalSec: number;
  maxIntervalSec: number;
  /** 连续发表情的最大数量 */
  maxConsecutiveStickers: number;
  /** 主动冒泡概率 (0-1) */
  proactiveProbability: number;
}

/** 进化子配置 */
export interface StickerEvolverConfig {
  enabled: boolean;
  /** 进化检查间隔 (小时) */
  checkIntervalHours: number;
  /** 热度过期时间 (天) */
  hotExpireDays: number;
  /** 保留的最小收藏数量 */
  minKeepCount: number;
  /** 每次进化最多淘汰 */
  maxEvictPerRun: number;
  /** 学习速率 */
  learningRate: number;
}

/** 存储子配置 */
export interface StickerStorageConfig {
  /** 元数据存储路径（默认空 = ~/.dsh-qqbot/stickers.json） */
  metadataPath: string;
  /** 图片存放目录（默认空 = ~/.dsh-qqbot/media，复用 QQ 附件下载目录）。
   *  指定后 collector 会把收藏的图 copyFile 到这里（避免 media cleaner 清掉）。 */
  imagesDir: string;
  /** 是否自动备份 */
  autoBackup: boolean;
  /** 备份保留份数 */
  backupRetention: number;
}

/** 完整贴纸模块配置 */
export interface StickerConfig {
  enabled: boolean;
  collector: StickerCollectorConfig;
  selector: StickerSelectorConfig;
  evolver: StickerEvolverConfig;
  storage: StickerStorageConfig;
}

/** 默认配置 */
export const DEFAULT_STICKER_CONFIG: StickerConfig = {
  enabled: false,
  collector: {
    enabled: true,
    watchGroups: [],
    skipSenders: [],
    minSizeKB: 5,
    maxSizeKB: 2048,
    maxPerGroupPerDay: 50,
    autoTag: true,
    autoDescribe: true,
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
    imagesDir: '',    // 空 = 复用 ~/.dsh-qqbot/media；填了就独立存储
    autoBackup: true,
    backupRetention: 5,
  },
};
