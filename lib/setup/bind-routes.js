import { persistCredentialsToProfile, removeCredentialsFromProfile, updateProfileConfig, } from "./persist.js";
import { getProfileDir, PLUGIN_PACKAGE_NAME, PLUGIN_VERSION } from "../shared/index.js";
import { checkForUpdate, inspectInstallation, runUpdate, } from "../update/update-service.js";
import { AccessControlSchema, DEFAULT_VOICE_ID, DEFAULT_VOICE_MAX_CHARS, DEFAULT_VOICE_MODEL, DEFAULT_VOICE_TIMEOUT_MS, MAX_VOICE_INSTRUCTION_LEN, } from "../config.js";
import { MAX_VOICE_MAX_CHARS, MAX_VOICE_RATE, MAX_VOICE_TIMEOUT_MS, MAX_VOICE_VOLUME, MIN_VOICE_MAX_CHARS, MIN_VOICE_RATE, MIN_VOICE_TIMEOUT_MS, MIN_VOICE_VOLUME, normalizeVoiceInstruction, } from "../voice/voice-config.js";
import { resolveVoicePresetForModel } from "../voice/voice-presets.js";
import { findKaomojiStyle, MAX_KAOMOJI_CUSTOM, MAX_KAOMOJI_ITEM_CHARS, MAX_KAOMOJI_PER_REPLY, MIN_KAOMOJI_PER_REPLY, } from "../expressions/kaomoji.js";
import { BIND_CONFIG_PATH, BIND_MANUAL_PATH, BIND_REFRESH_PATH, BIND_STATE_PATH, BIND_UNBIND_PATH, BIND_UPDATE_PATH, } from "../shared/bind-protocol.js";
// 协议单一来源：shared/bind-protocol.ts（类型 + 路径常量，客户端共用）
export { BIND_CONFIG_PATH, BIND_MANUAL_PATH, BIND_REFRESH_PATH, BIND_STATE_PATH, BIND_UNBIND_PATH, BIND_UPDATE_PATH, };
/** 可经 UI 编辑的配置键（白名单：只收用户必要的字段，其余走 patch/env） */
const EDITABLE_CONFIG_KEYS = new Set([
    'requireMention', 'streaming', 'replySplitMode', 'replySplitIntervalMs',
    'showToolResults', 'debug',
    'provider', 'model', 'preset',
    'globalPrompt',
    'personas', 'defaultPersona',
    'identity',
    'memory',
    'access',
    'voice',
]);
/** 白名单键的子 Schema（服务端校验：客户端校验仅为体验，安全边界在宿主） */
const EDITABLE_CONFIG_SCHEMAS = {
    requireMention: (v) => booleanSchema(v, 'requireMention'),
    streaming: (v) => booleanSchema(v, 'streaming'),
    replySplitMode: (v) => splitModeSchema(v),
    replySplitIntervalMs: (v) => intervalSchema(v),
    showToolResults: (v) => booleanSchema(v, 'showToolResults'),
    debug: (v) => booleanSchema(v, 'debug'),
    provider: stringSchema('provider'),
    model: stringSchema('model'),
    preset: stringSchema('preset'),
    globalPrompt: stringSchema('globalPrompt'),
    personas: (v) => personasSchema(v),
    defaultPersona: (v) => defaultPersonaSchema(v),
    identity: (v) => identitySchema(v),
    memory: (v) => memorySchema(v),
    access: (v) => AccessControlSchema(v),
    // voice 需要当前生效的 Key 来支持「留空 = 保持已保存的 Key」，见 handleConfig
};
function booleanSchema(value, name) {
    if (typeof value !== 'boolean')
        throw new TypeError(`${name} 必须是布尔值`);
    return value;
}
function stringSchema(name) {
    return (value) => {
        if (typeof value !== 'string')
            throw new TypeError(`${name} 必须是字符串`);
        if (value.length > 20000)
            throw new TypeError(`${name} 过长`);
        return value;
    };
}
/** 回复拆分方式（与 config.ts 的 ReplySplitMode 对齐） */
const SPLIT_MODES = ['none', 'delimiter', 'line', 'paragraph'];
function splitModeSchema(value) {
    if (typeof value !== 'string' || !SPLIT_MODES.includes(value)) {
        throw new TypeError(`replySplitMode 必须是 ${SPLIT_MODES.join(' / ')} 之一`);
    }
    return value;
}
/** 拆分间隔（毫秒，0–10000 非负整数；过大只会拖慢发送） */
function intervalSchema(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError('replySplitIntervalMs 必须是数字');
    }
    if (value < 0 || value > 10000) {
        throw new TypeError('replySplitIntervalMs 必须在 0–10000 之间');
    }
    return Math.round(value);
}
/** 人格 id 允许的字符（与 /persona <id> 的参数形态一致） */
const PERSONA_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** 人格预设条数上限（避免单次写入 patch 过大） */
const MAX_PERSONAS = 20;
/** 单个人格 prompt 长度上限 */
const MAX_PERSONA_PROMPT = 10000;
/** 工具名字符集（dsh 工具名，如 qqbot_send_file / web_search） */
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.:-]{1,64}$/;
/** 单个人格最多绑定的工具数 */
const MAX_PERSONA_TOOLS = 64;
/** 人格工具白名单：去空、去重、校验字符集；空数组合法（表示无工具） */
function personaToolsSchema(value, index) {
    if (!Array.isArray(value))
        throw new TypeError(`personas[${index}].tools 必须是数组`);
    if (value.length > MAX_PERSONA_TOOLS) {
        throw new TypeError(`personas[${index}].tools 最多 ${MAX_PERSONA_TOOLS} 个`);
    }
    const seen = new Set();
    const result = [];
    for (const item of value) {
        if (typeof item !== 'string')
            throw new TypeError(`personas[${index}].tools 只能是字符串`);
        const name = item.trim();
        if (name === '')
            continue;
        if (!TOOL_NAME_PATTERN.test(name)) {
            throw new TypeError(`personas[${index}].tools 含非法工具名: ${name}`);
        }
        const dedupeKey = name.toLowerCase();
        if (seen.has(dedupeKey))
            continue;
        seen.add(dedupeKey);
        result.push(name);
    }
    return result;
}
/** 自定义颜文字：去空、去重、限长、限量；返回空数组表示未配置 */
function personaKaomojiCustomSchema(value, index) {
    if (!Array.isArray(value))
        throw new TypeError(`personas[${index}].expressions.kaomoji.custom 必须是数组`);
    if (value.length > MAX_KAOMOJI_CUSTOM) {
        throw new TypeError(`personas[${index}].expressions.kaomoji.custom 最多 ${MAX_KAOMOJI_CUSTOM} 条`);
    }
    const seen = new Set();
    const result = [];
    for (const item of value) {
        if (typeof item !== 'string') {
            throw new TypeError(`personas[${index}].expressions.kaomoji.custom 只能是字符串`);
        }
        const text = item.trim().slice(0, MAX_KAOMOJI_ITEM_CHARS);
        if (text === '' || seen.has(text))
            continue;
        seen.add(text);
        result.push(text);
    }
    return result;
}
/** 语音字段长度上限（模型/音色/音色 id） */
const MAX_VOICE_FIELD_LEN = 128;
/** 单个语音字段：undefined/null 返回 fallback；空串也返回 fallback */
function voiceTextField(value, name, fallback, maxLen = MAX_VOICE_FIELD_LEN) {
    if (value === undefined || value === null)
        return fallback;
    if (typeof value !== 'string')
        throw new TypeError(`${name} 必须是字符串`);
    const text = value.trim();
    if (text === '')
        return fallback;
    if (text.length > maxLen)
        throw new TypeError(`${name} 过长（≤${maxLen}）`);
    return text;
}
/** 数值字段：undefined/null 返回 fallback；必须是 [min, max] 内的有限数字 */
function voiceNumberField(value, name, min, max, fallback, integer) {
    if (value === undefined || value === null)
        return fallback;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`${name} 必须是数字`);
    }
    if (value < min || value > max) {
        throw new TypeError(`${name} 必须在 ${min}–${max} 之间`);
    }
    return integer ? Math.round(value) : value;
}
/** 颜文字子项：关闭状态统一返回 undefined（不写回 patch） */
function personaKaomojiSchema(raw, index) {
    if (raw === undefined || raw === null)
        return undefined;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        throw new TypeError(`personas[${index}].expressions.kaomoji 必须是对象`);
    }
    const kaomoji = raw;
    if (kaomoji.enabled !== undefined && typeof kaomoji.enabled !== 'boolean') {
        throw new TypeError(`personas[${index}].expressions.kaomoji.enabled 必须是布尔值`);
    }
    let style;
    if (kaomoji.style !== undefined && kaomoji.style !== null) {
        if (typeof kaomoji.style !== 'string') {
            throw new TypeError(`personas[${index}].expressions.kaomoji.style 必须是字符串`);
        }
        style = kaomoji.style.trim() || undefined;
        if (style !== undefined && findKaomojiStyle(style) === undefined) {
            throw new TypeError(`personas[${index}].expressions.kaomoji.style 未知风格: ${style}`);
        }
    }
    let maxPerReply;
    if (kaomoji.maxPerReply !== undefined && kaomoji.maxPerReply !== null) {
        const n = kaomoji.maxPerReply;
        if (typeof n !== 'number' || !Number.isFinite(n)) {
            throw new TypeError(`personas[${index}].expressions.kaomoji.maxPerReply 必须是数字`);
        }
        if (n < MIN_KAOMOJI_PER_REPLY || n > MAX_KAOMOJI_PER_REPLY) {
            throw new TypeError(`personas[${index}].expressions.kaomoji.maxPerReply 必须在 ${MIN_KAOMOJI_PER_REPLY}–${MAX_KAOMOJI_PER_REPLY} 之间`);
        }
        maxPerReply = Math.round(n);
    }
    const custom = kaomoji.custom === undefined || kaomoji.custom === null
        ? []
        : personaKaomojiCustomSchema(kaomoji.custom, index);
    // GET 回显会把默认子对象物化成 enabled:false；这里统一丢弃，
    // 避免把「默认物化对象」写回 patch，也避免误开启所有人格。
    if (kaomoji.enabled !== true)
        return undefined;
    return {
        enabled: true,
        ...(style !== undefined ? { style } : {}),
        ...(custom.length > 0 ? { custom } : {}),
        ...(maxPerReply !== undefined ? { maxPerReply } : {}),
    };
}
/** 人格音色子项：三项都为空时返回 undefined（不写回无意义的空对象） */
function personaVoiceSchema(raw, index) {
    if (raw === undefined || raw === null)
        return undefined;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        throw new TypeError(`personas[${index}].expressions.voice 必须是对象`);
    }
    const voice = raw;
    let voiceId;
    if (voice.voice !== undefined && voice.voice !== null) {
        if (typeof voice.voice !== 'string') {
            throw new TypeError(`personas[${index}].expressions.voice.voice 必须是字符串`);
        }
        const text = voice.voice.trim();
        if (text.length > MAX_VOICE_FIELD_LEN) {
            throw new TypeError(`personas[${index}].expressions.voice.voice 过长（≤${MAX_VOICE_FIELD_LEN}）`);
        }
        voiceId = text === '' ? undefined : text;
    }
    let rate;
    if (voice.rate !== undefined && voice.rate !== null) {
        if (typeof voice.rate !== 'number' || !Number.isFinite(voice.rate)) {
            throw new TypeError(`personas[${index}].expressions.voice.rate 必须是数字`);
        }
        if (voice.rate < MIN_VOICE_RATE || voice.rate > MAX_VOICE_RATE) {
            throw new TypeError(`personas[${index}].expressions.voice.rate 必须在 ${MIN_VOICE_RATE}–${MAX_VOICE_RATE} 之间`);
        }
        rate = voice.rate;
    }
    let volume;
    if (voice.volume !== undefined && voice.volume !== null) {
        if (typeof voice.volume !== 'number' || !Number.isFinite(voice.volume)) {
            throw new TypeError(`personas[${index}].expressions.voice.volume 必须是数字`);
        }
        if (voice.volume < MIN_VOICE_VOLUME || voice.volume > MAX_VOICE_VOLUME) {
            throw new TypeError(`personas[${index}].expressions.voice.volume 必须在 ${MIN_VOICE_VOLUME}–${MAX_VOICE_VOLUME} 之间`);
        }
        volume = Math.round(voice.volume);
    }
    let instruction;
    if (voice.instruction !== undefined && voice.instruction !== null) {
        if (typeof voice.instruction !== 'string') {
            throw new TypeError(`personas[${index}].expressions.voice.instruction 必须是字符串`);
        }
        instruction = normalizeVoiceInstruction(voice.instruction);
        if (instruction !== undefined && voice.instruction.trim().length > MAX_VOICE_INSTRUCTION_LEN) {
            throw new TypeError(`personas[${index}].expressions.voice.instruction 过长（≤${MAX_VOICE_INSTRUCTION_LEN}）`);
        }
    }
    if (voiceId === undefined && rate === undefined && volume === undefined && instruction === undefined) {
        return undefined;
    }
    return {
        ...(voiceId !== undefined ? { voice: voiceId } : {}),
        ...(rate !== undefined ? { rate } : {}),
        ...(volume !== undefined ? { volume } : {}),
        ...(instruction !== undefined ? { instruction } : {}),
    };
}
/** 人格表达方式：颜文字 + 语音音色；两者都未配置时返回 undefined */
function personaExpressionsSchema(value, index) {
    if (value === undefined || value === null)
        return undefined;
    if (typeof value !== 'object' || Array.isArray(value)) {
        throw new TypeError(`personas[${index}].expressions 必须是对象`);
    }
    const record = value;
    const kaomoji = personaKaomojiSchema(record.kaomoji, index);
    const voice = personaVoiceSchema(record.voice, index);
    if (kaomoji === undefined && voice === undefined)
        return undefined;
    return {
        ...(kaomoji !== undefined ? { kaomoji } : {}),
        ...(voice !== undefined ? { voice } : {}),
    };
}
/** 人格预设数组校验：id 形态/唯一、名称与 prompt 长度、工具白名单与表达方式；返回规范化的数组 */
function personasSchema(value) {
    if (!Array.isArray(value))
        throw new TypeError('personas 必须是数组');
    if (value.length > MAX_PERSONAS)
        throw new TypeError(`personas 最多 ${MAX_PERSONAS} 条`);
    const seen = new Set();
    return value.map((item, index) => {
        if (typeof item !== 'object' || item === null) {
            throw new TypeError(`personas[${index}] 必须是对象`);
        }
        const record = item;
        const id = typeof record.id === 'string' ? record.id.trim() : '';
        const name = typeof record.name === 'string' ? record.name.trim() : '';
        const prompt = typeof record.prompt === 'string' ? record.prompt : '';
        if (!PERSONA_ID_PATTERN.test(id)) {
            throw new TypeError(`personas[${index}].id 需为 1–64 位字母/数字/-/_`);
        }
        if (seen.has(id))
            throw new TypeError(`personas 中存在重复 id: ${id}`);
        seen.add(id);
        if (name.length > 64)
            throw new TypeError(`personas[${index}].name 过长（≤64）`);
        if (prompt.length > MAX_PERSONA_PROMPT) {
            throw new TypeError(`personas[${index}].prompt 过长（≤${MAX_PERSONA_PROMPT}）`);
        }
        const tools = record.tools === undefined || record.tools === null
            ? undefined
            : personaToolsSchema(record.tools, index);
        const expressions = personaExpressionsSchema(record.expressions, index);
        return {
            id,
            name: name || id,
            prompt,
            ...(tools !== undefined ? { tools } : {}),
            ...(expressions !== undefined ? { expressions } : {}),
        };
    });
}
/** 默认人格 id：空字符串表示不启用人格 */
function defaultPersonaSchema(value) {
    if (typeof value !== 'string')
        throw new TypeError('defaultPersona 必须是字符串');
    const id = value.trim();
    if (id.length > 64)
        throw new TypeError('defaultPersona 过长（≤64）');
    return id;
}
/** 每份身份名单的条数上限（openid 短标识，避免单次写入 patch 过大） */
const MAX_IDENTITY_IDS = 200;
/** 单个 openid 长度上限（QQ openid 通常 32 位十六进制） */
const MAX_OPENID_LEN = 128;
/** 身份名单：字符串数组 → 去空白、忽略大小写去重 */
function openIdListSchema(value, key) {
    if (!Array.isArray(value))
        throw new TypeError(`identity.${key} 必须是数组`);
    if (value.length > MAX_IDENTITY_IDS) {
        throw new TypeError(`identity.${key} 最多 ${MAX_IDENTITY_IDS} 条`);
    }
    const seen = new Set();
    const result = [];
    for (const item of value) {
        if (typeof item !== 'string')
            throw new TypeError(`identity.${key} 只能是字符串`);
        const id = item.trim();
        if (id === '')
            continue;
        if (id.length > MAX_OPENID_LEN)
            throw new TypeError(`identity.${key} 单个 openid 过长（≤${MAX_OPENID_LEN}）`);
        const dedupeKey = id.toUpperCase();
        if (seen.has(dedupeKey))
            continue;
        seen.add(dedupeKey);
        result.push(id);
    }
    return result;
}
/** 身份识别配置：开关 + 三份名单 */
function identitySchema(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError('identity 必须是对象');
    }
    const record = value;
    if (record.enabled !== undefined && typeof record.enabled !== 'boolean') {
        throw new TypeError('identity.enabled 必须是布尔值');
    }
    return {
        enabled: record.enabled !== false,
        ownerOpenIds: openIdListSchema(record.ownerOpenIds ?? [], 'ownerOpenIds'),
        adminOpenIds: openIdListSchema(record.adminOpenIds ?? [], 'adminOpenIds'),
        friendOpenIds: openIdListSchema(record.friendOpenIds ?? [], 'friendOpenIds'),
    };
}
/** 每个会话记忆条数范围（与 config.ts 的 maxNotes 对齐） */
const MIN_MEMORY_NOTES = 1;
const MAX_MEMORY_NOTES = 100;
/** 记忆与关系状态：两个开关 + 条数上限（超范围拒绝，避免无意义的大文件） */
function memorySchema(value) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError('memory 必须是对象');
    }
    const record = value;
    if (record.enabled !== undefined && typeof record.enabled !== 'boolean') {
        throw new TypeError('memory.enabled 必须是布尔值');
    }
    if (record.autoCapture !== undefined && typeof record.autoCapture !== 'boolean') {
        throw new TypeError('memory.autoCapture 必须是布尔值');
    }
    const rawNotes = record.maxNotes;
    let maxNotes = 20;
    if (rawNotes !== undefined) {
        if (typeof rawNotes !== 'number' || !Number.isFinite(rawNotes)) {
            throw new TypeError('memory.maxNotes 必须是数字');
        }
        if (!Number.isInteger(rawNotes) || rawNotes < MIN_MEMORY_NOTES || rawNotes > MAX_MEMORY_NOTES) {
            throw new TypeError(`memory.maxNotes 必须是 ${MIN_MEMORY_NOTES}–${MAX_MEMORY_NOTES} 之间的整数`);
        }
        maxNotes = rawNotes;
    }
    return {
        enabled: record.enabled !== false,
        autoCapture: record.autoCapture !== false,
        maxNotes,
    };
}
/** API Key 长度上限（DashScope Key 远短于此值） */
const MAX_VOICE_KEY_LEN = 256;
/** 自定义 WebSocket 地址长度上限 */
const MAX_VOICE_BASE_URL_LEN = 512;
/** 自定义音色条数上限 */
const MAX_VOICE_PRESETS = 20;
/** 自定义音色名称长度上限 */
const MAX_VOICE_PRESET_NAME_LEN = 32;
/** 自定义 WebSocket 地址：空字符串表示走缺省网关 */
function voiceBaseUrlSchema(value, fallback) {
    if (value === undefined || value === null)
        return fallback;
    if (typeof value !== 'string')
        throw new TypeError('voice.baseUrl 必须是字符串');
    const url = value.trim();
    if (url === '')
        return fallback;
    if (url.length > MAX_VOICE_BASE_URL_LEN) {
        throw new TypeError(`voice.baseUrl 过长（≤${MAX_VOICE_BASE_URL_LEN}）`);
    }
    if (!/^wss?:\/\//i.test(url)) {
        throw new TypeError('voice.baseUrl 必须是 ws:// 或 wss:// 地址');
    }
    return url;
}
/**
 * 情感/语气指令：折叠空白并截断到上限；空字符串表示不指定。
 *
 * 超长不报错（按上限截断），避免用户在面板里粘贴一大段提示词直接保存失败。
 */
