/**
 * qqbot_view_person — 按需查看某位群友的本地发言档案
 *
 * 设计目标：不再在后台自动生成「群友人格」，也不把分析结果写进设置面板。
 * 档案只作为工具的数据源，模型在需要了解当前对话对象时调用本工具，
 * owner/admin 也可以通过自然语言指定昵称或 QQ 号查看其他人。
 *
 * 返回的是可核对的统计与最近发言摘要，不做性格/心理推断：
 * - 总消息数、会话数、首次/最近时间；
 * - 按会话分布（群 / 私聊）；
 * - 最近 N 条发言原文（截断过长内容）。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import { isOwnerOrAdmin } from '../identity/role.ts';
import type { SessionModelLookup, ToolsRegistryLike } from './model-route.ts';
import {
  personaArchiveKey,
  type ArchiveMemberChat,
  type ArchiveMemberSummary,
  type PersonaArchive,
} from './persona-archive.ts';

/** 工具名 */
export const PERSON_SUMMARY_TOOL_NAME = 'qqbot_view_person';

/** 一个可查看的对象（发送者 + 跨会话统计） */
export interface SummaryTarget {
  senderId: string;
  senderName?: string;
  messageCount: number;
  chats: ArchiveMemberChat[];
}

export interface SummaryTargetSelection {
  targets: SummaryTarget[];
  /** 昵称/前缀匹配到多人时非空 */
  ambiguous: SummaryTarget[];
}

function textOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** 档案成员 → 查看对象 */
export function memberToSummaryTarget(member: ArchiveMemberSummary): SummaryTarget {
  return {
    senderId: member.senderId,
    ...(member.senderName !== undefined ? { senderName: member.senderName } : {}),
    messageCount: member.count,
    chats: member.chats.map((chat) => ({ ...chat })),
  };
}

/**
 * 按昵称 / QQ 号查找对象。
 *
 * 匹配顺序：精确 id 或昵称 → id 前缀 → 昵称包含。
 * 任意一步命中多人时返回 ambiguous，由调用方提示补充更精确的 id。
 */
export function selectSummaryTargets(
  members: readonly ArchiveMemberSummary[],
  member?: string,
): SummaryTargetSelection {
  const all = members.map(memberToSummaryTarget);
  const needle = member?.trim().toLowerCase() ?? '';
  if (needle === '') return { targets: [], ambiguous: [] };

  const exact = all.filter((target) => target.senderId.toLowerCase() === needle
    || (target.senderName ?? '').toLowerCase() === needle);
  if (exact.length === 1) return { targets: exact, ambiguous: [] };
  if (exact.length > 1) return { targets: [], ambiguous: exact };

  const byIdPrefix = all.filter((target) => target.senderId.toLowerCase().startsWith(needle));
  if (byIdPrefix.length === 1) return { targets: byIdPrefix, ambiguous: [] };
  if (byIdPrefix.length > 1) return { targets: [], ambiguous: byIdPrefix };

  const byName = all.filter((target) => (target.senderName ?? '').toLowerCase().includes(needle));
  if (byName.length === 1) return { targets: byName, ambiguous: [] };
  if (byName.length > 1) return { targets: [], ambiguous: byName };

  return { targets: [], ambiguous: [] };
}

/** 展示名：昵称优先，没有昵称时用短 id */
export function summaryDisplayName(target: Pick<SummaryTarget, 'senderId' | 'senderName'>): string {
  const name = target.senderName?.trim();
  return name !== undefined && name !== '' ? name : shortId(target.senderId);
}

/** 短 id：保留首尾，便于在群里辨认又不刷屏 */
export function shortId(id: string): string {
  return id.length <= 12 ? id : `${id.slice(0, 6)}…${id.slice(-4)}`;
}

/** 候选对象的一行说明 */
export function describeSummaryTargets(targets: readonly SummaryTarget[]): string {
  return targets
    .slice(0, 10)
    .map((target) => `${summaryDisplayName(target)}（${shortId(target.senderId)}，${target.messageCount} 条）`)
    .join('、');
}

