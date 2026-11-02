/**
 * Memory 命令：/memory — 查看或管理长期记忆与关系状态
 *
 * 记忆按会话独立持久化（~/.dsh-qqbot/memory.json），与上下文历史分开：
 * `/new` 只重置对话，记忆仍在。
 *
 * 用法：
 *   /memory             查看当前会话的记忆与关系阶段
 *   /memory add <文本>   手动追加一条要点
 *   /memory del <序号>   删除第 N 条要点（序号从 1 开始）
 *   /memory clear       清空要点（保留互动次数与关系阶段）
 */
import type { CommandDeps, CategorizedCommand } from './types.ts';
import { getScopePeer, sendMarkdownChunked } from '../shared/index.ts';
import { relationshipStage } from '../memory/memory-prompt.ts';

/** 关系天数（向上取整，至少 1 天） */
function daysSince(firstSeenAt: number, now = Date.now()): number {
  return Math.max(1, Math.ceil((now - firstSeenAt) / 86_400_000));
}

/** 时间戳 → YYYY-MM-DD（本地时区） */
function formatDate(at: number): string {
  const d = new Date(at);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function memoryCommand({ manager, config }: CommandDeps): CategorizedCommand {
  return {
    name: ['memory', '记忆'],
    category: 'qqbot',
    description: '查看或管理长期记忆（用法: /memory [add|del|clear]）',
    minRole: 'admin',
    handler: async (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      const raw = (cmdCtx.command?.raw ?? '').trim();
      const sub = (raw.split(/\s+/)[0] ?? '').toLowerCase();
      const payload = raw.slice(raw.split(/\s+/)[0]?.length ?? 0).trim();

      if (!config.memory.enabled) {
        return '记忆功能已关闭。可在配置文件的 `memory.enabled` 中开启。';
      }

      // add：手动追加一条要点
      if (sub === 'add' || sub === '添加' || sub === '记') {
        if (!payload) return '用法: `/memory add <要记住的内容>`';
        const note = manager.addMemoryNote(scope, peerId, payload);
        if (!note) return '这条记忆已经记过了（或内容为空）。';
        return `✅ 已记住: ${note.text}`;
      }

      // del：按序号删除（用户看到的序号从 1 开始）
      if (sub === 'del' || sub === 'delete' || sub === '删除') {
        const index = Number.parseInt(payload, 10);
        const memory = manager.getChatMemory(scope, peerId);
        if (!Number.isFinite(index) || index <= 0) {
          return '用法: `/memory del <序号>`（序号从 1 开始，见 `/memory` 列表）';
        }
        if (!memory || index > memory.notes.length) {
          return `没有第 ${index} 条记忆，当前共 ${memory?.notes.length ?? 0} 条。`;
        }
        const removed = manager.removeMemoryNote(scope, peerId, index - 1);
        if (!removed) return `删除第 ${index} 条记忆失败。`;
        return `✅ 已删除第 ${index} 条记忆。`;
      }

      // clear：清空要点，保留关系统计
      if (sub === 'clear' || sub === '清空') {
        const count = manager.clearMemoryNotes(scope, peerId);
        if (count === 0) return '当前没有要点记忆，无需清空。';
        return `✅ 已清空 ${count} 条要点记忆（互动次数与关系阶段保留）。`;
      }

      // 无参数 / 未知子命令：展示当前记忆
      const memory = manager.getChatMemory(scope, peerId);
      if (!memory) {
        return [
          '### 🧠 记忆与关系',
          '',
          '还没有关于本会话的记忆。聊几句后会自动记住「我叫… / 我喜欢…」这类自述。',
          '',
          '手动添加: `/memory add <内容>`',
        ].join('\n');
      }

      const lines: string[] = ['### 🧠 记忆与关系', ''];
      lines.push(`**关系阶段:** ${relationshipStage(memory.messageCount)}（互动 ${memory.messageCount} 次）`);
      lines.push(`**认识于:** ${formatDate(memory.firstSeenAt)}（约 ${daysSince(memory.firstSeenAt)} 天）`);

      if (memory.notes.length === 0) {
        lines.push('', '**要点记忆:** 暂无');
      } else {
        lines.push('', `**要点记忆（${memory.notes.length} 条）:**`);
        memory.notes.forEach((note, i) => {
          const tag = note.source === 'manual' ? '（手动）' : '';
          lines.push(`${i + 1}. ${note.text}${tag}`);
        });
      }

      lines.push(
        '',
        '添加: `/memory add <内容>`　删除: `/memory del <序号>`　清空: `/memory clear`',
        '',
        '> 记忆按会话独立保存，`/new` 只重置上下文，不会清除记忆。',
      );

      await sendMarkdownChunked(cmdCtx, lines.join('\n'), config.textChunkLimit);
      return { kind: 'noop' as const };
    },
  };
}