function voiceInstructionSchema(value, fallback) {
    if (value === undefined || value === null)
        return fallback;
    if (typeof value !== 'string')
        throw new TypeError('voice.instruction 必须是字符串');
    return normalizeVoiceInstruction(value) ?? '';
}
/**
 * 自定义音色清单（用户手动添加）：名称 + 音色 id。
 *
 * - 名称留空时用音色 id 兜底（下拉里仍可辨认）
 * - 音色 id 为空的行直接丢弃（面板允许留空行待填）
 * - 按音色 id 去重，保留用户提交的顺序（面板把新增项排在最前，顺序即下拉顺序）
 */
function voicePresetsSchema(value, fallback) {
    if (value === undefined || value === null)
        return fallback;
    if (!Array.isArray(value))
        throw new TypeError('voice.presets 必须是数组');
    if (value.length > MAX_VOICE_PRESETS) {
        throw new TypeError(`voice.presets 最多 ${MAX_VOICE_PRESETS} 条`);
    }
    const seen = new Set();
    const result = [];
    for (const item of value) {
        if (typeof item !== 'object' || item === null || Array.isArray(item)) {
            throw new TypeError('voice.presets 的每一项必须是 { name, voice } 对象');
        }
        const entry = item;
        if (entry.voice !== undefined && entry.voice !== null && typeof entry.voice !== 'string') {
            throw new TypeError('voice.presets[].voice 必须是字符串');
        }
        if (entry.name !== undefined && entry.name !== null && typeof entry.name !== 'string') {
            throw new TypeError('voice.presets[].name 必须是字符串');
        }
        const voiceId = typeof entry.voice === 'string' ? entry.voice.trim() : '';
        if (voiceId === '')
            continue;
        if (voiceId.length > MAX_VOICE_FIELD_LEN) {
            throw new TypeError(`voice.presets[].voice 过长（≤${MAX_VOICE_FIELD_LEN}）`);
        }
        if (seen.has(voiceId))
            continue;
        seen.add(voiceId);
        const rawName = typeof entry.name === 'string' ? entry.name.trim() : '';
        const name = (rawName === '' ? voiceId : rawName).slice(0, MAX_VOICE_PRESET_NAME_LEN);
        result.push({ name, voice: voiceId });
    }
    return result;
}
/**
 * 语音配置校验（合并写回，Key 支持遮罩语义）：
 *
 * - GET 不回显 Key，客户端提交空字符串 = 保持已保存的 Key
 * - `clearApiKey: true` = 显式清空已保存的 Key（Key 管理；要停用语音请关 `enabled`）
 * - `hasApiKey` 是 GET 附带的只读提示，提交时忽略
 */
