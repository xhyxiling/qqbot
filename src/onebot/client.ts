/**
 * OneBot 11 传输客户端 — 正向 WebSocket 收事件 + HTTP 调 API。
 *
 * 只做连接与协议封装：事件语义（过滤/去重/转换）在 gateway.ts，
 * 发送语义在 sender.ts。断线自动退避重连，stop() 后不再重连。
 */
import type { Logger } from '../types.ts';
import type { OneBotApiResponse, OneBotEvent, OneBotLoginInfo } from './types.ts';

/** WebSocket 最小接口（避免依赖 lib.dom 类型；Node 22+ 自带全局 WebSocket） */
interface WebSocketLike {
  readyState: number;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code?: number; reason?: string }) => void) | null;
  onerror: ((event: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

type WebSocketCtor = new (url: string) => WebSocketLike;

interface OneBotClientOptions {
  httpUrl: string;
  wsUrl: string;
  accessToken: string;
  logger: Logger;
  /** 收到事件（已解析的 JSON） */
  onEvent: (event: OneBotEvent) => void;
}

/** 重连退避：1s 起步，翻倍到 30s 封顶 */
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;
/** 单次 HTTP API 调用超时 */
const API_TIMEOUT_MS = 30_000;

/** 拼接 access_token 查询参数（NapCat 与 go-cqhttp 都支持） */
function withToken(url: string, token: string): string {
  if (!token) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}access_token=${encodeURIComponent(token)}`;
}

/** 解析 WebSocket 全局构造器；缺失时尝试动态加载 ws（Node 20 兜底） */
async function resolveWebSocketCtor(): Promise<WebSocketCtor | undefined> {
  const globalCtor = (globalThis as { WebSocket?: unknown }).WebSocket;
  if (typeof globalCtor === 'function') return globalCtor as WebSocketCtor;

  try {
    // 用动态 import 的字符串形式绕过类型检查：ws 是可选兜底，未安装时直接失败
    const dynamicImport = new Function('specifier', 'return import(specifier)') as
      (specifier: string) => Promise<{ default?: unknown }>;
    const mod = await dynamicImport('ws');
    const ctor = mod.default ?? mod;
    if (typeof ctor === 'function') return ctor as WebSocketCtor;
  } catch {
    // 忽略：没有可用实现时由 connect 给出明确错误
  }
  return undefined;
}

export class OneBotClient {
  private readonly options: OneBotClientOptions;
  private readonly logger: Logger;
  private socket: WebSocketLike | undefined;
  private stopped = true;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private ctor: WebSocketCtor | undefined;

  public constructor(options: OneBotClientOptions) {
    this.options = options;
    this.logger = options.logger;
  }

  /** 建立连接（失败时自动重连） */
  public async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    this.ctor = await resolveWebSocketCtor();
    if (this.ctor === undefined) {
      throw new Error(
        '当前 Node 运行时不支持 WebSocket（需要 Node 22+ 内置 WebSocket，或安装 ws 依赖）；'
        + 'OneBot 传输无法启动',
      );
    }
    this.connect();
  }

  /** 主动断开并停止重连 */
  public stop(): void {
    this.stopped = true;
    if (this.reconnectTimer !== undefined) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    const socket = this.socket;
    this.socket = undefined;
    if (socket !== undefined) {
      try {
        socket.close(1000, 'shutdown');
      } catch {
        // 关闭失败忽略
      }
    }
  }

  /** 调用 OneBot HTTP API */
  public async call<T = unknown>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const url = `${this.options.httpUrl.replace(/\/+$/, '')}/${action}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.options.accessToken !== ''
            ? { Authorization: `Bearer ${this.options.accessToken}` }
            : {}),
        },
        body: JSON.stringify(params),
        signal: controller.signal,
      });

      const text = await response.text();
      let parsed: OneBotApiResponse<T>;
      try {
        parsed = JSON.parse(text) as OneBotApiResponse<T>;
      } catch {
        throw new Error(`${action} 返回非 JSON（HTTP ${response.status}）: ${text.slice(0, 200)}`);
      }

      const ok = parsed.retcode === 0 || parsed.status === 'ok' || parsed.status === 'async';
      if (!ok) {
        const detail = parsed.wording || parsed.message || `retcode=${parsed.retcode ?? '?'}`;
        throw new Error(`${action} 调用失败: ${detail}`);
      }
      return parsed.data as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 读取登录账号（selfId 未配置时用于补全） */
  public async getLoginInfo(): Promise<OneBotLoginInfo> {
    return await this.call<OneBotLoginInfo>('get_login_info', {});
  }

  // ── 内部：连接与重连 ──

  private connect(): void {
    if (this.stopped || this.ctor === undefined) return;

    const url = withToken(this.options.wsUrl, this.options.accessToken);
    let socket: WebSocketLike;
    try {
      socket = new this.ctor(url);
    } catch (err) {
      this.logger.error(`OneBot WebSocket 创建失败: ${err instanceof Error ? err.message : String(err)}`);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      this.reconnectAttempt = 0;
      this.logger.info(`OneBot WebSocket 已连接: ${this.options.wsUrl}`);
      console.log(`[im-qqbot] OneBot WebSocket connected (${this.options.wsUrl})`);
    };

    socket.onmessage = (event) => {
      this.handleFrame(event.data);
    };

    socket.onerror = () => {
      // 具体错误由 onclose 兜底，这里只记一行避免刷屏
      this.logger.debug('OneBot WebSocket error');
    };

    socket.onclose = (event) => {
      if (this.socket === socket) this.socket = undefined;
      if (this.stopped) return;
      const detail = event.code !== undefined ? `code=${event.code}` : '';
      this.logger.warn(`OneBot WebSocket 断开 ${detail}，准备重连`);
      this.scheduleReconnect();
    };
  }

  private handleFrame(data: unknown): void {
    let text: string | undefined;
    if (typeof data === 'string') {
      text = data;
    } else if (data instanceof ArrayBuffer) {
      text = Buffer.from(data).toString('utf8');
    } else if (ArrayBuffer.isView(data)) {
      text = Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
    }

    if (text === undefined) {
      this.logger.warn('OneBot 收到无法识别的 WebSocket 帧（预期文本 JSON）');
      return;
    }

    try {
      const parsed = JSON.parse(text) as OneBotEvent;
      this.options.onEvent(parsed);
    } catch (err) {
      this.logger.warn(`OneBot 事件解析失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer !== undefined) return;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempt,
      RECONNECT_MAX_MS,
    );
    this.reconnectAttempt += 1;
    this.logger.warn(`OneBot ${Math.round(delay / 1000)}s 后重连（第 ${this.reconnectAttempt} 次）`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
  }
}
