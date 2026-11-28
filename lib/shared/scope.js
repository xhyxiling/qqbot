/**
 * 从命令上下文提取 scope + peerId
 */
export function getScopePeer(cmdCtx) {
    const msg = cmdCtx.message;
    const scope = msg.kind === 'group' ? 'group' : 'c2c';
    const peerId = scope === 'group'
        ? (msg.groupOpenid ?? msg.senderId)
        : msg.senderId;
    return { scope, peerId };
}
/**
 * 从命令上下文提取传输通道。
 *
 * 官方通道把 channel 挂在 ctx.replyTarget 上；OneBot 挂在 message.replyTarget 上。
 * 取不到时返回 undefined，由 SessionManager 按 id 形状推断。
 */
export function getCommandChannel(cmdCtx) {
    const outer = cmdCtx.replyTarget;
    if (outer?.channel !== undefined)
        return outer.channel;
    const inner = cmdCtx.message.replyTarget;
    return inner?.channel;
}
//# sourceMappingURL=scope.js.map