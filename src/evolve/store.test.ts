import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FeedbackStore, PolicyStore, type PolicyProposal } from './store.ts';

const dirs: string[] = [];

function tempFile(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-qqbot-evolve-'));
  dirs.push(dir);
  return join(dir, name);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const proposal: PolicyProposal = {
  kind: 'proactive',
  reason: '测试',
  evidence: 2,
  proactive: { probability: 0.05 },
};

describe('PolicyStore', () => {
  it('apply 写入历史，重新加载后仍生效', () => {
    const path = tempFile('policies.json');
    const store = new PolicyStore({ path });
    expect(store.revision).toBe(0);

    store.apply([proposal], 'feedback');
    expect(store.revision).toBe(1);
    expect(store.snapshot().proactive.probability).toBe(0.05);

    const reloaded = new PolicyStore({ path });
    expect(reloaded.revision).toBe(1);
    expect(reloaded.snapshot().proactive.probability).toBe(0.05);
  });

  it('rollback 恢复上一版，没有历史时返回 false', () => {
    const store = new PolicyStore({ path: tempFile('policies.json') });
    expect(store.rollback()).toBe(false);

    store.apply([proposal], 'feedback');
    store.apply([{
      kind: 'style',
      reason: '测试',
      evidence: 2,
      styleNotes: ['回复更短'],
    }], 'feedback');
    expect(store.snapshot().styleNotes).toEqual(['回复更短']);

    expect(store.rollback()).toBe(true);
    expect(store.revision).toBe(1);
    expect(store.snapshot().proactive.probability).toBe(0.05);
    expect(store.snapshot().styleNotes).toEqual([]);
  });

  it('pending 可保存、读取和清除', () => {
    const store = new PolicyStore({ path: tempFile('policies.json') });
    store.setPending([proposal]);
    expect(store.pending()).toHaveLength(1);
    expect(store.clearPending()).toBe(true);
    expect(store.pending()).toHaveLength(0);
  });
});

describe('FeedbackStore', () => {
  it('按时间追加并持久化', () => {
    const path = tempFile('feedback.json');
    const store = new FeedbackStore({ path });
    store.add({ scope: 'group', peerId: 'g1', senderId: 'u1', verdict: 'bad', note: '  太吵  ' });
    expect(store.count()).toBe(1);

    const reloaded = new FeedbackStore({ path });
    expect(reloaded.all()[0]?.note).toBe('太吵');
    expect(reloaded.all()[0]?.verdict).toBe('bad');
  });
});
