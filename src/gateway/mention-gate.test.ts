/**
 * 群聊回复门控回归测试
 *
 * 开通「全量群消息」权限后，平台会额外推送 `GROUP_MESSAGE_CREATE`（群内每条消息）。
 * 这些消息只应进入档案 / 历史缓冲，**不能**逐条触发回复；回复仍由
 * `mentionGate({ requireMentionInGroup: config.requireMention })` 控制。
 *
 * 这里直接用 SDK 的 mentionGate 固化这层语义，避免以后换配置或升级 SDK 时
 * 把「全量消息 = 每条都回复」带回来。
 */
import { describe, expect, it, vi } from 'vitest';
import { mentionGate } from '@tencent-connect/qqbot-nodejs';
import type { MiddlewareContext, QQBotInboundMessage } from '@tencent-connect/qqbot-nodejs';

const APP_ID = '1906126382';

interface FakeCtx {
  ctx: MiddlewareContext;
  stop: ReturnType<typeof vi.fn>;
}

/** 造一个最小的群消息上下文（只填 mentionGate 会读的字段） */
function makeCtx(overrides: Partial<QQBotInboundMessage> = {}): FakeCtx {
  const message = {
    kind: 'group',
    rawEventType: 'GROUP_MESSAGE_CREATE',
    content: '群友闲聊：今天下雨了',
    mentions: [],
    senderId: 'u1',
    groupOpenid: 'g1',
    ...overrides,
  } as unknown as QQBotInboundMessage;
  const stop = vi.fn();
  const ctx = {
    bot: { appId: APP_ID },
    message,
    replyTarget: {},
    state: {},
    log: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    stop,
    stopped: false,
    stopReason: undefined,
    signal: new AbortController().signal,
  } as unknown as MiddlewareContext;
  return { ctx, stop };
}

describe('群聊回复门控（全量消息权限下仍只回复 @ 机器人）', () => {
  const gate = mentionGate({ requireMentionInGroup: true });

  it('GROUP_MESSAGE_CREATE 未 @ 机器人：只入档，不进回复流程', async () => {
    const { ctx, stop } = makeCtx();
    const next = vi.fn(async () => {});

    await gate(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledWith('mention-gate:no_mention');
    expect(ctx.state.mention).toMatchObject({ shouldAnswer: false, reason: 'no_mention' });
  });

  it('GROUP_MESSAGE_CREATE 里 @ 了机器人（正文带 <@!appId>）：照常回复', async () => {
    const { ctx, stop } = makeCtx({
      content: `<@!${APP_ID}> 你在吗`,
    });
    const next = vi.fn(async () => {});

    await gate(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    expect(ctx.state.mention).toMatchObject({ shouldAnswer: true, wasMentioned: true });
  });

  it('GROUP_AT_MESSAGE_CREATE（平台只推送 @ 消息）：照常回复', async () => {
    const { ctx, stop } = makeCtx({
      rawEventType: 'GROUP_AT_MESSAGE_CREATE',
      content: '你在吗',
    });
    const next = vi.fn(async () => {});

    await gate(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
  });

  it('关闭「仅回复 @ 机器人」（requireMention=false）：每条群消息都会触发回复（需自行承担刷屏风险）', async () => {
    const permissive = mentionGate({ requireMentionInGroup: false });
    const { ctx, stop } = makeCtx();
    const next = vi.fn(async () => {});

    await permissive(ctx, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
  });
});
