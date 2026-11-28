import { describe, expect, it } from 'vitest';
import type { ArchiveMemberSummary, PersonaArchive } from './persona-archive.ts';
import {
  buildPersonSummaryText,
  memberToSummaryTarget,
  selectSummaryTargets,
  summaryDisplayName,
} from './persona-summary.ts';

function member(
  senderId: string,
  senderName: string | undefined,
  count: number,
  chats: Array<{ chatKey: string; count: number; firstAt: number; lastAt: number }>,
): ArchiveMemberSummary {
  return {
    senderId,
    ...(senderName !== undefined ? { senderName } : {}),
    count,
    chats,
  };
}

const MEMBERS: ArchiveMemberSummary[] = [
  member('10001', '小明', 12, [
    { chatKey: 'qqbot:ns:group:g1', count: 8, firstAt: 1_700_000_000_000, lastAt: 1_700_000_900_000 },
    { chatKey: 'qqbot:ns:c2c:10001', count: 4, firstAt: 1_700_001_000_000, lastAt: 1_700_001_500_000 },
  ]),
  member('10002', '小明明', 3, [
    { chatKey: 'qqbot:ns:group:g1', count: 3, firstAt: 1_700_002_000_000, lastAt: 1_700_002_100_000 },
  ]),
  member('20001', undefined, 5, [
    { chatKey: 'qqbot:ns:group:g2', count: 5, firstAt: 1_700_003_000_000, lastAt: 1_700_003_500_000 },
  ]),
];

describe('selectSummaryTargets', () => {
  it('优先精确匹配 QQ 号或昵称', () => {
    expect(selectSummaryTargets(MEMBERS, '10001').targets.map((t) => t.senderId)).toEqual(['10001']);
    expect(selectSummaryTargets(MEMBERS, '小明').targets.map((t) => t.senderId)).toEqual(['10001']);
  });

  it('精确未命中时按 QQ 号前缀匹配', () => {
    expect(selectSummaryTargets(MEMBERS, '200').targets.map((t) => t.senderId)).toEqual(['20001']);
  });

  it('昵称包含多人时返回 ambiguous，不擅自选择', () => {
    const selection = selectSummaryTargets(MEMBERS, '小明');
    // 精确昵称「小明」只有一人，不应歧义
    expect(selection.ambiguous).toEqual([]);
    const fuzzy = selectSummaryTargets(MEMBERS, '明');
    expect(fuzzy.targets).toEqual([]);
    expect(fuzzy.ambiguous.map((t) => t.senderId)).toEqual(['10001', '10002']);
  });

  it('找不到时返回空结果', () => {
    expect(selectSummaryTargets(MEMBERS, '不存在')).toEqual({ targets: [], ambiguous: [] });
  });
});

describe('buildPersonSummaryText', () => {
  const archive = {
    listBySender: (chatKey: string, senderId: string) => (senderId === '10001'
      ? [{ content: chatKey.endsWith('g1') ? '群里说过的话' : '私聊里说过的话', timestamp: 1_700_000_900_000 }]
      : []),
  } as unknown as PersonaArchive;

  it('输出统计、会话分布与最近发言，不做人格推断', () => {
    const target = memberToSummaryTarget(MEMBERS[0]!);
    const text = buildPersonSummaryText({ archive, target, currentChatKey: 'qqbot:ns:group:g1' });

    expect(text).toContain('小明 的发言档案');
    expect(text).toContain('共 12 条，分布在 2 个会话');
    expect(text).toContain('当前会话 8 条');
    expect(text).toContain('群 g1：8 条');
    expect(text).toContain('私聊 10001：4 条');
    expect(text).toContain('群里说过的话');
    expect(text).not.toContain('性格');
  });

  it('没有昵称时用短 id 展示', () => {
    expect(summaryDisplayName({ senderId: '20001' })).toBe('20001');
  });
});
