/**
 * DashScope 语音合成（WebSocket 协议）
 *
 * 与 Python SDK `dashscope.audio.tts_v2.SpeechSynthesizer` 同一条 wire 协议：
 *   run-task（header.action=run-task, streaming=duplex）
 *   → task-started
 *   → continue-task（input.text）
 *   → finish-task
 *   → 若干二进制音频帧
 *   → task-finished
 *
 * 鉴权走 `Authorization: Bearer <apiKey>` 请求头（自定义 MaaS 网关另带
 * `X-DashScope-WorkSpace`），因此使用 Node 内置 WebSocket 的 `headers` 扩展
 * （Node 22.4+；DSH Desktop 运行时为 Node 24），不额外引入 `ws` 依赖。
 * Node 20 没有全局 WebSocket，此时 `isSpeechWebSocketAvailable()` 为 false，
 * 语音功能由上层关闭并给出日志，不影响其他能力。
 */
import { randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';

/** DashScope 官方共享网关（无 workspace 时的缺省地址） */
export const DEFAULT_TTS_WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference';
/** MaaS 网关区域（workspace 拼地址用） */
export const DEFAULT_TTS_REGION = 'cn-beijing';
/** 缺省采样率（与 SDK 的 SynthesisSession 对齐） */
export const DEFAULT_TTS_SAMPLE_RATE = 22050;
/** 缺省合成超时(ms) */
export const DEFAULT_TTS_TIMEOUT_MS = 30000;
/** 单次 run-task 的音频格式（QQ 语音容器一致） */
export const TTS_AUDIO_FORMAT = 'mp3';

/** 合成参数 */
export interface SpeechSynthesisOptions {
  apiKey: string;
  model: string;
  voice: string;
  /** 自定义 WebSocket 地址（优先于 workspace 拼出的地址） */
  baseUrl?: string;
  /** 百炼业务空间 id */
  workspace?: string;
  /** 语速倍率（0.5–2） */
  rate?: number;
  /** 音量（0–100） */
  volume?: number;
  /**
   * 情感/语气指令（自然语言：语种、语速、情绪、说话方式）。
   *
   * qwen-audio-3.1/3.0-tts-plus/flash 的系统音色、复刻音色、设计音色都支持；
   * 余弦/CosyVoice 模型亦支持（长度 ≤100 字符）。留空则不下发该参数。
   */
  instruction?: string;
  sampleRate?: number;
  timeoutMs?: number;
}

/** run-task / continue-task / finish-task 的帧结构 */
export interface TtsFrame {
  header: {
    action: 'run-task' | 'continue-task' | 'finish-task';
    task_id: string;
    streaming: 'duplex';
  };
  payload: Record<string, unknown>;
}

/**
 * 解析 WS 地址：显式 baseUrl > workspace（cn-beijing MaaS 网关）> 官方共享网关。
 *
 * baseUrl 支持传完整地址（`wss://.../api-ws/v1/inference`）或仅主机
 * （`wss://...`），后者自动补协议路径。
 */
export function resolveSpeechEndpoint(baseUrl?: string, workspace?: string): string {
  const host = baseUrl?.trim();
  if (host !== undefined && host !== '') {
    if (host.includes('/api-ws/')) return host;
    return `${host.replace(/\/+$/, '')}/api-ws/v1/inference`;
  }
  const space = workspace?.trim();
  if (space !== undefined && space !== '') {
    return `wss://${space}.${DEFAULT_TTS_REGION}.maas.aliyuncs.com/api-ws/v1/inference`;
  }
  return DEFAULT_TTS_WS_URL;
}

/** 构造 run-task 帧（参数名与 Python SDK 的 wire 名称一致） */
export function buildRunTaskFrame(taskId: string, options: SpeechSynthesisOptions): TtsFrame {
  const parameters: Record<string, unknown> = {
    voice: options.voice,
    format: TTS_AUDIO_FORMAT,
    sample_rate: options.sampleRate ?? DEFAULT_TTS_SAMPLE_RATE,
    text_type: 'PlainText',
  };
  if (options.rate !== undefined) parameters.rate = options.rate;
  if (options.volume !== undefined) parameters.volume = options.volume;
  const instruction = options.instruction?.trim();
  if (instruction !== undefined && instruction !== '') parameters.instruction = instruction;

  return {
    header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
    payload: {
      task_group: 'audio',
      task: 'tts',
      function: 'SpeechSynthesizer',
      model: options.model,
      input: {},
      parameters,
    },
  };
}

/** 构造 continue-task 帧（送文本） */
export function buildContinueTaskFrame(taskId: string, text: string): TtsFrame {
  return {
    header: { action: 'continue-task', task_id: taskId, streaming: 'duplex' },
    payload: { input: { text } },
  };
}

/** 构造 finish-task 帧（结束输入，等待音频收尾） */
export function buildFinishTaskFrame(taskId: string): TtsFrame {
  return {
    header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' },
    payload: { input: {} },
  };
}

/** 当前运行时是否具备内置 WebSocket（Node 22+） */
export function isSpeechWebSocketAvailable(): boolean {
  return typeof (globalThis as { WebSocket?: unknown }).WebSocket === 'function';
}

/** 最小 WebSocket 形状（避免依赖 DOM lib；headers 为 Node 的扩展参数） */
interface SpeechSocket {
  binaryType: string;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void;
}

type SpeechSocketConstructor = new (
  url: string,
  init?: { headers?: Record<string, string> },
) => SpeechSocket;

/** 单帧事件（服务端 JSON） */
interface TtsEvent {
  header?: {
    event?: string;
    task_id?: string;
    error_code?: string;
    error_message?: string;
  };
}

/** 二进制帧归一化为 Buffer（ArrayBuffer / TypedArray / Blob 均兼容） */
async function toAudioBuffer(data: unknown): Promise<Buffer> {
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  }
  if (typeof Blob === 'function' && data instanceof Blob) {
    return Buffer.from(await data.arrayBuffer());
  }
  return Buffer.alloc(0);
}

