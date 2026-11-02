/**
 * dsh-im-qqbot 插件配置 Schema
 */
import Schema from '@deepseek-ai/schemastery';
import { DEFAULT_VOICE_ID, DEFAULT_VOICE_MODEL } from "./voice/voice-presets.js";
// 单一来源：默认模型/音色由音色预设模块定义，这里再导出供其余模块引用
export { DEFAULT_VOICE_ID, DEFAULT_VOICE_MODEL };
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
/** 身份识别子 Schema（独立导出：config 路由的服务端校验复用） */
export const IdentitySchema = Schema.object({
    enabled: Schema.boolean().default(true).description('是否启用身份识别（按 openid 注入身份标签）'),
    ownerOpenIds: Schema.array(Schema.string()).default([]).description('主人 openid（私聊/群聊需分别添加）'),
    adminOpenIds: Schema.array(Schema.string()).default([]).description('管理员 openid'),
    friendOpenIds: Schema.array(Schema.string()).default([]).description('朋友 openid'),
});
/** 记忆与关系状态子 Schema（独立导出：config 路由的服务端校验复用） */
export const MemorySchema = Schema.object({
    enabled: Schema.boolean().default(true).description('是否启用记忆与关系状态'),
    autoCapture: Schema.boolean().default(true).description('是否自动捕获用户自述要点'),
    maxNotes: Schema.number().default(20).description('每个会话最多保留的记忆条数'),
});
/** 访问控制子 Schema（独立导出：config 路由的服务端校验复用） */
export const AccessControlSchema = Schema.object({
    c2cMode: Schema.union(['open', 'allowlist', 'disabled']).default('allowlist').description('C2C访问模式（默认白名单，空名单拒绝所有人）'),
    c2cAllow: Schema.array(Schema.string()).default([]).description('C2C白名单（QQ OpenID）'),
    groupMode: Schema.union(['open', 'allowlist', 'disabled']).default('open').description('群聊访问模式（默认开放：群自带进群门槛 + @bot 触发）'),
    groupAllow: Schema.array(Schema.string()).default([]).description('群聊白名单（群 OpenID）'),
});
/** 颜文字子 Schema（独立导出：config 路由的服务端校验复用） */
export const KaomojiConfigSchema = Schema.object({
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
export const PersonaVoiceSchema = Schema.object({
    voice: Schema.string().description('音色 id（如 longanfengyue_v3.1；缺省使用全局 voice.voice）'),
    rate: Schema.number().description('语速倍率（0.5–2，缺省 1）'),
    volume: Schema.number().description('音量（0–100，缺省 50）'),
    instruction: Schema.string().description('情感/语气指令（自然语言；缺省使用全局 voice.instruction；会与本轮 instruction 叠加下发，不会被顶掉）'),
});
/** 自定义音色子 Schema（用户手动添加的音色：名称 + id） */
export const VoicePresetEntrySchema = Schema.object({
    name: Schema.string().description('展示名称（如下拉里的「元气少女」）'),
    voice: Schema.string().description('音色 id（声音复刻/声音设计得到的专属 id）'),
});
/** 表达方式子 Schema（出现即启用；后续可扩展 sticker） */
export const ExpressionsSchema = Schema.object({
    kaomoji: KaomojiConfigSchema,
    voice: PersonaVoiceSchema,
});
/** 语音合成子 Schema（独立导出：config 路由的服务端校验复用） */
export const VoiceConfigSchema = Schema.object({
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
export const PersonaPresetSchema = Schema.object({
    id: Schema.string().description('人格标识（字母/数字/-/_，唯一）'),
    name: Schema.string().description('人格展示名称'),
    prompt: Schema.string().description('该人格的 system prompt'),
    tools: Schema.array(Schema.string())
        .description('可用工具白名单（缺省 = 默认放行清单；空数组 = 无工具；清单外的宿主工具一律禁用）'),
    expressions: ExpressionsSchema.description('表达方式（颜文字等；缺省不启用）'),
});
export const ConfigSchema = Schema.object({
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
//# sourceMappingURL=config.js.map