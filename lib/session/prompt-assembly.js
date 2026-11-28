import { buildPersonaPromptSections } from "../personas/persona-utils.js";
import { buildIdentityPromptSection } from "../identity/role.js";
import { buildNamesPromptSection } from "../identity/names-store.js";
import { buildMemoryPromptSection, buildPersonMemoryPromptSection } from "../memory/memory-prompt.js";
import { resolveActiveVoiceSettings } from "../voice/voice-config.js";
import { buildVoiceOptions } from "../voice/voice-presets.js";
import { buildVoicePromptSection } from "../voice/voice-prompt.js";
import { VOICE_TOOL_NAME } from "../voice/voice-tool.js";
import { buildStickerPromptSection } from "../sticker/prompt.js";
import { buildControlPromptSection } from "../features/control-prompt.js";
/**
 * 构建需要追加到宿主体 system prompt 的全部 section。
 *
 * 返回顺序已按 order 排好；调用方只需把它们接到宿主已有 section 后面。
 */
export function buildSessionPromptSections(input) {
    const { config, persona, names, lastUserText } = input;
    const voiceSettings = resolveActiveVoiceSettings(config.voice);
    // 语音可用时 qqbot_voice 无视人格白名单一路放行，所以这里也要把它写进
    // 「本会话绑定了哪些工具」的说明；否则模型看到说明里没有它就不敢调用。
    const sections = buildPersonaPromptSections(persona, config.globalPrompt, {
        extraTools: voiceSettings === undefined ? [] : [VOICE_TOOL_NAME],
    });
    // 身份说明夹在全局提示词与人格之间（order 82）：人格只写称呼与态度，
    // 不再写死 openid；标签含义统一由这里解释。
    const identitySection = buildIdentityPromptSection(config.identity);
    // 看图说明（order 86.5）：聊天里图片只以本地路径形式出现，必须明确告诉
    // 模型「路径不是图，要看就调工具」，否则它只会说看不到。
    const visionSection = config.vision?.enabled === true
        ? {
            name: 'qqbot:vision',
            order: 86.5,
            text: '【看图】聊天里出现 `Image: <本地路径>`（当前消息、引用消息、群历史里都可能有）说明对方发过图，'
                + '但你手里只有路径。需要知道图里是什么就调用 qqbot_describe_image，把该路径作为 image 参数；'
                + '视频同理用该路径。不要直接回复「看不到」「只有一张图」——先看再说。',
        }
        : undefined;
    // 记忆与关系状态（order 87）排在人格之后：模型先知道「自己是谁」，
    // 再知道「对面是谁、聊过什么」，避免关系描述盖过人格语气。
    const memorySection = buildMemoryPromptSection(input.chatMemory, config.memory);
    // 人物画像与记忆同档，插在会话记忆之前：同通道内的画像跨群/私聊共享；
    // 会话记忆只描述「这个群/这段私聊」的关系，两者互补、不重复。
    const personSection = buildPersonMemoryPromptSection(input.personMemory, config.memory, undefined, { ...(lastUserText !== undefined ? { query: lastUserText } : {}) });
    // 语音回复说明（order 88）：只有语音真正可用时才注入。这里告诉模型
    // 「有语音这条路、什么时候适合、怎么用」——不然它不知道该调用 qqbot_voice。
    const voiceSection = buildVoicePromptSection({
        settings: voiceSettings,
        personaVoice: persona?.expressions?.voice,
        voiceOptions: buildVoiceOptions(config.voice?.presets, config.voice?.model),
    });
    // 表情包说明（order 89）：只有图库里有东西时才注入，告诉模型何时该发、
    // 何时不该发以及剂量——否则它要么想不起来用，要么连着刷。
    const stickerSection = buildStickerPromptSection({
        total: input.sticker?.total ?? 0,
        catalog: input.sticker?.catalog ?? [],
    });
    const ordered = [
        identitySection,
        buildNamesPromptSection(names),
        visionSection,
        memorySection,
        personSection,
        voiceSection,
        stickerSection,
        // 管理操作说明（order 90）：主人用日常说话就能改人格/记忆/会话，不用手打斜杠
        buildControlPromptSection(),
    ].filter((section) => section !== undefined);
    // 按 order 插入，不依赖宿主排序；同 order 时保持追加顺序（人物画像在会话记忆前）
    for (const section of ordered) {
        const insertAt = sections.findIndex((existing) => existing.order >= section.order);
        if (insertAt === -1)
            sections.push(section);
        else
            sections.splice(insertAt, 0, section);
    }
    return sections;
}
//# sourceMappingURL=prompt-assembly.js.map