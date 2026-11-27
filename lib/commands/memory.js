import { getScopePeer, sendMarkdownChunked } from "../shared/index.js";
import { relationshipStage } from "../memory/memory-prompt.js";
/** 关系天数（向上取整，至少 1 天） */
function daysSince(firstSeenAt, now = Date.now()) {
    return Math.max(1, Math.ceil((now - firstSeenAt) / 86_400_000));
}
/** 时间戳 → YYYY-MM-DD（本地时区） */
function formatDate(at) {
    const d = new Date(at);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function memoryCommand({ manager, config }) {
    return {
        name: ['memory', '记忆'],
        category: 'qqbot',
        description: '查看或管理长期记忆（用法: /memory [add|del|clear]）',
        minRole: 'admin',
        handler: async (cmdCtx) => {
            const { scope, peerId } = getScopePeer(cmdCtx);
            const senderId = cmdCtx.message.senderId;
            const raw = (cmdCtx.command?.raw ?? '').trim();
            const sub = (raw.split(/\s+/)[0] ?? '').toLowerCase();
            const payload = raw.slice(raw.split(/\s+/)[0]?.length ?? 0).trim();
            if (!config.memory.enabled) {
                return '记忆功能已关闭。可在配置文件的 `memory.enabled` 中开启。';
            }
            // add：手动给你的画像追加一条要点
            if (sub === 'add' || sub === '添加' || sub === '记') {
                if (!payload)
                    return '用法: `/memory add <要记住的内容>`';
                const note = manager.addPersonNote(senderId, payload);
                if (!note)
                    return '这条记忆已经记过了（或内容为空）。';
                return `✅ 已记住: ${note.text}`;
            }
            // del：按序号删除（用户看到的序号从 1 开始）
            if (sub === 'del' || sub === 'delete' || sub === '删除') {
                const index = Number.parseInt(payload, 10);
                const person = manager.getPersonMemory(senderId);
                if (!Number.isFinite(index) || index <= 0) {
                    return '用法: `/memory del <序号>`（序号从 1 开始，见 `/memory` 列表）';
                }
                if (!person || index > person.notes.length) {
                    return `没有第 ${index} 条记忆，当前共 ${person?.notes.length ?? 0} 条。`;
                }
                const removed = manager.removePersonNote(senderId, index - 1);
                if (!removed)
                    return `删除第 ${index} 条记忆失败。`;
                return `✅ 已删除第 ${index} 条记忆。`;
            }
            // clear：清空要点，保留关系统计
            if (sub === 'clear' || sub === '清空') {
                const count = manager.clearPersonNotes(senderId);
                if (count === 0)
                    return '当前没有要点记忆，无需清空。';
                return `✅ 已清空 ${count} 条要点记忆（互动次数与关系阶段保留）。`;
            }
            // 无参数 / 未知子命令：展示画像 + 本会话关系
            const person = manager.getPersonMemory(senderId);
            const memory = manager.getChatMemory(scope, peerId);
            if (!person && !memory) {
                return [
                    '### 🧠 记忆',
                    '',
                    '还没有关于你的记忆。聊几句后会自动记住「我叫… / 我喜欢…」这类自述。',
                    '',
                    '手动添加: `/memory add <内容>`',
                ].join('\n');
            }
            const lines = ['### 🧠 记忆', ''];
            if (person) {
                const who = person.senderName ? `${person.senderName}（${person.senderId}）` : person.senderId;
                lines.push(`**关于你（跨群/私聊共享）:** ${who}`);
                lines.push(`互动 ${person.messageCount} 次，认识于 ${formatDate(person.firstSeenAt)}（约 ${daysSince(person.firstSeenAt)} 天）`);
                if (person.notes.length === 0) {
                    lines.push('', '**你的要点:** 暂无');
                }
                else {
                    lines.push('', `**你的要点（${person.notes.length} 条）:**`);
                    person.notes.forEach((note, i) => {
                        const tag = note.source === 'manual' ? '（手动）' : '';
                        lines.push(`${i + 1}. ${note.text}${tag}`);
                    });
                }
            }
            if (memory) {
                lines.push('', `**本会话关系（${scope === 'group' ? '本群' : '私聊'}）:** `
                    + `${relationshipStage(memory.messageCount)}，互动 ${memory.messageCount} 次，`
                    + `认识于 ${formatDate(memory.firstSeenAt)}（约 ${daysSince(memory.firstSeenAt)} 天）`);
            }
            lines.push('', '添加: `/memory add <内容>`　删除: `/memory del <序号>`　清空: `/memory clear`', '', '> 要点记在「你」身上，私聊和所有群共享；`/new` 只重置上下文，不会清除记忆。');
            await sendMarkdownChunked(cmdCtx, lines.join('\n'), config.textChunkLimit);
            return { kind: 'noop' };
        },
    };
}
//# sourceMappingURL=memory.js.map