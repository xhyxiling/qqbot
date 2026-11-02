/**
 * dsh-im-qqbot 插件配置 Schema
 */
import Schema from '@deepseek-ai/schemastery';
import { DEFAULT_VOICE_ID, DEFAULT_VOICE_MODEL } from './voice/voice-presets.ts';

// 单一来源：默认模型/音色由音色预设模块定义，这里再导出供其余模块引用
export { DEFAULT_VOICE_ID, DEFAULT_VOICE_MODEL };

export interface AccessControlConfig {
  /** C2C 访问模式 */
  c2cMode: 'open' | 'allowlist' | 'disabled';
  /** C2C 白名单（user openid） */
  c2cAllow: string[];
  /** 群聊访问模式 */
  groupMode: 'open' | 'allowlist' | 'disabled';
  /** 群聊白名单（group openid） */
  groupAllow: string[];
}

/**
 * 身份识别：按当前场景的 openid 判定发送者身份，注入 `[身份: 主人]` 等标签。
 *
 * 私聊用 user_openid、群聊用 member_openid，两者不同，需要分别添加。
 */
export interface IdentityConfig {
  /** 是否启用身份识别与标签注入 */
  enabled: boolean;
  /** 主人 openid */
  ownerOpenIds: string[];
  /** 管理员 openid */
  adminOpenIds: string[];
  /** 朋友 openid */
  friendOpenIds: string[];
}

/**
 * 记忆与关系状态：按会话持久化互动次数、关系阶段与要点记忆。
 *
 * 数据落在 ~/.dsh-qqbot/memory.json，与会话历史相互独立：
 * `/new` 清空上下文后记忆仍在，重启后也保留。
 */
export interface MemoryConfig {
  /** 是否启用记忆与关系状态（关闭后不写盘、不注入） */
  enabled: boolean;
  /** 是否自动从用户自述中捕获要点（"我叫… / 我喜欢…"） */
  autoCapture: boolean;
  /** 每个会话最多保留的记忆条数（超出后淘汰最旧的） */
  maxNotes: number;
}

export interface MediaConfig {
  /** 是否启用富媒体理解（图片/视频下载 + 工具分析） */
  enabled: boolean;
  /** 富媒体下载大小上限（MB），默认 200 */
  maxMB: number;
  /** 富媒体存活时长（小时，TTL），默认 24，0 = 永不过期 */
  ttlHours: number;
}

export interface VisionConfig {
  /** 是否启用视觉理解（qqbot_describe_image 工具） */
  enabled: boolean;
  /** 视觉模型 provider（dsh 注册的 llm adapter，如 pi-ai） */
  provider: string;
  /** 视觉模型 id（如 qwen-vl-max） */
  model: string;
  /** 默认描述 prompt（调用未显式指定时使用） */
  defaultPrompt: string;
  /** 图片字节上限，默认 10MB */
  maxBytes: number;
  /** 输出 token 上限 */
  maxTokens: number;
  /** 视觉调用超时(ms) */
  timeoutMs: number;
}

/** 附件发送配置（qqbot_send_file 工具与 present 交付物投递共用） */
export interface SendFileConfig {
  /** 是否启用路径白名单（默认 true，仅允许 media + cwd + extraRoots；关闭则任意路径） */
  restrictPaths: boolean;
  /** 额外允许访问的根目录（media 和 agent cwd 始终默认允许） */
  extraRoots: string[];
  /** 是否把 present 声明的交付文件在轮末发送到当前会话 */
  sendPresentedFiles: boolean;
  /** 单轮最多投递的交付文件数 */
  maxFiles: number;
}

/**
 * 颜文字配置：必须显式 `enabled: true` 才生效。
 *
 * 注意不能以「出现 kaomoji 对象」作为开关：Schema 会为每个人格
 * 物化默认子对象，否则所有未配置的人格都会被误开启。
 * 风格库见 `src/expressions/kaomoji.ts`；运行时拼进 system prompt，
 * 不依赖工具调用。
 */
