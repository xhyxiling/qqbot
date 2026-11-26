/**
 * 传输层装配契约 — official（QQ 开放平台）与 onebot（普通 QQ 号）
 * 对上暴露同一套发送接口，bootstrap 只负责共享功能与生命周期。
 */
import type { QQBotSender } from '../transport/outbound-buffer.ts';
import type { MediaSenderLike } from '../media/send-media.ts';

export interface GatewayTransport {
  /** 文本/markdown 发送器 */
  sender: QQBotSender;
  /** 图片/视频/语音/文件发送器 */
  mediaSender: MediaSenderLike;
  /** 启动传输层（连接网关 / WebSocket） */
  start(): Promise<void>;
  /** 停止传输层（断开连接，不等待在途消息） */
  stop(): void;
}
