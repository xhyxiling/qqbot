/**
 * 人格预设解析工具
 *
 * 与 QQ 会话状态解耦的纯函数，便于单测：
 * - per-chat 覆盖优先，其次 config.defaultPersona
 * - 生成 system-prompt/assemble 需要的 section（全局提示词 + 人格本体）
 */
import type { PersonaPreset } from '../config.ts';
import { buildKaomojiPrompt } from '../expressions/kaomoji.ts';

/** system-prompt section 最小结构 */
export interface PromptSection {
  name: string;
  order: number;
  text: string;
}

/** per-chat 「关闭人格」哨兵值（不会与任何预设 id 相同） */
export const PERSONA_OFF = '__off__';

/** 按 id 查找人格（id 为空或不存在返回 undefined） */
export function findPersona(
  personas: readonly PersonaPreset[] | undefined,
  id: string | undefined,
): PersonaPreset | undefined {
  if (!id) return undefined;
  return personas?.find((p) => p.id === id);
}

/**
 * 解析当前生效的人格 id。
 *
 * 优先级：per-chat 覆盖 > 默认人格 > 未启用。
 * 覆盖项为 PERSONA_OFF 时显式关闭；覆盖项或默认项指向已删除的人格时
 * 视为未启用，避免残留 id 持续生效。
 */
export function resolvePersonaId(
  personas: readonly PersonaPreset[] | undefined,
  defaultId: string | undefined,
  overrideId: string | undefined,
): string | undefined {
  if (overrideId === PERSONA_OFF) return undefined;
  const override = findPersona(personas, overrideId);
  if (override) return override.id;
  const fallback = findPersona(personas, defaultId);
  if (fallback) return fallback.id;
  return undefined;
}

/** 人格 prompt 之后、记忆之前的工具权限说明（order 86） */
export const PERSONA_TOOLS_ORDER = 86;

/**
 * 构造需要追加到 system prompt 的 section。
 *
 * 全局提示词（order=80）对所有会话生效，人格 prompt（order=85）在其后：
 * 全局部分写多条消息拆分规则等通用约束，人格只描述「是谁」。
 * 人格启用了颜文字时，把颜文字用法并进人格 section（同属说话风格），
 * 不单独占一个 order，避免和工具权限说明（order=86）抢位置。
 * 人格配置了工具白名单时追加一段权限说明（order=86），提醒模型不要在
 * 没有对应工具时假装完成文件/图片/联网等操作。
 */
export function buildPersonaPromptSections(
  persona: PersonaPreset | undefined,
  globalPrompt?: string,
  options?: {
    /**
     * 人格白名单之外额外放行的工具（如语音可用时的 `qqbot_voice`）。
     *
     * 必须写进这段说明里：否则提示词说「只绑定了 A、B」，而实际工具列表里
     * 还有 C，模型会按说明认为 C 不可用，从而不敢调用（语音就发不出来）。
     */
    extraTools?: readonly string[];
    /**
     * 不注入人格正文与颜文字。
     *
     * 人格改为由 `qqbot_current_persona` 工具在运行时返回时，system prompt
     * 只保留「先调用工具」的指令；人格白名单说明（order 86）仍然保留。
     */
    omitPrompt?: boolean;
  },
): PromptSection[] {
  const sections: PromptSection[] = [];
  const globalText = globalPrompt?.trim();
  if (globalText) {
    sections.push({ name: 'qqbot:global-prompt', order: 80, text: globalText });
  }
  if (options?.omitPrompt !== true) {
    const personaText = persona?.prompt.trim();
    const kaomojiText = buildKaomojiPrompt(persona);
    const styleText = [personaText, kaomojiText].filter((text): text is string => !!text).join('\n\n');
    if (styleText) {
      sections.push({ name: 'qqbot:persona', order: 85, text: styleText });
    }
  }
  // 没人格或人格没写 tools 时按默认清单放行，不额外说明（默认清单本来就很宽）
  if (persona?.tools !== undefined) {
    const tools = [
      ...new Set(
        [...persona.tools, ...(options?.extraTools ?? [])]
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    ];
    sections.push({
      name: 'qqbot:persona-tools',
      order: PERSONA_TOOLS_ORDER,
      text: tools.length === 0
        ? '本会话没有绑定任何工具：你无法读写文件、发送图片/文件、运行命令或联网。'
          + '遇到这类请求时直接说明做不到，不要声称已经完成。'
        : `本会话仅绑定了这些工具：${tools.join('、')}。`
          + '其余工具不可用；超出范围的请求请直接说明做不到，不要假装执行。',
    });
  }
  return sections;
}
