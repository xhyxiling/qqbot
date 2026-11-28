import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createOutboundHandler, stripStickerDescriptions } from './outbound.ts';
import type { QQBotSender, StreamSessionLike } from './outbound-buffer.ts';
import type { SessionManager, SessionRecord } from '../session/index.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger, ReplyTarget } from '../types.ts';

function createLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function createSession(): StreamSessionLike {
  return { update: vi.fn().mockResolvedValue(undefined), complete: vi.fn().mockResolvedValue(undefined) };
}

function createBot(session: StreamSessionLike): QQBotSender {
  return {
    sendMarkdown: vi.fn().mockResolvedValue(undefined),
    openStream: vi.fn(() => session),
  };
}

const c2cTarget: ReplyTarget = { scope: 'c2c', targetId: 'user1', msgId: 'msg1' };
const groupTarget: ReplyTarget = { scope: 'group', targetId: 'group1', msgId: 'msg1' };

function createRecord(target: ReplyTarget, sessionId = 'sess-qq'): SessionRecord {
  return {
    sessionKey: 'k',
    sessionId,
    replyTarget: target,
    agent: {},
    handle: {},
    createdAt: 0,
    lastActiveAt: 0,
  } as unknown as SessionRecord;
}

function createConfig(overrides?: Partial<ImQQBotConfig>): ImQQBotConfig {
  return {
    streaming: true,
    textChunkLimit: 4500,
    showToolResults: false,
    ...overrides,
  } as unknown as ImQQBotConfig;
}

/** 组装 handler：manager 按 sessionId 返回 record（默认 c2c 私聊） */
function setup(opts?: {
  record?: SessionRecord | undefined;
  config?: ImQQBotConfig;
  deliverer?: { deliver: ReturnType<typeof vi.fn> };
  voice?: { speak: ReturnType<typeof vi.fn> };
}) {
  const session = createSession();
  const bot = createBot(session);
  const record = 'record' in (opts ?? {}) ? opts!.record : createRecord(c2cTarget);
  const manager = {
    findBySessionId: vi.fn((id: string) => (id === 'sess-qq' ? record : undefined)),
  } as unknown as SessionManager;
  const logger = createLogger();
  const outbound = createOutboundHandler(
    manager, bot, opts?.config ?? createConfig(), logger, undefined, opts?.deliverer, opts?.voice,
  );
  return { outbound, bot, session, record, logger };
}

const delta = (attemptId: string, text: string) => ({ kind: 'text-delta' as const, attemptId, text });
const start = (attemptId: string) => ({ kind: 'attempt-start' as const, attemptId });

