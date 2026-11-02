/**
 * 语音回复的配置解析与文本清洗
 *
 * 门控语义：`voice.enabled` 为 false **或** `voice.apiKey` 为空 = 语音功能整体关闭
 * （不注册 qqbot_voice 工具、不合成、不发语音、不消耗额度），与没有这项配置时的
 * 行为完全一致。两个条件必须同时满足才启用。
 *
 * 是否发语音由**上层模型**判断（调用 qqbot_voice 工具），不再做字符匹配：
 * 关键词命中会把「唱歌」这类闲聊误判成指令，也挡不住「想听你的声音」这类变体。
 */
import { DEFAULT_VOICE_MAX_CHARS, DEFAULT_VOICE_MODEL, DEFAULT_VOICE_TIMEOUT_MS, MAX_VOICE_INSTRUCTION_LEN, } from "../config.js";
import { ensureVoiceForModel } from "./voice-presets.js";
import { isSpeechWebSocketAvailable } from "./tts.js";
/** 单次朗读的最大字数范围 */
export const MIN_VOICE_MAX_CHARS = 20;
export const MAX_VOICE_MAX_CHARS = 1000;
/** 合成超时范围(ms) */
export const MIN_VOICE_TIMEOUT_MS = 5000;
export const MAX_VOICE_TIMEOUT_MS = 120000;
/** 语速倍率范围 */
export const MIN_VOICE_RATE = 0.5;
export const MAX_VOICE_RATE = 2;
/** 音量范围 */
export const MIN_VOICE_VOLUME = 0;
export const MAX_VOICE_VOLUME = 100;
/** 取整并收敛到 [min, max]，非法值返回缺省 */
function clampInt(value, min, max, fallback) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return fallback;
    return Math.min(max, Math.max(min, Math.round(value)));
}
/**
 * 情感/语气指令规范化：把分行描述连成一段、折叠多余空白、按上限截断。
 *
 * 模型常把「场景」「第1句」「第2句」分行写，这里把换行换成「；」：
 * 既保留逐句走向的可读结构，也不会在 wire 上出现一堆无意义空白。
 * 返回 undefined 表示未配置（调用方不下发该参数）。
 */
export function normalizeVoiceInstruction(value, maxLen = MAX_VOICE_INSTRUCTION_LEN) {
    if (typeof value !== 'string')
        return undefined;
    const text = value
        .replace(/\r\n?/g, '\n')
        .replace(/\s*\n+\s*/g, '；')
        .replace(/[ \t\u3000]+/g, ' ')
        .replace(/；{2,}/g, '；')
        .replace(/^[；\s]+/, '')
        .replace(/[；\s]+$/, '');
    if (text === '')
        return undefined;
    return text.length > maxLen ? text.slice(0, maxLen).trimEnd() : text;
}
/**
 * 「像真人发语音」的通用提示：追加在情感指令后面。
 *
 * 音色再像人，静态的朗读指令也会带出播音腔——同一句话在微信里是随口说的，
 * 不是念稿。这条只描述「怎么说」，不改变情绪，因此可以和清冷 / 元气等人格
 * 指令叠加使用。
 */
export const NATURAL_SPEECH_HINT = '像发微信语音一样随口说，自然一点，不要播音腔、不要朗读腔';
/**
 * 指令超长时优先停在分句边界（「；」「。」），不要切掉半句走向。
 */
function clipInstruction(text, room) {
    const head = text.slice(0, room);
    if (text.length <= room)
        return head;
    const stop = Math.max(head.lastIndexOf('；'), head.lastIndexOf('。'), head.lastIndexOf('，'));
    const cut = stop !== -1 && stop + 1 >= Math.ceil(room * 0.6)
        ? head.slice(0, stop + 1)
        : head;
    return cut.replace(/[；。，、]+$/, '').trimEnd();
}
/**
 * 组装最终下发给 TTS 的 instruction：人格/单轮指令 + 自然口语提示。
 *
 * 总长度受 `MAX_VOICE_INSTRUCTION_LEN` 限制；超长时优先保留提示语，
 * 因为「不要播音腔」正是解决「听起来像 AI 念稿」的关键一句。
 */
