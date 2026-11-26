/**
 * NapCat（OneBot 11 实现）托管 —— 一键下载 / 启动 / 停止
 *
 * 面向普通 QQ 号用户：免去手动安装 NapCat 的步骤。只支持 Windows
 * 自动安装（GitHub release + PowerShell Expand-Archive），macOS/Linux
 * 返回 unsupported 并给出手动下载指引。
 *
 * 安装目录固定 `~/.dsh-qqbot/napcat`；端口 / token / QQ 号复用现有
 * onebot.* 配置，不新增任何配置项，也不做配置持久化。
 *
 * 约定：
 * - 只用 node 内置模块与全局 fetch；
 * - 所有外部副作用（fetch / spawn）可注入，便于测试；
 * - 任何异常都收敛为 phase='error' + message，不向路由抛错。
 */
import { execFile, spawn } from 'node:child_process';
import type { StdioOptions } from 'node:child_process';
import { once } from 'node:events';
import {
  closeSync,
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, sep } from 'node:path';
import type { Logger } from '../types.ts';

/** NapCat 托管阶段 */
export type NapcatPhase =
  | 'unsupported'
  | 'not_installed'
  | 'installing'
  | 'installed'
  | 'starting'
  | 'running'
  | 'login_required'
  | 'error';

/** 面板展示用的托管状态 */
export interface NapcatState {
  phase: NapcatPhase;
  platform: string;
  installDir: string;
  qqPath?: string;
  launcher?: string;
  webuiUrl: string;
  httpUrl: string;
  loggedIn: boolean;
  uin?: string;
  progress?: number;
  message?: string;
}

/** 从插件配置里读出的 OneBot 连接参数 */
export interface NapcatEnv {
  httpUrl: string;
  wsUrl: string;
  accessToken: string;
  selfId: string;
}

/** 管理器构造参数 */
export interface NapcatManagerOptions {
  logger: Logger;
  env: NapcatEnv;
  installDir?: string;
  fetchImpl?: typeof fetch;
  spawnImpl?: typeof spawn;
  /** 是否在托管目录之外扫描本机已有的 NapCat（默认关闭，单测保持确定性） */
  discoverExternal?: boolean;
}

const DEFAULT_HTTP_URL = 'http://127.0.0.1:3000';
const DEFAULT_WS_URL = 'ws://127.0.0.1:3001';
/** NapCat WebUI 固定端口（官方默认） */
const WEBUI_URL = 'http://127.0.0.1:6099/webui';
const RELEASE_API = 'https://api.github.com/repos/NapNeko/NapCatQQ/releases/latest';
const MANUAL_URL = 'https://github.com/NapNeko/NapCatQQ/releases';
const WINDOWS_ONLY_MESSAGE = `NapCat 自动安装仅支持 Windows；macOS/Linux 请手动下载安装：${MANUAL_URL}`;

/** 启动脚本候选（含 NapCat.*.Shell 子目录一层） */
const LAUNCHER_NAMES = ['launcher.bat', 'launcher-win10.bat', 'napcat.bat'];
/** 托管目录之外扫描本机安装：缓存时长 / 递归深度 */
const EXTERNAL_SCAN_TTL_MS = 30_000;
const EXTERNAL_SCAN_DEPTH = 3;
/** Shell 版 / OneKey 版安装包名 */
const SHELL_ZIP = 'NapCat.Shell.zip';
const ONEKEY_ZIP = 'NapCat.Shell.Windows.OneKey.zip';

/** get_login_info 探测超时 */
const LOGIN_PROBE_TIMEOUT_MS = 2000;
/** start() 后等待登录/运行态的最长时间与轮询间隔 */
const START_POLL_TIMEOUT_MS = 30_000;
const START_POLL_INTERVAL_MS = 1000;