function voiceSchema(value, current) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new TypeError('voice 必须是对象');
    }
    const record = value;
    const enabled = record.enabled === undefined || record.enabled === null
        ? current?.enabled !== false
        : booleanSchema(record.enabled, 'voice.enabled');
    let apiKey = current?.apiKey?.trim() ?? '';
    if (record.clearApiKey !== undefined && record.clearApiKey !== null) {
        if (typeof record.clearApiKey !== 'boolean') {
            throw new TypeError('voice.clearApiKey 必须是布尔值');
        }
        if (record.clearApiKey)
            apiKey = '';
    }
    if (record.apiKey !== undefined && record.apiKey !== null) {
        if (typeof record.apiKey !== 'string')
            throw new TypeError('voice.apiKey 必须是字符串');
        const submitted = record.apiKey.trim();
        if (submitted !== '') {
            if (submitted.length > MAX_VOICE_KEY_LEN) {
                throw new TypeError(`voice.apiKey 过长（≤${MAX_VOICE_KEY_LEN}）`);
            }
            apiKey = submitted;
        }
    }
    const model = voiceTextField(record.model, 'voice.model', current?.model?.trim() || DEFAULT_VOICE_MODEL);
    return {
        enabled,
        apiKey,
        model,
        voice: resolveVoicePresetForModel(voiceTextField(record.voice, 'voice.voice', current?.voice?.trim() || DEFAULT_VOICE_ID), model),
        instruction: voiceInstructionSchema(record.instruction, normalizeVoiceInstruction(current?.instruction) ?? ''),
        presets: voicePresetsSchema(record.presets, current?.presets ?? []),
        baseUrl: voiceBaseUrlSchema(record.baseUrl, current?.baseUrl?.trim() ?? ''),
        workspace: voiceTextField(record.workspace, 'voice.workspace', current?.workspace?.trim() ?? ''),
        maxChars: voiceNumberField(record.maxChars, 'voice.maxChars', MIN_VOICE_MAX_CHARS, MAX_VOICE_MAX_CHARS, current?.maxChars ?? DEFAULT_VOICE_MAX_CHARS, true),
        timeoutMs: voiceNumberField(record.timeoutMs, 'voice.timeoutMs', MIN_VOICE_TIMEOUT_MS, MAX_VOICE_TIMEOUT_MS, current?.timeoutMs ?? DEFAULT_VOICE_TIMEOUT_MS, true),
    };
}
/** 从当前生效配置里读出 voice（GET/POST 共用；缺失时返回 undefined） */
function readCurrentVoice(options) {
    const voice = options.currentConfig?.()?.voice;
    if (typeof voice !== 'object' || voice === null || Array.isArray(voice))
        return undefined;
    return voice;
}
/**
 * GET 回显的人格音色按模型代际修正（只动内置系统音色，复刻/设计 id 原样保留）。
 *
 * 面板看到的值应与实际合成一致：运行时 `resolveVoiceTuning` 也会做同样的映射。
 */
