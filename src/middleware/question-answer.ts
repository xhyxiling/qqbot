/**
 * 待答问题截获中间件 — 在中间件链中截获 ask_user_question 的答案
 *
 * 必须放在 concurrencyGuard 之前：答案消息需绕过并发守卫的 merge 缓冲，
 * 否则会被排队而无法到达 tryAnswer，导致「turn 等答案 ↔ 答案被缓冲」死锁。
 */
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { SessionManager } from '../session/index.ts';
import { cacheMsgId } from '../transport/msgid-cache.ts';

export function questionAnswer(manager: SessionManager) {
  return async (ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> => {
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
export function approvalAnswer(manager: SessionManager) {
  return async (ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> => {
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