/**
 * 合成一段文本为 mp3 音频。
 *
 * 失败（网络 / 鉴权 / 模型未开通 / 超时）一律抛错，由调用方降级为纯文本回复。
 */
export async function synthesizeSpeech(
  text: string,
  options: SpeechSynthesisOptions,
): Promise<Buffer> {
  const apiKey = options.apiKey.trim();
  if (apiKey === '') throw new Error('语音合成未配置 API Key');
  const input = text.trim();
  if (input === '') throw new Error('语音合成文本为空');

  const Ctor = (globalThis as { WebSocket?: SpeechSocketConstructor }).WebSocket;
  if (typeof Ctor !== 'function') {
    throw new Error('当前 Node 运行时没有内置 WebSocket（需要 Node 22+），无法合成语音');
  }

  const taskId = randomUUID().replace(/-/g, '');
  const endpoint = resolveSpeechEndpoint(options.baseUrl, options.workspace);
  const headers: Record<string, string> = { authorization: `Bearer ${apiKey}` };
  const workspace = options.workspace?.trim();
  if (workspace !== undefined && workspace !== '') {
    headers['X-DashScope-WorkSpace'] = workspace;
  }
  const timeoutMs = Math.max(1000, options.timeoutMs ?? DEFAULT_TTS_TIMEOUT_MS);

  return await new Promise<Buffer>((resolve, reject) => {
    const audioParts: Array<Promise<Buffer>> = [];
    let socket: SpeechSocket | undefined;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      try {
        socket?.close();
      } catch {
        // 已关闭或对端已断开
      }
    };

    const fail = (error: Error): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const succeed = (audio: Buffer): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(audio);
    };

    const handleEvent = (raw: string): void => {
      let event: TtsEvent;
      try {
        event = JSON.parse(raw) as TtsEvent;
      } catch {
        return;
      }
      const name = event.header?.event;
      if (name === 'task-started') {
        socket?.send(JSON.stringify(buildContinueTaskFrame(taskId, input)));
        socket?.send(JSON.stringify(buildFinishTaskFrame(taskId)));
        return;
      }
      if (name === 'task-failed') {
        const code = event.header?.error_code ?? 'TtsError';
        const message = event.header?.error_message ?? '语音合成失败';
        fail(new Error(`语音合成失败（${code}）：${message}`));
        return;
      }
      if (name === 'task-finished') {
        void Promise.all(audioParts)
          .then((parts) => {
            const audio = Buffer.concat(parts);
            if (audio.length === 0) {
              fail(new Error('语音合成未返回音频数据'));
              return;
            }
            succeed(audio);
          })
          .catch((err: unknown) => {
            fail(new Error(`语音音频读取失败: ${err instanceof Error ? err.message : String(err)}`));
          });
      }
    };

    timer = setTimeout(() => {
      fail(new Error(`语音合成超时（>${timeoutMs}ms）`));
    }, timeoutMs);

    try {
      socket = new Ctor(endpoint, { headers });
    } catch (err) {
      fail(new Error(`连接语音服务失败: ${err instanceof Error ? err.message : String(err)}`));
      return;
    }

    socket.binaryType = 'arraybuffer';
    socket.addEventListener('open', () => {
      socket?.send(JSON.stringify(buildRunTaskFrame(taskId, options)));
    });
    socket.addEventListener('message', (event) => {
      const data = event.data;
      if (typeof data === 'string') {
        handleEvent(data);
        return;
      }
      audioParts.push(toAudioBuffer(data));
    });
    socket.addEventListener('error', () => {
      fail(new Error('语音服务连接异常'));
    });
    socket.addEventListener('close', () => {
      fail(new Error('语音服务连接已关闭（未收到完整音频）'));
    });
  });
}
