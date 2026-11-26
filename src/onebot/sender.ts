/**
 * OneBot 发送适配器
 *
 * 同一个对象承担三个角色，避免官方/本地两套发送链路分叉：
 *   - QQBotSender（出站路由、问答通道、工具结果）
 *   - MediaSenderLike（qqbot_send_file、present 交付物、语音）
 *   - 中间件门面（appId / sendText / sendTyping）
 *
 * QQ 普通消息不支持 Markdown 渲染，发送前统一降级为纯文本。
 */
import { readFile } from 'node:fs/promises';
import type { InlineKeyboard } from '@tencent-connect/qqbot-nodejs';
import type { Logger, ReplyTarget } from '../types.ts';
import type { MediaSendResult, MediaSenderLike } from '../media/send-media.ts';
import type { QQBotSender, StreamSessionLike } from '../transport/outbound-buffer.ts';
import type { OneBotClient } from './client.ts';

/** OneBot 消息段（发送用） */
interface OutSegment {
  type: string;
  data: Record<string, unknown>;
}

/** 把 10 位以上纯数字 id 还原成 number（NapCat 两种都接受，number 更通用） */
function toId(value: string): number | string {
  return /^\d{1,15}$/.test(value) ? Number(value) : value;
}

/** 本地绝对路径 → file:// URI（NapCat 读取本机文件用） */
function toFileUri(filePath: string): string {
  const posix = filePath.replace(/\\/g, '/');
  return posix.startsWith('/') ? `file://${posix}` : `file:///${posix}`;
}

/**
 * Markdown → 纯文本（QQ 普通消息不渲染 Markdown）
 *
 * 重点处理 `<qqbot-cmd-input show="..."/>` 这类插件自定义标签，
 * 否则用户会看到原始标签。表格与列表保持原样。
 */
export function stripMarkdown(text: string): string {
  let out = text;

  // 插件自定义可点击指令标签：保留 show 文本
  out = out.replace(/<qqbot-cmd-input\b[^>]*?\bshow="([^"]*)"[^>]*\/>/g, '$1');
  out = out.replace(/<qqbot-cmd-input\b[^>]*\/>/g, '');
  out = out.replace(/<\/?qqbot-[^>]*>/g, '');

  // 代码块围栏与行内代码
  out = out.replace(/```[a-zA-Z0-9_+-]*\n?/g, '');
  out = out.replace(/`([^`\n]+)`/g, '$1');

  // 标题、引用、分隔线
  out = out.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  out = out.replace(/^\s{0,3}>\s?/gm, '');
  out = out.replace(/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '');

  // 强调
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '$1');
  out = out.replace(/__([^_\n]+)__/g, '$1');
  out = out.replace(/~~([^~\n]+)~~/g, '$1');
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2');
  // 下划线斜体：仅在词边界生效，避免破坏 snake_case 与 id
  out = out.replace(/(?<![\w])_([^_\n]+)_(?![\w])/g, '$1');

  // 链接与图片
  out = out.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '$1');
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1（$2）');

  return out.trim();
}

export interface OneBotBotOptions {
  client: OneBotClient;
  logger: Logger;
  /** 中间件门面读取用（mentionGate/contentSanitizer） */
  appId: string;
}

/** 发送结果归一化（send-media.ts 读取 upload.file_uuid） */
function toMediaResult(data: unknown): MediaSendResult {
  const payload = (data ?? {}) as { message_id?: unknown; file_id?: unknown };
  const id = payload.message_id !== undefined
    ? String(payload.message_id)
    : payload.file_id !== undefined
      ? String(payload.file_id)
      : '';
  return {
    upload: { file_uuid: id },
    ...(id !== '' ? { message: { id } } : {}),
  };
}

export class OneBotBot implements QQBotSender, MediaSenderLike {
  public readonly appId: string;
  private readonly client: OneBotClient;
  private readonly logger: Logger;

  public constructor(options: OneBotBotOptions) {
    this.client = options.client;
    this.logger = options.logger;
    this.appId = options.appId;
  }

  // ── 中间件门面 ──

  /** 中间件/命令直接发纯文本 */
  public async sendText(target: ReplyTarget, text: string): Promise<unknown> {
    return await this.sendPlain(target, text);
  }

  /** OneBot 没有「正在输入」接口，返回已解决 Promise 保持契约 */
  public async sendTyping(): Promise<void> {
    return;
  }

  // ── QQBotSender ──

  public async sendMarkdown(target: ReplyTarget, content: string, _opts?: { keyboard?: InlineKeyboard }): Promise<unknown> {
    return await this.sendPlain(target, stripMarkdown(content));
  }

  /** 不支持流式：返回空会话，真实文本由 OutboundBuffer 降级为静态发送 */
  public openStream(_target: ReplyTarget): StreamSessionLike {
    return {
      update: async () => undefined,
      complete: async () => undefined,
    };
  }

  // ── MediaSenderLike ──

  public async sendImage(target: ReplyTarget, source: { localPath?: string }, _opts?: { reply?: boolean }): Promise<MediaSendResult> {
    const buffer = await this.readFile(source.localPath);
    const data = await this.sendSegments(target, [
      { type: 'image', data: { file: `base64://${buffer.toString('base64')}` } },
    ]);
    return toMediaResult(data);
  }

  public async sendVideo(target: ReplyTarget, source: { localPath?: string }): Promise<MediaSendResult> {
    const filePath = this.requirePath(source.localPath);
    const data = await this.sendSegments(target, [
      { type: 'video', data: { file: toFileUri(filePath) } },
    ]);
    return toMediaResult(data);
  }

  public async sendVoice(target: ReplyTarget, source: { localPath?: string }): Promise<MediaSendResult> {
    const buffer = await this.readFile(source.localPath);
    const data = await this.sendSegments(target, [
      { type: 'record', data: { file: `base64://${buffer.toString('base64')}` } },
    ]);
    return toMediaResult(data);
  }

  public async sendFile(
    target: ReplyTarget,
    source: { localPath?: string },
    opts?: { fileName?: string },
  ): Promise<MediaSendResult> {
    const filePath = this.requirePath(source.localPath);
    const name = opts?.fileName ?? filePath.split(/[\\/]/).pop() ?? 'file';

    // 群文件走 upload_group_file，私聊走 upload_private_file
    const action = target.scope === 'group' ? 'upload_group_file' : 'upload_private_file';
    const params = target.scope === 'group'
      ? { group_id: toId(target.targetId), file: filePath, name }
      : { user_id: toId(target.targetId), file: filePath, name };

    const data = await this.client.call(action, params);
    return toMediaResult(data);
  }

  // ── 内部 ──

  private async sendPlain(target: ReplyTarget, text: string): Promise<unknown> {
    if (text.trim() === '') return undefined;
    return await this.sendSegments(target, [{ type: 'text', data: { text } }]);
  }

  private async sendSegments(target: ReplyTarget, segments: OutSegment[]): Promise<unknown> {
    const action = target.scope === 'group' ? 'send_group_msg' : 'send_private_msg';
    const params = target.scope === 'group'
      ? { group_id: toId(target.targetId), message: segments }
      : { user_id: toId(target.targetId), message: segments };

    try {
      return await this.client.call(action, params);
    } catch (err) {
      this.logger.error(`OneBot ${action} 失败: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  private requirePath(localPath: string | undefined): string {
    if (localPath === undefined || localPath === '') {
      throw new Error('缺少本地文件路径');
    }
    return localPath;
  }

  private async readFile(localPath: string | undefined): Promise<Buffer> {
    return await readFile(this.requirePath(localPath));
  }
}