describe('OutboundRouter.routeStreamFrame', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('流式帧路由到会话 buffer：openStream + update', async () => {
    const { outbound, bot, session } = setup();

    outbound.routeStreamFrame('sess-qq', start('a1'));
    outbound.routeStreamFrame('sess-qq', delta('a1', 'hello'));
    await vi.advanceTimersByTimeAsync(200);

    expect(bot.openStream).toHaveBeenCalledTimes(1);
    expect(session.update).toHaveBeenCalledWith('hello');
  });

  it('attempt 切换 reset：同一条流式消息被新内容全量重写', async () => {
    const { outbound, bot, session } = setup();

    outbound.routeStreamFrame('sess-qq', start('a1'));
    outbound.routeStreamFrame('sess-qq', delta('a1', 'partial'));
    await vi.advanceTimersByTimeAsync(200);
    expect(session.update).toHaveBeenCalledWith('partial');

    outbound.routeStreamFrame('sess-qq', start('a2'));
    outbound.routeStreamFrame('sess-qq', delta('a2', 'full'));
    await vi.advanceTimersByTimeAsync(200);

    expect(bot.openStream).toHaveBeenCalledTimes(1); // 流式会话复用
    expect(session.update).toHaveBeenNthCalledWith(2, 'full'); // 全量替换
  });

  it('agent replacement（attemptId 重叠）：start 帧无条件重置', async () => {
    const { outbound, bot, session } = setup();

    outbound.routeStreamFrame('sess-qq', start('sess-qq:1'));
    outbound.routeStreamFrame('sess-qq', delta('sess-qq:1', 'stale'));
    await vi.advanceTimersByTimeAsync(200);
    expect(session.update).toHaveBeenCalledWith('stale');

    // agent replacement 后 attempt 计数重启，attemptId 与旧 agent 相同
    outbound.routeStreamFrame('sess-qq', start('sess-qq:1'));
    outbound.routeStreamFrame('sess-qq', delta('sess-qq:1', 'fresh'));
    await vi.advanceTimersByTimeAsync(200);

    expect(bot.openStream).toHaveBeenCalledTimes(1);
    expect(session.update).toHaveBeenNthCalledWith(2, 'fresh'); // 全量替换，无残留
  });

  it('迟到帧（旧 attemptId）被丢弃', async () => {
    const { outbound, session } = setup();

    outbound.routeStreamFrame('sess-qq', start('a1'));
    outbound.routeStreamFrame('sess-qq', delta('a1', 'x'));
    outbound.routeStreamFrame('sess-qq', start('a2'));
    outbound.routeStreamFrame('sess-qq', delta('a1', 'late')); // a1 的迟到帧
    await vi.advanceTimersByTimeAsync(200);

    expect(session.update).not.toHaveBeenCalledWith(expect.stringContaining('late'));
  });

  it('非 QQ 会话（无 record）忽略流式帧', async () => {
    const { outbound, bot } = setup({ record: undefined });

    outbound.routeStreamFrame('sess-web', start('a1'));
    outbound.routeStreamFrame('sess-web', delta('a1', 'hello'));
    await vi.advanceTimersByTimeAsync(200);

    expect(bot.openStream).not.toHaveBeenCalled();
    expect(bot.sendMarkdown).not.toHaveBeenCalled();
  });

  it('群聊不流式：帧累积后由 assistant/message 静态发送', async () => {
    const { outbound, bot } = setup({ record: createRecord(groupTarget) });

    outbound.routeStreamFrame('sess-qq', start('a1'));
    outbound.routeStreamFrame('sess-qq', delta('a1', 'group reply'));
    await vi.advanceTimersByTimeAsync(200);

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'group reply' }] } },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(bot.openStream).not.toHaveBeenCalled();
    expect(bot.sendMarkdown).toHaveBeenCalledWith(groupTarget, 'group reply');
  });

  it('assistant/message 到达时收尾流式：complete 且不重复静态发送', async () => {
    const { outbound, bot, session } = setup();

    outbound.routeStreamFrame('sess-qq', start('a1'));
    outbound.routeStreamFrame('sess-qq', delta('a1', 'hello'));
    await vi.advanceTimersByTimeAsync(200);

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'hello' }] } },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(session.complete).toHaveBeenCalledTimes(1);
    expect(bot.sendMarkdown).not.toHaveBeenCalled();
  });

  it('旧通道回归：durable assistant/chunk 事件仍进 buffer', async () => {
    const { outbound, bot, session } = setup();

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'assistant/chunk',
      data: { chunk: { type: 'text-delta', text: 'legacy' } },
    });
    await vi.advanceTimersByTimeAsync(200);

    expect(bot.openStream).toHaveBeenCalledTimes(1);
    expect(session.update).toHaveBeenCalledWith('legacy');
  });
});