export interface KaomojiConfig {
  /** 是否启用（缺省 false） */
  enabled?: boolean;
  /** 预设风格 id（daily / genki / chuuni / cat / tsundere / soft / cool / maid），缺省 daily */
  style?: string;
  /** 自定义补充颜文字（最多 20 条） */
  custom?: string[];
  /** 一条回复最多使用几个颜文字（1–3，缺省 1） */
  maxPerReply?: number;
}

/** 人格语音音色覆盖（可选；不写就用全局 `voice.voice`） */
export interface PersonaVoiceConfig {
  /** 音色 id（如 longanfengyue_v3.1；需与全局语音模型同一代际） */
  voice?: string;
  /** 语速倍率（0.5–2，缺省 1） */
  rate?: number;
  /** 音量（0–100，缺省 50） */
  volume?: number;
  /** 情感/语气指令（自然语言，缺省沿用全局 `voice.instruction`；会与本轮 instruction 叠加下发） */
  instruction?: string;
}

/**
 * 表达方式配置（颜文字 / 语音音色等）。
 *
 * 后续表情包（图片）可在同一容器下新增 `sticker` 字段，
 * 人格侧只需增加一个子项，不必再动 `PersonaPreset`。
 */
export interface ExpressionsConfig {
  kaomoji?: KaomojiConfig;
  /** 该人格的语音音色覆盖（语音功能本身由全局 `voice.enabled` + `voice.apiKey` 控制） */
  voice?: PersonaVoiceConfig;
}

/** 语音单次朗读字数上限（QQ 语音不宜过长） */
export const DEFAULT_VOICE_MAX_CHARS = 300;
/** 语音合成超时(ms) */
export const DEFAULT_VOICE_TIMEOUT_MS = 30000;
/**
 * 情感/语气指令长度上限。
 *
 * 允许模型写「场景 + 逐句走向」（如：场景：夜里她叫住学长…；第1句轻声迟疑…；
 * 第2句吞吐犹豫…），真实账号实测 400 字以内可正常合成；再长只是稀释指令。
 */
export const MAX_VOICE_INSTRUCTION_LEN = 400;

/**
 * 用户手动添加的音色条目（面板里可增删）。
 *
 * 与 `src/voice/voice-presets.ts` 的内置系统音色不同：这里放的是用户自己的
 * 声音复刻 / 声音设计音色 id（与账号和模型绑定），因此默认空数组，
 * 且面板下拉里排在系统预设之前（新增项置顶）。
 */
export interface VoicePresetEntry {
  /** 展示名称（下拉里显示的提示文案） */
  name: string;
  /** 音色 id（如 qwen-audio-3.1-tts-plus-vd-bailian-xxx） */
  voice: string;
}

/**
 * 出站语音（TTS）配置。
 *
 * **门控语义：`enabled` 为 false 或 `apiKey` 为空时语音功能完全关闭**——
 * 不注册 qqbot_voice 工具、不合成、不发语音，行为与没有这项配置时一致
 * （不消耗额度）。`enabled` 默认 true：已有 Key 的配置升级后行为不变，
 * 想停用语音时关开关即可，不需要清除 Key。
 */
export interface VoiceConfig {
  /** 语音总开关（关闭后即使已保存 Key 也不启用；默认 true） */
  enabled: boolean;
  /** DashScope API Key（留空同样无法启用语音） */
  apiKey: string;
  /** 语音模型 id */
  model: string;
  /** 默认音色 id（人格可用 `expressions.voice.voice` 覆盖） */
  voice: string;
  /** 情感/语气指令（自然语言：语速、情绪、说话方式） */
  instruction: string;
  /** 用户手动添加的音色（排在内置系统预设之前） */
  presets: VoicePresetEntry[];
  /** 自定义 WebSocket 地址（自定义 MaaS 网关时填完整 wss 地址） */
  baseUrl: string;
  /** 百炼业务空间 id（走 MaaS 网关时用于拼默认地址与请求头） */
  workspace: string;
  /** 单次朗读的最大字数（超出截断） */
  maxChars: number;
  /** 合成超时(ms) */
  timeoutMs: number;
}

