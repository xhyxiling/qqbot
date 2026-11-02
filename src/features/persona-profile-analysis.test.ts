/**
 * 结构化人格分析层单测
 *
 * 覆盖：prompt 结构（跨会话分段 / 统计 / 关注点）、JSON 解析容错、
 * 可信度校正与 Markdown 格式化。
 */
import { describe, it, expect } from 'vitest';
import {
  PROFILE_MIN_CHARS_PER_CHAT,
  PROFILE_TRANSCRIPT_MAX_CHARS,
  buildProfilePrompt,
  chatDisplayName,
  confidenceLabel,
  displayName,
  formatProfileMarkdown,
  parseProfileAnalysis,
  sampleMessages,
  shortId,
  type PersonaChatInput,
} from './persona-profile-analysis.ts';
import type { ArchivedMessage } from './persona-archive.ts';

function message(content: string, timestamp: number, senderName?: string): ArchivedMessage {
  return { senderId: 'u1', content, timestamp, ...(senderName !== undefined ? { senderName } : {}) };
}

describe('展示工具', () => {
  it('shortId 截前 8 位，displayName 优先昵称', () => {
    expect(shortId('abcdefghijk')).toBe('abcdefgh');
    expect(displayName({ senderId: 'abcdefghijk', senderName: ' 小明 ' })).toBe('小明');
    expect(displayName({ senderId: 'abcdefghijk', senderName: '   ' })).toBe('abcdefgh');
    expect(displayName({ senderId: 'abcdefghijk' })).toBe('abcdefgh');
  });

  it('chatDisplayName 区分群聊与私聊', () => {
    expect(chatDisplayName('group', 'group-openid-1234')).toBe('群聊 group-op');
    expect(chatDisplayName('c2c', 'user-openid')).toBe('私聊');
  });
});

describe('sampleMessages', () => {
  function bulk(n: number): ArchivedMessage[] {
    return Array.from({ length: n }, (_, i) => message('x'.repeat(100), 1000 + i));
  }

  it('预算充足时全部保留', () => {
    expect(sampleMessages(bulk(3), 10_000)).toHaveLength(3);
  });

  it('预算不足时等间隔抽样并保留最后一条', () => {
    const messages = bulk(10);
    const sampled = sampleMessages(messages, 400);
    expect(sampled.length).toBeGreaterThan(1);
    expect(sampled.length).toBeLessThan(messages.length);
    expect(sampled.at(-1)).toEqual(messages.at(-1));
  });

  it('空输入或零预算返回空数组', () => {
    expect(sampleMessages([], 100)).toEqual([]);
    expect(sampleMessages(bulk(2), 0)).toEqual([]);
  });
});

describe('buildProfilePrompt', () => {
  const base = Date.now();

  function chats(): PersonaChatInput[] {
    return [
      {
        chatKey: 'qqbot:app:group:g1',
        scope: 'group',
        peerId: 'g1',
        messages: [message('群一第一句', base, '小明'), message('群一第二句', base + 1000, '小明')],
      },
      {
        chatKey: 'qqbot:app:c2c:u1',
        scope: 'c2c',
        peerId: 'u1',
        messages: [message('私聊的一句', base + 2000, '小明')],
      },
    ];
  }

  it('包含对象、会话类型、统计与会话分布', () => {
    const prompt = buildProfilePrompt({ senderId: 'u1', senderName: '小明', chats: chats() });
    expect(prompt).toContain('【分析对象】小明（openid: u1）');
    expect(prompt).toContain('【会话类型】群聊与私聊');
    expect(prompt).toContain('【发言统计】共 3 条，覆盖 2 个会话');
    expect(prompt).toContain('【会话分布】群聊 g1（2 条）、私聊（1 条）');
    expect(prompt).toContain('【会话 1｜群聊 g1】2 条（本次送入 2 条）');
    expect(prompt).toContain('小明: 群一第一句');
  });

  it('只含群聊时按群聊口径', () => {
    const prompt = buildProfilePrompt({ senderId: 'u1', chats: chats().slice(0, 1) });
    expect(prompt).toContain('【会话类型】群聊');
    // 单会话时不写「会话 1」前缀
    expect(prompt).toContain('【聊天记录】2 条（本次送入 2 条）');
  });

  it('写入额外关注点', () => {
    const prompt = buildProfilePrompt({ senderId: 'u1', chats: chats(), focus: '看他怼人的时候' });
    expect(prompt).toContain('【额外关注点】看他怼人的时候');
  });

  it('空会话列表不抛错，统计为 0', () => {
    const prompt = buildProfilePrompt({ senderId: 'u1', chats: [] });
    expect(prompt).toContain('【发言统计】共 0 条，覆盖 0 个会话');
    expect(prompt).toContain('时间未知');
  });

  it('字符预算生效：超长记录被抽样', () => {
    const big: PersonaChatInput[] = [{
      chatKey: 'qqbot:app:group:g1',
      scope: 'group',
      peerId: 'g1',
      messages: Array.from({ length: 80 }, (_, i) => message('x'.repeat(300), base + i * 1000)),
    }];
    const prompt = buildProfilePrompt({ senderId: 'u1', chats: big });
    expect(prompt.length).toBeLessThan(PROFILE_TRANSCRIPT_MAX_CHARS + PROFILE_MIN_CHARS_PER_CHAT);
  });
});

