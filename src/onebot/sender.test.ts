import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Logger } from '../types.ts';
import { OneBotClient } from './client.ts';
import { OneBotBot, stripMarkdown } from './sender.ts';

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeBot(): { bot: OneBotBot; calls: Array<{ action: string; params: Record<string, unknown> }> } {
  const calls: Array<{ action: string; params: Record<string, unknown> }> = [];
  const client = new OneBotClient({
    httpUrl: 'http://127.0.0.1:3000',
    wsUrl: 'ws://127.0.0.1:3001',
    accessToken: '',
    logger: makeLogger(),
    onEvent: () => undefined,
  });
  const originalCall = client.call.bind(client);
  client.call = (async (action: string, params: Record<string, unknown> = {}) => {
    calls.push({ action, params });
    return await originalCall(action, params);
  }) as typeof client.call;

  return { bot: new OneBotBot({ client, logger: makeLogger(), appId: 'onebot-test' }), calls };
}

describe('stripMarkdown', () => {
  it('keeps the display text of qqbot-cmd-input tags', () => {
    const text = '<qqbot-cmd-input text="/persona a" show="/persona 傲娇"/>　_可用_';
    expect(stripMarkdown(text)).toBe('/persona 傲娇　可用');
  });

  it('removes headings, bold and code fences', () => {
    const text = '### 标题\n\n**加粗** 与 `代码`\n```ts\nconst a = 1;\n```';
    expect(stripMarkdown(text)).toBe('标题\n\n加粗 与 代码\nconst a = 1;');
  });

  it('turns markdown links into plain text', () => {
    expect(stripMarkdown('见[文档](https://example.com)')).toBe('见文档（https://example.com）');
  });
});

describe('OneBotBot 发送', () => {
  let tmp: string;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'onebot-test-'));
    fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 123 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(tmp, { recursive: true, force: true });
  });

  it('sends group text through send_group_msg and strips markdown', async () => {
    const { bot, calls } = makeBot();
    await bot.sendMarkdown({ scope: 'group', targetId: '30001' }, '**你好**');

    expect(calls).toHaveLength(1);
    expect(calls[0]!.action).toBe('send_group_msg');
    expect(calls[0]!.params).toEqual({
      group_id: 30001,
      message: [{ type: 'text', data: { text: '你好' } }],
    });
  });

  it('sends private text through send_private_msg', async () => {
    const { bot, calls } = makeBot();
    await bot.sendText({ scope: 'c2c', targetId: '20001' }, 'hi');

    expect(calls[0]!.action).toBe('send_private_msg');
    expect(calls[0]!.params).toMatchObject({ user_id: 20001 });
  });

  it('encodes images as base64 segments', async () => {
    const filePath = join(tmp, 'a.png');
    await writeFile(filePath, Buffer.from([1, 2, 3]));

    const { bot, calls } = makeBot();
    const result = await bot.sendImage({ scope: 'group', targetId: '30001' }, { localPath: filePath });

    expect(calls[0]!.action).toBe('send_group_msg');
    expect(calls[0]!.params).toMatchObject({
      message: [{ type: 'image', data: { file: 'base64://AQID' } }],
    });
    expect(result.upload.file_uuid).toBe('123');
  });

  it('uploads files via upload_group_file in groups', async () => {
    const filePath = join(tmp, '报告.pdf');
    await writeFile(filePath, Buffer.from('x'));

    const { bot, calls } = makeBot();
    await bot.sendFile({ scope: 'group', targetId: '30001' }, { localPath: filePath });

    expect(calls[0]!.action).toBe('upload_group_file');
    expect(calls[0]!.params).toMatchObject({ group_id: 30001, name: '报告.pdf' });
  });

  it('keeps a noop stream session (streaming is disabled on this backend)', async () => {
    const { bot } = makeBot();
    const stream = bot.openStream({ scope: 'c2c', targetId: '20001' });
    await expect(stream.update('x')).resolves.toBeUndefined();
    await expect(stream.complete()).resolves.toBeUndefined();
  });
});