describe('OutboundRouter: 回复拆分', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('line 模式：多行回复拆成多条消息，且不启用流式', async () => {
    const { outbound, bot } = setup({ config: createConfig({ replySplitMode: 'line' }) });

    outbound.routeStreamFrame('sess-qq', start('a1'));
    outbound.routeStreamFrame('sess-qq', delta('a1', '第一行\n第二行'));
    await vi.advanceTimersByTimeAsync(200);

    expect(bot.openStream).not.toHaveBeenCalled();

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '第一行\n第二行' }] } },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(bot.openStream).not.toHaveBeenCalled();
    expect(bot.sendMarkdown).toHaveBeenNthCalledWith(1, c2cTarget, '第一行');
    expect(bot.sendMarkdown).toHaveBeenNthCalledWith(2, c2cTarget, '第二行');
  });

  it('paragraph 模式：按空行分段发送', async () => {
    const { outbound, bot } = setup({ config: createConfig({ replySplitMode: 'paragraph' }) });

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '段落一\n子行\n\n段落二' }] } },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(bot.sendMarkdown).toHaveBeenCalledTimes(2);
    expect(bot.sendMarkdown).toHaveBeenNthCalledWith(1, c2cTarget, '段落一\n子行');
    expect(bot.sendMarkdown).toHaveBeenNthCalledWith(2, c2cTarget, '段落二');
  });

  it('delimiter 模式：出现 ||| 时，段内剩余换行也按分条处理', async () => {
    const { outbound, bot } = setup({ config: createConfig({ replySplitMode: 'delimiter' }) });

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '第一句\n第二句|||第三句' }] } },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(bot.openStream).not.toHaveBeenCalled();
    expect(bot.sendMarkdown).toHaveBeenCalledTimes(3);
    expect(bot.sendMarkdown).toHaveBeenNthCalledWith(1, c2cTarget, '第一句');
    expect(bot.sendMarkdown).toHaveBeenNthCalledWith(2, c2cTarget, '第二句');
    expect(bot.sendMarkdown).toHaveBeenNthCalledWith(3, c2cTarget, '第三句');
  });

  it('delimiter 模式：分隔符固定为 |||（其他字符串不拆）', async () => {
    const { outbound, bot } = setup({
      config: createConfig({ replySplitMode: 'delimiter' }),
    });

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'a%%b|||c' }] } },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(bot.sendMarkdown).toHaveBeenCalledTimes(2);
    expect(bot.sendMarkdown).toHaveBeenNthCalledWith(1, c2cTarget, 'a%%b');
    expect(bot.sendMarkdown).toHaveBeenNthCalledWith(2, c2cTarget, 'c');
  });

  it('拆分间隔：相邻消息之间等待配置的时长', async () => {
    const { outbound, bot } = setup({
      config: createConfig({ replySplitMode: 'line', replySplitIntervalMs: 1000 }),
    });

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'a\nb' }] } },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(bot.sendMarkdown).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(bot.sendMarkdown).toHaveBeenCalledTimes(2);
  });
});

describe('OutboundRouter: 工具步骤正文不单独发送', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const turnEnd = { type: 'turn/end', data: { reason: { kind: 'stop' } } };

  it('工具步骤有正文、后面还有纯文本回复：只发最终回复', async () => {
    const { outbound, bot } = setup({ record: createRecord(groupTarget) });

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'assistant/message',
      data: { message: { content: [
        { type: 'text', text: '过程里的一句话' },
        { type: 'tool-call', name: 'qqbot_send_sticker' },
      ] } },
    });
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: '最终回复' }] } },
    });
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, turnEnd);
    await vi.advanceTimersByTimeAsync(0);

    expect(bot.sendMarkdown).toHaveBeenCalledTimes(1);
    expect(bot.sendMarkdown).toHaveBeenCalledWith(groupTarget, '最终回复');
  });

  it('整轮只有工具步骤正文：轮末补发一次，避免丢回复', async () => {
    const { outbound, bot } = setup({ record: createRecord(groupTarget) });

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'assistant/message',
      data: { message: { content: [
        { type: 'text', text: '只有过程正文' },
        { type: 'tool-call', name: 'qqbot_send_sticker' },
      ] } },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(bot.sendMarkdown).not.toHaveBeenCalled();

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, turnEnd);
    await vi.advanceTimersByTimeAsync(0);
    expect(bot.sendMarkdown).toHaveBeenCalledTimes(1);
    expect(bot.sendMarkdown).toHaveBeenCalledWith(groupTarget, '只有过程正文');
  });
});