/** 读取插件配置里的 onebot.*（缺失时回落到默认值） */
export function readNapcatEnv(config: Record<string, unknown>): NapcatEnv {
  const raw = config.onebot;
  const onebot = typeof raw === 'object' && raw !== null ? raw as Record<string, unknown> : {};
  const text = (value: unknown, fallback: string): string =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
  return {
    httpUrl: text(onebot.httpUrl, DEFAULT_HTTP_URL),
    wsUrl: text(onebot.wsUrl, DEFAULT_WS_URL),
    accessToken: typeof onebot.accessToken === 'string' ? onebot.accessToken.trim() : '',
    selfId: typeof onebot.selfId === 'string' ? onebot.selfId.trim() : '',
  };
}

/** 默认安装目录：~/.dsh-qqbot/napcat */
function defaultInstallDir(): string {
  return join(homedir(), '.dsh-qqbot', 'napcat');
}

/** 从 URL 解析端口（解析失败时回落到 fallback） */
function portOf(url: string, fallback: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.port !== '') return parsed.port;
    return parsed.protocol === 'https:' || parsed.protocol === 'wss:' ? '443' : '80';
  } catch {
    return fallback;
  }
}

/** PowerShell 单引号字符串字面量 */
function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * NapCat 进程管理器（进程级单例由 getNapcatManager 持有）。
 *
 * state() 是纯探测；install/start/stop 各自负责副作用并返回探测结果，
 * 不依赖调用方保存任何中间态。
 */
export class NapcatManager {
  private logger: Logger;
  private readonly env: NapcatEnv;
  private readonly installDir: string;
  private readonly fetchImpl: typeof fetch;
  private readonly spawnImpl: typeof spawn;
  /** 安装进行中（状态查询据此返回 installing + progress） */
  private installing = false;
  /** 启动进行中（并发点击「启动」时避免重复拉起进程） */
  private starting = false;
  private progress = 0;
  private installMessage: string | undefined;
  /** 托管目录之外发现的本机安装（扫描较重，缓存 30s） */
  private readonly discoverExternal: boolean;
  private externalCache: { launcher: string | undefined; at: number } | undefined;

  public constructor(options: NapcatManagerOptions) {
    this.logger = options.logger;
    this.env = options.env;
    this.installDir = options.installDir ?? defaultInstallDir();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.spawnImpl = options.spawnImpl ?? spawn;
    this.discoverExternal = options.discoverExternal === true;
  }

  /** 安装目录（测试 / 面板诊断用） */
  public getInstallDir(): string {
    return this.installDir;
  }

  /** 宿主 logger 就绪后补挂（单例创建早于插件 logger 时用） */
  public attachLogger(logger: Logger): void {
    this.logger = logger;
  }

  /** 探测当前状态（不产生副作用） */
  public async state(): Promise<NapcatState> {
    const base = this.base('not_installed');
    if (process.platform !== 'win32') {
      return { ...base, phase: 'unsupported', message: WINDOWS_ONLY_MESSAGE };
    }

    const qqPath = this.findQqPath();
    if (this.installing) {
      return {
        ...base,
        phase: 'installing',
        ...(qqPath !== undefined ? { qqPath } : {}),
        progress: this.progress,
        ...(this.installMessage !== undefined ? { message: this.installMessage } : {}),
      };
    }

    const launcher = this.findLauncher();
    // 先探测 OneBot 接口：外部 NapCat（不在托管目录）也可能正在跑，
    // 只要 HTTP 接口能通就算「运行中」，不能因为没找到启动脚本就报未安装。
    const probe = await this.probeLogin();
    if (probe.running) {
      const external = launcher !== undefined && !this.isInsideInstallDir(launcher);
      // 只有托管启动过的进程（有 pid 文件且存活）才给「停止」，外部实例停不掉
      const pid = this.readPid();
      const stoppable = launcher !== undefined && pid !== undefined && await this.isProcessAlive(pid);
      return {
        ...base,
        phase: 'running',
        ...(stoppable ? { launcher } : {}),
        ...(qqPath !== undefined ? { qqPath } : {}),
        loggedIn: true,
        ...(probe.uin !== undefined ? { uin: probe.uin } : {}),
        ...(external || launcher === undefined
          ? { message: '检测到本机已有的 NapCat 正在运行（不在托管目录），已复用它连接' }
          : {}),
      };
    }
    if (launcher === undefined) {
      return { ...base, phase: 'not_installed', ...(qqPath !== undefined ? { qqPath } : {}) };
    }

    const pid = this.readPid();
    if (pid !== undefined && await this.isProcessAlive(pid)) {
      return {
        ...base,
        phase: 'login_required',
        launcher,
        ...(qqPath !== undefined ? { qqPath } : {}),
        message: `NapCat 已启动，等待扫码登录：${WEBUI_URL}`,
      };
    }

    return {
      ...base,
      phase: 'installed',
      launcher,
      ...(qqPath !== undefined ? { qqPath } : {}),
      message: this.isInsideInstallDir(launcher)
        ? '已安装，点击「启动」运行 NapCat'
        : `已检测到本机已有的 NapCat 安装（${dirname(launcher)}），点击「启动」直接使用`,
    };
  }

