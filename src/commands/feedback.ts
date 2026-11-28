/**
 * Feedback 命令：/feedback — 记录对回复的评价
 *
 * 只做记录，不立即改变行为。累积的差评由 `/evolve` 归因成策略提案，
 * 主人确认后才生效；数据落在 ~/.dsh-qqbot/feedback.json。
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
import { getScopePeer } from '../shared/index.ts';
import { getFeedbackStore } from '../evolve/store.ts';

/** 接受中英文与符号简写，减少记忆负担 */
function parseVerdict(raw: string): 'good' | 'bad' | undefined {
  const value = raw.trim().toLowerCase();
  if (['good', '好', '赞', '👍', '+'].includes(value)) return 'good';
  if (['bad', '差', '烂', '👎', '-'].includes(value)) return 'bad';
  return undefined;
}

export function feedbackCommand(_deps: CommandDeps): CategorizedCommand {
  return {
    name: ['feedback', '反馈'],
    category: 'qqbot',
    description: '评价这次回复（用法: /feedback good|bad [备注]）',
    minRole: 'admin',
    handler: (cmdCtx) => {
      const raw = (cmdCtx.command?.raw ?? '').trim();
      const [verdictRaw = '', ...rest] = raw.split(/\s+/);
      const verdict = parseVerdict(verdictRaw);
      if (verdict === undefined) {
        return '用法: `/feedback good|bad [备注]`\n例如：`/feedback bad 刚才太吵了，别插话`';
      }

      const note = rest.join(' ').trim();
      const { scope, peerId } = getScopePeer(cmdCtx);
      const store = getFeedbackStore();
      store.add({
        scope,
        peerId,
        senderId: cmdCtx.message.senderId,
        verdict,
        ...(note !== '' ? { note } : {}),
      });

      const total = store.count();
      return verdict === 'good'
        ? `✅ 已记录好评（第 ${total} 条）`
        : `📝 已记录差评（第 ${total} 条）。发送 /evolve 可生成调整提案，确认后才生效。`;
    },
  };
}