export function buildSpeechInstruction(base) {
    const room = MAX_VOICE_INSTRUCTION_LEN - NATURAL_SPEECH_HINT.length - 1;
    const normalized = normalizeVoiceInstruction(base);
    if (normalized === undefined || room <= 0)
        return NATURAL_SPEECH_HINT;
    const head = clipInstruction(normalized, room);
    return head === '' ? NATURAL_SPEECH_HINT : `${head}；${NATURAL_SPEECH_HINT}`;
}
/**
 * 合并「本轮走向」与「人格/全局语气」——两者是不同层次的信息，不能互相顶掉。
 *
 * 本轮走向描述**这一句**怎么起伏（模型每轮现写：场景、逐句轻重停顿），
 * 人格语气描述**这套声线**一贯的说话习惯（静态配置：中低音、句尾落下…）。
 * 早先是「有本轮指令就整段丢掉人格语气」：模型只要写一句「语气自然一点」，
 * 人格里调好的音色特征就全没了，听感立刻变平。
 *
 * 现在叠加，本轮走向放前面：`buildSpeechInstruction` 超长截断时保留开头，
 * 不会把这一轮真正的走向切掉；两者内容重复时只留一份。
 */
export function composeSpeechInstruction(turn, base) {
    const primary = normalizeVoiceInstruction(turn);
    const secondary = normalizeVoiceInstruction(base);
    if (primary === undefined)
        return secondary;
    if (secondary === undefined || primary === secondary)
        return primary;
    if (primary.includes(secondary) || secondary.includes(primary)) {
        return primary.length >= secondary.length ? primary : secondary;
    }
    return `${primary}；${secondary}`;
}
/**
 * 解析语音配置；开关关闭或 `apiKey` 为空时返回 undefined（= 语音关闭）。
 *
 * 开关缺省视为打开（兼容未写 `enabled` 的旧配置）；已有 Key 的旧配置升级后
 * 行为不变，想停用语音时关开关即可，不需要清除 Key。
 *
 * 模型/音色为空时回落到缺省值，避免面板里清空后合成直接失败。
 * 音色与模型不兼容时只修正内置系统音色：先做 3.0 ↔ 3.1 的同名映射，再检查该
 * 模型是否支持这个音色（不支持就用该模型的缺省音色），避免选完必然合成失败。
 * 复刻/设计音色保持原样，不会静默换成别的声线。
 */
export function resolveVoiceSettings(voice) {
    if (voice?.enabled === false)
        return undefined;
    const apiKey = voice?.apiKey?.trim() ?? '';
    if (apiKey === '')
        return undefined;
    const model = voice?.model?.trim() || DEFAULT_VOICE_MODEL;
    const voiceId = ensureVoiceForModel(voice?.voice, model);
    const baseUrl = voice?.baseUrl?.trim();
    const workspace = voice?.workspace?.trim();
    const instruction = normalizeVoiceInstruction(voice?.instruction);
    return {
        apiKey,
        model,
        voice: voiceId,
        ...(instruction !== undefined ? { instruction } : {}),
        ...(baseUrl !== undefined && baseUrl !== '' ? { baseUrl } : {}),
        ...(workspace !== undefined && workspace !== '' ? { workspace } : {}),
        maxChars: clampInt(voice?.maxChars, MIN_VOICE_MAX_CHARS, MAX_VOICE_MAX_CHARS, DEFAULT_VOICE_MAX_CHARS),
        timeoutMs: clampInt(voice?.timeoutMs, MIN_VOICE_TIMEOUT_MS, MAX_VOICE_TIMEOUT_MS, DEFAULT_VOICE_TIMEOUT_MS),
    };
}
/**
 * 语音是否真正可用：开关打开**且** apiKey 非空**且**运行时支持内置 WebSocket（Node 22+）。
 *
 * 提示词注入与工具白名单都按它判断：Node 20 填了 Key 也合成不了，
 * 此时不能再告诉模型「你可以调 qqbot_voice」，否则模型只会调到一个不存在的工具。
 */
export function resolveActiveVoiceSettings(voice) {
    const settings = resolveVoiceSettings(voice);
    if (settings === undefined)
        return undefined;
    return isSpeechWebSocketAvailable() ? settings : undefined;
}
/**
 * 解析本轮语音参数：人格音色覆盖全局音色，语速/音量只在人格里显式配置时生效。
 * 非法数值一律忽略（交给服务端缺省值）；情感指令同理——人格没写就沿用全局。
 *
 * 人格音色同样过一遍「音色 ↔ 模型」校验：人格里写了一个当前模型不支持的
 * 内置音色（例如 3.1-plus 里配了 `longwan_v3.1`），合成会被服务端拒绝、
 * 整轮退回文字；换成该模型缺省音色至少还能把语音发出去。
 */