function formatTime(ts: number): string {
  const date = new Date(ts);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `qqbot:<namespace>:<scope>:<peerId>` → 「群 123」/「私聊 123」 */
function chatLabel(chatKey: string): string {
  const parts = chatKey.split(':');
  const scope = parts[parts.length - 2];
  const peer = parts[parts.length - 1] ?? chatKey;
  return scope === 'group' ? `群 ${peer}` : `私聊 ${peer}`;
}

function truncate(text: string, max = 160): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max)}…`;
}

/**
 * 生成某人的档案摘要。
 *
 * 最近发言跨会话合并后按时间倒序取前 N 条；只读本地档案，不调用模型。
 */
export function buildPersonSummaryText(input: {
  archive: PersonaArchive;
  target: SummaryTarget;
  currentChatKey?: string;
  limit?: number;
}): string {
  const { archive, target } = input;
  const limit = Math.max(1, Math.min(20, Math.trunc(input.limit ?? 8)));

  const chatStats = target.chats.length > 0
    ? target.chats
    : archive.chatsForSender(target.senderId);
  const firstAt = chatStats.length > 0 ? Math.min(...chatStats.map((chat) => chat.firstAt)) : undefined;
  const lastAt = chatStats.length > 0 ? Math.max(...chatStats.map((chat) => chat.lastAt)) : undefined;

  const recent = chatStats
    .flatMap((chat) => archive.listBySender(chat.chatKey, target.senderId))
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, limit);

  const currentCount = input.currentChatKey === undefined
    ? undefined
    : chatStats.find((chat) => chat.chatKey === input.currentChatKey)?.count;

  const lines: string[] = [
    `# ${summaryDisplayName(target)} 的发言档案`,
    '',
    `- 本地档案共 ${target.messageCount} 条，分布在 ${chatStats.length} 个会话`
      + `${currentCount !== undefined ? `（当前会话 ${currentCount} 条）` : ''}`,
    ...(firstAt !== undefined ? [`- 最早：${formatTime(firstAt)}`] : []),
    ...(lastAt !== undefined ? [`- 最近：${formatTime(lastAt)}`] : []),
    '',
    '## 会话分布',
    ...chatStats.slice(0, 8).map((chat) => `- ${chatLabel(chat.chatKey)}：${chat.count} 条`),
    ...(chatStats.length > 8 ? [`- 其余 ${chatStats.length - 8} 个会话未展开`] : []),
    '',
    `## 最近 ${recent.length} 条发言`,
    ...(recent.length === 0
      ? ['- 没有可展示的发言']
      : recent.map((message) => `- [${formatTime(message.timestamp)}] ${truncate(message.content)}`)),
    '',
    '> 只统计机器人收到并写入本地档案的消息；档案未开启或被清理时可能不完整。',
  ];

  return lines.join('\n');
}