  /** 下载并安装 NapCat（仅 Windows） */
  public async install(): Promise<NapcatState> {
    if (process.platform !== 'win32') {
      return { ...this.base('error'), message: WINDOWS_ONLY_MESSAGE };
    }
    if (this.installing) return await this.state();
    if (this.findLauncher() !== undefined) return await this.state();

    const qqPath = this.findQqPath();
    this.installing = true;
    this.progress = 0;
    this.installMessage = '正在准备下载 NapCat…';
    let tempZip: string | undefined;

    try {
      const source = await this.resolveZipSource(qqPath);
      tempZip = join(tmpdir(), `dsh-qqbot-napcat-${Date.now()}.zip`);
      if (source.url !== undefined) {
        this.installMessage = '正在下载 NapCat（约 100–200MB）…';
        await this.downloadZip(source.url, tempZip);
      } else if (source.file !== undefined) {
        this.installMessage = '正在复制本地安装包…';
        copyFileSync(source.file, tempZip);
        this.progress = 100;
      } else {
        throw new Error('没有可用的安装包来源');
      }

      mkdirSync(this.installDir, { recursive: true });
      this.installMessage = '正在解压 NapCat…';
      await this.expandArchive(tempZip);
    } catch (err) {
      this.logger.warn(`im-qqbot: NapCat 安装失败: ${errorText(err)}`);
      return {
        ...this.base('error'),
        progress: this.progress,
        message: `NapCat 安装失败：${errorText(err)}`,
      };
    } finally {
      this.installing = false;
      this.installMessage = undefined;
      if (tempZip !== undefined) {
        try {
          rmSync(tempZip, { force: true });
        } catch {
          // 临时文件清理失败不影响结果
        }
      }
    }

    const qq = this.findQqPath();
    const launcher = this.findLauncher();
    const installer = this.findFile('NapCatInstaller.exe', this.installDir, 2);
    if (launcher === undefined && installer !== undefined) {
      // OneKey 包：解压后是安装向导，不能假装已经装好
      try {
        const child = this.spawnImpl(installer, [], {
          cwd: this.installDir,
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        child.unref();
        this.logger.info(`im-qqbot: 已启动 NapCat 安装向导: ${installer}`);
      } catch (err) {
        this.logger.warn(`im-qqbot: 启动 NapCat 安装向导失败: ${errorText(err)}`);
      }
      return {
        ...this.base('installed'),
        ...(qq !== undefined ? { qqPath: qq } : {}),
        message: 'NapCat 安装向导已启动，请在向导里完成安装，然后点「刷新」',
      };
    }

    if (launcher === undefined) {
      return {
        ...this.base('error'),
        ...(qq !== undefined ? { qqPath: qq } : {}),
        message: `解压完成但未找到启动脚本，请手动检查安装目录：${this.installDir}`,
      };
    }

    // Shell 包：best-effort 写入 OneBot 网络配置（仅在 selfId 已知且文件不存在时）
    this.writeOneBotConfig();
    return {
      ...this.base('installed'),
      launcher,
      ...(qq !== undefined ? { qqPath: qq } : {}),
      message: 'NapCat 已安装，点击「启动」开始运行',
    };
  }

  /** 启动 NapCat 并轮询等待运行 / 待扫码 */
  public async start(): Promise<NapcatState> {
    if (process.platform !== 'win32') {
      return { ...this.base('error'), message: WINDOWS_ONLY_MESSAGE };
    }
    // 并发点击「启动」只允许一次真正 spawn
    if (this.starting) return await this.state();
    const current = await this.state();
    if (current.phase === 'running') return current;
    if (current.phase === 'login_required' || current.phase === 'starting') return current;
    if (current.phase === 'not_installed') {
      return { ...current, phase: 'error', message: '未检测到 NapCat 安装，请先点「下载并安装」' };
    }
    if (current.launcher === undefined) {
      return {
        ...current,
        phase: 'error',
        message: '未找到启动脚本：OneKey 安装向导可能还没完成，完成后再点「刷新」',
      };
    }

    this.starting = true;
    try {
      this.spawnLauncher(current.launcher);
    } catch (err) {
      this.starting = false;
      this.logger.warn(`im-qqbot: NapCat 启动失败: ${errorText(err)}`);
      return { ...current, phase: 'error', message: `NapCat 启动失败：${errorText(err)}` };
    }

    const deadline = Date.now() + START_POLL_TIMEOUT_MS;
    try {
      while (Date.now() < deadline) {
        const probed = await this.state();
        if (probed.phase === 'running' || probed.phase === 'login_required') return probed;
        await delay(START_POLL_INTERVAL_MS);
      }

      return {
        ...this.base('starting'),
        launcher: current.launcher,
        ...(current.qqPath !== undefined ? { qqPath: current.qqPath } : {}),
        message: 'NapCat 正在启动，请稍后点「刷新」查看状态（首次启动可能需要下载组件）',
      };
    } finally {
      this.starting = false;
    }
  }

  /** 停止 NapCat（taskkill 整棵进程树） */
  public async stop(): Promise<NapcatState> {
    try {
      const pid = this.readPid();
      if (pid !== undefined) {
        await this.killTree(pid);
        this.removePid();
      }
      return await this.state();
    } catch (err) {
      this.logger.warn(`im-qqbot: 停止 NapCat 失败: ${errorText(err)}`);
      let state: NapcatState;
      try {
        state = await this.state();
      } catch {
        state = this.base('installed');
      }
      return { ...state, phase: 'error', message: `停止 NapCat 失败：${errorText(err)}` };
    }
  }

  // ── 内部：状态与探测 ──

  private base(phase: NapcatPhase): NapcatState {
    return {
      phase,
      platform: process.platform,
      installDir: this.installDir,
      webuiUrl: WEBUI_URL,
      httpUrl: this.env.httpUrl,
      loggedIn: false,
    };
  }

  /** GET {httpUrl}/get_login_info（2s 超时；有 token 时带 Bearer） */
  private async probeLogin(): Promise<{ running: boolean; uin?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => { controller.abort(); }, LOGIN_PROBE_TIMEOUT_MS);
    try {
      const headers: Record<string, string> = {};
      if (this.env.accessToken !== '') headers.Authorization = `Bearer ${this.env.accessToken}`;
      const response = await this.fetchImpl(`${this.env.httpUrl.replace(/\/+$/, '')}/get_login_info`, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      if (!response.ok) return { running: false };
      const body = await response.json() as {
        status?: string;
        data?: { user_id?: number | string } | null;
      };
      // NapCat 未登录时同样回 200，但 status 是 failed（retcode 非 0）
      if (body.status !== 'ok' || body.data === undefined || body.data === null) {
        return { running: false };
      }
      const raw = body.data.user_id;
      if (raw === undefined || raw === null) return { running: true };
      return { running: true, uin: String(raw) };
    } catch {
      return { running: false };
    } finally {
      clearTimeout(timer);
    }
  }

  private get pidPath(): string {
    return join(this.installDir, 'napcat.pid');
  }

  private readPid(): number | undefined {
    try {
      const raw = readFileSync(this.pidPath, 'utf8').trim();
      const pid = Number(raw);
      return Number.isInteger(pid) && pid > 0 ? pid : undefined;
    } catch {
      return undefined;
    }
  }

  private async isProcessAlive(pid: number): Promise<boolean> {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /** 在常用路径里找 QQ.exe（不存在的忽略） */
  private findQqPath(): string | undefined {
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA];
    for (const root of roots) {
      if (typeof root !== 'string' || root === '') continue;
      const candidate = join(root, 'Tencent', 'QQNT', 'QQ.exe');
      if (existsSync(candidate)) return candidate;
    }
    return undefined;
  }

  /**
   * 找启动脚本：托管目录顶层 + 一层 NapCat.*.Shell 子目录；
   * 开启 discoverExternal 时再扫本机常见位置（用户自己装的 NapCat）。
   */
  private findLauncher(): string | undefined {
    for (const name of LAUNCHER_NAMES) {
      const direct = join(this.installDir, name);
      if (existsSync(direct)) return direct;
    }
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(this.installDir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^NapCat\..*\.Shell$/i.test(entry.name)) continue;
      for (const name of LAUNCHER_NAMES) {
        const candidate = join(this.installDir, entry.name, name);
        if (existsSync(candidate)) return candidate;
      }
    }

    if (!this.discoverExternal) return undefined;
    const cached = this.externalCache;
    if (cached !== undefined && Date.now() - cached.at < EXTERNAL_SCAN_TTL_MS) {
      return cached.launcher;
    }
    const found = this.scanExternal();
    this.externalCache = { launcher: found, at: Date.now() };
    return found;
  }

  /** 扫描常见安装位置（只看名字像 NapCat 的目录，控制开销） */
  private scanExternal(): string | undefined {
    const home = homedir();
    const roots = [
      join(home, 'qce'),
      join(home, 'Desktop'),
      join(home, 'Downloads'),
      'C:\\Napcat',
      'C:\\napcat',
      'D:\\Napcat',
      'D:\\napcat',
      'D:\\NapCat',
    ];
    try {
      // 家目录下一层：名字里带 nap 的目录（如 Napcat、NapCatQQ）
      for (const entry of readdirSync(home, { withFileTypes: true })) {
        if (entry.isDirectory() && /nap/i.test(entry.name)) roots.push(join(home, entry.name));
      }
    } catch {
      // 家目录读不到就只扫固定候选
    }
    for (const root of roots) {
      const found = this.findLauncherUnder(root, EXTERNAL_SCAN_DEPTH);
      if (found !== undefined) {
        this.logger.info(`im-qqbot: 检测到本机已有的 NapCat 安装: ${found}`);
        return found;
      }
    }
    return undefined;
  }

  /** 在 root 下有限深度查找启动脚本，只进入名字像 NapCat 的子目录 */
  private findLauncherUnder(root: string, depth: number): string | undefined {
    for (const name of LAUNCHER_NAMES) {
      const direct = join(root, name);
      if (existsSync(direct)) return direct;
    }
    if (depth <= 0) return undefined;
    let entries;
    try {
      entries = readdirSync(root, { withFileTypes: true });
    } catch {
      return undefined;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !/nap|qq/i.test(entry.name)) continue;
      const found = this.findLauncherUnder(join(root, entry.name), depth - 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  /** 启动脚本是否位于托管目录内 */
  private isInsideInstallDir(launcher: string): boolean {
    const prefix = this.installDir.endsWith(sep) ? this.installDir : `${this.installDir}${sep}`;
    return launcher.toLowerCase().startsWith(prefix.toLowerCase());
  }

  /** 有限深度递归查找文件（大小写不敏感） */
  private findFile(name: string, dir: string, depth: number): string | undefined {
    if (depth < 0) return undefined;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return undefined;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) {
        return join(dir, entry.name);
      }
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const found = this.findFile(name, join(dir, entry.name), depth - 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  // ── 内部：安装 ──

  /** 解析安装包来源：GitHub release / 本地 zip / 下载 URL（QQBOT_NAPCAT_ZIP） */
  private async resolveZipSource(qqPath: string | undefined): Promise<{ url?: string; file?: string }> {
    const override = process.env.QQBOT_NAPCAT_ZIP?.trim() ?? '';
    if (override !== '') {
      return /^https?:\/\//i.test(override) ? { url: override } : { file: override };
    }

    try {
      const response = await this.fetchImpl(RELEASE_API, {
        headers: {
          accept: 'application/vnd.github+json',
          'user-agent': 'dsh-qqbot-napcat',
        },
      });
      if (!response.ok) throw new Error(`GitHub API HTTP ${response.status}`);
      const release = await response.json() as {
        assets?: Array<{ name?: string; browser_download_url?: string }>;
      };
      const wanted = qqPath !== undefined ? SHELL_ZIP : ONEKEY_ZIP;
      const asset = (release.assets ?? []).find((item) => item.name === wanted);
      if (asset?.browser_download_url === undefined) {
        throw new Error(`最新 release 中缺少 ${wanted}`);
      }
      return { url: asset.browser_download_url };
    } catch (err) {
      throw new Error(
        `无法从 GitHub 获取 NapCat 安装包（${errorText(err)}）；`
        + `请手动下载 ${MANUAL_URL} 并解压到 ${this.installDir}，`
        + '或设置环境变量 QQBOT_NAPCAT_ZIP 指向本地 zip / 下载地址',
      );
    }
  }

  /** 流式下载并按 content-length 更新进度（0-100） */
  private async downloadZip(url: string, target: string): Promise<void> {
    const response = await this.fetchImpl(url, { headers: { 'user-agent': 'dsh-qqbot-napcat' } });
    if (!response.ok) throw new Error(`下载安装包失败（HTTP ${response.status}）`);
    const body = response.body;
    if (body === null) throw new Error('下载安装包失败（响应无文件流）');

    const total = Number(response.headers.get('content-length') ?? '0');
    const reader = body.getReader();
    const file = createWriteStream(target);
    let received = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const value = chunk.value;
        if (value === undefined) continue;
        received += value.length;
        if (total > 0) this.progress = Math.min(99, Math.floor((received / total) * 100));
        if (!file.write(Buffer.from(value))) await once(file, 'drain');
      }
      this.progress = 100;
    } finally {
      await new Promise<void>((resolve, reject) => {
        file.end((err?: Error | null) => {
          if (err !== undefined && err !== null) reject(err);
          else resolve();
        });
      });
    }
  }

  /** PowerShell Expand-Archive（等退出码） */
  private async expandArchive(zipPath: string): Promise<void> {
    const command = `Expand-Archive -LiteralPath ${psQuote(zipPath)} -DestinationPath ${psQuote(this.installDir)} -Force`;
    const child = this.spawnImpl('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
      stdio: 'ignore',
      windowsHide: true,
    });
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => { resolve(code); });
    });
    if (exitCode !== 0) throw new Error(`解压失败（PowerShell 退出码 ${exitCode ?? 'unknown'}）`);
  }

  /**
   * best-effort 写 OneBot 网络配置：installDir/config/onebot11_<selfId>.json
   * 仅在 selfId 非空且文件不存在时写入；失败只告警。
   */
  private writeOneBotConfig(): void {
    if (this.env.selfId === '') return;
    const configDir = join(this.installDir, 'config');
    const target = join(configDir, `onebot11_${this.env.selfId}.json`);
    if (existsSync(target)) return;
    try {
      mkdirSync(configDir, { recursive: true });
      const content = {
        network: {
          httpServers: [{
            name: 'http',
            enable: true,
            host: '127.0.0.1',
            port: Number(portOf(this.env.httpUrl, '3000')),
            messagePostFormat: 'array',
            token: this.env.accessToken,
          }],
          websocketServers: [{
            name: 'ws',
            enable: true,
            host: '127.0.0.1',
            port: Number(portOf(this.env.wsUrl, '3001')),
            messagePostFormat: 'array',
            token: this.env.accessToken,
          }],
        },
      };
      writeFileSync(target, `${JSON.stringify(content, null, 2)}\n`, 'utf8');
      this.logger.info(`im-qqbot: 已写入 NapCat OneBot 配置: ${target}`);
    } catch (err) {
      // 配置写失败不影响安装，用户可在 WebUI 里手动改
      this.logger.warn(`im-qqbot: 写入 NapCat 配置失败: ${errorText(err)}`);
    }
  }

  // ── 内部：启动 / 停止 ──

  /** detached 启动 launcher.bat，日志追加到 napcat.log，pid 落盘 */
  private spawnLauncher(launcher: string): void {
    mkdirSync(this.installDir, { recursive: true });
    const logFd = openSync(join(this.installDir, 'napcat.log'), 'a');
    let child;
    try {
      const stdio: StdioOptions = ['ignore', logFd, logFd];
      const args = ['/c', launcher, ...(this.env.selfId !== '' ? [this.env.selfId] : [])];
      child = this.spawnImpl('cmd.exe', args, {
        // 外部安装的 launcher.bat 依赖自身目录里的相对路径
        cwd: dirname(launcher),
        detached: true,
        stdio,
        windowsHide: true,
      });
    } finally {
      closeSync(logFd);
    }
    child.unref();
    if (typeof child.pid === 'number') {
      writeFileSync(this.pidPath, String(child.pid), 'utf8');
    }
  }

  private async killTree(pid: number): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], (err) => {
        if (err !== null && err !== undefined) reject(err);
        else resolve();
      });
    });
  }

  private removePid(): void {
    try {
      rmSync(this.pidPath, { force: true });
    } catch {
      // pid 文件删除失败忽略
    }
  }
}

