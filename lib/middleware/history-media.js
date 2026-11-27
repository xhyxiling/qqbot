import { appendHistoryMedia, historyGroupKey } from "../features/history-store.js";
/** 单条历史最多补充的媒体行数 */
const MAX_MEDIA_LINES = 4;
/** 下载结果 → 历史里的一行（与当前消息上下文里的写法保持一致） */
function mediaLine(file) {
    switch (file.contentType) {
        case 'image':
            return `Image: ${file.localPath}`;
        case 'video':
            return `Video: ${file.localPath}`;
        default:
            return `File: ${file.localPath}`;
    }
}
export function historyMedia(config) {
    return async (ctx, next) => {
        const groupId = ctx.message.groupOpenid;
        if (ctx.message.kind === 'group' && groupId) {
            const files = ctx.state.downloadedFiles ?? [];
            if (files.length > 0) {
                appendHistoryMedia(historyGroupKey(config.appId, groupId), ctx.message.messageId, files.slice(0, MAX_MEDIA_LINES).map(mediaLine));
            }
        }
        await next();
    };
}
//# sourceMappingURL=history-media.js.map