/** 注册 qqbot_view_person（档案未启用时仍注册，调用时返回可操作提示） */
export function registerPersonSummaryTool(
  ctx: Context,
  options: {
    manager: SessionModelLookup;
    config: ImQQBotConfig;
    archive?: PersonaArchive;
    logger: Logger;
  },
): void {
  const { manager, config, archive, logger } = options;
  const tools = ctx.get('tools') as ToolsRegistryLike | undefined;
  if (!tools?.register) {
    logger.warn(`im-qqbot: tools 服务不可用，${PERSON_SUMMARY_TOOL_NAME} 工具未注册`);
    return;
  }

  const definition = {
    name: PERSON_SUMMARY_TOOL_NAME,
    description:
      'View a QQ member\'s local chat archive summary: message counts, chats, first/last time, '
      + 'and the most recent messages. Use when you need to recall what the person you are talking to '
      + 'said before, or when the owner asks to look up someone by nickname or QQ number. '
      + 'This tool returns stored evidence only; it does not generate a personality profile. '
      + 'Omit `member` to view the current conversation partner. Non-owner users may only view themselves.',
    parameters: {
      type: 'object',
      properties: {
        member: {
          type: 'string',
          description: 'Nickname or QQ number to look up. Omit to view the current conversation partner.',
        },
        limit: {
          type: 'number',
          description: 'How many recent messages to show, 1-20. Default 8.',
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          senderId: { type: 'string' },
          senderName: { type: 'string' },
          messageCount: { type: 'number' },
          chatCount: { type: 'number' },
        },
        required: ['text', 'senderId', 'senderName', 'messageCount', 'chatCount'],
        additionalProperties: false,
      },
      render: (_args: unknown, value: unknown): ContentBlock[] => [
        { type: 'text', text: (value as { text: string }).text },
      ],
    },
    async execute(args: unknown, exec: { signal: AbortSignal; agent?: unknown }): Promise<Record<string, unknown>> {
      const fields = (args ?? {}) as Record<string, unknown>;
      const member = textOrUndefined(fields.member);
      const rawLimit = typeof fields.limit === 'number' ? fields.limit : undefined;

      if (config.personaAnalysis?.enabled === false || archive === undefined) {
        throw new Error(
          `${PERSON_SUMMARY_TOOL_NAME}: 本地发言档案未启用。`
          + '请在配置中打开 personaAnalysis.enabled 后重启插件。',
        );
      }

      const record = exec.agent === undefined ? undefined : manager.findByAgent(exec.agent as never);
      if (record === undefined) {
        throw new Error(`${PERSON_SUMMARY_TOOL_NAME}: 只能在 QQ 会话里查看（找不到当前会话）`);
      }

      const members = archive.membersAll();
      if (members.length === 0) {
        throw new Error(
          `${PERSON_SUMMARY_TOOL_NAME}: 还没有归档的聊天记录。`
          + '档案只从启用后开始积累，先聊一段时间再试。',
        );
      }

      const currentChatKey = personaArchiveKey(config.appId, record.scope, record.peerId);
      const scoped = members.filter((item) => item.chats.some((chat) => chat.chatKey === currentChatKey));

      let target: SummaryTarget | undefined;
      if (member === undefined) {
        // 默认查当前对话对象：群聊里就是刚发言的人，私聊里就是对方
        const own = members.find((item) => item.senderId
          === (record.scope === 'c2c' ? record.peerId : record.senderId));
        target = own !== undefined ? memberToSummaryTarget(own) : undefined;
        if (target === undefined && scoped.length > 0) {
          target = memberToSummaryTarget(scoped[0]!);
        }
        if (target === undefined) {
          throw new Error(
            `${PERSON_SUMMARY_TOOL_NAME}: 当前会话还没有归档记录。先在群里聊一段时间再试。`,
          );
        }
      } else {
        const selection = selectSummaryTargets(members, member);
        if (selection.ambiguous.length > 0) {
          throw new Error(
            `${PERSON_SUMMARY_TOOL_NAME}: 「${member}」匹配到多位群友：`
            + `${describeSummaryTargets(selection.ambiguous)}。请用完整昵称或 QQ 号重新指定。`,
          );
        }
        if (selection.targets.length === 0) {
          throw new Error(
            `${PERSON_SUMMARY_TOOL_NAME}: 没有找到「${member}」的发言。`
            + `档案里有记录的群友：${describeSummaryTargets(members.map(memberToSummaryTarget))}`,
          );
        }
        target = selection.targets[0]!;
        // 当前对话对象本人可以查自己；查别人需要 owner/admin
        if (target.senderId !== record.senderId
          && !isOwnerOrAdmin(record.senderId, config.identity)) {
          throw new Error(`${PERSON_SUMMARY_TOOL_NAME}: 只有主人或管理员才能查看其他人的资料。`);
        }
      }

      const text = buildPersonSummaryText({
        archive,
        target,
        currentChatKey,
        ...(rawLimit !== undefined ? { limit: rawLimit } : {}),
      });
      logger.info(
        `im-qqbot: ${PERSON_SUMMARY_TOOL_NAME} sender=${shortId(target.senderId)} `
        + `messages=${target.messageCount} chats=${target.chats.length}`,
      );

      return {
        text,
        senderId: target.senderId,
        senderName: summaryDisplayName(target),
        messageCount: target.messageCount,
        chatCount: target.chats.length,
      };
    },
  };

  tools.register(definition);
  logger.info(`im-qqbot: ${PERSON_SUMMARY_TOOL_NAME} 工具已注册（数据源：本地发言档案）`);
}