function mapPersonaVoiceIds(personas, model) {
    if (!Array.isArray(personas))
        return personas;
    let changed = false;
    const next = personas.map((item) => {
        if (typeof item !== 'object' || item === null || Array.isArray(item))
            return item;
        const persona = item;
        const expressions = persona.expressions;
        if (typeof expressions !== 'object' || expressions === null || Array.isArray(expressions))
            return item;
        const expressionsRecord = expressions;
        const voice = expressionsRecord.voice;
        if (typeof voice !== 'object' || voice === null || Array.isArray(voice))
            return item;
        const voiceRecord = voice;
        const id = typeof voiceRecord.voice === 'string' ? voiceRecord.voice.trim() : '';
        if (id === '')
            return item;
        const mapped = resolveVoicePresetForModel(id, model);
        if (mapped === id)
            return item;
        changed = true;
        return {
            ...persona,
            expressions: { ...expressionsRecord, voice: { ...voiceRecord, voice: mapped } },
        };
    });
    return changed ? next : personas;
}
/**
 * GET 回显脱敏：语音 API Key 永不返回，只回 `hasApiKey` 让面板知道「已保存」。
 * 同时把内置音色按当前模型代际映射（3.0 ↔ 3.1），避免面板显示的音色
 * 与实际下发的不一致（内置系统音色跨代 id 会合成失败）。
 * 不修改传入对象（currentConfig 返回的是 apply 时的合并配置）。
 */