/** 人格预设条目（QQ 端可用 /persona 切换） */
export interface PersonaPreset {
  /** 稳定标识（命令用，字母/数字/-/_，唯一） */
  id: string;
  /** 展示名称 */
  name: string;
  /** 该人格的 system prompt */
  prompt: string;
  /**
   * 该人格可用的工具名白名单（硬约束：运行时限制模型可见的工具）。
   *
   * 缺省（不写）表示使用默认放行清单（插件内置工具 + 只读联网/提问能力）；
   * 配置为空数组表示该人格没有任何工具能力。
   */
  tools?: string[];
  /** 表达方式（颜文字；后续可扩展表情包） */
  expressions?: ExpressionsConfig;
}

export interface ImQQBotConfig {
  /** QQ Bot AppID */
  appId: string;
  /** QQ Bot AppSecret */
  appSecret: string;
  /** dsh LLM 提供商名称 */
  provider?: string;
  /** 模型名称 */
  model?: string;
  /** Agent preset id */
  preset?: string;
  /** Agent 工作目录（缺省 ~/.dsh-qqbot/workspace，不随宿主进程 cwd） */
  cwd?: string;
  /** 是否启用群消息 @mention 门控 */
  requireMention: boolean;
  /** 全局 system prompt（所有群聊/私聊生效，不含人格差异） */
  globalPrompt: string;
  /** 人格预设列表（QQ 端 /persona 切换） */
  personas: PersonaPreset[];
  /** 默认人格 id；空字符串 = 不启用默认人格 */
  defaultPersona: string;
  /** 单条消息最大长度（QQ 限制约 5000 字符） */
  textChunkLimit: number;
  /** 是否启用流式输出（群聊始终不启用） */
  streaming: boolean;
  /** 回复拆分方式：none=仅按长度切分；delimiter=按固定分隔符 |||（出现分隔符时剩余换行也拆）；line=每个换行一条；paragraph=按空行分段 */
  replySplitMode: 'none' | 'delimiter' | 'line' | 'paragraph';
  /** 拆分后每条消息之间的间隔(ms)，0=不等候（顺序发送，避免平台限流时可用） */
  replySplitIntervalMs: number;
  /** 每会话最大闲置时长(ms)，超时自动回收 */
  sessionIdleTimeout: number;
  /** 并发队列最大长度 */
  maxQueue: number;
  /** 处理超时(ms)，超时中断当前 LLM 调用 */
  processingTimeoutMs: number;
  /** 待答问题超时(ms)，超时自动拒绝并提示（ask_user_question） */
  askTimeoutMs: number;
  /** 群历史缓冲条数 */
  historyLimit: number;
  /** 身份识别（主人/管理员/朋友/陌生人） */
  identity: IdentityConfig;
  /** 记忆与关系状态 */
  memory: MemoryConfig;
  /** 访问控制 */
  access: AccessControlConfig;
  /** 是否展示工具调用成功结果（工具错误始终展示） */
  showToolResults: boolean;
  /** 调试模式 */
  debug: boolean;
  /** 富媒体理解（图片/视频） */
  media: MediaConfig;
  /** 视觉理解（qqbot_describe_image 工具，走 dsh llm + attachments） */
  vision: VisionConfig;
  /** 附件发送（qqbot_send_file 工具与交付物投递共用） */
  sendFile: SendFileConfig;
  /** 出站语音（TTS）；开关关闭或 apiKey 为空时整体关闭 */
  voice: VoiceConfig;
}

