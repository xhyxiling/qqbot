import { getCommandChannel, getScopePeer, sendMarkdownChunked } from "../shared/index.js";
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
/** 事实来源标签 */
function sourceTag(note) {
    if (note.source === 'manual')
        return '（手动）';
    if (note.source === 'llm')
        return '（模型）';
    return '（自动）';
}
export function memoryCommand({ manager, config }) {
    return {
        name: ['memory', '记忆'],
        category: 'qqbot',
        description: '查看或管理长期记忆（用法: /memory [add|del|clear|bind]）',
        handler: async (cmdCtx) => {
            const { scope, peerId } = getScopePeer(cmdCtx);
            const senderId = cmdCtx.message.senderId;
            const channel = getCommandChannel(cmdCtx);
            const raw = (cmdCtx.command?.raw ?? '').trim();
            const sub = (raw.split(/\s+/)[0] ?? '').toLowerCase();
            const payload = raw.slice(raw.split(/\s+/)[0]?.length ?? 0).trim();
            if (!config.memory.enabled) {
                return '记忆功能已关闭。可在配置文件的 `memory.enabled` 中开启。';
            }
            // add：追加一条要点
            if (sub === 'add' || sub === '添加' || sub === '记') {
                if (!payload)
                    return '用法: `/memory add <要记住的内容>`';
                const note = manager.addPersonNote(senderId, payload, channel);
                if (!note)
                    return '这条记忆已经记过了（或内容为空）。';
                return `✅ 已记住: ${note.text}`;
            }
            // del / forget：按序号删除（用户看到的序号从 1 开始）
            if (sub === 'del' || sub === 'delete' || sub === 'forget' || sub === '删除') {
                const index = Number.parseInt(payload, 10);
                const person = manager.getPersonMemory(senderId, channel);
                if (!Number.isFinite(index) || index <= 0) {
                    return '用法: `/memory del <序号>`（序号从 1 开始，见 `/memory` 列表）';
                }
                if (!person || index > person.notes.length) {
                    return `没有第 ${index} 条记忆，当前共 ${person?.notes.length ?? 0} 条。`;
                }
                const removed = manager.removePersonNote(senderId, index - 1, channel);
                if (!removed)
                    return `删除第 ${index} 条记忆失败。`;
                return `✅ 已删除第 ${index} 条记忆。`;
            }
            // clear：清空要点，保留关系统计
            if (sub === 'clear' || sub === '清空') {
                const count = manager.clearPersonNotes(senderId, channel);
                if (count === 0)
                    return '当前没有要点记忆，无需清空。';
                return `✅ 已清空 ${count} 条要点记忆（互动次数与关系阶段保留）。`;
            }
            // bind：签发 / 兑换绑定码
            if (sub === 'bind' || sub === '绑定') {
                if (!payload) {
                    const issued = manager.issueMemoryBindCode(senderId, channel);
                    if (!issued.ok) {
                        return issued.reason === 'disabled'
                            ? '记忆功能已关闭。'
                            : '暂时无法生成绑定码，请稍后再试。';
                    }
                    return [
                        `✅ 绑定码：**${issued.code}**（10 分钟内有效）`,
                        '',
                        '到另一个会话（例如你想合并的那个群）发送：',
                        `\`/memory bind ${issued.code}\``,
                    ].join('\n');
                }
                const redeemed = manager.redeemMemoryBindCode(payload, senderId, channel);
                if (redeemed.ok) {
                    return redeemed.merged
                        ? '✅ 绑定成功：两个身份的记忆已经合并，之后群聊和私聊共用一份。'
                        : '✅ 已绑定。';
                }
                switch (redeemed.reason) {
                    case 'invalid':
                        return '绑定码无效。先在其中一个会话发送 `/memory bind` 获取绑定码。';
                    case 'expired':
                        return '绑定码已过期，请重新发送 `/memory bind` 获取。';
                    case 'same':
                        return '这个身份已经绑定了，无需重复操作。';
                    case 'cross-channel':
                        return '这个绑定码属于另一侧的记忆库（官方 / OneBot 分开存储），不能跨侧绑定。请在同一侧重新获取。';
                    default:
                        return '记忆功能已关闭。';
                }
            }
            // 无参数 / 未知子命令：展示画像 + 本会话关系
            const person = manager.getPersonMemory(senderId, channel);
            const memory = manager.getChatMemory(scope, peerId, channel);
            if (!person && !memory) {
                return [
                    '### 🧠 记忆',
                    '',
                    '还没有关于你的记忆。聊几句后会自动记住「我叫… / 我喜欢…」这类自述，',
                    '后台也会在消息攒够后补充抽取长期事实。',
                    '',
                    '手动添加: `/memory add <内容>`',
                ].join('\n');
            }
            const lines = ['### 🧠 记忆', ''];
            const isOneBot = (channel ?? (/^\d+$/.test(senderId) ? 'onebot' : 'official')) === 'onebot';
            const side = isOneBot ? 'QQ 账号侧' : '官方机器人侧';
            lines.push(`> 存储：${side}（与另一侧分开存储，绑定只在同一侧内生效）`, '');
            if (person) {
                const who = person.senderName ? person.senderName : '（未记录昵称）';
                lines.push(`**关于你（跨群/私聊共享）:** ${who}`);
                lines.push(`互动 ${person.messageCount} 次，认识于 ${formatDate(person.firstSeenAt)}（约 ${daysSince(person.firstSeenAt)} 天）`);
                if (person.notes.length === 0) {
                    lines.push('', '**你的要点:** 暂无');
                }
                else {
                    lines.push('', `**你的要点（${person.notes.length} 条）:**`);
                    person.notes.forEach((note, i) => {
                        lines.push(`${i + 1}. ${note.text}${sourceTag(note)}`);
                    });
                }
            }
            if (memory) {
                lines.push('', `**本会话关系（${scope === 'group' ? '本群' : '私聊'}）:** `
                    + `${relationshipStage(memory.messageCount)}，互动 ${memory.messageCount} 次，`
                    + `认识于 ${formatDate(memory.firstSeenAt)}（约 ${daysSince(memory.firstSeenAt)} 天）`);
            }
            lines.push('', '添加: `/memory add <内容>`　删除: `/memory del <序号>`　清空: `/memory clear`', '绑定双后端/群聊私聊身份: `/memory bind`', '', '> 要点记在「你」身上，同一侧（官方 / OneBot）内的群聊和私聊共享；`/new` 只重置上下文，不会清除记忆。');
            await sendMarkdownChunked(cmdCtx, lines.join('\n'), config.textChunkLimit);
            return { kind: 'noop' };
        },
    };
}
//# sourceMappingURL=memory.js.map