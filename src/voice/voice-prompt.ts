/**
 * 语音回复的 system prompt section（order 88）
 *
 * 「要不要发语音」交给上层模型判断：这里告诉模型有语音这条路、什么时候适合、
 * 以及怎么用（先调 qqbot_voice，再把要朗读的话写成正文）。语音未启用时
 * 不产生 section，模型完全感知不到这项能力。
 *
 * 关键在于把正文约束成「台词本」而不是文章：机器人只负责念，所以正文必须是
 * 嘴里说出来的话——短句、口语、无旁白、无标记符号；情绪走 TTS 的 instruction，
 * 不写在正文里（写进去只会被一个字一个字念出来）。
 */
import { MAX_VOICE_INSTRUCTION_LEN, type PersonaVoiceConfig } from '../config.ts';
import {
  resolveVoiceTuning,
  SPEECH_EMOTION_TAGS,
  type ResolvedVoiceSettings,
  type VoiceTuning,
} from './voice-config.ts';
import { voiceShortLabel, type VoiceOption } from './voice-presets.ts';
import { VOICE_TOOL_NAME } from './voice-tool.ts';

/** 语音说明 section 的 order：排在人格（85）、工具权限（86）、记忆（87）之后 */
export const VOICE_PROMPT_ORDER = 88;

/** system-prompt section 最小结构（与 personas/persona-utils 保持一致） */
export interface VoicePromptSection {
  name: string;
  order: number;
  text: string;
}

export interface VoicePromptOptions {
  /** 解析后的语音设置；undefined = 语音未启用（不产生 section） */
  settings?: ResolvedVoiceSettings;
  /** 当前人格的语音覆盖（音色/情感指令） */
  personaVoice?: PersonaVoiceConfig;
  /** 音色下拉清单（用于把音色 id 翻成用户可读的名字） */
  voiceOptions?: readonly VoiceOption[];
}

/** 音色展示名：优先自定义名称，取不到时用音色 id */
function describeTimbre(tuning: VoiceTuning, options?: readonly VoiceOption[]): string {
  const name = voiceShortLabel(options, tuning.voice);
  return name === '' || name === tuning.voice ? tuning.voice : `${name}（${tuning.voice}）`;
}

/**
 * 组装语音说明 section。
 *
 * @returns undefined = 语音未启用（开关关闭或 apiKey 为空），不注入任何说明
 */
export function buildVoicePromptSection(options: VoicePromptOptions): VoicePromptSection | undefined {
  const { settings, personaVoice, voiceOptions } = options;
  if (settings === undefined) return undefined;

  const tuning = resolveVoiceTuning(settings, personaVoice);
  const lines = [
    '【语音回复】',
    `本会话可以把回复发成 QQ 语音（当前音色：${describeTimbre(tuning, voiceOptions)}`
    + `${tuning.instruction === undefined ? '）。' : `；语气：${tuning.instruction}）。`}`,
    `需要语音时：先调用 ${VOICE_TOOL_NAME}（本轮的语气可以写进它的 instruction 参数），再把要说的话写成回复正文。`
    + '这段正文会合成为语音，**不会再发一条重复的文字**，所以正文就是嘴里要说的话。',
    `（${VOICE_TOOL_NAME} 已在本会话的工具列表里；即使人格的工具清单没写到它，也照样可以调用。）`,
    '',
    '【instruction = 场景 + 逐句走向】',
    `每次调用 ${VOICE_TOOL_NAME} 都必须带 instruction（必填，≤${MAX_VOICE_INSTRUCTION_LEN} 字，只描述怎么说，不会被念出来）：`
    + '先交代这一轮的场景/情境，再按正文的句子顺序写每一句怎么走，用「；」分隔。',
    '模板：场景：夜里她叫住学长，楼道很静，她有点紧张；第1句：声音很轻、带一点迟疑，语速偏慢，像在鼓起勇气；'
    + '第2句：有些吞吐，中间有自然的停顿，句尾不要往上飘；第3句：柔和、带一点温暖的笑意，语速平稳。',
    '单句回复也照样写「场景 + 这一句」：如「场景：深夜私聊，她困得不行；这一句：声音轻而软，慢一点，句尾落地」。',
    '走向要具体可执行：音量高低、语速快慢、笑意/委屈/迟疑、在哪几个字后面停一下、音调要不要上扬。'
    + '只写「自然一点」「带点感情」等于没写；每句都沿用同一套默认语气，听起来就会像念稿。',
    '本轮 instruction 会和人格里固定的语气一起下发给 TTS：你只写这一轮的场景与逐句走向，'
    + '不用复述人格设定；但也别因此只写一句「语气自然」——那样人格细节会被你的短指令挤到后面。',
    '场景要贴当前上下文（时间、地点、关系、刚才聊了什么、她是什么状态）；逐句走向要和正文的句子一一对上，但不要把正文抄进去。',
    '',
    '【正文 = 台词，不是文章】',
    '- 像发微信语音那样说话：1–2 个短句、30–60 字最好，一句一句能直接念出来；'
    + '可以用「嗯」「诶」「啊」这类起头的语气词，用逗号或省略号表示停顿，不要一口气念一大段。',
    '- 只写台词，不写旁白：不要括号里的动作神态（（小声）、(sighs)），不要【突然】【笑】、'
    + '[pause:1s] 这类标记，不要 *叹气* 星号动作——它们没有朗读意义。',
    '- 情绪优先写在 instruction 里：例如「带点笑意」「压低声音」「有点委屈」「语速慢一点」。',
    `- 需要一句话里逐句变情绪时，才在正文里用服务端标签，且只用这几个：${SPEECH_EMOTION_TAGS.map((tag) => `[${tag}]`).join('、')}；其它标签不要写。`,
    '- 不要用 ||| 分条、不要用换行分气泡：语音是一条完整的话，需要断开就用逗号、句号。',
    '- 语音轮的正文只用于合成、不发给用户看，断句按口语来（句号、问号都可以写），不受人格「不打句号」这类聊天格式限制。',
    '- 不要出现念不出来的东西：Markdown、代码块、URL、编号列表、颜文字、emoji。',
    '',
    '什么时候用语音：用户想听你的声音（「说句话」「发条语音」「想听你说话」「唱首歌」）、晚安安慰撒娇这类情绪化的短句、私聊里一两句话的回应。',
    '什么时候不用：代码、链接、列表或步骤、长篇解释、需要复制保存的内容，以及群聊里给多人看的信息——这些用文字更清楚。',
    `正文长度：控制在 ${settings.maxChars} 字以内，一次只发一条语音。`,
    '不要每轮都调用：没有需要用声音表达的场合，正常用文字回复即可。',
  ];
  return { name: 'qqbot:voice', order: VOICE_PROMPT_ORDER, text: lines.join('\n') };
}
