/**
 * 富媒体下载中间件 — 在中间件链中下载 image/video/file 附件
 *
 * 结果写入 ctx.state.downloadedFiles，供 handleInbound 读取。
 * 下载失败不阻断消息（记录告警后放行），确保附件异常不影响正常文本处理。
 */
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import { downloadMediaAttachments } from '../transport/attachment.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger, QuotedAttachment, RawAttachment } from '../types.ts';

export function attachmentProcessor(
  config: ImQQBotConfig,
  logger: Logger,
  options: {
    allowInsecureMedia?: boolean;
    /** 是否下载当前消息附件（默认 true）；门控前那趟只收当前消息 */
    downloadCurrent?: boolean;
    /** 是否下载引用消息附件（默认 true）；门控后那趟只补引用 */
    downloadQuote?: boolean;
  } = {},
) {
  const downloadCurrent = options.downloadCurrent !== false;
  const downloadQuote = options.downloadQuote !== false;
  return async (ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> => {
    const msg = ctx.message as { attachments?: RawAttachment[] };

    try {
      // 当前消息附件
      if (downloadCurrent) {
        const downloaded = await downloadMediaAttachments(msg.attachments, config.media, logger, {
          allowHttp: options.allowInsecureMedia === true,
        });
        ctx.state.downloadedFiles = downloaded;
      }

      // 引用消息附件：转成 RawAttachment 结构复用下载（voice 由 downloadMediaAttachments 自动跳过）
      const quoteAttachments = (ctx.state as { quote?: { attachments?: QuotedAttachment[] } }).quote?.attachments;
      if (downloadQuote && quoteAttachments && quoteAttachments.length > 0) {
        const rawQuote = quoteAttachments
          .filter(a => a.url)
          .map((a): RawAttachment => ({
            content_type: a.contentType ?? '',
            filename: a.filename ?? '',
            size: 0,
            url: a.url as string,
          }));
        const downloadedQuote = await downloadMediaAttachments(rawQuote, config.media, logger, {
          allowHttp: options.allowInsecureMedia === true,
        });
        ctx.state.downloadedQuoteFiles = downloadedQuote;
      }
    } catch (err) {
      logger.warn(`im-qqbot: attachment download failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    await next();
  };
}
