import { getScopePeer } from "../shared/index.js";
import { analyzeFeedback } from "../evolve/analyze.js";
import { getFeedbackStore, getPolicyStore, } from "../evolve/store.js";
function formatPercent(value) {
    return `${Math.round(value * 1000) / 10}%`;
}
function formatTime(at) {
    const d = new Date(at);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
/** 一条提案的展示文本（不含编号） */
function renderProposal(proposal) {
    return `${proposal.reason}\n　依据: ${proposal.evidence} 条反馈`;
}
/** 当前策略的简洁描述，用于 apply/status/rollback 后的回显 */
function renderValues(values, deps) {
    const cfg = deps.config.proactive;
    const p = values.proactive;
    const fallback = (override, base, suffix = '') => override !== undefined
        ? `${override}${suffix}（默认 ${base ?? '—'}${suffix}）`
        : `跟随配置 ${base ?? '—'}${suffix}`;
    return [
        `主动发言: 概率 ${fallback(p.probability === undefined ? undefined : Math.round(p.probability * 1000) / 10, cfg === undefined ? undefined : Math.round(cfg.probability * 1000) / 10, '%')}`,
        `  间隔 ${fallback(p.minIntervalSec, cfg?.minIntervalSec, 's')}`
            + `，每小时 ${fallback(p.maxPerHour, cfg?.maxPerHour)}`
            + `，每天 ${fallback(p.maxPerDay, cfg?.maxPerDay)}`,
        values.styleNotes.length > 0
            ? `表达偏好: ${values.styleNotes.map((note) => `「${note}」`).join('、')}`
            : '表达偏好: 无',
    ];
}
export function evolveCommand(deps) {
    return {
        name: ['evolve', '进化'],
        category: 'qqbot',
        description: '根据反馈生成/应用回复策略（用法: /evolve [apply|discard|status|history|rollback]）',
        minRole: 'admin',
        handler: async (cmdCtx) => {
            const raw = (cmdCtx.command?.raw ?? '').trim();
            const [sub = '', ...rest] = raw.split(/\s+/);
            const policy = getPolicyStore();
            const feedback = getFeedbackStore();
            const { scope, peerId } = getScopePeer(cmdCtx);
            /**
             * 优先让模型理解反馈；模型不可用/失败时回落到关键词规则。
             * 两条路径都只产出提案，是否生效仍由主人 apply 决定。
             */
            const generate = async () => {
                const current = policy.snapshot();
                const modeled = await deps.manager.analyzeFeedbackWithModel(feedback.all(), current, scope, peerId);
                if (modeled !== undefined)
                    return { proposals: modeled, source: '模型归因' };
                return { proposals: analyzeFeedback(feedback.all(), current), source: '规则归因' };
            };
            // 无参数：生成提案并展示
            if (sub === '') {
                const { proposals, source } = await generate();
                if (proposals.length === 0) {
                    return '暂时没有可执行的调整。\n'
                        + '同类差评至少 2 条才会提案，先用 `/feedback bad <原因>` 记录感受。';
                }
                policy.setPending(proposals);
                const lines = [`🧬 待确认的调整（${source}，只展示，未生效）`, ''];
                proposals.forEach((proposal, index) => {
                    lines.push(`**${index + 1}.** ${renderProposal(proposal)}`);
                });
                lines.push('', '发送 `/evolve apply` 全部应用，`/evolve apply 2` 只应用第 2 条；', '`/evolve discard` 放弃这批提案。');
                return lines.join('\n');
            }
            if (sub === 'apply') {
                let proposals = policy.pending();
                if (proposals.length === 0) {
                    proposals = (await generate()).proposals;
                    if (proposals.length === 0) {
                        return '没有可应用的提案。先用 `/feedback bad <原因>` 记录问题（同类至少 2 条）。';
                    }
                    policy.setPending(proposals);
                }
                const target = Number.parseInt(rest[0] ?? '', 10);
                if (Number.isFinite(target)) {
                    if (target < 1 || target > proposals.length) {
                        return `序号超出范围：当前有 ${proposals.length} 条待确认提案。`;
                    }
                    proposals = [proposals[target - 1]];
                }
                const result = policy.apply(proposals, 'feedback');
                return [
                    `✅ 已应用 ${proposals.length} 项调整（第 ${result.revision} 版）`,
                    ...renderValues(result.values, deps),
                    '',
                    '主动发言参数在下一条旁听消息生效；表达偏好在下一轮回复生效。',
                ].join('\n');
            }
            if (sub === 'discard') {
                return policy.clearPending()
                    ? '已放弃待确认的提案。'
                    : '当前没有待确认的提案。';
            }
            if (sub === 'status') {
                const values = policy.snapshot();
                const pending = policy.pending();
                return [
                    `🧬 策略状态（第 ${policy.revision} 版）`,
                    ...renderValues(values, deps),
                    pending.length > 0 ? `待确认: ${pending.length} 条（/evolve apply 或 /evolve discard）` : '待确认: 无',
                    `反馈总数: ${feedback.count()}（/feedback good|bad [备注]）`,
                ].join('\n');
            }
            if (sub === 'history') {
                const history = policy.history();
                if (history.length === 0)
                    return '还没有应用过任何策略调整。';
                return [
                    '🧬 策略历史（旧 → 新，最多显示最近 10 条）',
                    ...history.slice(-10).map((entry) => {
                        const main = entry.values.proactive.probability !== undefined
                            ? `概率 ${formatPercent(entry.values.proactive.probability)}`
                            : '无参数覆盖';
                        const style = entry.values.styleNotes.length > 0
                            ? `；偏好 ${entry.values.styleNotes.length} 条`
                            : '';
                        return `#${entry.revision} ${formatTime(entry.at)} ${entry.source}${entry.note !== undefined ? `（${entry.note}）` : ''}: ${main}${style}`;
                    }),
                ].join('\n');
            }
            if (sub === 'rollback') {
                if (!policy.rollback())
                    return '没有可回滚的版本。';
                return [
                    `↩️ 已回滚到第 ${policy.revision} 版`,
                    ...renderValues(policy.snapshot(), deps),
                    '',
                    '已回滚的版本不再出现在 /evolve history 里，可重新 /evolve 生成提案。',
                ].join('\n');
            }
            return '用法: `/evolve` 生成提案，`/evolve apply [序号]` 应用，'
                + '`/evolve discard` 放弃，`/evolve status` 查看，`/evolve history` 历史，`/evolve rollback` 回滚。';
        },
    };
}
//# sourceMappingURL=evolve.js.map