describe('OutboundRouter: deliverables/presented', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const presentedEvent = (callId: string, files: Array<{ path: string; description?: string }>) => ({
    type: 'deliverables/presented',
    data: { turn: 1, callId, files },
  });
  const turnEnd = { type: 'turn/end', data: { reason: { kind: 'stop' } } };
  const record = createRecord(c2cTarget);

  it('轮末投递声明的文件，且在文本之后', async () => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const { outbound, bot } = setup({ deliverer: { deliver } });

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, presentedEvent('c1', [{ path: '/tmp/report.xlsx' }]));
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'final reply' }] } },
    });
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, turnEnd);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(record, [{ path: '/tmp/report.xlsx' }]);
    // 文本先于文件：markdown 发送的调用序在 deliver 之前
    const textOrder = (bot.sendMarkdown as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0];
    expect(textOrder).toBeLessThan(deliver.mock.invocationCallOrder[0]);
  });

  it('同 callId 去重：事件重放不重复投递', async () => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const { outbound } = setup({ deliverer: { deliver } });

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, presentedEvent('c1', [{ path: '/tmp/a.png' }]));
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, presentedEvent('c1', [{ path: '/tmp/a.png' }]));
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, presentedEvent('c2', [{ path: '/tmp/b.png' }]));
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, turnEnd);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(deliver).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledWith(record, [{ path: '/tmp/a.png' }, { path: '/tmp/b.png' }]);
  });

  it('assistant/message 在途文本未送达前不投递文件（等待 pending 发送完成）', async () => {
    let resolveText: (() => void) | undefined;
    const textTask = new Promise<void>((resolve) => { resolveText = resolve; });
    const bot: QQBotSender = {
      sendMarkdown: vi.fn(() => textTask),
      openStream: vi.fn(() => createSession()),
    };
    const record = createRecord(c2cTarget);
    const manager = {
      findBySessionId: vi.fn(() => record),
    } as unknown as SessionManager;
    const deliver = vi.fn().mockResolvedValue(undefined);
    const outbound = createOutboundHandler(manager, bot, createConfig(), createLogger(), undefined, { deliver });

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, presentedEvent('c1', [{ path: '/tmp/a.png' }]));
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'assistant/message',
      data: { message: { content: [{ type: 'text', text: 'reply' }] } },
    });
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, turnEnd);
    await Promise.resolve();
    await Promise.resolve();
    expect(deliver).not.toHaveBeenCalled(); // 文本仍在途

    resolveText?.();
    for (let i = 0; i < 10; i++) await Promise.resolve(); // 冲刷 catch 派生 + Promise.all 的微任务链
    expect(deliver).toHaveBeenCalledTimes(1); // 文本送达后才投递
  });

  it('配置关闭时不投递', async () => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const { outbound } = setup({
      config: createConfig({ sendFile: { restrictPaths: true, extraRoots: [], sendPresentedFiles: false, maxFiles: 4 } as ImQQBotConfig['sendFile'] }),
      deliverer: { deliver },
    });

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, presentedEvent('c1', [{ path: '/tmp/a.png' }]));
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, turnEnd);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(deliver).not.toHaveBeenCalled();
  });

  it('异常结束的轮次仍投递已声明的文件（宿主契约：失败不撤销声明）', async () => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const { outbound, bot } = setup({ deliverer: { deliver } });

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, presentedEvent('c1', [{ path: '/tmp/a.png' }]));
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, {
      type: 'turn/end',
      data: { reason: { kind: 'error', error: { code: 'E_BROKEN', message: 'boom' } } },
    });
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(bot.sendMarkdown).toHaveBeenCalledWith(c2cTarget, expect.stringContaining('E_BROKEN'));
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it('未提供投递器时静默跳过（老环境降级）', async () => {
    const { outbound, bot } = setup();

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, presentedEvent('c1', [{ path: '/tmp/a.png' }]));
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, turnEnd);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(bot.sendMarkdown).not.toHaveBeenCalled();
  });
});

