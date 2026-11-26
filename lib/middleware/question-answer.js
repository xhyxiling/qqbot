import { cacheMsgId } from "../transport/msgid-cache.js";
export function questionAnswer(manager) {
    return async (ctx, next) => {
        const questionChannel = manager.questionChannel;
        if (!questionChannel) {
            await next();
            return;
        }
        if (questionChannel.tryAnswer(ctx.replyTarget.scope, ctx.replyTarget.targetId, ctx.message.content.trim())) {
            // 答案消息被截获（不再走到 bot.on('message')），在此补录其 msgId，
            // 供被动回复超限时切换到缓存的最近 msgId。
            cacheMsgId(ctx.replyTarget.scope, ctx.replyTarget.targetId, ctx.replyTarget.msgId);
            ctx.stop('question-answer');
            return;
        }
        await next();
    };
}
/**
 * 待批审批的文本作答 — 「同意 / 拒绝」直接决策。
 *
 * QQ 开放平台走按钮回调；OneBot（普通 QQ 账号）没有 interaction 事件，
 * 只能靠文字回答，否则审批会一直挂起直到会话被回收。
 * 同样必须放在 concurrencyGuard 之前。
 */
export function approvalAnswer(manager) {
    return async (ctx, next) => {
        const approvalChannel = manager.approvalChannel;
        if (!approvalChannel) {
            await next();
            return;
        }
        if (approvalChannel.tryAnswer(ctx.replyTarget.scope, ctx.replyTarget.targetId, ctx.message.content.trim())) {
            cacheMsgId(ctx.replyTarget.scope, ctx.replyTarget.targetId, ctx.replyTarget.msgId);
            ctx.stop('approval-answer');
            return;
        }
        await next();
    };
}
//# sourceMappingURL=question-answer.js.map