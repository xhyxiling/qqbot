/**
 * scope 提取工具
 *
 * 从 SDK 命令上下文中提取 scope + peerId。
 */
import type { SlashCommandHandlerContext } from '@tencent-connect/qqbot-nodejs';
import type { ChannelKind } from '../types.ts';

/**
 * 从命令上下文提取 scope + peerId
 */
export function getScopePeer(cmdCtx: SlashCommandHandlerContext): { scope: 'c2c' | 'group'; peerId: string } {
  const msg = cmdCtx.message;
  const scope = msg.kind === 'group' ? 'group' : 'c2c';
  const peerId = scope === 'group'
    ? ((msg as unknown as Record<string, unknown>).groupOpenid as string ?? msg.senderId)
    : msg.senderId;
  return { scope, peerId };
}

/**
 * 从命令上下文提取传输通道。
 *
 * 官方通道把 channel 挂在 ctx.replyTarget 上；OneBot 挂在 message.replyTarget 上。
 * 取不到时返回 undefined，由 SessionManager 按 id 形状推断。
 */
export function getCommandChannel(cmdCtx: SlashCommandHandlerContext): ChannelKind | undefined {
  const outer = (cmdCtx as unknown as { replyTarget?: { channel?: ChannelKind } }).replyTarget;
  if (outer?.channel !== undefined) return outer.channel;
  const inner = (cmdCtx.message as unknown as { replyTarget?: { channel?: ChannelKind } }).replyTarget;
  return inner?.channel;
}
