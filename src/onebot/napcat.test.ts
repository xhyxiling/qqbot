/**
 * NapCat 托管测试
 *
 * 用临时目录 + 注入的 fetch / spawn 测探测与容错路径；
 * 不触发任何真实下载、解压或进程启动。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { NapcatManager, readNapcatEnv } from './napcat.ts';
import type { Logger } from '../types.ts';

function makeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

const ENV = {
  httpUrl: 'http://127.0.0.1:3000',
  wsUrl: 'ws://127.0.0.1:3001',
  accessToken: '',
  selfId: '',
};

/** 永远失败的 fetch：模拟 NapCat 未运行 */
const offlineFetch = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
/** 永远不应被调用的 spawn */
const spawnMock = vi.fn() as unknown as typeof spawn;

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-napcat-'));
  tempDirs.push(dir);
  return dir;
}

function makeManager(installDir: string, fetchImpl: typeof fetch = offlineFetch): NapcatManager {
  return new NapcatManager({
    logger: makeLogger(),
    env: ENV,
    installDir,
    fetchImpl,
    spawnImpl: spawnMock,
  });
}

/** 强制 platform=win32（测试可能跑在非 Windows CI 上） */
function asWindows(): void {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('readNapcatEnv', () => {
  it('空配置回落到 3000/3001 与空 token / selfId', () => {
    expect(readNapcatEnv({})).toEqual({
      httpUrl: 'http://127.0.0.1:3000',
      wsUrl: 'ws://127.0.0.1:3001',
      accessToken: '',
      selfId: '',
    });
  });

  it('读取 onebot.* 并裁剪空白', () => {
    expect(readNapcatEnv({
      onebot: { httpUrl: ' http://127.0.0.1:4000 ', wsUrl: 'ws://127.0.0.1:4001', accessToken: ' t ', selfId: ' 10001 ' },
    })).toEqual({
      httpUrl: 'http://127.0.0.1:4000',
      wsUrl: 'ws://127.0.0.1:4001',
      accessToken: 't',
      selfId: '10001',
    });
  });
});

describe('NapcatManager.state', () => {
  it('非 Windows 返回 unsupported（不探测网络）', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const manager = new NapcatManager({
      logger: makeLogger(), env: ENV, installDir: makeTempDir(), fetchImpl, spawnImpl: spawnMock,
    });

    const state = await manager.state();
    expect(state.phase).toBe('unsupported');
    expect(state.message).toContain('手动');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('安装目录里有 launcher.bat → installed', async () => {
    asWindows();
    const dir = makeTempDir();
    writeFileSync(join(dir, 'launcher.bat'), '@echo off\n');

    const state = await makeManager(dir).state();
    expect(state.phase).toBe('installed');
    expect(state.launcher).toBe(join(dir, 'launcher.bat'));
  });

  it('get_login_info 成功 → running + uin', async () => {
    asWindows();
    const dir = makeTempDir();
    writeFileSync(join(dir, 'launcher.bat'), '@echo off\n');
    const fetchImpl = vi.fn(async () => new Response(
      JSON.stringify({ status: 'ok', retcode: 0, data: { user_id: 10001, nickname: 'bot' } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch;

    const state = await makeManager(dir, fetchImpl).state();
    expect(state.phase).toBe('running');
    expect(state.loggedIn).toBe(true);
    expect(state.uin).toBe('10001');
    const [url] = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0]!;
    expect(url).toBe('http://127.0.0.1:3000/get_login_info');
  });

  it('探测失败但 pid 进程仍在 → login_required', async () => {
    asWindows();
    const dir = makeTempDir();
    writeFileSync(join(dir, 'launcher.bat'), '@echo off\n');
    // 用当前进程 pid 保证「进程存在」
    writeFileSync(join(dir, 'napcat.pid'), String(process.pid));

    const state = await makeManager(dir).state();
    expect(state.phase).toBe('login_required');
  });
});

describe('NapcatManager 动作容错', () => {
  it('未安装时 start 返回 error（不 spawn）', async () => {
    asWindows();
    const dir = makeTempDir();
    const manager = makeManager(dir);

    const state = await manager.start();
    expect(state.phase).toBe('error');
    expect(state.message).toContain('未检测到');
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it('没有 pid 文件时 stop 不抛错', async () => {
    asWindows();
    const dir = makeTempDir();

    const state = await makeManager(dir).stop();
    expect(state.phase).not.toBe('error');
  });

  it('已安装时 install 直接返回当前 state（不下载）', async () => {
    asWindows();
    const dir = makeTempDir();
    writeFileSync(join(dir, 'launcher.bat'), '@echo off\n');
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const manager = new NapcatManager({
      logger: makeLogger(), env: ENV, installDir: dir, fetchImpl, spawnImpl: spawnMock,
    });

    const state = await manager.install();
    expect(state.phase).toBe('installed');
    // 只做了运行态探测，没有请求 GitHub release / 下载
    const calls = (fetchImpl as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls;
    expect(calls.every(([url]) => !url.includes('github.com'))).toBe(true);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