describe('OutboundRouter: 语音回复（模型决定）', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const turnEnd = { type: 'turn/end', data: { reason: { kind: 'stop' } } };
  const message = (text: string) => ({
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text }] } },
  });

  it('语音轮：正文不发文字，轮末合成语音', async () => {
    const speak = vi.fn().mockResolvedValue(true);
    const { outbound, bot, record } = setup({ voice: { speak } });
    record.voiceRequested = true;

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, message('晚安，早点睡'));
    await vi.advanceTimersByTimeAsync(0);
    expect(bot.sendMarkdown).not.toHaveBeenCalled(); // 正文只用于合成

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, turnEnd);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(speak).toHaveBeenCalledWith(record, '晚安，早点睡');
    expect(bot.sendMarkdown).not.toHaveBeenCalled(); // 不会再发一遍同样的文字
  });

  it('语音轮不流式：即使开启 streaming，也不会先把文字流出去', async () => {
    const speak = vi.fn().mockResolvedValue(true);
    const bot = createBot(createSession());
    const record = createRecord(c2cTarget);
    record.voiceRequested = true;
    const manager = { findBySessionId: vi.fn(() => record) } as unknown as SessionManager;
    const local = createOutboundHandler(
      manager, bot, createConfig(), createLogger(), undefined, undefined, { speak },
    );

    local.routeStreamFrame('sess-qq', start('a1'));
    local.routeStreamFrame('sess-qq', delta('a1', '语音内容'));
    await vi.advanceTimersByTimeAsync(200);

    expect(bot.openStream).not.toHaveBeenCalled();
  });

  it('语音合成失败：退回文字，用户不会什么都收不到', async () => {
    const speak = vi.fn().mockResolvedValue(false);
    const { outbound, bot, record } = setup({ voice: { speak } });
    record.voiceRequested = true;

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, message('这条语音合成失败了'));
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, turnEnd);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(speak).toHaveBeenCalledTimes(1);
    expect(bot.sendMarkdown).toHaveBeenCalledWith(c2cTarget, '这条语音合成失败了');
  });

  it('轮末复位标记：下一轮不再按语音处理', async () => {
    const speak = vi.fn().mockResolvedValue(true);
    const { outbound, bot, record } = setup({ voice: { speak } });
    record.voiceRequested = true;

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, message('第一轮语音'));
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, turnEnd);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    expect(record.voiceRequested).toBeUndefined();
    expect(record.voiceInstruction).toBeUndefined();

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, message('第二轮文字'));
    await vi.advanceTimersByTimeAsync(0);
    expect(bot.sendMarkdown).toHaveBeenCalledWith(c2cTarget, '第二轮文字');
  });

  it('未配置语音时：模型标记了语音也只会发文字（不吞消息）', async () => {
    const { outbound, bot, record } = setup();
    record.voiceRequested = true;

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, message('没有语音能力的兜底'));
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, turnEnd);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();

    expect(bot.sendMarkdown).toHaveBeenCalledWith(c2cTarget, '没有语音能力的兜底');
  });

  it('时序兜底：正文先发出、之后才调用 qqbot_voice → 不再补一条同内容语音', async () => {
    const speak = vi.fn().mockResolvedValue(true);
    const { outbound, bot, record, logger } = setup({ voice: { speak } });

    // 模型先写正文（此时还没决定语音），文字照常发出
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, message('笨蛋|||知道了 我爱你'));
    await vi.advanceTimersByTimeAsync(0);
    expect(bot.sendMarkdown).toHaveBeenCalledTimes(1);

    // 之后才调用 qqbot_voice：正文已经送达，轮末不能再用同内容合成语音
    record.voiceRequested = true;
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, message('笨蛋|||知道了 我爱你'));
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, turnEnd);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(speak).not.toHaveBeenCalled();
    expect(bot.sendMarkdown).toHaveBeenCalledTimes(1); // 也没有退回文字造成第二次重复
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('跳过语音以免重复'));
  });

  it('已发文字后语音轮另写新正文：新正文仍会送到用户（不吞内容）', async () => {
    const speak = vi.fn().mockResolvedValue(true);
    const { outbound, bot, record } = setup({ voice: { speak } });

    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, message('第一段文字'));
    await vi.advanceTimersByTimeAsync(0);

    record.voiceRequested = true;
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, message('第二段只能发文字'));
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, turnEnd);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(speak).not.toHaveBeenCalled();
    expect(bot.sendMarkdown).toHaveBeenCalledWith(c2cTarget, '第二段只能发文字');
  });

  it('边流式边调用 qqbot_voice：文字已可见时轮末不合成语音', async () => {
    const speak = vi.fn().mockResolvedValue(true);
    const { outbound, bot, record } = setup({ voice: { speak } });

    outbound.routeStreamFrame('sess-qq', start('a1'));
    outbound.routeStreamFrame('sess-qq', delta('a1', '流式已可见的文字'));
    await vi.advanceTimersByTimeAsync(200);
    expect(bot.openStream).toHaveBeenCalledTimes(1);

    record.voiceRequested = true;
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, message('流式已可见的文字'));
    outbound.routeSessionEvent({ header: { id: 'sess-qq' } }, turnEnd);
    await vi.advanceTimersByTimeAsync(0);
    await Promise.resolve();
    await Promise.resolve();

    expect(speak).not.toHaveBeenCalled();
  });
});

describe('stripStickerDescriptions — 纯括号状态语', () => {
  it('整条回复只是「（发过去了）」时丢弃', () => {
    expect(stripStickerDescriptions('（发过去了）', ['呆滞傻笑'])).toBe('');
    expect(stripStickerDescriptions('(发过去了)', undefined)).toBe('');
    expect(stripStickerDescriptions('（已发送）', [])).toBe('');
  });

  it('混在正文里时只剔除该分句', () => {
    expect(stripStickerDescriptions('哈哈哈好家伙|||（发过去了）', ['呆滞傻笑'])).toBe('哈哈哈好家伙');
  });

  it('正常的括号动作不误删', () => {
    expect(stripStickerDescriptions('（给你比心）', ['呆滞傻笑'])).toBe('（给你比心）');
  });
});