export function resolveVoiceTuning(settings, persona) {
    const personaVoice = persona?.voice?.trim();
    const rate = persona?.rate;
    const volume = persona?.volume;
    const instruction = normalizeVoiceInstruction(persona?.instruction) ?? settings.instruction;
    return {
        voice: personaVoice !== undefined && personaVoice !== ''
            ? ensureVoiceForModel(personaVoice, settings.model)
            : settings.voice,
        ...(typeof rate === 'number' && Number.isFinite(rate)
            ? { rate: Math.min(MAX_VOICE_RATE, Math.max(MIN_VOICE_RATE, rate)) }
            : {}),
        ...(typeof volume === 'number' && Number.isFinite(volume)
            ? { volume: Math.min(MAX_VOICE_VOLUME, Math.max(MIN_VOICE_VOLUME, Math.round(volume))) }
            : {}),
        ...(instruction !== undefined ? { instruction } : {}),
    };
}
/**
 * 可用于朗读的字符集：中日韩汉字/假名/字母数字 + 常用中英标点。
 *
 * 颜文字、emoji、Markdown 符号（`#` `*` `_` `~` `|` 等）不在集合内，
 * 会被整体剔除，避免 TTS 把符号念出来。
 */
const SPEECH_CHARS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}A-Za-z0-9\s，。！？、；：…—,.!?;:'"“”‘’《》【】]/gu;
/** 至少包含一个可朗读的实义字符（纯符号/颜文字不算） */
const SPEECH_CONTENT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}A-Za-z0-9]/u;
/**
 * 服务端能识别的逐句情感标签（`qwen-audio-3.0 / 3.1-tts-plus / flash`）。
 *
 * 只有白名单里的标签会原样送进 TTS；其它方括号内容一律当注释丢掉，
 * 免得模型写的 `[pause:1s]`、`[突然]` 被一个字一个字念出来。
 */
export const SPEECH_EMOTION_TAGS = [
    'excited',
    'sad',
    'serious',
    'laughing',
    'sighing',
    'whispers',
    'very slowly',
    'very fast',
];
const SPEECH_TAG_BODY = SPEECH_EMOTION_TAGS.join('|');
const SPEECH_TAG_SPLIT = new RegExp(`(\\[(?:${SPEECH_TAG_BODY})\\])`, 'gi');
const SPEECH_TAG = new RegExp(`^\\[(?:${SPEECH_TAG_BODY})\\]$`, 'i');
/** 句末标点：TTS 靠它收尾，缺了会读得很平 */
const TERMINAL_PUNCT = /[。！？!?…]/;
/**
 * 规范朗读用的标点。
 *
 * - 去掉中文标点两侧的空白：空白会被 TTS 当成停顿，听起来一顿一顿
 * - 合并 `。。` / `，，`，把「逗号+句号」收敛成一个句号
 * - 句首悬挂的标点直接丢掉，避免一开口就是逗号
 */
