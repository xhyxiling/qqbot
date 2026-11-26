/**
 * 群历史媒体回填中间件
 *
 * 位置在「当前消息附件下载」之后、@ 门控之前：群里没 @ 机器人的消息也会
 * 下载图片/视频/文件，并把本地路径补进历史条目。这样后面有人 @ 机器人
 * 时，模型能看到之前群里发过的图，而不只是文字和一个 [图片] 占位。
 *
 * 每条消息最多回填 {@link MAX_MEDIA_LINES} 条，避免九宫格刷屏。
 */
import type { MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import type { ImQQBotConfig } from '../config.ts';
import type { DownloadedFile } from '../transport/attachment.ts';
import { appendHistoryMedia, historyGroupKey } from '../features/history-store.ts';

/** 单条历史最多补充的媒体行数 */
const MAX_MEDIA_LINES = 4;

/** 下载结果 → 历史里的一行（与当前消息上下文里的写法保持一致） */
function mediaLine(file: DownloadedFile): string {
  switch (file.contentType) {
    case 'image':
      return `Image: ${file.localPath}`;
    case 'video':
      return `Video: ${file.localPath}`;
    default:
      return `File: ${file.localPath}`;
  }
}

export function historyMedia(config: ImQQBotConfig) {
  return async (ctx: MiddlewareContext, next: () => Promise<void>): Promise<void> => {
    const groupId = ctx.message.groupOpenid;
    if (ctx.message.kind === 'group' && groupId) {
      const files = (ctx.state as { downloadedFiles?: DownloadedFile[] }).downloadedFiles ?? [];
      if (files.length > 0) {
        appendHistoryMedia(
          historyGroupKey(config.appId, groupId),
          ctx.message.messageId,
          files.slice(0, MAX_MEDIA_LINES).map(mediaLine),
        );
      }
    }
    await next();
  };
}
