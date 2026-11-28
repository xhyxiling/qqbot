import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryStore, MAX_NOTE_TEXT, type ChatMemory, type PersonMemory } from './memory-store.ts';
import {
  buildMemoryPromptSection,
  buildPersonMemoryPromptSection,
  extractMemoryFacts,
  MEMORY_SECTION_ORDER,
  relationshipStage,
  selectFactsForPrompt,
} from './memory-prompt.ts';
import { parseExtractedFacts } from './memory-extractor.ts';
import { IdentityStore, inferChannel } from './identity-store.ts';
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
  return {
    enabled: true,
    autoCapture: true,
    maxNotes: 20,
    llmExtract: false,
    extractThreshold: 8,
    aliases: [],
    ...overrides,
  };
}

function makeStore(): MemoryStore {
  return new MemoryStore({ path, writeDelayMs: 0 });
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

  it('落盘文件包含 version 3 与 chats', () => {
    const store = makeStore();
    store.recordInteraction(KEY, 'group', 'GROUP1');
    const data = JSON.parse(readFileSync(path, 'utf8')) as { version: number; chats: Record<string, unknown> };
    expect(data.version).toBe(3);
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

describe('MemoryStore person facts', () => {
  it('人物事实按 personId 累积并落盘', () => {
    const store = makeStore();
    store.recordPersonInteraction('P1', '西泠', 1_000);
    store.recordPersonInteraction('P1', '西泠', 2_000);
    const note = store.addPersonNote('P1', '我叫小明', 'manual', 20);
    expect(note?.text).toBe('我叫小明');

    const reloaded = makeStore();
    expect(reloaded.getPerson('P1')?.messageCount).toBe(2);
    expect(reloaded.getPerson('P1')?.notes[0]?.text).toBe('我叫小明');
  });

  it('完全重复的事实只保留一条', () => {
    const store = makeStore();
    store.addPersonNote('P1', '我叫小明', 'auto', 20);
    expect(store.addPersonNote('P1', '  我叫小明。 ', 'auto', 20)).toBeUndefined();
    expect(store.getPerson('P1')?.notes).toHaveLength(1);
  });

  it('同一槽位的旧事实会被新事实覆盖（搬家）', () => {
    const store = makeStore();
    store.addPersonNote('P1', '我住在杭州', 'auto', 20);
    store.addPersonNote('P1', '我住在上海', 'auto', 20);
    const texts = store.getPerson('P1')?.notes.map((n) => n.text) ?? [];
    expect(texts).toEqual(['我住在上海']);
  });

  it('不同喜好会同时保留', () => {
    const store = makeStore();
    store.addPersonNote('P1', '我喜欢吃火锅', 'auto', 20);
    store.addPersonNote('P1', '我喜欢猫', 'auto', 20);
    expect(store.getPerson('P1')?.notes).toHaveLength(2);
  });

  it('mergePeople 合并事实、计数与时间', () => {
    const store = makeStore();
    store.recordPersonInteraction('P1', '西泠', 1_000);
    store.addPersonNote('P1', '我叫小明', 'manual', 20);

    store.recordPersonInteraction('P2', '西泠', 2_000);
    store.addPersonNote('P2', '我喜欢猫', 'auto', 20);

    store.mergePeople('P2', 'P1', 20);
    expect(store.getPerson('P2')).toBeUndefined();
    const merged = store.getPerson('P1') as PersonMemory;
    expect(merged.messageCount).toBe(2);
    expect(merged.firstSeenAt).toBe(1_000);
    expect(merged.notes.map((n) => n.text)).toEqual(['我叫小明', '我喜欢猫']);
  });

  it('v2（senderId 主键）文件可直接加载为 v3 人物记忆', () => {
    writeFileSync(path, JSON.stringify({
      version: 2,
      chats: {},
      people: {
        1759893823: {
          senderId: '1759893823',
          senderName: '西泠',
          firstSeenAt: 1_000,
          lastSeenAt: 2_000,
          messageCount: 12,
          notes: [{ text: '我叫西泠', at: 1_000, source: 'manual' }],
        },
      },
    }), 'utf8');

    const store = makeStore();
    const person = store.getPerson('1759893823') as PersonMemory;
    expect(person.senderName).toBe('西泠');
    expect(person.messageCount).toBe(12);
    expect(person.notes[0]?.text).toBe('我叫西泠');
    expect(person.notes[0]?.kind).toBe('profile');
    expect(person.notes[0]?.confidence).toBe(1);
  });

  it('分通道存储：旧 memory.json 按 id 形状拆成官方/OneBot 两份', () => {
    const legacy = join(dir, 'memory.json');
    const at = 1_000;
    writeFileSync(legacy, JSON.stringify({
      version: 2,
      chats: {
        'k-official': {
          scope: 'group', peerId: '8E4BF9DF', firstSeenAt: at, lastSeenAt: at, messageCount: 2, notes: [],
        },
        'k-onebot': {
          scope: 'group', peerId: '123456789', firstSeenAt: at, lastSeenAt: at, messageCount: 3, notes: [],
        },
      },
      people: {
        '8E4BF9DF': {
          senderId: '8E4BF9DF', senderName: '西泠', firstSeenAt: at, lastSeenAt: at, messageCount: 2,
          notes: [{ text: '官方侧事实', at, source: 'manual' }],
        },
        1759893823: {
          senderId: '1759893823', senderName: '西泠', firstSeenAt: at, lastSeenAt: at, messageCount: 3,
          notes: [{ text: 'QQ 侧事实', at, source: 'manual' }],
        },
      },
    }), 'utf8');

    const officialPath = join(dir, 'memory.official.json');
    const onebotPath = join(dir, 'memory.onebot.json');
    const official = new MemoryStore({ path: officialPath, channel: 'official', legacyPath: legacy, writeDelayMs: 0 });
    const onebot = new MemoryStore({ path: onebotPath, channel: 'onebot', legacyPath: legacy, writeDelayMs: 0 });

    expect(official.getPerson('8E4BF9DF')?.notes[0]?.text).toBe('官方侧事实');
    expect(official.getPerson('1759893823')).toBeUndefined();
    expect(onebot.getPerson('1759893823')?.notes[0]?.text).toBe('QQ 侧事实');
    expect(onebot.getPerson('8E4BF9DF')).toBeUndefined();
    expect(official.get('k-official')).toBeDefined();
    expect(official.get('k-onebot')).toBeUndefined();
    expect(onebot.get('k-onebot')).toBeDefined();
    // 首次迁移会落盘到各自文件
    expect(existsSync(officialPath)).toBe(true);
    expect(existsSync(onebotPath)).toBe(true);
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

  it('补充句式：年龄 / 专业 / 恋爱状态', () => {
    expect(extractMemoryFacts('我今年 18 岁。')).toEqual(['我今年 18 岁']);
    expect(extractMemoryFacts('我的专业是计算机。')).toEqual(['我的专业是计算机']);
    expect(extractMemoryFacts('我单身。')).toEqual(['我单身']);
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

describe('buildPersonMemoryPromptSection', () => {
  const now = 1_700_000_000_000;

  function person(notes: PersonMemory['notes'], senderName?: string): PersonMemory {
    return {
      personId: 'P1',
      ...(senderName !== undefined ? { senderName } : {}),
      firstSeenAt: now - 10 * 86_400_000,
      lastSeenAt: now,
      messageCount: 42,
      notes,
    };
  }

  it('没有事实时不注入（不再输出「认识 X 天」空话）', () => {
    expect(buildPersonMemoryPromptSection(person([]), memoryConfig(), now)).toBeUndefined();
    expect(buildPersonMemoryPromptSection(undefined, memoryConfig(), now)).toBeUndefined();
    expect(buildPersonMemoryPromptSection(person([{ text: '我叫小明', at: now, source: 'auto' }]), memoryConfig({ enabled: false }), now))
      .toBeUndefined();
  });

  it('注入昵称、事实与防泄露说明，且不暴露 personId / 互动次数', () => {
    const section = buildPersonMemoryPromptSection(
      person([{ text: '我叫小明', at: now, source: 'manual', kind: 'profile', confidence: 1 }], '西泠'),
      memoryConfig(),
      now,
      { query: '你还记得我叫什么吗' },
    ) as PromptSection;
    expect(section.name).toBe('qqbot:person-memory');
    expect(section.text).toContain('西泠');
    expect(section.text).toContain('我叫小明');
    expect(section.text).toContain('不要说明你是从哪里知道的');
    expect(section.text).not.toContain('P1');
    expect(section.text).not.toContain('互动 42 次');
  });

  it('按当前消息挑选更相关的事实', () => {
    const notes: PersonMemory['notes'] = [
      { text: '我喜欢吃火锅', at: now, source: 'auto' },
      { text: '我养了一只猫', at: now, source: 'auto' },
      { text: '我在准备考研', at: now, source: 'auto' },
    ];
    const selected = selectFactsForPrompt(notes, '晚上吃火锅吗', now, 2);
    expect(selected[0]?.text).toBe('我喜欢吃火锅');
  });
});

describe('parseExtractedFacts', () => {
  it('解析模型返回的 JSON 数组（容忍代码块）', () => {
    const raw = '```json\n[{"text":"我叫小明","kind":"profile","confidence":0.9}]\n```';
    expect(parseExtractedFacts(raw)).toEqual([{ text: '我叫小明', kind: 'profile', confidence: 0.9 }]);
  });

  it('非法输入返回空数组', () => {
    expect(parseExtractedFacts('没有 JSON')).toEqual([]);
    expect(parseExtractedFacts('[{"text":""}]')).toEqual([]);
  });

  it('最多保留 5 条并去重', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ text: `事实${i}`, confidence: 0.5 }));
    items.push({ text: '事实0', confidence: 0.5 });
    expect(parseExtractedFacts(JSON.stringify(items))).toHaveLength(5);
  });
});

describe('IdentityStore', () => {
  function makeIdentities(): IdentityStore {
    return new IdentityStore({ path: join(dir, 'identities.json'), writeDelayMs: 0 });
  }

  it('同通道同一 id 稳定解析为同一个人，不同通道各自独立', () => {
    const store = makeIdentities();
    const a = store.resolve('onebot', '1759893823', '西泠', 'group');
    const b = store.resolve('onebot', '1759893823', '西泠', 'c2c');
    expect(a).toBe(b);
    expect(a).toBe('1759893823');

    const official = store.resolve('official', '8E4BF9DF', '西泠', 'c2c');
    expect(official).not.toBe(a);
  });

  it('绑定码能把同一通道内的私聊/群聊两个身份并成一个人', () => {
    const store = makeIdentities();
    const c2c = store.resolve('official', 'USER_OPENID', '西泠', 'c2c');
    const group = store.resolve('official', 'MEMBER_OPENID', '西泠', 'group');
    expect(group).not.toBe(c2c);

    const code = store.issueBindCode(c2c, 'official');
    expect(code).toBeDefined();
    const result = store.redeemBindCode(code as string, 'official', 'MEMBER_OPENID', '西泠', 'group');
    expect(result).toEqual({ ok: true, personId: c2c, mergedPersonId: group });
    expect(store.resolve('official', 'MEMBER_OPENID', '西泠', 'group')).toBe(c2c);
    expect(store.get(group)).toBeUndefined();
  });

  it('绑定码不能跨通道使用，且不会因此作废', () => {
    const store = makeIdentities();
    const official = store.resolve('official', 'USER_OPENID', '西泠', 'c2c');
    const qq = store.resolve('onebot', '1759893823', '西泠', 'c2c');
    const code = store.issueBindCode(official, 'official') as string;

    expect(store.redeemBindCode(code, 'onebot', '1759893823', '西泠', 'c2c'))
      .toEqual({ ok: false, reason: 'cross-channel' });
    expect(store.resolve('onebot', '1759893823')).toBe(qq);

    // 码仍可在正确的一侧兑换
    store.resolve('official', 'MEMBER_OPENID', '西泠', 'group');
    expect(store.redeemBindCode(code, 'official', 'MEMBER_OPENID', '西泠', 'group').ok).toBe(true);
  });

  it('无效 / 过期 / 重复兑换有明确结果', () => {
    const store = makeIdentities();
    const personId = store.resolve('onebot', '111', '小明');
    expect(store.redeemBindCode('000000', 'onebot', '222')).toEqual({ ok: false, reason: 'invalid' });

    const code = store.issueBindCode(personId, 'onebot') as string;
    expect(store.redeemBindCode(code, 'onebot', '111')).toEqual({ ok: false, reason: 'same' });
    expect(store.redeemBindCode(code, 'onebot', '222')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('人工别名组在同一通道内归并', () => {
    const store = makeIdentities();
    const linked = store.linkGroup('official', ['8E4BF9DF', 'C2C4F1AA']);
    expect(linked?.mergedPersonIds).toHaveLength(1);
    expect(store.resolve('official', '8E4BF9DF')).toBe(linked?.targetPersonId);
    expect(store.resolve('official', 'C2C4F1AA')).toBe(linked?.targetPersonId);
    // 跨通道同名 id 不会被这条组带进来
    expect(store.resolve('onebot', '1759893823')).not.toBe(linked?.targetPersonId);
  });

  it('adoptExisting 为旧记忆里的 senderId 补本通道别名', () => {
    const store = makeIdentities();
    store.adoptExisting(['1759893823'], 'onebot');
    store.adoptExisting(['8E4BF9DF'], 'official');
    expect(store.resolve('onebot', '1759893823')).toBe('1759893823');
    expect(store.resolve('official', '8E4BF9DF')).toBe('8E4BF9DF');
  });

  it('按 id 形状推断通道', () => {
    expect(inferChannel('1759893823')).toBe('onebot');
    expect(inferChannel('8E4BF9DF3A321BC03F55845EE32C623D')).toBe('official');
  });
});
