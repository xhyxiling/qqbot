import { describe, it, expect, vi } from 'vitest';
import type { Logger, ReplyTarget } from '../types.ts';
import type { ChannelKind } from '../types.ts';
import { MultiplexSender, type ChannelEndpoint } from './multiplex.ts';

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function endpoint(name: string) {
  const calls: string[] = [];
  const ep: ChannelEndpoint = {
    sender: {
      sendMarkdown: async () => { calls.push(`${name}:markdown`); },
      openStream: () => ({ update: async () => undefined, complete: async () => undefined }),
    },
    mediaSender: {
      sendImage: async () => { calls.push(`${name}:image`); return { upload: { file_uuid: '' } }; },
      sendVideo: async () => { calls.push(`${name}:video`); return { upload: { file_uuid: '' } }; },
      sendVoice: async () => { calls.push(`${name}:voice`); return { upload: { file_uuid: '' } }; },
      sendFile: async () => { calls.push(`${name}:file`); return { upload: { file_uuid: '' } }; },
    },
  };
  return { ep, calls };
}

function makeMux(endpoints: Partial<Record<ChannelKind, ChannelEndpoint>>, fallback: ChannelKind) {
  return new MultiplexSender(new Map(Object.entries(endpoints) as Array<[ChannelKind, ChannelEndpoint]>), fallback, makeLogger());
}

const target = (channel?: ChannelKind): ReplyTarget => ({
  scope: 'c2c',
  targetId: '1',
  ...(channel !== undefined ? { channel } : {}),
});

describe('MultiplexSender', () => {
  it('routes by target.channel', async () => {
    const a = endpoint('official');
    const b = endpoint('onebot');
    const mux = makeMux({ official: a.ep, onebot: b.ep }, 'official');

    await mux.sendMarkdown(target('onebot'), 'hi');
    await mux.sendImage(target('official'), { localPath: 'x.png' });
    await mux.sendFile(target('onebot'), { localPath: 'x.pdf' });

    expect(a.calls).toEqual(['official:image']);
    expect(b.calls).toEqual(['onebot:markdown', 'onebot:file']);
  });

  it('falls back to the default channel when the target has none', async () => {
    const a = endpoint('official');
    const b = endpoint('onebot');
    const mux = makeMux({ official: a.ep, onebot: b.ep }, 'onebot');

    await mux.sendVoice(target());
    expect(b.calls).toEqual(['onebot:voice']);
  });

  it('falls back when the requested channel is not enabled', async () => {
    const a = endpoint('official');
    const logger = makeLogger();
    const mux = new MultiplexSender(new Map([['official', a.ep]]), 'official', logger);

    await mux.sendMarkdown(target('onebot'), 'hi');

    expect(a.calls).toEqual(['official:markdown']);
    expect(logger.warn).toHaveBeenCalled();
  });
});
