/**
 * 历史媒体回填单测
 */
import { describe, expect, it } from 'vitest';
import { appendHistoryMedia, getHistoryStore, historyGroupKey } from './history-store.ts';

describe('history media', () => {
  it('把媒体路径补进对应消息', async () => {
    const store = getHistoryStore();
    const key = historyGroupKey('app', 'g1');
    await store.append(key, {
      senderId: '1', content: '看这个 [图片]', timestamp: 1, messageId: 'm1',
    }, 10);

    appendHistoryMedia(key, 'm1', ['Image: /tmp/a.png']);

    const list = await store.list(key, 10);
    expect(list[0]?.content).toBe('看这个 [图片] Image: /tmp/a.png');
  });

  it('找不到消息时静默跳过', () => {
    expect(() => appendHistoryMedia(historyGroupKey('app', 'g2'), 'nope', ['Image: /tmp/b.png']))
      .not.toThrow();
  });
});
