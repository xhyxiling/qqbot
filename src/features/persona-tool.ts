/**
 * qqbot_current_persona — 让模型在运行时获取自己当前生效的人格
 *
 * 人格是全局的，可能在一条消息之间被主人切换（私聊或群聊里说一句就行）。
 * 如果把人格设定静态写死在 system prompt 里，模型很容易被聊天记录里旧的
 * `/persona` 输出带偏，坚持自己还是旧人格。这里把人格变成工具：
 *
 *   system prompt 只要求「每轮回复前先调用本工具」，
 *   工具返回当前人格的名字、完整设定与颜文字规则。
 *
 * 工具本身不调用 LLM，只读取 SessionManager 里的全局人格解析结果。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { PersonaPreset } from '../config.ts';
import type { Logger } from '../types.ts';
import type { ToolsRegistryLike } from './model-route.ts';
import { buildKaomojiPrompt } from '../expressions/kaomoji.ts';

/** 工具名 */
export const CURRENT_PERSONA_TOOL_NAME = 'qqbot_current_persona';

/** 只看人格解析结果，避免把整个 SessionManager 拖进这个文件 */
export interface PersonaLookupLike {
  getEffectivePersona(): PersonaPreset | undefined;
}

/** 工具返回 */
export interface CurrentPersonaResult {
  enabled: boolean;
  id: string;
  name: string;
  text: string;
}

/**
 * 把当前人格渲染成给模型看的文本。
 *
 * 未启用人格时也要明确说出来：否则模型会继续沿用聊天记录里的旧人格设定。
 */
export function describeCurrentPersona(persona: PersonaPreset | undefined): CurrentPersonaResult {
  if (persona === undefined) {
    return {
      enabled: false,
      id: '',
      name: '',
      text: '【当前人格】未启用：按全局提示词说话。聊天记录里旧的人格设定已经失效，不要再沿用。',
    };
  }

  const name = persona.name.trim() || persona.id;
  const parts = [
    `【当前人格】${name}（${persona.id}）`,
    '本轮回复以这份设定为准；聊天记录里旧的 /persona 列表、或你以前关于人格的说法都可能已过期。',
  ];
  const prompt = (persona.prompt ?? '').trim();
  if (prompt !== '') {
    parts.push('', '【人格设定】', prompt);
  }
  const kaomoji = buildKaomojiPrompt(persona);
  if (kaomoji) {
    parts.push('', kaomoji);
  }
  parts.push('', '（本结果只对当前这一轮有效；下一轮回复前需要重新获取。）');
  return { enabled: true, id: persona.id, name, text: parts.join('\n') };
}

/**
 * 注册 qqbot_current_persona（tools 服务不可用时告警跳过，不阻断启动）
 */
export function registerCurrentPersonaTool(
  ctx: Context,
  options: { manager: PersonaLookupLike; logger: Logger },
): void {
  const { manager, logger } = options;
  let tools: ToolsRegistryLike | undefined;
  try {
    tools = ctx.get('tools') as ToolsRegistryLike | undefined;
  } catch {
    tools = undefined;
  }
  if (!tools?.register) {
    logger.warn(`im-qqbot: tools 服务不可用，${CURRENT_PERSONA_TOOL_NAME} 工具未注册`);
    return;
  }

  const definition = {
    name: CURRENT_PERSONA_TOOL_NAME,
    description:
      'Get the bot\'s current persona: its name/id, full persona prompt and any kaomoji rules. '
      + 'Persona is global and can be switched at any time by the owner, in either private or group chat, '
      + 'so call this before composing a reply (every turn) instead of trusting old /persona output or '
      + 'what you said about your persona earlier in the conversation.',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          id: { type: 'string' },
          name: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['enabled', 'id', 'name', 'text'],
        additionalProperties: false,
      },
      render: (_args: unknown, value: unknown): ContentBlock[] => [
        { type: 'text', text: (value as CurrentPersonaResult).text },
      ],
    },
    async execute(): Promise<CurrentPersonaResult> {
      return describeCurrentPersona(manager.getEffectivePersona());
    },
  };

  tools.register(definition);
  logger.info(`im-qqbot: ${CURRENT_PERSONA_TOOL_NAME} 工具已注册（模型每轮获取当前人格）`);
}
