import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore, MAX_NOTE_TEXT, type ChatMemory } from './memory-store.ts';
import {
  buildMemoryPromptSection,
  extractMemoryFacts,
  MEMORY_SECTION_ORDER,
  relationshipStage,
} from './memory-prompt.ts';
import type { MemoryConfig } from '../config.ts';
import type { PromptSection } from '../personas/persona-utils.ts';

let dir: string;
let path: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'im-qqbot-memory-'));
  path = join(dir, 'memory.json');
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const KEY = 'qqbot:app:group:GROUP1';

function memoryConfig(overrides: Partial<MemoryConfig> = {}): MemoryConfig {
  return { enabled: true, autoCapture: true, maxNotes: 20, ...overrides };
}

function makeStore(): MemoryStore {
  return new MemoryStore({ path });
}

describe('MemoryStore', () => {
  it('首次互动创建记录，后续累加消息数与末次时间', () => {
    const store = makeStore();
    const first = store.recordInteraction(KEY, 'group', 'GROUP1', 1_000);
    expect(first.messageCount).toBe(1);
    expect(first.firstSeenAt).toBe(1_000);

    const second = store.recordInteraction(KEY, 'group', 'GROUP1', 2_000);
    expect(second.messageCount).toBe(2);
    expect(second.firstSeenAt).toBe(1_000);
    expect(second.lastSeenAt).toBe(2_000);
  });

  it('写入后重新加载仍能读到记录与要点', () => {
    const store = makeStore();
    store.recordInteraction(KEY, 'group', 'GROUP1');
    store.addNote(KEY, 'group', 'GROUP1', '我叫小明', 'manual', 20);
    expect(store.get(KEY)?.notes).toHaveLength(1);

    const reloaded = makeStore();
    expect(reloaded.get(KEY)?.messageCount).toBe(1);
    expect(reloaded.get(KEY)?.notes[0]?.text).toBe('我叫小明');
  });

  it('落盘文件包含 version 与 chats', () => {
    const store = makeStore();
    store.recordInteraction(KEY, 'group', 'GROUP1');
    const data = JSON.parse(readFileSync(path, 'utf8')) as { version: number; chats: Record<string, unknown> };
    expect(data.version).toBe(2);
    expect(Object.keys(data.chats)).toEqual([KEY]);
  });

  it('addNote 归一化空白与首尾标点，并忽略重复', () => {
    const store = makeStore();
    expect(store.addNote(KEY, 'group', 'GROUP1', '  我叫  小明。 ', 'manual', 20)?.text).toBe('我叫 小明');
    expect(store.addNote(KEY, 'group', 'GROUP1', '我叫 小明', 'manual', 20)).toBeUndefined();
    expect(store.addNote(KEY, 'group', 'GROUP1', '   ', 'manual', 20)).toBeUndefined();
  });

  it('超过 maxNotes 时淘汰最旧的要点', () => {
    const store = makeStore();
    for (const text of ['一', '二', '三']) {
      store.addNote(KEY, 'group', 'GROUP1', text, 'auto', 2);
    }
    expect(store.get(KEY)?.notes.map((n) => n.text)).toEqual(['二', '三']);
  });

  it('单条要点超长时截断', () => {
    const store = makeStore();
    const note = store.addNote(KEY, 'group', 'GROUP1', 'x'.repeat(300), 'manual', 20);
    expect(note?.text).toHaveLength(MAX_NOTE_TEXT);
  });

  it('removeNote / clearNotes / remove 的边界行为', () => {
    const store = makeStore();
    store.addNote(KEY, 'group', 'GROUP1', '甲', 'manual', 20);
    store.addNote(KEY, 'group', 'GROUP1', '乙', 'manual', 20);

    expect(store.removeNote(KEY, 5)).toBe(false);
    expect(store.removeNote(KEY, 0)).toBe(true);
    expect(store.get(KEY)?.notes.map((n) => n.text)).toEqual(['乙']);

    expect(store.clearNotes(KEY)).toBe(1);
    expect(store.get(KEY)?.notes).toEqual([]);
    // 关系统计保留
    expect(store.get(KEY)?.messageCount).toBe(0);

    expect(store.remove(KEY)).toBe(true);
    expect(store.get(KEY)).toBeUndefined();
  });

  it('addNote 时记录尚不存在则创建（messageCount=0）', () => {
    const store = makeStore();
    store.addNote(KEY, 'c2c', 'USER1', '喜欢猫', 'manual', 20);
    expect(store.get(KEY)?.messageCount).toBe(0);
  });
});

