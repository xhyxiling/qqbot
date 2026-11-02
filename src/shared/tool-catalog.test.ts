/**
 * 工具候选与默认放行清单单测
 *
 * 面板下拉与运行时默认策略都依赖这里：候选只保留插件内置工具，
 * 默认放行清单额外保留只读的联网/提问能力。
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TOOL_ALLOWLIST,
  TOOL_CATALOG,
  catalogToolNames,
  groupToolNames,
  isPluginToolName,
  mergeToolNames,
} from './tool-catalog.ts';

describe('TOOL_CATALOG', () => {
  it('只包含 QQ 插件内置的 8 个工具', () => {
    expect(catalogToolNames()).toEqual([
      'qqbot_solve',
      'qqbot_describe_image',
      'qqbot_send_file',
      'qqbot_translate',
      'qqbot_summarize',
      'qqbot_explain',
      'qqbot_rewrite',
      'qqbot_analyze_persona',
    ]);
  });

  it('不再列出文件读写 / 命令执行等宿主工具', () => {
    const names = catalogToolNames();
    for (const banned of ['read', 'write', 'edit', 'pwsh', 'bash', 'glob', 'grep', 'working_directory']) {
      expect(names).not.toContain(banned);
    }
  });

  it('名字不重复', () => {
    const names = catalogToolNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it('isPluginToolName 只认清单内的名字（自动去空白）', () => {
    expect(isPluginToolName(' qqbot_translate ')).toBe(true);
    expect(isPluginToolName('read')).toBe(false);
    expect(isPluginToolName('')).toBe(false);
  });
});

describe('DEFAULT_TOOL_ALLOWLIST', () => {
  it('包含全部插件内置工具', () => {
    const pluginNames = catalogToolNames();
    expect(DEFAULT_TOOL_ALLOWLIST.slice(0, pluginNames.length)).toEqual(pluginNames);
  });

  it('额外只放行只读的联网与提问能力', () => {
    expect(DEFAULT_TOOL_ALLOWLIST).toEqual([
      ...catalogToolNames(),
      'ask_user_question',
      'web_search',
      'web_fetch',
    ]);
  });

  it('不含文件修改与命令执行', () => {
    for (const banned of ['read', 'write', 'edit', 'pwsh', 'bash', 'read_image', 'glob', 'grep']) {
      expect(DEFAULT_TOOL_ALLOWLIST).not.toContain(banned);
    }
  });
});

describe('mergeToolNames', () => {
  it('按首次出现顺序合并并去重', () => {
    expect(mergeToolNames(['b', 'a'], ['a', 'c'])).toEqual(['b', 'a', 'c']);
  });

  it('修剪空白并丢弃空名字', () => {
    expect(mergeToolNames(['  read  ', ''], ['   '], undefined)).toEqual(['read']);
  });

  it('忽略 undefined 来源', () => {
    expect(mergeToolNames(undefined, undefined)).toEqual([]);
  });

  it('三个来源合并', () => {
    expect(mergeToolNames(['qqbot_solve'], catalogToolNames(), ['qqbot_solve', 'custom_tool']))
      .toEqual(['qqbot_solve', ...catalogToolNames().filter((name) => name !== 'qqbot_solve'), 'custom_tool']);
  });
});

describe('groupToolNames', () => {
  it('插件工具归入「插件内置」并保留清单顺序', () => {
    const groups = groupToolNames(['qqbot_solve', 'qqbot_translate']);
    expect(groups).toEqual([{
      group: '插件内置',
      tools: [
        { name: 'qqbot_solve', label: '做题（答案+过程）' },
        { name: 'qqbot_translate', label: '翻译' },
      ],
    }]);
  });

  it('清单外的名字归入「其他」且标注自定义', () => {
    const groups = groupToolNames(['zzz_unknown']);
    expect(groups).toEqual([{ group: '其他', tools: [{ name: 'zzz_unknown', label: '自定义工具' }] }]);
  });

  it('空组不出现，空名字被丢弃', () => {
    expect(groupToolNames(['  '])).toEqual([]);
    const groups = groupToolNames(['qqbot_explain']);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.group).toBe('插件内置');
  });
});

describe('TOOL_CATALOG 结构', () => {
  it('每条都有名字、中文说明与分组', () => {
    for (const entry of TOOL_CATALOG) {
      expect(entry.name.startsWith('qqbot_')).toBe(true);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.group).toBe('插件内置');
    }
  });
});
