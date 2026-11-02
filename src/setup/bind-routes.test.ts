/**
 * 端内绑定路由测试
 *
 * 用假的 webServer 捕获注册的 handler，验证：
 * 状态查询协议（含 bound 相位）、refresh / manual 动作、
 * 方法守卫、Origin 信任校验与 manual 请求体校验。
 */
import { EventEmitter } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  BIND_CONFIG_PATH,
  BIND_MANUAL_PATH,
  BIND_PERSONAS_PATH,
  BIND_REFRESH_PATH,
  BIND_STATE_PATH,
  BIND_UNBIND_PATH,
  BIND_UPDATE_PATH,
  registerBindRoutes,
  type BindRoutesOptions,
  type WebRoute,
} from './bind-routes.ts';
import type { BindingService } from './binding-service.ts';
import type { InstallationInfo } from '../update/update-service.ts';

/** 默认 unbind/persist 实现依赖 getProfileDir：用可控 mock 替换（其余导出保留） */
const profileDirState = vi.hoisted(() => ({ dir: undefined as string | undefined }));
vi.mock('../shared/index.ts', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getProfileDir: () => profileDirState.dir };
});

/** 假 req：EventEmitter + headers/method + 可读 body */
function fakeReq(method: string, headers: Record<string, string | undefined> = {}, body?: string): IncomingMessage {
  const req = new EventEmitter() as unknown as IncomingMessage;
  (req as { method?: string }).method = method;
  (req as { headers: Record<string, string | undefined> }).headers = headers;
  Object.assign(req, {
    resume: vi.fn(),
    // 模拟异步可读流：POST body 异步推送
    [Symbol.asyncIterator]() {
      const chunks = body === undefined ? [] : [Buffer.from(body, 'utf8')];
      let index = 0;
      return {
        next: () => Promise.resolve(index < chunks.length
          ? { done: false, value: chunks[index++] as Buffer }
          : { done: true as const, value: undefined }),
      };
    },
  });
  return req;
}

/** 假 res：捕获 writeHead/end */
function fakeRes(): ServerResponse & { statusCode: number; body: string; headers: Record<string, string> } {
  const res = {
    statusCode: 0,
    body: '',
    headers: {} as Record<string, string>,
    writeHead(status: number, headers: Record<string, string>) {
      res.statusCode = status;
      res.headers = headers;
    },
    end(payload?: string) {
      if (payload !== undefined) res.body += payload;
    },
  };
  return res as unknown as ServerResponse & { statusCode: number; body: string; headers: Record<string, string> };
}

function createHarness(options: BindRoutesOptions = {}): {
  routes: Map<string, WebRoute>;
  service: { wireState: () => unknown; refresh: () => void };
  manualSubmits: unknown[];
} {
  const routes = new Map<string, WebRoute>();
  const webServer = {
    register(route: WebRoute): () => void {
      routes.set(route.path, route);
      return () => { routes.delete(route.path); };
    },
  };
  const service = {
    wireState: vi.fn(() => ({ phase: 'starting' })),
    refresh: vi.fn(),
  } as unknown as BindingService;
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  const manualSubmits: unknown[] = [];
  const wrappedOptions: BindRoutesOptions = {
    ...options,
    onManualCredentials: (credentials) => {
      manualSubmits.push(credentials);
      return options.onManualCredentials?.(credentials) ?? { persisted: true };
    },
  };
  registerBindRoutes(webServer, service, logger, wrappedOptions);
  return {
    routes,
    service: service as unknown as { wireState: () => unknown; refresh: () => void },
    manualSubmits,
  };
}

async function invoke(route: WebRoute | undefined, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (route === undefined) throw new Error('route not registered');
  await route.handler(req, res);
}

function json(res: { body: string }): unknown {
  return JSON.parse(res.body);
}