describe('parseProfileAnalysis', () => {
  const raw = {
    summary: '话少但很稳',
    traits: ['慢热', '慢热', '理性'],
    style: '短句为主',
    catchphrases: ['行吧'],
    interests: ['技术'],
    role: '潜水科普',
    advice: '直接说重点',
    confidence: 'high',
  };

  it('解析标准 JSON 并去重', () => {
    const analysis = parseProfileAnalysis(JSON.stringify(raw), 40);
    expect(analysis).toMatchObject({
      summary: '话少但很稳',
      traits: ['慢热', '理性'],
      style: '短句为主',
      confidence: 'high',
    });
  });

  it('容忍 ```json 代码块包裹', () => {
    const analysis = parseProfileAnalysis('```json\n' + JSON.stringify(raw) + '\n```', 40);
    expect(analysis.summary).toBe('话少但很稳');
  });

  it('容忍前后解释文字', () => {
    const analysis = parseProfileAnalysis(`分析如下：${JSON.stringify(raw)} 以上。`, 40);
    expect(analysis.traits).toEqual(['慢热', '理性']);
  });

  it('样本不足时强制降级 confidence', () => {
    expect(parseProfileAnalysis(JSON.stringify(raw), 3).confidence).toBe('low');
    expect(parseProfileAnalysis(JSON.stringify(raw), 10).confidence).toBe('medium');
  });

  it('非法 JSON 抛错', () => {
    expect(() => parseProfileAnalysis('完全不是 JSON', 40)).toThrow(/有效 JSON/);
  });

  it('缺少核心字段抛错', () => {
    expect(() => parseProfileAnalysis(JSON.stringify({ traits: [] }), 40)).toThrow(/缺少/);
  });

  it('traits 超过 8 个时截断，字段类型错误时退化为空数组', () => {
    const analysis = parseProfileAnalysis(JSON.stringify({
      ...raw,
      traits: Array.from({ length: 12 }, (_, i) => `标签${i}`),
      catchphrases: 'not-array',
      interests: [1, '技术', '技术'],
    }), 40);
    expect(analysis.traits).toHaveLength(8);
    expect(analysis.catchphrases).toEqual([]);
    expect(analysis.interests).toEqual(['技术']);
  });
});

describe('formatProfileMarkdown', () => {
  it('输出全部小节与统计行', () => {
    const analysis = parseProfileAnalysis(JSON.stringify({
      summary: '话少但很稳',
      traits: ['慢热'],
      style: '短句为主',
      catchphrases: ['行吧'],
      interests: ['技术'],
      role: '潜水科普',
      advice: '直接说重点',
      confidence: 'medium',
    }), 40);
    const text = formatProfileMarkdown(analysis, {
      messageCount: 42,
      chatCount: 2,
      firstAt: Date.now() - 86_400_000,
      lastAt: Date.now(),
    });
    expect(text).toContain('## 一句话印象');
    expect(text).toContain('`慢热`');
    expect(text).toContain('## 口头禅与高频表达');
    expect(text).toContain('样本 42 条（2 个会话');
    expect(text).toContain('中');
  });

  it('空字段用占位文案', () => {
    const text = formatProfileMarkdown({
      summary: '', traits: [], style: '', catchphrases: [], interests: [],
      role: '', advice: '', confidence: 'low',
    }, { messageCount: 1, chatCount: 1 });
    expect(text).toContain('（样本不足，暂无稳定印象）');
    expect(text).toContain('样本不足，暂不打标签');
    expect(text).toContain('没有明显重复的口头禅');
    expect(text).toContain('时间未知');
  });
});

describe('confidenceLabel', () => {
  it('高中低三档', () => {
    expect(confidenceLabel('high')).toBe('高');
    expect(confidenceLabel('medium')).toBe('中');
    expect(confidenceLabel('low')).toBe('低');
  });
});
