/**
 * 多通道发送器 — 按 ReplyTarget.channel 把发送路由到对应传输层
 *
 * 双后端并行（backend=both）时，插件只维护一份 SessionManager / 一套工具与
 * 问答通道；每个会话的 replyTarget 带上创建它的通道标记，所有出站（正常回复、
 * 工具发文件、表情、语音、交付物、问答/审批）都经这里分发。
 */
import type { InlineKeyboard } from '@tencent-connect/qqbot-nodejs';
import type { ChannelKind, Logger, ReplyTarget } from '../types.ts';
import type { MediaSendResult, MediaSenderLike } from '../media/send-media.ts';
import type { QQBotSender, StreamSessionLike } from '../transport/outbound-buffer.ts';

export interface ChannelEndpoint {
  sender: QQBotSender;
  mediaSender: MediaSenderLike;
}

export class MultiplexSender implements QQBotSender, MediaSenderLike {
  private readonly endpoints: ReadonlyMap<ChannelKind, ChannelEndpoint>;
  private readonly fallback: ChannelKind;
  private readonly logger: Logger;

  public constructor(
    endpoints: ReadonlyMap<ChannelKind, ChannelEndpoint>,
    fallback: ChannelKind,
    logger: Logger,
  ) {
    this.endpoints = endpoints;
    this.fallback = fallback;
    this.logger = logger;
  }

  /** 目标通道缺失时回退到默认通道（例如历史会话未带通道标记） */
  private pick(target: ReplyTarget): ChannelEndpoint {
    const wanted = target.channel ?? this.fallback;
    const endpoint = this.endpoints.get(wanted) ?? this.endpoints.get(this.fallback);
    if (endpoint === undefined) {
      throw new Error(`没有可用的 ${wanted} 发送通道`);
    }
    if (target.channel !== undefined && !this.endpoints.has(target.channel)) {
      this.logger.warn(`im-qqbot: 通道 ${target.channel} 未启用，回退到 ${this.fallback}`);
    }
    return endpoint;
  }

  public sendMarkdown(
    target: ReplyTarget,
    content: string,
    opts?: { keyboard?: InlineKeyboard },
  ): Promise<unknown> {
    return this.pick(target).sender.sendMarkdown(target, content, opts);
  }

  public openStream(target: ReplyTarget): StreamSessionLike {
    return this.pick(target).sender.openStream(target);
  }

  public sendImage(
    target: ReplyTarget,
    source: { localPath?: string },
    opts?: { reply?: boolean },
  ): Promise<MediaSendResult> {
    return this.pick(target).mediaSender.sendImage(target, source, opts);
  }

  public sendVideo(target: ReplyTarget, source: { localPath?: string }): Promise<MediaSendResult> {
    return this.pick(target).mediaSender.sendVideo(target, source);
  }

  public sendVoice(target: ReplyTarget, source: { localPath?: string }): Promise<MediaSendResult> {
    return this.pick(target).mediaSender.sendVoice(target, source);
  }

  public sendFile(
    target: ReplyTarget,
    source: { localPath?: string },
    opts?: { fileName?: string },
  ): Promise<MediaSendResult> {
    return this.pick(target).mediaSender.sendFile(target, source, opts);
  }
}
