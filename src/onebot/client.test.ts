import { describe, it, expect, vi, afterEach } from 'vitest';
import { OneBotClient } from './client.ts';
import type { Logger } from '../types.ts';

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function makeClient(token = ''): OneBotClient {
  return new OneBotClient({
    httpUrl: 'http://127.0.0.1:3000/',
    wsUrl: 'ws://127.0.0.1:3001',
    accessToken: token,
    logger: makeLogger(),
    onEvent: () => undefined,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OneBotClient.call', () => {
  it('posts to the API action and returns data', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ status: 'ok', retcode: 0, data: { message_id: 9 } }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const client = makeClient();
    const data = await client.call<{ message_id: number }>('send_private_msg', { user_id: 1, message: [] });

    expect(data.message_id).toBe(9);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:3000/send_private_msg');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ user_id: 1, message: [] });
  });

  it('adds a bearer token when configured', async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ status: 'ok', retcode: 0, data: {} }),
      { status: 200 },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await makeClient('secret-token').call('get_login_info');

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer secret-token');
  });

  it('throws on failed responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ status: 'failed', retcode: 1400, message: 'bad request' }),
      { status: 200 },
    )));

    await expect(makeClient().call('send_group_msg')).rejects.toThrow('send_group_msg 调用失败: bad request');
  });

  it('throws when the response is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('oops', { status: 502 })));

    await expect(makeClient().call('get_login_info')).rejects.toThrow('返回非 JSON');
  });
});
