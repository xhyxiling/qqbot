import { describe, it, expect, vi } from 'vitest';
import type { Logger } from '../types.ts';
import type { OneBotMessageEvent } from './types.ts';
import {
  buildInboundMessage,
  extractAttachments,
  parseCqString,
  renderText,
  toSegments,
} from './message.ts';

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function groupEvent(overrides: Partial<OneBotMessageEvent> = {}): OneBotMessageEvent {
  return {
    post_type: 'message',
    message_type: 'group',
    time: 1_700_000_000,
    self_id: 10000,
    message_id: 42,
    user_id: 20001,
    group_id: 30001,
    sender: { user_id: 20001, nickname: '小明', card: '小明同学' },
    message: [
      { type: 'at', data: { qq: '10000' } },
      { type: 'text', data: { text: ' 在吗' } },
    ],
    ...overrides,
  };
}

describe('parseCqString', () => {
  it('splits text and CQ codes', () => {
    const segments = parseCqString('你好[CQ:at,qq=10000] 看这个[CQ:image,file=a.png,url=https://x/a.png]');
    expect(segments).toEqual([
      { type: 'text', data: { text: '你好' } },
      { type: 'at', data: { qq: '10000' } },
      { type: 'text', data: { text: ' 看这个' } },
      { type: 'image', data: { file: 'a.png', url: 'https://x/a.png' } },
    ]);
  });

  it('decodes CQ escapes', () => {
    expect(parseCqString('a&#91;b&#93;')).toEqual([{ type: 'text', data: { text: 'a[b]' } }]);
  });
});

describe('renderText', () => {
  it('drops self mention and keeps others', () => {
    const mentions: Array<{ is_you?: boolean; id?: string }> = [];
    const text = renderText([
      { type: 'at', data: { qq: '10000' } },
      { type: 'text', data: { text: '你好 ' } },
      { type: 'at', data: { qq: '20002' } },
      { type: 'image', data: { file: 'a.png' } },
    ], '10000', mentions);

    expect(text).toBe('你好 @20002 [图片]');
    expect(mentions).toEqual([
      { is_you: true, id: '10000' },
      { is_you: false, id: '20002' },
    ]);
  });
});

describe('extractAttachments', () => {
  it('maps image / record / file segments', () => {
    const attachments = extractAttachments([
      { type: 'image', data: { file: 'a.image', url: 'https://x/a', file_size: 2048 } },
      { type: 'record', data: { file: 'v.amr', url: 'https://x/v', text: '语音转写' } },
      { type: 'file', data: { name: '报告.pdf', url: 'https://x/f', file_size: 100 } },
    ]);

    expect(attachments).toHaveLength(3);
    expect(attachments[0]).toMatchObject({
      content_type: 'image/png', filename: 'a.image', size: 2048, url: 'https://x/a',
    });
    expect(attachments[1]).toMatchObject({
      content_type: 'voice', asr_refer_text: '语音转写',
    });
    expect(attachments[2]).toMatchObject({
      content_type: 'file', filename: '报告.pdf', size: 100,
    });
  });
});

describe('buildInboundMessage', () => {
  it('builds a group message with mention and reply target', async () => {
    const result = await buildInboundMessage(groupEvent(), { selfId: '10000', logger: makeLogger() });
    expect(result).toBeDefined();
    const message = result!.message;

    expect(message.kind).toBe('group');
    expect(message.rawEventType).toBe('GROUP_AT_MESSAGE_CREATE');
    expect(message.senderId).toBe('20001');
    expect(message.senderName).toBe('小明同学');
    expect(message.groupOpenid).toBe('30001');
    expect(message.content).toBe('在吗');
    expect(message.messageId).toBe('42');
    expect(message.replyTarget).toEqual({ scope: 'group', targetId: '30001', msgId: '42', channel: 'onebot' });
    expect(message.timestamp).toBe(new Date(1_700_000_000_000).toISOString());
  });

  it('marks group message without mention as non-@ message', async () => {
    const result = await buildInboundMessage(groupEvent({
      message: [{ type: 'text', data: { text: '随便聊聊' } }],
    }), { selfId: '10000', logger: makeLogger() });

    expect(result!.message.rawEventType).toBe('GROUP_MESSAGE_CREATE');
    expect(result!.message.mentions).toEqual([]);
  });

  it('builds a private message and resolves quote via get_msg', async () => {
    const getMessage = vi.fn(async () => ({
      message_id: 7,
      sender: { user_id: 20009, nickname: '小红' },
      message: [
        { type: 'text', data: { text: '原来的话' } },
        { type: 'image', data: { file: 'q.png', url: 'https://x/q.png' } },
      ],
    }));

    const result = await buildInboundMessage({
      post_type: 'message',
      message_type: 'private',
      time: 1_700_000_100,
      message_id: 43,
      user_id: 20001,
      sender: { user_id: 20001, nickname: '小明' },
      message: [
        { type: 'reply', data: { id: '7' } },
        { type: 'text', data: { text: '回你' } },
      ],
    }, { selfId: '10000', logger: makeLogger(), getMessage });

    expect(result!.message.kind).toBe('c2c');
    expect(result!.message.rawEventType).toBe('C2C_MESSAGE_CREATE');
    expect(result!.message.replyTarget).toEqual({ scope: 'c2c', targetId: '20001', msgId: '43', channel: 'onebot' });
    expect(result!.quote?.text).toContain('原来的话');
    expect(result!.quote?.entry?.senderId).toBe('20009');
    expect(result!.quote?.attachments?.[0]).toMatchObject({
      contentType: 'image/png', url: 'https://x/q.png',
    });
  });

  it('extracts markdown-embedded images from a quoted bot message', async () => {
    const getMessage = vi.fn(async () => ({
      message_id: 8,
      sender: { user_id: 3889001246, nickname: '幽幽子' },
      message: [{
        type: 'markdown',
        data: {
          content: '欢迎新同学\n![图片 #113px #85px](https://qqbot.ugcimg.cn/a.png)\n'
            + '[图片 #132px #96px](https://qqbot.ugcimg.cn/b.png)',
        },
      }],
    }));

    const result = await buildInboundMessage({
      post_type: 'message',
      message_type: 'group',
      time: 1_700_000_200,
      message_id: 44,
      user_id: 20001,
      group_id: 30001,
      sender: { user_id: 20001, nickname: '小明' },
      message: [
        { type: 'reply', data: { id: '8' } },
        { type: 'at', data: { qq: '10000' } },
        { type: 'text', data: { text: '这图什么意思' } },
      ],
    }, { selfId: '10000', logger: makeLogger(), getMessage });

    const images = result!.quote?.attachments?.filter((a) => a.contentType === 'image/png') ?? [];
    expect(images.map((a) => a.url)).toEqual([
      'https://qqbot.ugcimg.cn/a.png',
      'https://qqbot.ugcimg.cn/b.png',
    ]);
  });

  it('returns undefined for unsupported message types', async () => {
    const result = await buildInboundMessage({
      post_type: 'message',
      message_type: 'guild' as 'group',
      message_id: 1,
      user_id: 2,
      message: [],
    }, { selfId: '10000', logger: makeLogger() });
    expect(result).toBeUndefined();
  });
});

describe('toSegments', () => {
  it('accepts array or CQ string', () => {
    expect(toSegments([{ type: 'text', data: { text: 'x' } }])).toHaveLength(1);
    expect(toSegments('[CQ:face,id=1]')).toEqual([{ type: 'face', data: { id: '1' } }]);
    expect(toSegments(undefined)).toEqual([]);
  });
});