/** 身份识别子 Schema（独立导出：config 路由的服务端校验复用） */
export const IdentitySchema: Schema<IdentityConfig> = Schema.object({
  enabled: Schema.boolean().default(true).description('是否启用身份识别（按 openid 注入身份标签）'),
  ownerOpenIds: Schema.array(Schema.string()).default([]).description('主人 openid（私聊/群聊需分别添加）'),
  adminOpenIds: Schema.array(Schema.string()).default([]).description('管理员 openid'),
  friendOpenIds: Schema.array(Schema.string()).default([]).description('朋友 openid'),
});

/** 记忆与关系状态子 Schema（独立导出：config 路由的服务端校验复用） */
export const MemorySchema: Schema<MemoryConfig> = Schema.object({
  enabled: Schema.boolean().default(true).description('是否启用记忆与关系状态'),
  autoCapture: Schema.boolean().default(true).description('是否自动捕获用户自述要点'),
  maxNotes: Schema.number().default(20).description('每个会话最多保留的记忆条数'),
});

/** 访问控制子 Schema（独立导出：config 路由的服务端校验复用） */
export const AccessControlSchema: Schema<AccessControlConfig> = Schema.object({
  c2cMode: Schema.union(['open', 'allowlist', 'disabled']).default('allowlist').description('C2C访问模式（默认白名单，空名单拒绝所有人）'),
  c2cAllow: Schema.array(Schema.string()).default([]).description('C2C白名单（QQ OpenID）'),
  groupMode: Schema.union(['open', 'allowlist', 'disabled']).default('open').description('群聊访问模式（默认开放：群自带进群门槛 + @bot 触发）'),
  groupAllow: Schema.array(Schema.string()).default([]).description('群聊白名单（群 OpenID）'),
});

/** 颜文字子 Schema（独立导出：config 路由的服务端校验复用） */
export const KaomojiConfigSchema: Schema<KaomojiConfig> = Schema.object({
  enabled: Schema.boolean().default(false)
    .description('是否启用颜文字（必须显式 true）'),
  style: Schema.string().default('daily')
    .description('颜文字风格 id（daily/genki/chuuni/cat/tsundere/soft/cool/maid）'),
  custom: Schema.array(Schema.string()).default([])
    .description('自定义补充颜文字（最多 20 条，每条 ≤32 字）'),
  maxPerReply: Schema.number().default(1)
    .description('一条回复最多使用几个颜文字（1–3）'),
});

/** 人格语音音色子 Schema（全部可选：未配置时继承全局音色） */
export const PersonaVoiceSchema: Schema<PersonaVoiceConfig> = Schema.object({
  voice: Schema.string().description('音色 id（如 longanfengyue_v3.1；缺省使用全局 voice.voice）'),
  rate: Schema.number().description('语速倍率（0.5–2，缺省 1）'),
  volume: Schema.number().description('音量（0–100，缺省 50）'),
  instruction: Schema.string().description('情感/语气指令（自然语言；缺省使用全局 voice.instruction；会与本轮 instruction 叠加下发，不会被顶掉）'),
});

/** 自定义音色子 Schema（用户手动添加的音色：名称 + id） */
export const VoicePresetEntrySchema: Schema<VoicePresetEntry> = Schema.object({
  name: Schema.string().description('展示名称（如下拉里的「元气少女」）'),
  voice: Schema.string().description('音色 id（声音复刻/声音设计得到的专属 id）'),
});

/** 表达方式子 Schema（出现即启用；后续可扩展 sticker） */
export const ExpressionsSchema: Schema<ExpressionsConfig> = Schema.object({
  kaomoji: KaomojiConfigSchema,
  voice: PersonaVoiceSchema,
});

