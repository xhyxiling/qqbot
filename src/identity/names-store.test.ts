/**
 * NamesStore / buildNamesPromptSection 单测
 *
 * 重点：机器人自称与 QQ 账号昵称互相独立，改一个不影响另一个，
 * 并且只有设置过才注入名字 section。
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  buildNamesPromptSection,
  NAMES_SECTION_ORDER,
  NamesStore,
  sanitizeName,
} from './names-store.ts';

function tempFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'names-')), 'names.json');
}

describe('NamesStore', () => {
  it('两个名字独立保存与清除', () => {
    const file = tempFile();
    const store = new NamesStore(file);
    store.setBotName('小泠');
    store.setQqAccountName('西泠');
    expect(store.get()).toEqual({ botName: '小泠', qqAccountName: '西泠' });

    store.setBotName('');
    expect(store.get()).toEqual({ qqAccountName: '西泠' });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ qqAccountName: '西泠' });
  });

  it('重新加载后保留名字', () => {
    const file = tempFile();
    new NamesStore(file).setQqAccountName('西泠');
    expect(new NamesStore(file).get().qqAccountName).toBe('西泠');
  });
});

describe('buildNamesPromptSection', () => {
  it('都没设置时不注入', () => {
    expect(buildNamesPromptSection({})).toBeUndefined();
  });

  it('设置两个名字时说明互相独立', () => {
    const section = buildNamesPromptSection({ botName: '小泠', qqAccountName: '西泠' });
    expect(section?.order).toBe(NAMES_SECTION_ORDER);
    expect(section?.text).toContain('小泠');
    expect(section?.text).toContain('西泠');
    expect(section?.text).toContain('互相独立');
  });

  it('只设置机器人自称时不提 QQ 昵称', () => {
    const section = buildNamesPromptSection({ botName: '小泠' });
    expect(section?.text).toContain('你叫什么');
    expect(section?.text).not.toContain('QQ 账号的昵称');
  });
});

describe('sanitizeName', () => {
  it('去换行、压空白并限长', () => {
    expect(sanitizeName('  小\n 泠\t酱  ')).toBe('小 泠 酱');
    expect(sanitizeName('x'.repeat(40)).length).toBe(24);
  });
});