function maskVoiceForClient(current) {
    const voice = current.voice;
    if (typeof voice !== 'object' || voice === null || Array.isArray(voice))
        return current;
    const record = voice;
    const hasApiKey = typeof record.apiKey === 'string' && record.apiKey.trim() !== '';
    const model = typeof record.model === 'string' ? record.model.trim() : '';
    const voiceId = typeof record.voice === 'string' ? record.voice.trim() : '';
    return {
        ...current,
        voice: {
            ...record,
            voice: voiceId === '' ? record.voice : resolveVoicePresetForModel(voiceId, model),
            apiKey: '',
            hasApiKey,
        },
        ...(Array.isArray(current.personas)
            ? { personas: mapPersonaVoiceIds(current.personas, model || DEFAULT_VOICE_MODEL) }
            : {}),
    };
}
/** manual 请求体大小上限（appId + appSecret 远小于此值） */
const MAX_MANUAL_BODY_BYTES = 4096;
/**
 * config 请求体大小上限：对齐 Schema 的业务边界——白名单字符串字段单个
 * 允许 20000 字符（全中文 UTF-8 约 60KB），allowlist 不设条目上限（openid
 * 短标识，512KB 约容纳 1.4 万条）。上限只是反滥用闸门，语义校验在 Schema。
 */