/** 语音合成子 Schema（独立导出：config 路由的服务端校验复用） */
export const VoiceConfigSchema: Schema<VoiceConfig> = Schema.object({
  enabled: Schema.boolean().default(true)
    .description('语音总开关；关闭后即使已保存 Key 也不合成、不发语音（默认 true）'),
  apiKey: Schema.string().default('')
    .description('DashScope API Key；留空则不启用语音（开关打开也需要 Key 才生效）'),
  model: Schema.string().default(DEFAULT_VOICE_MODEL)
    .description('语音模型 id（面板里是下拉：qwen-audio-3.1/3.0-tts-flash/plus；其他模型请手动填写 id）'),
  voice: Schema.string().default(DEFAULT_VOICE_ID)
    .description('默认音色 id（如 longanfengyue_v3.1；音色 id 与模型代际绑定，3.0 音色不能用在 3.1 上）'),
  instruction: Schema.string().default('')
    .description('情感/语气指令：可写成「场景 + 逐句走向」（如「场景：夜里她叫住学长…；第1句轻声迟疑…；第2句吞吐犹豫…」）；本轮 instruction 会与它叠加下发'),
  presets: Schema.array(VoicePresetEntrySchema).default([])
    .description('自定义音色（用户手动添加，面板下拉里排在系统预设之前）'),
  baseUrl: Schema.string().default('')
    .description('自定义 WebSocket 地址（缺省走 DashScope 官方网关）'),
  workspace: Schema.string().default('')
    .description('百炼业务空间 id（走 MaaS 网关时用于拼地址与请求头）'),
  maxChars: Schema.number().default(DEFAULT_VOICE_MAX_CHARS)
    .description('单次朗读的最大字数（超出截断）'),
  timeoutMs: Schema.number().default(DEFAULT_VOICE_TIMEOUT_MS)
    .description('语音合成超时(ms)'),
});

/** 人格预设子 Schema（独立导出：config 路由的服务端校验复用） */
export const PersonaPresetSchema: Schema<PersonaPreset> = Schema.object({
  id: Schema.string().description('人格标识（字母/数字/-/_，唯一）'),
  name: Schema.string().description('人格展示名称'),
  prompt: Schema.string().description('该人格的 system prompt'),
  tools: Schema.array(Schema.string())
    .description('可用工具白名单（缺省 = 默认放行清单；空数组 = 无工具；清单外的宿主工具一律禁用）'),
  expressions: ExpressionsSchema.description('表达方式（颜文字等；缺省不启用）'),
});