function tidySpeechPunctuation(text) {
    return text
        .replace(/[ \t\u3000]+([，。！？、；：…])/g, '$1')
        .replace(/([，。！？、；：…])[ \t\u3000]+/g, '$1')
        .replace(/。{2,}/g, '。')
        .replace(/，{2,}/g, '，')
        .replace(/[，、；：]+([。！？…])/g, '$1')
        .replace(/。([，、；：])+/g, '。')
        .replace(/。+([！？…])/g, '$1')
        .replace(/[！？…]+。/g, (match) => match.slice(0, -1))
        .replace(/^[，。、；：！？…]+/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
/**
 * 句尾补标点（保留末尾的情感标签，标点插在标签之前）。
 *
 * 「晚安」和「晚安。」在 TTS 里是两种语调：没有句末标点，引擎会把一句话
 * 读成平的陈述；补上句号才有收尾的降调，听感更像真人说完一句。
 */
function ensureTerminalPunctuation(text) {
    const tail = text.match(/\[[^\]]*\]\s*$/);
    const tag = tail?.[0] ?? '';
    const body = (tail === null ? text : text.slice(0, tail.index)).trimEnd();
    if (body === '' || TERMINAL_PUNCT.test(body.slice(-1)))
        return `${body}${tag}`;
    return `${body}。${tag}`;
}
/** 清洗一段不含白名单标签的正文（去掉不该念的东西） */
function cleanSpeechChunk(chunk) {
    const stripped = chunk
        // 代码块与行内代码（TTS 念代码没有意义）
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`\n]*`/g, ' ')
        // 图片语法整体去掉，链接语法保留可见文字
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        // 裸 URL
        .replace(/https?:\/\/\S+/gi, ' ')
        // 舞台指示：括号/方括号/星号包住的动作、神态、情绪标签，整段不念
        .replace(/（[^（）]*）/g, ' ')
        .replace(/\([^()]*\)/g, ' ')
        .replace(/【[^【】]*】/g, ' ')
        .replace(/\[[^[\]]*\]/g, ' ')
        .replace(/\*[^*\n]*\*/g, ' ')
        // 固定分隔符 ||| 与换行都是「一句话说完了」：当句子边界（句号）而不是逗号，
        // 否则几句气泡会被连成一段长句，TTS 只能一口气念完，听着像念稿
        .replace(/\|+/g, '。')
        .replace(/\r?\n+/g, '。')
        // Markdown 标题/列表/强调符号
        .replace(/[#*_~>]+/g, ' ');
    // 只保留可朗读字符（颜文字括号内的一堆符号会被清掉）
    const kept = (stripped.match(SPEECH_CHARS) ?? []).join('')
        .replace(/\s+/g, ' ')
        .trim();
    if (kept === '' || !SPEECH_CONTENT.test(kept))
        return '';
    return tidySpeechPunctuation(kept);
}
/**
 * 清洗回复文本用于语音合成：
 *
 * - 去掉代码块 / 行内代码 / 图片与链接语法 / URL（念出来没有意义）
 * - 去掉舞台指示：括号动作（`（小声）`、`(sighs)`）、`【突然】` 这类情绪标记、
 *   `*叹气*` 星号动作——TTS 会把里面的字念出来，而它们只是给读者看的注释
 * - 白名单内的服务端情感标签（`[whispers]` 等）保留，供 TTS 逐句表演
 * - `|||` 是 QQ 的分条分隔符、换行是气泡边界：两者都当句号，让 TTS 逐句换气
 * - 规范标点（合并重复、去掉标点旁的空格），句尾补句号——这是「像真人说话」
 *   最直接的一步：没有句末标点，TTS 会把整段读成平的陈述句
 * - Markdown 符号与颜文字整体剔除，按 `maxChars` 截断（优先停在句末，
 *   且不会切坏情感标签）
 *
 * 返回空字符串表示本轮没有可朗读内容（调用方应跳过语音）。
 */
export function cleanTextForSpeech(text, maxChars) {
    if (text === '')
        return '';
    const limit = clampInt(maxChars, MIN_VOICE_MAX_CHARS, MAX_VOICE_MAX_CHARS, DEFAULT_VOICE_MAX_CHARS);
    const assembled = text
        .split(SPEECH_TAG_SPLIT)
        .map((part) => (SPEECH_TAG.test(part) ? part.toLowerCase() : cleanSpeechChunk(part)))
        .join('')
        .trim();
    if (assembled === '' || !SPEECH_CONTENT.test(assembled.replace(/\[[^\]]*\]/g, '')))
        return '';
    const normalized = ensureTerminalPunctuation(tidySpeechPunctuation(assembled));
    if (normalized.length <= limit)
        return normalized;
    // 截断优先停在句末：半句话被硬切，TTS 会用上扬的语调收尾，很像机器
    const head = normalized.slice(0, limit);
    const stop = Math.max(head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('？'), head.lastIndexOf('…'), head.lastIndexOf('!'), head.lastIndexOf('?'));
    if (stop !== -1 && stop + 1 >= Math.ceil(limit * 0.6)) {
        return ensureTerminalPunctuation(tidySpeechPunctuation(head.slice(0, stop + 1)));
    }
    // 否则硬截断（留一个字符给句末标点）；若切在标签中间，回退到标签起点
    let cut = normalized.slice(0, Math.max(1, limit - 1));
    const open = cut.lastIndexOf('[');
    if (open !== -1 && cut.indexOf(']', open) === -1)
        cut = cut.slice(0, open);
    cut = cut.trimEnd();
    return cut === '' ? '' : ensureTerminalPunctuation(tidySpeechPunctuation(cut));
}
//# sourceMappingURL=voice-config.js.map