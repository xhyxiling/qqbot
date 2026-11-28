import { describe, expect, it } from 'vitest';
import { describeCurrentPersona } from './persona-tool.ts';

describe('describeCurrentPersona', () => {
  it('未启用人格时明确声明旧设定失效', () => {
    const result = describeCurrentPersona(undefined);
    expect(result.enabled).toBe(false);
    expect(result.text).toContain('未启用');
    expect(result.text).toContain('已经失效');
  });

  it('返回当前人格的名字、id 与完整设定', () => {
    const result = describeCurrentPersona({
      id: 'daily',
      name: '日常',
      prompt: '你是日常闲聊风格，回答简短。',
    });
    expect(result).toMatchObject({ enabled: true, id: 'daily', name: '日常' });
    expect(result.text).toContain('【当前人格】日常（daily）');
    expect(result.text).toContain('你是日常闲聊风格，回答简短。');
    expect(result.text).toContain('以这份设定为准');
  });

  it('人格没写名字时用 id 兜底', () => {
    const result = describeCurrentPersona({ id: 'cat', name: '', prompt: '喵' });
    expect(result.name).toBe('cat');
    expect(result.text).toContain('【当前人格】cat（cat）');
  });
});
