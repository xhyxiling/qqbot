/**
 * Persona 命令：/persona — 查看或切换人格预设
 *
 * 人格是全局的：所有群与私聊统一使用同一个人格，切换一次全部生效。
 * 无参数列出配置中的人格（可点击切换），有参数切换到指定人格；
 * default 跟随默认人格，off 全局关闭人格。
 *
 * 人格通过 system-prompt/assemble 每次 turn 注入，切换后下一条消息即生效。
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
import { sendMarkdownChunked } from '../shared/index.ts';

/** 把展示文本清洗成可安全放进 qqbot-cmd-input show 属性的字符串 */
function safeAttr(text: string): string {
  return text.replace(/["<>\r\n]/g, ' ').trim();
}

export function personaCommand({ manager, config }: CommandDeps): CategorizedCommand {
  return {
    name: ['persona', '人格'],
    category: 'qqbot',
    description: '查看或切换人格预设（用法: /persona [id|default|off]，全局生效）',
    minRole: 'admin',
    handler: async (cmdCtx) => {
      const args = (cmdCtx.command?.raw ?? '').trim();
      const personas = manager.listPersonas();

      // 无参数：列出可用人格 + 当前生效
      if (!args) {
        if (personas.length === 0) {
          return '当前未配置人格预设，请在 dsh 设置面板的「人格预设」中添加后重试。';
        }

        const currentId = manager.getEffectivePersonaId();
        const current = manager.getEffectivePersona();
        const followsDefault = !manager.hasGlobalPersonaOverride();
        const currentLabel = current
          ? `${current.name} (${current.id})${followsDefault ? '（跟随默认）' : ''}`
          : '未启用';

        const lines: string[] = ['### 🎭 人格预设', ''];
        lines.push(`**当前:** ${currentLabel}`);
        if (config.defaultPersona) {
          const def = manager.findPersonaById(config.defaultPersona);
          lines.push(`**默认人格:** ${def ? `${def.name} (${def.id})` : `${config.defaultPersona}（已不存在）`}`);
        }
        lines.push('', '**可用人格（点击切换，全局生效）:**');
        for (const p of personas) {
          const mark = p.id === currentId ? '✅ ' : '';
          const show = safeAttr(`${mark}${p.name || p.id}`);
          const tools = p.tools === undefined
            ? '工具: 全部'
            : p.tools.length === 0 ? '工具: 无' : `工具: ${p.tools.length} 个`;
          lines.push(`<qqbot-cmd-input text="/persona ${p.id}" show="/persona ${show}"/>　_${tools}_`);
        }
        lines.push(
          '',
          '手动指定: `/persona <id>`',
          '跟随默认: `/persona default`　关闭人格: `/persona off`',
          '',
          '> 人格是全局的：切换后所有群和私聊一起生效。',
          '> 切换后下一条消息立即生效，工具权限同时切换；查看绑定用 `/tools`。',
        );

        await sendMarkdownChunked(cmdCtx, lines.join('\n'), config.textChunkLimit);
        return { kind: 'noop' as const };
      }

      // default / reset：清除全局覆盖，回到默认人格
      if (args === 'default' || args === 'reset') {
        manager.clearGlobalPersona();
        const current = manager.getEffectivePersona();
        return current
          ? `✅ 已恢复默认人格（全局）: ${current.name} (${current.id})\n工具权限按默认人格重新绑定，下一条消息生效。`
          : '✅ 已恢复默认（全局）\n当前未配置默认人格，人格已关闭；工具权限回到默认放行清单（插件内置工具 + 只读联网/提问），下一条消息生效。';
      }

      // off：全局关闭人格
      if (args === 'off') {
        manager.disableGlobalPersona();
        return '✅ 已关闭人格（全局，所有群/私聊）\n工具权限回到默认放行清单（插件内置工具 + 只读联网/提问），下一条消息生效，恢复默认用 `/persona default`。';
      }

      // 切换到指定人格：先按 id，再按展示名（用户和模型常说「日常」而不是 daily）
      const persona = manager.findPersonaById(args)
        ?? personas.find((p) => p.name.trim().toLowerCase() === args.toLowerCase());
      if (!persona) {
        const ids = personas.map((p) => `${p.id}（${p.name || p.id}）`).join(', ');
        return `未知人格: ${args}${ids ? `\n可用: ${ids}` : ''}`;
      }

      manager.setGlobalPersona(persona.id);
      const tools = persona.tools === undefined
        ? '工具: 默认策略'
        : persona.tools.length === 0 ? '工具: 无' : `工具: ${persona.tools.length} 个`;
      return `✅ 人格已全局切换（所有群与私聊）: ${persona.name} (${persona.id})\n${tools}，下一条消息生效。`;
    },
  };
}
