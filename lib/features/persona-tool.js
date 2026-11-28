import { buildKaomojiPrompt } from "../expressions/kaomoji.js";
/** 工具名 */
export const CURRENT_PERSONA_TOOL_NAME = 'qqbot_current_persona';
/**
 * 把当前人格渲染成给模型看的文本。
 *
 * 未启用人格时也要明确说出来：否则模型会继续沿用聊天记录里的旧人格设定。
 */
export function describeCurrentPersona(persona) {
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
export function registerCurrentPersonaTool(ctx, options) {
    const { manager, logger } = options;
    let tools;
    try {
        tools = ctx.get('tools');
    }
    catch {
        tools = undefined;
    }
    if (!tools?.register) {
        logger.warn(`im-qqbot: tools 服务不可用，${CURRENT_PERSONA_TOOL_NAME} 工具未注册`);
        return;
    }
    const definition = {
        name: CURRENT_PERSONA_TOOL_NAME,
        description: 'Get the bot\'s current persona: its name/id, full persona prompt and any kaomoji rules. '
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
            render: (_args, value) => [
                { type: 'text', text: value.text },
            ],
        },
        async execute() {
            return describeCurrentPersona(manager.getEffectivePersona());
        },
    };
    tools.register(definition);
    logger.info(`im-qqbot: ${CURRENT_PERSONA_TOOL_NAME} 工具已注册（模型每轮获取当前人格）`);
}
//# sourceMappingURL=persona-tool.js.map