const MAX_CONFIG_BODY_BYTES = 512 * 1024;
/** 更新请求体上限（只含 `{ action: 'check' | 'update' }`） */
const MAX_UPDATE_BODY_BYTES = 4096;
/** 线上回显：剔除 profileDir（服务端内部字段，只在宿主侧执行更新时使用） */
function toInstallWire(info) {
    return {
        packageName: info.packageName,
        kind: info.kind,
        version: info.version,
        installed: info.installed,
        ...(info.spec !== undefined ? { spec: info.spec } : {}),
        ...(info.remote !== undefined ? { remote: info.remote } : {}),
        ...(info.ref !== undefined ? { ref: info.ref } : {}),
        canUpdate: info.canUpdate,
        command: info.command,
        ...(info.message !== undefined ? { message: info.message } : {}),
    };
}
/** 合并缺省实现：没有宿主注入时只读检查，更新只返回手动命令 */
function resolveUpdateHooks(options) {
    const custom = options.update;
    const canUpdate = custom?.perform !== undefined;
    return {
        inspect: custom?.inspect ?? (() => inspectInstallation({
            packageName: PLUGIN_PACKAGE_NAME,
            version: PLUGIN_VERSION,
            profileDir: getProfileDir(),
            canUpdate,
        })),
        check: custom?.check ?? ((info) => checkForUpdate(info)),
        perform: custom?.perform ?? ((info) => runUpdate(info)),
        reload: custom?.reload ?? (() => { }),
    };
}
/**
 * 注册绑定路由（状态查询 / 刷新二维码 / 手动凭据）。
 *
 * @param webServer - ctx.webServer
 * @param service - 绑定状态机；已绑定 fiber 传 null（无扫码流程）
 * @param logger - 日志
 * @param options - 行为注入（bound 态回显、manual 处理）
 * @returns 注销函数（与插件 fiber 生命周期绑定）
 */
export function registerBindRoutes(webServer, service, logger, options = {}) {
    const defaultManual = (credentials) => {
        const persisted = persistCredentialsToProfile(credentials, getProfileDir() ?? undefined, logger);
        return persisted ? { persisted: true } : { persisted: false, error: '无法定位 profile 目录或写入失败，请改用环境变量配置' };
    };
    const handleManualSubmit = options.onManualCredentials ?? defaultManual;
    const disposers = [
        webServer.register({
            kind: 'exact',
            path: BIND_STATE_PATH,
            handler: (req, res) => { handleState(req, res, service, options); },
        }),
        webServer.register({
            kind: 'exact',
            path: BIND_REFRESH_PATH,
            handler: (req, res) => { handleRefresh(req, res, service); },
        }),
        webServer.register({
            kind: 'exact',
            path: BIND_MANUAL_PATH,
            handler: (req, res) => handleManual(req, res, handleManualSubmit),
        }),
        webServer.register({
            kind: 'exact',
            path: BIND_UNBIND_PATH,
            handler: (req, res) => handleUnbind(req, res, options),
        }),
        webServer.register({
            kind: 'exact',
            path: BIND_CONFIG_PATH,
            handler: (req, res) => handleConfig(req, res, options),
        }),
        webServer.register({
            kind: 'exact',
            path: BIND_UPDATE_PATH,
            handler: (req, res) => handleUpdate(req, res, resolveUpdateHooks(options), logger),
        }),
    ];
    logger.info(`im-qqbot: 端内绑定页已就绪: ${BIND_STATE_PATH}`);
    return () => { for (const dispose of disposers)
        dispose(); };
}
/**
 * 请求来源校验（最小 CSRF 防护）。
 *
 * 带 Origin 的请求必须与 Host 同源；同源 fetch 与 Desktop IPC 桥
 * （后者会删除 origin 头）均放行。本路由数据不敏感且动作无害，
 * 该级别的防护足够。
 */