describe('bind-routes', () => {
  it('注册状态、刷新与手动提交三条精确路由', () => {
    const { routes } = createHarness();
    expect(routes.has(BIND_STATE_PATH)).toBe(true);
    expect(routes.has(BIND_REFRESH_PATH)).toBe(true);
    expect(routes.has(BIND_MANUAL_PATH)).toBe(true);
    expect(routes.get(BIND_STATE_PATH)?.kind).toBe('exact');
  });

  it('GET state：返回 200 + 序列化相位 + no-store', async () => {
    const { routes, service } = createHarness();
    service.wireState = () => ({ phase: 'waiting', url: 'https://q.qq.com/t1', issuedAt: 1 });

    const res = fakeRes();
    await invoke(routes.get(BIND_STATE_PATH), fakeReq('GET', { host: '127.0.0.1:3080' }), res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(json(res)).toEqual({ phase: 'waiting', url: 'https://q.qq.com/t1', issuedAt: 1 });
  });

  it('GET state（bound）：优先返回脱敏 appId，不触碰扫码状态机', async () => {
    const { routes, service } = createHarness({ boundAppId: () => '102120114' });

    const res = fakeRes();
    await invoke(routes.get(BIND_STATE_PATH), fakeReq('GET', { host: '127.0.0.1:3080' }), res);

    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ phase: 'bound', appId: '102120114' });
    expect(service.wireState).not.toHaveBeenCalled();
  });

  it('HEAD state：允许', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(routes.get(BIND_STATE_PATH), fakeReq('HEAD', { host: 'x' }), res);
    expect(res.statusCode).toBe(200);
  });

  it('POST state：405', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(routes.get(BIND_STATE_PATH), fakeReq('POST', { host: 'x' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('POST refresh：调用 service.refresh 并返回 starting', async () => {
    const { routes, service } = createHarness();
    const req = fakeReq('POST', { host: '127.0.0.1:3080' });
    const res = fakeRes();
    await invoke(routes.get(BIND_REFRESH_PATH), req, res);

    expect(service.refresh).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ phase: 'starting' });
  });

  it('GET refresh：405', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(routes.get(BIND_REFRESH_PATH), fakeReq('GET', { host: 'x' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('POST manual：合法凭据 → 提交处理并返回成功', async () => {
    const { routes, manualSubmits } = createHarness();
    const res = fakeRes();
    await invoke(
      routes.get(BIND_MANUAL_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080', 'content-type': 'application/json' }, '{"appId":"102120114","appSecret":"s3cr3t"}'),
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ ok: true, message: '凭据已保存，插件将自动重载' });
    expect(manualSubmits).toEqual([{ appId: '102120114', appSecret: 's3cr3t' }]);
  });

  it('POST manual：缺失字段 → 400', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(
      routes.get(BIND_MANUAL_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' }, '{"appId":"102120114"}'),
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  it('POST manual：空 body → 400', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(routes.get(BIND_MANUAL_PATH), fakeReq('POST', { host: '127.0.0.1:3080' }, ''), res);
    expect(res.statusCode).toBe(400);
  });

  it('POST manual：persisted=false → 500 + 错误信息', async () => {
    const { routes } = createHarness({
      onManualCredentials: () => ({ persisted: false, error: '写入失败' }),
    });
    const res = fakeRes();
    await invoke(
      routes.get(BIND_MANUAL_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' }, '{"appId":"a","appSecret":"b"}'),
      res,
    );
    expect(res.statusCode).toBe(500);
    expect(json(res)).toEqual({ ok: false, error: '写入失败' });
  });

  it('GET manual：405', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(routes.get(BIND_MANUAL_PATH), fakeReq('GET', { host: 'x' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('POST unbind（bound 态）：调用解绑处理并返回成功', async () => {
    const { routes } = createHarness({
      boundAppId: () => '102120114',
      onUnbind: () => ({ persisted: true }),
    });
    const res = fakeRes();
    await invoke(routes.get(BIND_UNBIND_PATH), fakeReq('POST', { host: '127.0.0.1:3080' }), res);
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ ok: true, message: '已解绑，插件将重载并重新进入绑定流程' });
  });

  it('POST unbind（未绑定）：409，不触达解绑处理', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(routes.get(BIND_UNBIND_PATH), fakeReq('POST', { host: '127.0.0.1:3080' }), res);
    expect(res.statusCode).toBe(409);
    expect(json(res)).toEqual({ ok: false, error: '当前未绑定' });
  });

  it('GET unbind：405', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(routes.get(BIND_UNBIND_PATH), fakeReq('GET', { host: 'x' }), res);
    expect(res.statusCode).toBe(405);
  });

  it('POST unbind（默认实现）：删除 patch 凭据并清除进程 env（否则 HMR 后仍读到旧凭据，状态停留 bound）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'im-qqbot-unbind-'));
    const patchPath = join(dir, 'cordis.patch.yml');
    writeFileSync(patchPath, [
      '- id: im-qqbot',
      '  config:',
      '    appId: "102120114"',
      '    appSecret: "s3cr3t"',
      '    requireMention: true',
      '',
    ].join('\n'), 'utf8');
    profileDirState.dir = dir;
    // 扫码绑定成功时会写入进程 env：模拟该残留
    const savedAppId = process.env.QQBOT_APPID;
    const savedSecret = process.env.QQBOT_SECRET;
    process.env.QQBOT_APPID = '102120114';
    process.env.QQBOT_SECRET = 's3cr3t';

    try {
      const { routes } = createHarness({ boundAppId: () => '102120114' });
      const res = fakeRes();
      await invoke(routes.get(BIND_UNBIND_PATH), fakeReq('POST', { host: '127.0.0.1:3080' }), res);

      expect(res.statusCode).toBe(200);
      expect(json(res)).toMatchObject({ ok: true });
      // 进程 env 凭据被清除（HMR 重载后新 fiber 不再回退读到旧凭据）
      expect(process.env.QQBOT_APPID).toBeUndefined();
      expect(process.env.QQBOT_SECRET).toBeUndefined();
      // patch 中的凭据被删除、其余配置保留
      const content = readFileSync(patchPath, 'utf8');
      expect(content).not.toContain('appId');
      expect(content).not.toContain('appSecret');
      expect(content).toContain('requireMention: true');
    } finally {
      profileDirState.dir = undefined;
      if (savedAppId === undefined) delete process.env.QQBOT_APPID;
      else process.env.QQBOT_APPID = savedAppId;
      if (savedSecret === undefined) delete process.env.QQBOT_SECRET;
      else process.env.QQBOT_SECRET = savedSecret;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('POST unbind（幂等重入）：patch 已无凭据时仍写回文件（触发宿主 HMR，bound fiber 才会卸载）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'im-qqbot-unbind-idem-'));
    const patchPath = join(dir, 'cordis.patch.yml');
    // 凭据已被上一次解绑删除，但 fiber 未重载（无 HMR）的场景
    writeFileSync(patchPath, [
      '- id: im-qqbot',
      '  config:',
      '    requireMention: true',
      '',
    ].join('\n'), 'utf8');
    profileDirState.dir = dir;
    const before = readFileSync(patchPath, 'utf8');

    try {
      const { routes } = createHarness({ boundAppId: () => '102120114' });
      const res = fakeRes();
      await invoke(routes.get(BIND_UNBIND_PATH), fakeReq('POST', { host: '127.0.0.1:3080' }), res);

      expect(res.statusCode).toBe(200);
      // 文件被重写（mtime 更新触发宿主 HMR 重载），内容仍为合法 YAML
      expect(readFileSync(patchPath, 'utf8')).toEqual(before);
    } finally {
      profileDirState.dir = undefined;
      rmSync(dir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (profileDirState.dir !== undefined) {
      rmSync(profileDirState.dir, { recursive: true, force: true });
      profileDirState.dir = undefined;
    }
  });

  it('GET config：回显生效配置且剔除 appSecret', async () => {
    const { routes } = createHarness({
      currentConfig: () => ({ appId: '102120114', appSecret: 'SECRET', requireMention: true, cwd: '/tmp/w' }),
    });
    const res = fakeRes();
    await invoke(routes.get(BIND_CONFIG_PATH), fakeReq('GET', { host: '127.0.0.1:3080' }), res);
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ config: { appId: '102120114', requireMention: true, cwd: '/tmp/w' } });
  });

  it('GET config：提供 availableTools 时附带工具候选（面板下拉用）', async () => {
    const { routes } = createHarness({
      currentConfig: () => ({ requireMention: true }),
      availableTools: () => ['qqbot_solve', 'qqbot_send_file'],
    });
    const res = fakeRes();
    await invoke(routes.get(BIND_CONFIG_PATH), fakeReq('GET', { host: '127.0.0.1:3080' }), res);
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ config: { requireMention: true }, tools: ['qqbot_solve', 'qqbot_send_file'] });
  });

  it('GET config：availableTools 为空时不带 tools 字段（老客户端兼容）', async () => {
    const { routes } = createHarness({
      currentConfig: () => ({ requireMention: true }),
      availableTools: () => [],
    });
    const res = fakeRes();
    await invoke(routes.get(BIND_CONFIG_PATH), fakeReq('GET', { host: '127.0.0.1:3080' }), res);
    expect(json(res)).toEqual({ config: { requireMention: true } });
  });

  it('POST config：白名单内合法值通过并触发合并写入', async () => {
    const { routes } = createHarness({ onUpdateConfig: () => true });
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080', 'content-type': 'application/json' },
        '{"requireMention":false,"access":{"c2cMode":"allowlist","c2cAllow":["u1"],"groupMode":"open","groupAllow":[]}}'),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({ ok: true, message: '配置已保存，插件将自动重载（进行中的机器人会话将重置）' });
  });

  it('POST config：人格预设通过校验并规范化空白 id/名称', async () => {
    let saved: Record<string, unknown> | undefined;
    const { routes } = createHarness({
      onUpdateConfig: (config) => { saved = config; return true; },
    });
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' },
        '{"personas":[{"id":" cat ","name":"","prompt":"你是猫娘。"}],"defaultPersona":" cat "}'),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(saved).toEqual({
      personas: [{ id: 'cat', name: 'cat', prompt: '你是猫娘。' }],
      defaultPersona: 'cat',
    });
  });

  it('POST config：人格 id 非法字符被拒绝', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' }, '{"personas":[{"id":"a b","name":"x","prompt":""}]}'),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(json(res)).toMatchObject({ ok: false, error: expect.stringContaining('id') });
  });

  it('POST config：人格 id 重复被拒绝', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' },
        '{"personas":[{"id":"dup","name":"a","prompt":""},{"id":"dup","name":"b","prompt":""}]}'),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(json(res)).toMatchObject({ ok: false, error: expect.stringContaining('重复') });
  });

  it('POST config：人格工具白名单去空/去重后原样保存', async () => {
    let saved: Record<string, unknown> | undefined;
    const { routes } = createHarness({
      onUpdateConfig: (config) => { saved = config; return true; },
    });
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' },
        '{"personas":[{"id":"cat","name":"猫娘","prompt":"","tools":[" read ","","read","qqbot_send_file"]},'
        + '{"id":"plain","name":"纯聊","prompt":"","tools":[]}]}'),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(saved).toEqual({
      personas: [
        { id: 'cat', name: '猫娘', prompt: '', tools: ['read', 'qqbot_send_file'] },
        { id: 'plain', name: '纯聊', prompt: '', tools: [] },
      ],
    });
  });

  it('POST config：人格工具名非法字符被拒绝', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' },
        '{"personas":[{"id":"cat","name":"猫娘","prompt":"","tools":["bad name!"]}]}'),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(json(res)).toMatchObject({ ok: false, error: expect.stringContaining('非法工具名') });
  });

  it('POST config：人格工具白名单类型错误被拒绝', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' },
        '{"personas":[{"id":"cat","name":"猫娘","prompt":"","tools":"read"}]}'),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(json(res)).toMatchObject({ ok: false, error: expect.stringContaining('必须是数组') });
  });

  it('POST config：人格颜文字配置通过校验并规范化', async () => {
    let saved: Record<string, unknown> | undefined;
    const { routes } = createHarness({
      onUpdateConfig: (config) => { saved = config; return true; },
    });
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' },
        '{"personas":[{"id":"genki","name":"元气","prompt":"","expressions":{"kaomoji":'
        + '{"enabled":true,"style":" genki ","custom":[" (๑•̀ㅂ•́)و✧ ","","(๑•̀ㅂ•́)و✧"],"maxPerReply":2}}},'
        + '{"id":"plain","name":"纯聊","prompt":"","expressions":{}}]}'),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(saved).toEqual({
      personas: [
        {
          id: 'genki', name: '元气', prompt: '',
          expressions: {
            kaomoji: { enabled: true, style: 'genki', custom: ['(๑•̀ㅂ•́)و✧'], maxPerReply: 2 },
          },
        },
        { id: 'plain', name: '纯聊', prompt: '' },
      ],
    });
  });

  it('POST config：enabled 未显式 true 的颜文字对象被丢弃（GET 回显的默认物化对象）', async () => {
    let saved: Record<string, unknown> | undefined;
    const { routes } = createHarness({
      onUpdateConfig: (config) => { saved = config; return true; },
    });
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' },
        '{"personas":[{"id":"cat","name":"猫娘","prompt":"",'
        + '"expressions":{"kaomoji":{"enabled":false,"style":"cat"}}}]}'),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(saved).toEqual({ personas: [{ id: 'cat', name: '猫娘', prompt: '' }] });
  });

  it('POST config：未知颜文字风格被拒绝', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' },
        '{"personas":[{"id":"cat","name":"猫娘","prompt":"","expressions":{"kaomoji":{"style":"nope"}}}]}'),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(json(res)).toMatchObject({ ok: false, error: expect.stringContaining('未知风格') });
  });

  it('POST config：颜文字每条上限超出范围被拒绝', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' },
        '{"personas":[{"id":"cat","name":"猫娘","prompt":"","expressions":{"kaomoji":{"maxPerReply":9}}}]}'),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(json(res)).toMatchObject({ ok: false, error: expect.stringContaining('1–3') });
  });

  it('POST config：全局提示词与拆分模式通过校验并原样保存', async () => {
    let saved: Record<string, unknown> | undefined;
    const { routes } = createHarness({
      onUpdateConfig: (config) => { saved = config; return true; },
    });
    const res = fakeRes();
    const prompt = '多条消息请用 ||| 分隔\n其余内容保持一条';
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' },
        JSON.stringify({ replySplitMode: 'delimiter', globalPrompt: prompt })),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(saved).toEqual({ replySplitMode: 'delimiter', globalPrompt: prompt });
  });

  it('POST config：全局提示词类型错误被拒绝', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' }, '{"globalPrompt":123}'),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(json(res)).toMatchObject({ ok: false, error: expect.stringContaining('globalPrompt') });
  });

  it('POST config：凭据字段被拒绝并引导绑定功能', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' }, '{"appSecret":"xxx"}'),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(json(res)).toMatchObject({ ok: false, error: expect.stringContaining('凭据') });
  });

  it('POST config：cwd 只读字段被拒绝', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' }, '{"cwd":"/etc"}'),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(json(res)).toMatchObject({ ok: false, error: expect.stringContaining('只读') });
  });

  it('POST config：未知/超时类字段不在白名单被拒绝', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' }, '{"maxQueue":50}'),
      res,
    );
    expect(res.statusCode).toBe(400);
  });

  it('POST config：类型错误被 Schema 拒绝', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' }, '{"requireMention":"yes"}'),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(json(res)).toMatchObject({ ok: false, error: expect.stringContaining('布尔') });
  });

  it('GET config：语音 API Key 永不回显，只返回 hasApiKey', async () => {
    const { routes } = createHarness({
      currentConfig: () => ({
        requireMention: true,
        voice: {
          enabled: false,
          apiKey: 'sk-secret', model: 'cosyvoice-v2', voice: 'longxiaochun_v2',
          baseUrl: '', workspace: '', maxChars: 300, timeoutMs: 30000,
        },
      }),
    });
    const res = fakeRes();
    await invoke(routes.get(BIND_CONFIG_PATH), fakeReq('GET', { host: '127.0.0.1:3080' }), res);
    expect(res.statusCode).toBe(200);
    expect(json(res)).toEqual({
      config: {
        requireMention: true,
        voice: {
          enabled: false,
          apiKey: '', hasApiKey: true, model: 'cosyvoice-v2', voice: 'longxiaochun_v2',
          baseUrl: '', workspace: '', maxChars: 300, timeoutMs: 30000,
        },
      },
    });
  });

  it('GET config：内置音色按模型代际映射（含人格音色），未知音色原样保留', async () => {
    const { routes } = createHarness({
      currentConfig: () => ({
        voice: {
          enabled: true, apiKey: 'sk-secret',
          model: 'qwen-audio-3.0-tts-flash', voice: 'longanfengyue_v3.1',
        },
        personas: [
          { id: 'cat', name: '猫娘', prompt: '', expressions: { voice: { voice: 'longanlingxi_v3.1' } } },
          { id: 'clone', name: '复刻', prompt: '', expressions: { voice: { voice: 'vd-8521' } } },
        ],
      }),
    });
    const res = fakeRes();
    await invoke(routes.get(BIND_CONFIG_PATH), fakeReq('GET', { host: '127.0.0.1:3080' }), res);
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({
      config: {
        voice: {
          apiKey: '', hasApiKey: true,
          model: 'qwen-audio-3.0-tts-flash', voice: 'longanfengyue',
        },
        personas: [
          { expressions: { voice: { voice: 'longanlingxi' } } },
          { expressions: { voice: { voice: 'vd-8521' } } },
        ],
      },
    });
  });

  it('POST config：只改语音模型时，内置音色跟随新代际映射', async () => {
    let saved: Record<string, unknown> | undefined;
    const { routes } = createHarness({
      currentConfig: () => ({
        voice: { apiKey: 'sk-old', model: 'qwen-audio-3.0-tts-flash', voice: 'longanfengyue' },
      }),
      onUpdateConfig: (config) => { saved = config; return true; },
    });
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' },
        '{"voice":{"model":"qwen-audio-3.1-tts-flash"}}'),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(saved).toMatchObject({
      voice: { model: 'qwen-audio-3.1-tts-flash', voice: 'longanfengyue_v3.1' },
    });
  });

  it('POST config：语音 apiKey 留空 = 保持已保存的 Key（面板不回显 Key）', async () => {
    let saved: Record<string, unknown> | undefined;
    const { routes } = createHarness({
      currentConfig: () => ({
        voice: { apiKey: 'sk-old', model: 'cosyvoice-v2', voice: 'longxiaochun_v2' },
      }),
      onUpdateConfig: (config) => { saved = config; return true; },
    });
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' },
        '{"voice":{"apiKey":"","maxChars":500}}'),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(saved).toMatchObject({
      voice: {
        apiKey: 'sk-old',
        model: 'cosyvoice-v2',
        voice: 'longxiaochun_v2',
        maxChars: 500,
      },
    });
  });

  it('POST config：clearApiKey 显式清空 Key（Key 管理，不再等价于停用语音）', async () => {
    let saved: Record<string, unknown> | undefined;
    const { routes } = createHarness({
      currentConfig: () => ({ voice: { apiKey: 'sk-old' } }),
      onUpdateConfig: (config) => { saved = config; return true; },
    });
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' }, '{"voice":{"clearApiKey":true}}'),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect((saved?.voice as { apiKey?: string }).apiKey).toBe('');
  });

  it('POST config：开关可关闭语音且保留已保存的 Key', async () => {
    let saved: Record<string, unknown> | undefined;
    const { routes } = createHarness({
      currentConfig: () => ({ voice: { enabled: true, apiKey: 'sk-old' } }),
      onUpdateConfig: (config) => { saved = config; return true; },
    });
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' }, '{"voice":{"enabled":false}}'),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(saved).toMatchObject({ voice: { enabled: false, apiKey: 'sk-old' } });
  });

  it('POST config：voice.enabled 必须是布尔值', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' }, '{"voice":{"enabled":"off"}}'),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(json(res)).toMatchObject({ ok: false, error: expect.stringContaining('布尔') });
  });

  it('POST config：语音 baseUrl 必须是 ws/wss 地址', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' }, '{"voice":{"baseUrl":"https://example.com"}}'),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(json(res)).toMatchObject({ ok: false, error: expect.stringContaining('wss') });
  });

  it('POST config：语音情感指令折叠空白并截断；自定义音色去空、去重、保持顺序', async () => {
    let saved: Record<string, unknown> | undefined;
    const { routes } = createHarness({
      currentConfig: () => ({ voice: { apiKey: 'sk-old' } }),
      onUpdateConfig: (config) => { saved = config; return true; },
    });
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' }, JSON.stringify({
        voice: {
          instruction: '  请用清冷、克制的语气\n语速稍慢  ',
          presets: [
            { name: '御姐', voice: 'vd-ee1c' },
            { name: '待填', voice: '  ' },
            { name: '', voice: 'vd-8521' },
            { name: '重复', voice: 'vd-ee1c' },
          ],
        },
      })),
      res,
    );
    expect(res.statusCode).toBe(200);
    const voice = (saved?.voice ?? {}) as Record<string, unknown>;
    expect(voice.instruction).toBe('请用清冷、克制的语气；语速稍慢');
    expect(voice.presets).toEqual([
      { name: '御姐', voice: 'vd-ee1c' },
      { name: 'vd-8521', voice: 'vd-8521' },
    ]);
  });

  it('POST config：超长情感指令按上限截断、超长音色名称被裁剪', async () => {
    let saved: Record<string, unknown> | undefined;
    const { routes } = createHarness({
      onUpdateConfig: (config) => { saved = config; return true; },
    });
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' }, JSON.stringify({
        voice: {
          instruction: '柔'.repeat(450),
          presets: [{ name: '名'.repeat(40), voice: 'vd-x' }],
        },
      })),
      res,
    );
    expect(res.statusCode).toBe(200);
    const voice = (saved?.voice ?? {}) as Record<string, unknown>;
    expect((voice.instruction as string).length).toBe(400);
    expect(voice.presets).toEqual([{ name: '名'.repeat(32), voice: 'vd-x' }]);
  });

  it('POST config：自定义音色超过条数上限被拒绝', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' }, JSON.stringify({
        voice: {
          presets: Array.from({ length: 21 }, (_, i) => ({ name: `音色${i}`, voice: `vd-${i}` })),
        },
      })),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(json(res)).toMatchObject({ ok: false, error: expect.stringContaining('最多 20 条') });
  });

  it('GET config：自定义音色与情感指令原样回传（Key 仍遮罩）', async () => {
    const { routes } = createHarness({
      currentConfig: () => ({
        voice: {
          apiKey: 'sk-secret', instruction: '请用元气满满的语气',
          presets: [{ name: '元气少女', voice: 'vd-8521' }],
        },
      }),
    });
    const res = fakeRes();
    await invoke(routes.get(BIND_CONFIG_PATH), fakeReq('GET', { host: '127.0.0.1:3080' }), res);
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({
      config: {
        voice: {
          apiKey: '', hasApiKey: true,
          instruction: '请用元气满满的语气',
          presets: [{ name: '元气少女', voice: 'vd-8521' }],
        },
      },
    });
  });

  it('POST config：人格语音情感指令保留，空指令不写回', async () => {
    let saved: Record<string, unknown> | undefined;
    const { routes } = createHarness({
      onUpdateConfig: (config) => { saved = config; return true; },
    });
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' }, JSON.stringify({
        personas: [
          { id: 'cool', name: '清冷', prompt: '', expressions: { voice: { instruction: ' 用清冷克制的语气 ' } } },
          { id: 'plain', name: '纯聊', prompt: '', expressions: { voice: { instruction: '   ' } } },
        ],
      })),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(saved).toEqual({
      personas: [
        { id: 'cool', name: '清冷', prompt: '', expressions: { voice: { instruction: '用清冷克制的语气' } } },
        { id: 'plain', name: '纯聊', prompt: '' },
      ],
    });
  });

  it('POST config：人格语音音色通过校验并保留（与颜文字并存）', async () => {
    let saved: Record<string, unknown> | undefined;
    const { routes } = createHarness({
      onUpdateConfig: (config) => { saved = config; return true; },
    });
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' },
        '{"personas":[{"id":"cool","name":"清冷","prompt":"",'
        + '"expressions":{"kaomoji":{"enabled":true,"style":"cool"},'
        + '"voice":{"voice":" longanfengyue ","rate":1.2,"volume":60}}},'
        + '{"id":"plain","name":"纯聊","prompt":"","expressions":{"voice":{}}}]}'),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(saved).toEqual({
      personas: [
        {
          id: 'cool', name: '清冷', prompt: '',
          expressions: {
            kaomoji: { enabled: true, style: 'cool' },
            voice: { voice: 'longanfengyue', rate: 1.2, volume: 60 },
          },
        },
        { id: 'plain', name: '纯聊', prompt: '' },
      ],
    });
  });

  it('POST config：人格语音语速超出范围被拒绝', async () => {
    const { routes } = createHarness();
    const res = fakeRes();
    await invoke(
      routes.get(BIND_CONFIG_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080' },
        '{"personas":[{"id":"cool","name":"清冷","prompt":"","expressions":{"voice":{"rate":9}}}]}'),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(json(res)).toMatchObject({ ok: false, error: expect.stringContaining('0.5–2') });
  });

  it('跨站 Origin：403（state 与 manual 均拦截）', async () => {
    const { routes } = createHarness();
    const res1 = fakeRes();
    await invoke(
      routes.get(BIND_STATE_PATH),
      fakeReq('GET', { host: '127.0.0.1:3080', origin: 'https://evil.example.com' }),
      res1,
    );
    expect(res1.statusCode).toBe(403);

    const res2 = fakeRes();
    await invoke(
      routes.get(BIND_MANUAL_PATH),
      fakeReq('POST', { host: '127.0.0.1:3080', origin: 'https://evil.example.com' }, '{"appId":"a","appSecret":"b"}'),
      res2,
    );
    expect(res2.statusCode).toBe(403);
  });

  it('同源 Origin / 无 Origin（Desktop IPC 桥）：放行', async () => {
    const { routes } = createHarness();
    const resSame = fakeRes();
    await invoke(
      routes.get(BIND_STATE_PATH),
      fakeReq('GET', { host: '127.0.0.1:3080', origin: 'http://127.0.0.1:3080' }),
      resSame,
    );
    expect(resSame.statusCode).toBe(200);

    const resNone = fakeRes();
    await invoke(routes.get(BIND_STATE_PATH), fakeReq('GET', { host: '127.0.0.1:3080' }), resNone);
    expect(resNone.statusCode).toBe(200);
  });

  describe('插件更新路由', () => {
    const install: InstallationInfo = {
      packageName: '@tencent-connect/dsh-qqbot',
      kind: 'git',
      version: '0.11.0',
      installed: '889ef5232dfe48d8e2954d41be0866d749229c3e',
      spec: 'https://gitee.com/x/qq-bot.git',
      remote: 'https://gitee.com/x/qq-bot.git',
      canUpdate: true,
      command: 'dsh plugin --profile desktop update @tencent-connect/dsh-qqbot',
      profileDir: '/profile/desktop',
    };

    afterEach(() => {
      vi.useRealTimers();
    });

    it('GET 回显安装信息（不回传 profileDir）', async () => {
      const { routes } = createHarness({ update: { inspect: () => install } });
      const res = fakeRes();
      await invoke(routes.get(BIND_UPDATE_PATH), fakeReq('GET', { host: '127.0.0.1:3080' }), res);
      expect(res.statusCode).toBe(200);
      const body = json(res) as { ok: boolean; install: Record<string, unknown> };
      expect(body.ok).toBe(true);
      expect(body.install).toMatchObject({ kind: 'git', canUpdate: true });
      expect(body.install).not.toHaveProperty('profileDir');
    });

    it('POST check 返回远端结果', async () => {
      const check = vi.fn(async () => ({
        updateAvailable: true,
        latest: 'abcdef0123456789abcdef0123456789abcdef01',
        checkedAt: 123,
        message: '发现新版本',
      }));
      const { routes } = createHarness({ update: { inspect: () => install, check } });
      const res = fakeRes();
      await invoke(
        routes.get(BIND_UPDATE_PATH),
        fakeReq('POST', { host: '127.0.0.1:3080' }, '{"action":"check"}'),
        res,
      );
      expect(res.statusCode).toBe(200);
      expect(check).toHaveBeenCalledWith(install);
      expect(json(res)).toMatchObject({
        ok: true,
        check: { updateAvailable: true, latest: 'abcdef0123456789abcdef0123456789abcdef01' },
      });
    });

    it('检查失败：200 + 错误信息（保留安装信息）', async () => {
      const { routes } = createHarness({
        update: {
          inspect: () => install,
          check: async () => { throw new Error('git ls-remote 超时'); },
        },
      });
      const res = fakeRes();
      await invoke(
        routes.get(BIND_UPDATE_PATH),
        fakeReq('POST', { host: '127.0.0.1:3080' }, '{"action":"check"}'),
        res,
      );
      expect(res.statusCode).toBe(200);
      expect(json(res)).toMatchObject({ ok: false, error: expect.stringContaining('git ls-remote 超时') });
    });

    it('POST update 成功：返回新安装信息并在响应后触发重载', async () => {
      vi.useFakeTimers();
      const next = { ...install, installed: 'abcdef0123456789abcdef0123456789abcdef01' };
      const perform = vi.fn(async () => ({ ok: true, exitCode: 0, message: '更新完成' }));
      const reload = vi.fn();
      const { routes } = createHarness({
        update: { inspect: () => next, perform, reload },
      });
      const res = fakeRes();
      await invoke(
        routes.get(BIND_UPDATE_PATH),
        fakeReq('POST', { host: '127.0.0.1:3080' }, '{"action":"update"}'),
        res,
      );
      expect(res.statusCode).toBe(200);
      expect(perform).toHaveBeenCalledTimes(1);
      expect(json(res)).toMatchObject({
        ok: true,
        install: { installed: 'abcdef0123456789abcdef0123456789abcdef01' },
      });
      expect(reload).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(400);
      expect(reload).toHaveBeenCalledTimes(1);
    });

    it('更新失败：500 + 命令输出摘要', async () => {
      const { routes } = createHarness({
        update: {
          inspect: () => install,
          perform: async () => ({ ok: false, exitCode: 1, message: '更新命令失败：fatal: unable to access' }),
        },
      });
      const res = fakeRes();
      await invoke(
        routes.get(BIND_UPDATE_PATH),
        fakeReq('POST', { host: '127.0.0.1:3080' }, '{"action":"update"}'),
        res,
      );
      expect(res.statusCode).toBe(500);
      expect(json(res)).toMatchObject({ ok: false, error: expect.stringContaining('unable to access') });
    });

    it('action 非法 / 方法不支持 / 跨站 Origin 均拒绝', async () => {
      const { routes } = createHarness({ update: { inspect: () => install } });
      const bad = fakeRes();
      await invoke(
        routes.get(BIND_UPDATE_PATH),
        fakeReq('POST', { host: '127.0.0.1:3080' }, '{"action":"install"}'),
        bad,
      );
      expect(bad.statusCode).toBe(400);

      const wrongMethod = fakeRes();
      await invoke(routes.get(BIND_UPDATE_PATH), fakeReq('DELETE', { host: '127.0.0.1:3080' }), wrongMethod);
      expect(wrongMethod.statusCode).toBe(405);

      const crossSite = fakeRes();
      await invoke(
        routes.get(BIND_UPDATE_PATH),
        fakeReq('GET', { host: '127.0.0.1:3080', origin: 'https://evil.example.com' }),
        crossSite,
      );
      expect(crossSite.statusCode).toBe(403);
    });
  });

  describe('群友人格列表路由', () => {
    /** 带 url 的假 req（查询参数解析用） */
    function reqWithUrl(
      method: string,
      url: string,
      headers: Record<string, string | undefined> = { host: '127.0.0.1:3080' },
    ): IncomingMessage {
      const req = fakeReq(method, headers);
      Object.assign(req, { url });
      return req;
    }

    it('注册精确路由', () => {
      const { routes } = createHarness();
      expect(routes.has(BIND_PERSONAS_PATH)).toBe(true);
      expect(routes.get(BIND_PERSONAS_PATH)?.kind).toBe('exact');
    });

    it('未注入数据源时返回 200 + 空表与原因（面板可区分「未启用」）', async () => {
      const { routes } = createHarness();
      const res = fakeRes();
      await invoke(routes.get(BIND_PERSONAS_PATH), reqWithUrl('GET', BIND_PERSONAS_PATH), res);

      expect(res.statusCode).toBe(200);
      expect(json(res)).toEqual({
        ok: false, profiles: [], total: 0, error: '群友人格档案未启用',
      });
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('解析名称 / openid / 特点 / 分页参数并原样传给数据源', async () => {
      const listPersonaProfiles = vi.fn(() => ({ ok: true, profiles: [], total: 0 }));
      const { routes } = createHarness({
        listPersonaProfiles: listPersonaProfiles as unknown as NonNullable<BindRoutesOptions['listPersonaProfiles']>,
      });
      const res = fakeRes();
      await invoke(
        routes.get(BIND_PERSONAS_PATH),
        reqWithUrl('GET', `${BIND_PERSONAS_PATH}?name=%E5%B0%8F%E6%98%8E&openid=u1&trait=%E7%90%86%E6%80%A7&limit=10&offset=5`),
        res,
      );

      expect(res.statusCode).toBe(200);
      expect(listPersonaProfiles).toHaveBeenCalledWith({
        name: '小明', openid: 'u1', trait: '理性', limit: 10, offset: 5,
      });
    });

    it('空白查询参数视为未提供（不传空串给数据源）', async () => {
      const listPersonaProfiles = vi.fn(() => ({ ok: true, profiles: [], total: 0 }));
      const { routes } = createHarness({
        listPersonaProfiles: listPersonaProfiles as unknown as NonNullable<BindRoutesOptions['listPersonaProfiles']>,
      });
      const res = fakeRes();
      await invoke(
        routes.get(BIND_PERSONAS_PATH),
        reqWithUrl('GET', `${BIND_PERSONAS_PATH}?name=%20&openid=&trait=&limit=abc&offset=-1`),
        res,
      );

      expect(listPersonaProfiles).toHaveBeenCalledWith({});
    });

    it('数据源抛错时返回 500 + 中文原因', async () => {
      const { routes } = createHarness({
        listPersonaProfiles: () => { throw new Error('磁盘损坏'); },
      });
      const res = fakeRes();
      await invoke(routes.get(BIND_PERSONAS_PATH), reqWithUrl('GET', BIND_PERSONAS_PATH), res);

      expect(res.statusCode).toBe(500);
      expect(json(res)).toMatchObject({
        ok: false, profiles: [], total: 0, error: expect.stringContaining('磁盘损坏'),
      });
    });

    it('HEAD 允许、POST 405、跨站 Origin 403', async () => {
      const { routes } = createHarness({
        listPersonaProfiles: () => ({ ok: true, profiles: [], total: 0 }),
      });

      const head = fakeRes();
      await invoke(routes.get(BIND_PERSONAS_PATH), reqWithUrl('HEAD', BIND_PERSONAS_PATH), head);
      expect(head.statusCode).toBe(200);

      const post = fakeRes();
      await invoke(routes.get(BIND_PERSONAS_PATH), reqWithUrl('POST', BIND_PERSONAS_PATH), post);
      expect(post.statusCode).toBe(405);

      const crossSite = fakeRes();
      await invoke(
        routes.get(BIND_PERSONAS_PATH),
        reqWithUrl('GET', BIND_PERSONAS_PATH, { host: '127.0.0.1:3080', origin: 'https://evil.example.com' }),
        crossSite,
      );
      expect(crossSite.statusCode).toBe(403);
    });
  });

  describe('personaAnalysis 配置校验', () => {
    function postConfig(
      routes: Map<string, WebRoute>,
      body: string,
    ): Promise<ServerResponse & { statusCode: number; body: string }> {
      const res = fakeRes();
      return invoke(
        routes.get(BIND_CONFIG_PATH),
        fakeReq('POST', { host: '127.0.0.1:3080' }, body),
        res,
      ).then(() => res);
    }

    it('自动分析开关与阈值原样保存', async () => {
      let saved: Record<string, unknown> | undefined;
      const { routes } = createHarness({ onUpdateConfig: (config) => { saved = config; return true; } });
      const res = await postConfig(
        routes,
        '{"personaAnalysis":{"enabled":true,"maxMessages":300,"retentionDays":30,'
        + '"autoAnalyze":false,"autoAnalyzeThreshold":35}}',
      );
      expect(res.statusCode).toBe(200);
      expect(saved).toEqual({
        personaAnalysis: {
          enabled: true, maxMessages: 300, retentionDays: 30, autoAnalyze: false, autoAnalyzeThreshold: 35,
        },
      });
    });

    it('缺省字段回落到默认值（自动分析开启、阈值 20）', async () => {
      let saved: Record<string, unknown> | undefined;
      const { routes } = createHarness({ onUpdateConfig: (config) => { saved = config; return true; } });
      const res = await postConfig(routes, '{"personaAnalysis":{}}');
      expect(res.statusCode).toBe(200);
      expect(saved).toEqual({
        personaAnalysis: {
          enabled: true, maxMessages: 300, retentionDays: 30, autoAnalyze: true, autoAnalyzeThreshold: 20,
        },
      });
    });

    it('阈值低于 5 或高于 200 被拒绝', async () => {
      const { routes } = createHarness();
      const tooSmall = await postConfig(routes, '{"personaAnalysis":{"autoAnalyzeThreshold":4}}');
      expect(tooSmall.statusCode).toBe(400);
      expect(json(tooSmall)).toMatchObject({ ok: false, error: expect.stringContaining('5–200') });

      const tooLarge = await postConfig(routes, '{"personaAnalysis":{"autoAnalyzeThreshold":201}}');
      expect(tooLarge.statusCode).toBe(400);
    });

    it('autoAnalyze 必须是布尔值', async () => {
      const { routes } = createHarness();
      const res = await postConfig(routes, '{"personaAnalysis":{"autoAnalyze":"yes"}}');
      expect(res.statusCode).toBe(400);
      expect(json(res)).toMatchObject({ ok: false, error: expect.stringContaining('布尔') });
    });
  });
});
