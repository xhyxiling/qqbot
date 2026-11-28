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
import { CURRENT_PERSONA_TOOL_NAME } from "../features/persona-tool.js";
import { PERSON_SUMMARY_TOOL_NAME } from "../features/persona-summary.js";
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
        // 人格正文改由 qqbot_current_persona 在运行时返回，避免被聊天记录里的
        // 旧 /persona 输出带偏；这里只保留白名单说明（order 86）。
        omitPrompt: true,
    });
    // 身份说明夹在全局提示词与人格之间（order 82）：人格只写称呼与态度，
    // 不再写死 openid；标签含义统一由这里解释。
    const identitySection = buildIdentityPromptSection(config.identity);
    // 人格获取指令（order 85）：人格是全局的、随时可能被切换，所以不再把人格
    // 正文写死在 system prompt 里，而是要求模型每轮先调用工具获取当前人格。
    // 这样即使聊天记录里还留着旧的 /persona 输出，也会以工具返回为准。
    const personaDirectiveSection = {
        name: 'qqbot:persona-directive',
        order: 85,
        text: '【当前人格】你当前生效的人格由运行时工具提供，可能刚被主人切换过。\n'
            + `- 每次准备回复前，先调用 ${CURRENT_PERSONA_TOOL_NAME} 获取「当前人格」的名字与完整设定，再按它说话。\n`
            + '- 聊天记录里旧的 /persona 列表、你以前说过的人格，都可能已经过期，一律以工具返回为准。\n'
            + '- 工具结果只对当前这一轮有效，下一轮要重新获取。',
    };
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
    // 群友资料查询（order 86.8）：档案只作为按需工具，不再后台生成人格。
    // 告诉模型「想回忆对方以前说过什么就查档案」，避免它凭空编造。
    const personLookupSection = config.personaAnalysis?.enabled === true
        ? {
            name: 'qqbot:person-lookup',
            order: 86.8,
            text: `【群友资料】需要回忆当前对话对象以前说过什么、在哪些群聊过时，调用 ${PERSON_SUMMARY_TOOL_NAME}`
                + '（不传 member 就是当前对象）。主人/管理员可以传昵称或 QQ 号查看其他人。'
                + '该工具只返回本地档案里的统计与最近发言，不要据此编造性格、隐私或未记录的内容。',
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
        personaDirectiveSection,
        buildNamesPromptSection(names),
        visionSection,
        personLookupSection,
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