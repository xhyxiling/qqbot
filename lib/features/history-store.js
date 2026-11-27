/**
 * 群历史存储共享模块
 *
 * historyBuffer 中间件需要一个跨调用可访问的 HistoryStore 实例，
 * 以便在回复完成后清空某群的历史缓存（避免下次 @ 时重复组包）。
 *
 * 这里额外支持「媒体路径回填」：附件下载发生在历史记录之后，
 * 下载完成后把本地路径补进刚写的那条历史，模型下次被 @ 时
 * 才能看到群里之前发过的图，而不只是一个 [图片]。
 */
import { MemoryHistoryStore } from '@tencent-connect/qqbot-nodejs';
class MediaHistoryStore extends MemoryHistoryStore {
    /** 把媒体本地路径补进指定消息（按 messageId 定位，找不到就跳过） */
    appendMedia(groupKey, messageId, lines) {
        const buffers = this.buffers;
        const entry = buffers.get(groupKey)?.find((item) => item.messageId === messageId);
        if (entry === undefined)
            return;
        const suffix = lines.join(' ');
        entry.content = entry.content === '' ? suffix : `${entry.content} ${suffix}`;
    }
}
let _store = null;
/** 获取共享历史存储（单例） */
export function getHistoryStore() {
    if (!_store)
        _store = new MediaHistoryStore();
    return _store;
}
/** 用 appId 前缀隔离群历史（单账号下等价于 groupOpenid，保留多账号扩展） */
export function historyGroupKey(appId, groupId) {
    return `${appId}:${groupId}`;
}
/** 把媒体本地路径回填到刚记录的历史条目（未 @ 的消息也要能被后续上下文看到） */
export function appendHistoryMedia(groupKey, messageId, lines) {
    _store?.appendMedia(groupKey, messageId, lines);
}
/** 清空群历史（回复后调用，避免下次 @ 时重复组包） */
export function clearGroupHistory(appId, groupId) {
    _store?.clear?.(historyGroupKey(appId, groupId));
}
//# sourceMappingURL=history-store.js.map