export const ConfigSchema: Schema<ImQQBotConfig> = Schema.object({
  appId: Schema.string().default('').description('QQ 机器人 AppID'),
  appSecret: Schema.string().default('').description('QQ 机器人 AppSecret'),
  provider: Schema.string().description('LLM provider name'),
  model: Schema.string().description('Model name'),
  preset: Schema.string().description('Agent preset id'),
  cwd: Schema.string().description('Agent working directory (default ~/.dsh-qqbot/workspace)'),
  requireMention: Schema.boolean().default(true).description('群聊是否需要@bot触发'),
  globalPrompt: Schema.string().default('')
    .description('全局 system prompt（所有群聊/私聊生效，建议写多条消息分隔规则）'),
  personas: Schema.array(PersonaPresetSchema).default([])
    .description('人格预设列表（QQ 端 /persona 切换）'),
  defaultPersona: Schema.string().default('')
    .description('默认人格 id，留空表示不启用默认人格'),
  textChunkLimit: Schema.number().default(4500).description('单条消息最大字符数'),
  streaming: Schema.boolean().default(true).description('是否启用流式输出（群聊始终不启用）'),
  replySplitMode: Schema.union(['none', 'delimiter', 'line', 'paragraph']).default('none')
    .description('回复拆分方式：none=按长度，delimiter=按固定分隔符 |||（推荐；出现分隔符时剩余换行也拆，避免气泡里夹断行），line=每个换行一条，paragraph=按空行分段'),
  replySplitIntervalMs: Schema.number().default(0)
    .description('拆分后每条消息之间的间隔(ms)，0=不等候'),
  sessionIdleTimeout: Schema.number().default(30 * 60 * 1000).description('会话闲置超时(ms)'),
  maxQueue: Schema.number().default(20).description('并发队列最大长度'),
  processingTimeoutMs: Schema.number().default(30 * 60 * 1000).description('处理超时(ms)，超时中断当前 LLM 调用'),
  askTimeoutMs: Schema.number().default(5 * 60 * 1000).description('待答问题超时(ms)，超时自动拒绝并提示'),
  historyLimit: Schema.number().default(10).description('群历史缓冲条数'),
  access: AccessControlSchema.default({
    c2cMode: 'open',
    c2cAllow: [],
    groupMode: 'open',
    groupAllow: [],
  }).description('访问控制'),
  identity: IdentitySchema.default({
    enabled: true,
    ownerOpenIds: [],
    adminOpenIds: [],
    friendOpenIds: [],
  }).description('身份识别（主人/管理员/朋友/陌生人）'),
  memory: MemorySchema.default({
    enabled: true,
    autoCapture: true,
    maxNotes: 20,
  }).description('记忆与关系状态'),
  showToolResults: Schema.boolean().default(false).description('是否展示工具调用成功结果（错误始终展示）'),
  debug: Schema.boolean().default(false),
  media: Schema.object({
    enabled: Schema.boolean().default(true).description('是否启用富媒体理解（图片/视频下载 + 工具分析）'),
    maxMB: Schema.number().default(200).description('富媒体下载大小上限(MB)'),
    ttlHours: Schema.number().default(24).description('富媒体存活时长(小时)，0=永不过期'),
  }).default({
    enabled: true,
    maxMB: 200,
    ttlHours: 24,
  }).description('富媒体理解配置'),
  vision: Schema.object({
    enabled: Schema.boolean().default(false).description('是否启用视觉理解（qqbot_describe_image 工具）'),
    provider: Schema.string().default('').description('视觉模型 provider（dsh 注册的 llm adapter，如 pi-ai）'),
    model: Schema.string().default('').description('视觉模型 id（如 qwen-vl-max）'),
    defaultPrompt: Schema.string().default('Describe this image in detail.').description('默认描述 prompt'),
    maxBytes: Schema.number().default(10 * 1024 * 1024).description('图片字节上限'),
    maxTokens: Schema.number().default(1024).description('输出 token 上限'),
    timeoutMs: Schema.number().default(120000).description('视觉调用超时(ms)'),
  }).default({
    enabled: false,
    provider: '',
    model: '',
    defaultPrompt: 'Describe this image in detail.',
    maxBytes: 10 * 1024 * 1024,
    maxTokens: 1024,
    timeoutMs: 120000,
  }).description('视觉理解配置'),
  sendFile: Schema.object({
    restrictPaths: Schema.boolean().default(true).description('是否启用路径白名单（默认 true，仅允许 media + cwd + extraRoots）'),
    extraRoots: Schema.array(Schema.string()).default([]).description('额外允许访问的根目录'),
    sendPresentedFiles: Schema.boolean().default(true).description('是否将 present 声明的交付文件发送到当前会话'),
    maxFiles: Schema.number().default(4).description('单轮最多投递的交付文件数'),
  }).default({
    restrictPaths: true,
    extraRoots: [],
    sendPresentedFiles: true,
    maxFiles: 4,
  }).description('附件发送配置'),
  voice: VoiceConfigSchema.default({
    enabled: true,
    apiKey: '',
    model: DEFAULT_VOICE_MODEL,
    voice: DEFAULT_VOICE_ID,
    instruction: '',
    presets: [],
    baseUrl: '',
    workspace: '',
    maxChars: DEFAULT_VOICE_MAX_CHARS,
    timeoutMs: DEFAULT_VOICE_TIMEOUT_MS,
  }).description('出站语音（TTS）配置；开关关闭或 apiKey 为空时语音功能关闭'),
});