describe('relationshipStage', () => {
  it('按互动次数分档', () => {
    expect(relationshipStage(0)).toBe('初识');
    expect(relationshipStage(4)).toBe('初识');
    expect(relationshipStage(5)).toBe('眼熟');
    expect(relationshipStage(19)).toBe('眼熟');
    expect(relationshipStage(20)).toBe('熟悉');
    expect(relationshipStage(59)).toBe('熟悉');
    expect(relationshipStage(60)).toBe('亲近');
    expect(relationshipStage(199)).toBe('亲近');
    expect(relationshipStage(200)).toBe('很亲近');
  });
});

describe('extractMemoryFacts', () => {
  it('提取明确的自述', () => {
    expect(extractMemoryFacts('我叫小明。')).toEqual(['我叫小明']);
    expect(extractMemoryFacts('我喜欢吃火锅！')).toEqual(['我喜欢吃火锅']);
    expect(extractMemoryFacts('我住在杭州。')).toEqual(['我住在杭州']);
    expect(extractMemoryFacts('我的生日是 5 月 1 日。')).toEqual(['我的生日是 5 月 1 日']);
  });

  it('多句 / 多行都能提取，并去重', () => {
    expect(extractMemoryFacts('我叫小明\n我养了一只猫。')).toEqual(['我叫小明', '我养了一只猫']);
    expect(extractMemoryFacts('我叫小明。我叫小明。')).toEqual(['我叫小明']);
  });

  it('疑问句不当作事实', () => {
    expect(extractMemoryFacts('我叫什么来着？')).toEqual([]);
    expect(extractMemoryFacts('我喜欢什么牌子呢')).toEqual([]);
    expect(extractMemoryFacts('我叫小明吗')).toEqual([]);
  });

  it('转述别人的信息不记成本人事实', () => {
    expect(extractMemoryFacts('他说他喜欢猫。')).toEqual([]);
    expect(extractMemoryFacts('听说我同事住在杭州。')).toEqual([]);
  });

  it('没有自述句式时返回空数组', () => {
    expect(extractMemoryFacts('')).toEqual([]);
    expect(extractMemoryFacts('今天天气不错')).toEqual([]);
  });
});

describe('buildMemoryPromptSection', () => {
  const now = 1_700_000_000_000;

  function memory(overrides: Partial<ChatMemory> = {}): ChatMemory {
    return {
      scope: 'group',
      peerId: 'GROUP1',
      firstSeenAt: now - 3 * 86_400_000,
      lastSeenAt: now,
      messageCount: 1,
      notes: [],
      ...overrides,
    };
  }

  it('无记忆 / 关闭开关时返回 undefined', () => {
    expect(buildMemoryPromptSection(undefined, memoryConfig())).toBeUndefined();
    expect(buildMemoryPromptSection(memory(), memoryConfig({ enabled: false }))).toBeUndefined();
    expect(buildMemoryPromptSection(memory(), undefined)).toBeUndefined();
  });

  it('互动次数少且没有要点时不注入，避免噪声', () => {
    expect(buildMemoryPromptSection(memory({ messageCount: 4 }), memoryConfig(), now)).toBeUndefined();
    expect(buildMemoryPromptSection(memory({ messageCount: 0 }), memoryConfig(), now)).toBeUndefined();
    // 有要点则即使互动少也注入
    const withNotes = memory({ notes: [{ text: '我叫小明', at: now, source: 'manual' }] });
    expect(buildMemoryPromptSection(withNotes, memoryConfig(), now)).toBeDefined();
  });

  it('包含关系阶段、互动次数与要点清单', () => {
    const section = buildMemoryPromptSection(
      memory({ messageCount: 30, notes: [{ text: '我叫小明', at: now, source: 'manual' }] }),
      memoryConfig(),
      now,
    ) as PromptSection;
    expect(section.name).toBe('qqbot:memory');
    expect(section.order).toBe(MEMORY_SECTION_ORDER);
    expect(section.text).toContain('熟悉');
    expect(section.text).toContain('互动 30 次');
    expect(section.text).toContain('认识约 3 天');
    expect(section.text).toContain('我叫小明');
    expect(section.text).toContain('不要编造');
  });
});