/** 进程级单例（路由与自动启动共用；config 变化时重建以更新 env） */
let singleton: NapcatManager | undefined;
let singletonKey = '';

/** 兜底 logger：单例没有宿主 logger 时静默 */
const SILENT_LOGGER: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

function envKey(env: NapcatEnv): string {
  return JSON.stringify(env);
}

/** 取进程级 NapCat 管理器；config 变化时用新 env 重建 */
export function getNapcatManager(config?: Record<string, unknown>, logger?: Logger): NapcatManager {
  const env = readNapcatEnv(config ?? {});
  const key = envKey(env);
  if (singleton === undefined || singletonKey !== key) {
    singleton = new NapcatManager({
      logger: logger ?? SILENT_LOGGER,
      env,
      discoverExternal: true,
    });
    singletonKey = key;
  } else if (logger !== undefined) {
    singleton.attachLogger(logger);
  }
  return singleton;
}

/**
 * 插件加载时尝试自动拉起 NapCat（非阻塞）。
 *
 * 只有已安装且处于 installed 态才启动；官方机器人模式不拉起。
 * 失败只告警，不影响插件加载。
 */
export function maybeAutoStartNapcat(config: Record<string, unknown>, logger: Logger): void {
  if (config.backend === 'official') return;
  const manager = getNapcatManager(config, logger);
  void manager.state()
    .then(async (state) => {
      if (state.phase !== 'installed') return;
      const next = await manager.start();
      logger.info(`im-qqbot: NapCat 自动启动（${next.phase}）`);
    })
    .catch((err: unknown) => {
      logger.warn(`im-qqbot: NapCat 自动启动失败: ${errorText(err)}`);
    });
}