function trusted(req) {
    const origin = req.headers.origin;
    if (origin === undefined)
        return true;
    try {
        return new URL(origin).host === req.headers.host;
    }
    catch {
        return false;
    }
}
function sendJson(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
    });
    res.end(payload);
}
function handleState(req, res, service, options) {
    if (!trusted(req)) {
        sendJson(res, 403, { error: 'forbidden' });
        return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
        sendJson(res, 405, { error: 'method not allowed' });
        return;
    }
    // 已绑定优先（appSecret 不回传，appId 非机密可回显）
    const boundAppId = options.boundAppId?.() ?? null;
    if (boundAppId !== null) {
        sendJson(res, 200, { phase: 'bound', appId: boundAppId });
        return;
    }
    sendJson(res, 200, service === null ? { phase: 'starting' } : service.wireState());
}
function handleRefresh(req, res, service) {
    if (!trusted(req)) {
        sendJson(res, 403, { error: 'forbidden' });
        return;
    }
    if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' });
        return;
    }
    // 丢弃可能的请求体（refresh 无参数）
    req.resume();
    service?.refresh();
    // 新二维码异步生成，统一由状态轮询收敛
    sendJson(res, 200, { phase: 'starting' });
}
/** 读取并解析 JSON 请求体（带大小上限） */
async function readJsonBody(req, maxBytes = MAX_MANUAL_BODY_BYTES) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        const buffer = chunk;
        size += buffer.length;
        if (size > maxBytes)
            throw new Error('request body too large');
        chunks.push(buffer);
    }
    if (size === 0)
        throw new Error('empty request body');
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
/** 校验手动提交的凭据形态（不打印内容） */
function parseCredentials(body) {
    if (typeof body !== 'object' || body === null)
        return null;
    const record = body;
    const appId = typeof record.appId === 'string' ? record.appId.trim() : '';
    const appSecret = typeof record.appSecret === 'string' ? record.appSecret.trim() : '';
    if (appId.length === 0 || appSecret.length === 0)
        return null;
    if (appId.length > 128 || appSecret.length > 256)
        return null;
    return { appId, appSecret };
}
async function handleManual(req, res, submit) {
    if (!trusted(req)) {
        sendJson(res, 403, { error: 'forbidden' });
        return;
    }
    if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' });
        return;
    }
    let body;
    try {
        body = await readJsonBody(req);
    }
    catch (err) {
        sendJson(res, 400, { ok: false, error: `invalid request body: ${err instanceof Error ? err.message : String(err)}` });
        return;
    }
    const credentials = parseCredentials(body);
    if (credentials === null) {
        sendJson(res, 400, { ok: false, error: 'appId 与 appSecret 不能为空' });
        return;
    }
    const result = submit(credentials);
    if (!result.persisted) {
        sendJson(res, 500, { ok: false, error: result.error ?? '保存失败' });
        return;
    }
    // 写入 profile patch 触发 HMR 重载，新 fiber 以新凭据启动网关
    sendJson(res, 200, { ok: true, message: '凭据已保存，插件将自动重载' });
}
/** 解绑：仅已绑定态可执行；移除 profile patch 中的凭据并触发 HMR 重载 */
function handleUnbind(req, res, options) {
    if (!trusted(req)) {
        sendJson(res, 403, { error: 'forbidden' });
        return;
    }
    if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' });
        return;
    }
    req.resume();
    if ((options.boundAppId?.() ?? null) === null) {
        sendJson(res, 409, { ok: false, error: '当前未绑定' });
        return;
    }
    const result = options.onUnbind === undefined
        ? (() => {
            const removed = removeCredentialsFromProfile(getProfileDir() ?? undefined, undefined);
            if (removed) {
                // 清除进程内凭据：扫码绑定成功时会写入 env（供热更新后的下次
                // apply 兜底读取）；不清则 HMR 重载后新 fiber 仍从 env 读到
                // 凭据，解绑不生效（状态一直停留在 bound）
                delete process.env.QQBOT_APPID;
                delete process.env.QQBOT_SECRET;
            }
            return removed
                ? { persisted: true }
                : { persisted: false, error: '无法定位 profile 目录或写入失败，请手动编辑 cordis.patch.yml' };
        })()
        : options.onUnbind();
    if (!result.persisted) {
        sendJson(res, 500, { ok: false, error: result.error ?? '解绑失败' });
        return;
    }
    // 移除后写入触发 HMR 重载，插件回到未绑定态（绑定流程重新可用）
    sendJson(res, 200, { ok: true, message: '已解绑，插件将重载并重新进入绑定流程' });
}
/**
 * 配置读写：
 * - GET：回显当前生效配置（appSecret 剔除，cwd 等只读字段正常返回）
 * - POST：白名单 + 子 Schema 校验 → 最小写入 profile patch → HMR 重载
 */
async function handleConfig(req, res, options) {
    if (!trusted(req)) {
        sendJson(res, 403, { error: 'forbidden' });
        return;
    }
    if (req.method !== 'GET' && req.method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' });
        return;
    }
    if (req.method === 'GET') {
        const current = options.currentConfig?.() ?? {};
        // appSecret 永不回传；语音 API Key 同样遮罩（只回 hasApiKey）；其余（含只读 cwd）原样回显
        const { appSecret: _s, ...rest } = current;
        const safe = maskVoiceForClient(rest);
        // 工具候选清单（面板下拉用）：运行时为空时不带该字段，老客户端不受影响
        const toolNames = options.availableTools?.() ?? [];
        sendJson(res, 200, toolNames.length > 0 ? { config: safe, tools: toolNames } : { config: safe });
        return;
    }
    let body;
    try {
        body = await readJsonBody(req, MAX_CONFIG_BODY_BYTES);
    }
    catch (err) {
        sendJson(res, 400, { ok: false, error: `invalid request body: ${err instanceof Error ? err.message : String(err)}` });
        return;
    }
    if (typeof body !== 'object' || body === null) {
        sendJson(res, 400, { ok: false, error: '请求体必须是 JSON 对象' });
        return;
    }
    const submitted = body;
    // 白名单与凭据/只读字段拦截
    for (const key of Object.keys(submitted)) {
        if (!EDITABLE_CONFIG_KEYS.has(key)) {
            const reason = key === 'appId' || key === 'appSecret'
                ? '凭据请使用绑定/更换/解绑功能'
                : key === 'cwd'
                    ? 'cwd 为只读字段'
                    : '不支持的字段';
            sendJson(res, 400, { ok: false, error: `${reason}: ${key}` });
            return;
        }
    }
    // 逐键 Schema 校验（非法值拒绝，返回首个错误）
    let validated = {};
    const currentVoice = readCurrentVoice(options);
    try {
        validated = Object.fromEntries(Object.entries(submitted).map(([key, value]) => {
            // voice 需要现有 Key 才能实现「空值 = 保持已保存的 Key」
            if (key === 'voice')
                return [key, voiceSchema(value, currentVoice)];
            const check = EDITABLE_CONFIG_SCHEMAS[key];
            if (check === undefined)
                throw new TypeError(`不支持的字段: ${key}`);
            return [key, check(value)];
        }));
    }
    catch (err) {
        sendJson(res, 400, { ok: false, error: err instanceof TypeError ? err.message : String(err) });
        return;
    }
    const persisted = options.onUpdateConfig === undefined
        ? updateProfileConfig(validated, getProfileDir() ?? undefined, undefined)
        : options.onUpdateConfig(validated);
    if (!persisted) {
        sendJson(res, 500, { ok: false, error: '无法定位 profile 目录或写入失败' });
        return;
    }
    sendJson(res, 200, { ok: true, message: '配置已保存，插件将自动重载（进行中的机器人会话将重置）' });
}
/** 更新成功后异步触发重载：先让 HTTP 响应落地，再替换模块 */
function scheduleUpdateReload(hooks, logger) {
    const timer = setTimeout(() => {
        Promise.resolve(hooks.reload()).catch((err) => {
            logger.warn(`im-qqbot: 更新后自动重载失败（请重启 DSH）: ${err instanceof Error ? err.message : String(err)}`);
        });
    }, 300);
    timer.unref?.();
}
/**
 * 插件更新检查与执行：
 * - GET：读取本地安装信息（安装方式 / 已装引用 / 是否支持一键更新）
 * - POST `{ action: 'check' }`：对比远端（git ls-remote / npm registry）
 * - POST `{ action: 'update' }`：执行 `pnpm update`，成功后触发 HMR 重载
 */
async function handleUpdate(req, res, hooks, logger) {
    if (!trusted(req)) {
        sendJson(res, 403, { error: 'forbidden' });
        return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
        try {
            sendJson(res, 200, { ok: true, install: toInstallWire(hooks.inspect()) });
        }
        catch (err) {
            sendJson(res, 500, { ok: false, error: `读取安装信息失败：${err instanceof Error ? err.message : String(err)}` });
        }
        return;
    }
    if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'method not allowed' });
        return;
    }
    let body;
    try {
        body = await readJsonBody(req, MAX_UPDATE_BODY_BYTES);
    }
    catch (err) {
        sendJson(res, 400, {
            ok: false,
            error: `invalid request body: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
    }
    const action = typeof body === 'object' && body !== null
        ? body.action
        : undefined;
    if (action !== 'check' && action !== 'update') {
        sendJson(res, 400, { ok: false, error: 'action 必须是 check 或 update' });
        return;
    }
    let info;
    try {
        info = hooks.inspect();
    }
    catch (err) {
        sendJson(res, 500, { ok: false, error: `读取安装信息失败：${err instanceof Error ? err.message : String(err)}` });
        return;
    }
    if (action === 'check') {
        try {
            const check = await hooks.check(info);
            sendJson(res, 200, {
                ok: true,
                install: toInstallWire(info),
                check,
                message: check.message,
            });
        }
        catch (err) {
            // 检查失败（网络/认证/不支持）不是致命错误：保留安装信息供面板展示原因
            sendJson(res, 200, {
                ok: false,
                install: toInstallWire(info),
                error: `检查更新失败：${err instanceof Error ? err.message : String(err)}`,
            });
        }
        return;
    }
    const result = await hooks.perform(info);
    if (!result.ok) {
        sendJson(res, 500, { ok: false, install: toInstallWire(info), error: result.message });
        return;
    }
    // 更新可能改写 lockfile：重新读一次；失败时保留旧信息（不影响成功提示）
    let next = info;
    try {
        next = hooks.inspect();
    }
    catch { /* 保留旧信息 */ }
    sendJson(res, 200, {
        ok: true,
        install: toInstallWire(next),
        message: '更新完成，插件正在重载；若界面没有自动刷新，请重启 DSH。',
    });
    scheduleUpdateReload(hooks, logger);
}
//# sourceMappingURL=bind-routes.js.map