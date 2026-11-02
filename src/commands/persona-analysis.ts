/**
 * Persona 分析命令：/人格分析 — 当场分析被 @ 的群友
 *
 * 触发优先级：
 *   1. 消息里 @ 了谁就分析谁（群消息的 mentions 带 member_openid，最稳，不怕重名）
 *   2. 没有 @ 时按参数（昵称 / openid）匹配，作为兜底
 *   3. 私聊里没有 @ 时分析对面这个人
 *
 * 与 `qqbot_analyze_persona` 工具共用 `persona-analyzer.ts`：按 openid 合并该成员在
 * 所有群 / 私聊里的发言，模型输出结构化 JSON，成功结果写入人格库（设置面板可见）。
 * 命令直接返回 Markdown，不依赖模型是否愿意调工具。
 */
import { getScopePeer, sendMarkdownChunked } from '../shared/index.ts';
import { personaArchiveKey } from '../features/persona-archive.ts';
import {
  describeTargets,
  memberToTarget,
  selectAnalysisTargets,
  type AnalysisTarget,
} from '../features/persona-analysis-tool.ts';
import { analyzeSenderProfile, loadSenderChats } from '../features/persona-analyzer.ts';
import { formatProfileMarkdown, displayName, shortId } from '../features/persona-profile-analysis.ts';
import type { ModelRoute } from '../features/model-route.ts';
import type { CommandDeps, CategorizedCommand } from './types.ts';

/** 从 @ 列表/内容里解析出的目标 */
export interface MentionedMember {
  senderId: string;
  senderName?: string;
}

/** 取第一个非空字符串 */
function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed !== '') return trimmed;
  }
  return undefined;
}

/**
 * 从消息的 @ 列表里挑出「被 @ 的群友」。
 *
 * - 跳过机器人自己（`is_you` / `bot`）与 `@全体成员`；
 * - 群消息用 `member_openid`，私聊/其它载荷退到 `user_openid` / `id`；
 * - 兼容没有 mentions 字段的载荷：从正文 `<@!openid>` 标记兜底
 *   （内容清洗只去掉机器人的标记，其他人保留）。
 */
export function pickMentionedMember(
  mentions: readonly Record<string, unknown>[] | undefined,
  appId: string,
  content?: string,
): MentionedMember | undefined {
  for (const item of mentions ?? []) {
    if (item['is_you'] === true || item['bot'] === true) continue;
    const senderId = firstString(item['member_openid'], item['user_openid'], item['id']);
    if (senderId === undefined || senderId === appId || senderId === 'all') continue;
    const senderName = firstString(item['nickname'], item['username']);
    return { senderId, ...(senderName !== undefined ? { senderName } : {}) };
  }

  // mentions 存在但只有机器人/全体时，说明 @ 列表是可信的，不再猜正文
  if ((mentions ?? []).length > 0) return undefined;

  const markers = [...(content ?? '').matchAll(/<@!?([^>]+)>/g)]
    .map((match) => (match[1] ?? '').trim())
    .filter((id) => id !== '' && id !== appId && id !== 'all');
  const first = markers[0];
  return first === undefined ? undefined : { senderId: first };
}

/** 命令里的模型路由：会话当前路由 > 配置默认 */
function resolveCommandRoute(
  deps: CommandDeps,
  scope: 'group' | 'c2c',
  peerId: string,
): ModelRoute | undefined {
  const route = deps.manager.getEffectiveModel(scope, peerId);
  if (route?.provider && route.model) return { provider: route.provider, model: route.model };
  if (deps.config.provider && deps.config.model) {
    return { provider: deps.config.provider, model: deps.config.model };
  }
  return undefined;
}

/** 洗成可放进 qqbot-cmd-input show 属性的文本 */
function safeAttr(text: string): string {
  return text.replace(/["<>\r\n]/g, ' ').trim();
}

/** 没有指定对象时的用法提示（附活跃群友的快捷入口） */
function buildUsageMarkdown(targets: readonly AnalysisTarget[]): string {
  const lines = [
    '### 🧭 人格分析用法',
    '',
    '在群里先 **@ 要分析的那个人**，再发命令：',
    '`@机器人 /人格分析`',
    '',
    '> 只按 @ 匹配，昵称重名也不会认错人；不想 @ 时可以用 `/人格分析 <昵称或 openid>`。',
  ];
  const shown = targets.slice(0, 5);
  if (shown.length > 0) {
    lines.push('', '**档案里的活跃群友（点击直接分析）:**');
    for (const target of shown) {
      const label = `${displayName(target)} · ${target.messageCount} 条`;
      lines.push(
        `<qqbot-cmd-input text="/人格分析 ${target.senderId}" show="${safeAttr(label)}"/>`,
      );
    }
    if (targets.length > shown.length) {
      lines.push('', `_（只列出前 ${shown.length} 位，共 ${targets.length} 位）_`);
    }
  }
  lines.push('', '> 档案只记录机器人运行期间（功能开启后）的发言，新群友要先聊几句。');
  return lines.join('\n');
}

export function personaAnalysisCommand(deps: CommandDeps): CategorizedCommand {
  return {
    name: ['人格分析', 'persona-analysis'],
    category: 'qqbot',
    description: '分析被 @ 的群友人格（用法: @机器人 /人格分析 @某人）',
    scope: 'all',
    minRole: 'admin',
    handler: async (cmdCtx) => {
      const { scope, peerId } = getScopePeer(cmdCtx);
      const services = deps.persona;

      if (deps.config.personaAnalysis?.enabled === false || services === undefined) {
        return '群友人格档案未启用。请在设置面板「群友人格」页签打开「群聊人格档案」并保存后重试。';
      }
      if (services.llm?.stream === undefined) {
        return '人格分析需要 llm 服务，当前宿主没有提供，暂时无法分析。';
      }

      const { archive, profiles, llm } = services;
      const members = archive.membersAll();
      if (members.length === 0) {
        return '还没有归档的聊天记录。档案只从功能开启后开始积累，先在群里聊一段时间再试。';
      }

      const mention = pickMentionedMember(
        cmdCtx.message.mentions as readonly Record<string, unknown>[] | undefined,
        deps.config.appId,
        cmdCtx.message.content,
      );
      const arg = (cmdCtx.command.raw ?? '').trim();

      let target: AnalysisTarget;
      if (mention !== undefined) {
        const hit = members.find((member) => member.senderId === mention.senderId);
        if (hit === undefined) {
          return `⚠️ 档案里还没有 @ 的这位群友的发言。\n只在机器人运行、档案开启之后的发言会被记录，先让 TA 聊两句再试。`;
        }
        target = memberToTarget(hit);
      } else if (arg !== '') {
        const selection = selectAnalysisTargets(members, arg);
        if (selection.ambiguous.length > 0) {
          return `⚠️「${arg}」匹配到多位群友：${describeTargets(selection.ambiguous)}。\n建议直接 @ 要分析的那个人再发一次命令。`;
        }
        if (selection.targets.length === 0) {
          return `⚠️ 没有找到「${arg}」的发言。\n档案里有记录的群友：${describeTargets(members.map(memberToTarget))}`;
        }
        target = selection.targets[0]!;
      } else if (scope === 'c2c') {
        const self = members.find((member) => member.senderId === peerId);
        if (self === undefined) {
          return '⚠️ 档案里还没有你在私聊里的发言记录，先聊两句再试。';
        }
        target = memberToTarget(self);
      } else {
        const currentChatKey = personaArchiveKey(deps.config.appId, 'group', peerId);
        const scoped = members
          .filter((member) => member.chats.some((chat) => chat.chatKey === currentChatKey))
          .map(memberToTarget);
        await sendMarkdownChunked(
          cmdCtx,
          buildUsageMarkdown(scoped),
          deps.config.textChunkLimit,
        );
        return { kind: 'noop' as const };
      }

      const route = resolveCommandRoute(deps, scope, peerId);
      if (route === undefined) {
        return '⚠️ 无法确定使用的模型，请先在配置里设置 provider/model，或在会话里用 /model 指定。';
      }

      const chats = loadSenderChats(archive, target.senderId);
      if (chats.length === 0) {
        return '⚠️ 没有找到可以分析的消息（档案可能已被清理）。';
      }

      try {
        const result = await analyzeSenderProfile({
          llm,
          route,
          senderId: target.senderId,
          ...(target.senderName !== undefined ? { senderName: target.senderName } : {}),
          chats,
          signal: cmdCtx.signal,
        });

        const analyzedAt = Date.now();
        const senderName = target.senderName ?? displayName(target);
        profiles.upsert({
          senderId: target.senderId,
          ...(target.senderName !== undefined ? { senderName: target.senderName } : {}),
          analysis: result.analysis,
          analyzedMessageCount: result.messageCount,
          analyzedChatCount: result.chatCount,
          analyzedAt,
          provider: result.provider,
          model: result.model,
          lastAttemptAt: analyzedAt,
        });

        const firstAt = target.chats.length > 0
          ? Math.min(...target.chats.map((chat) => chat.firstAt))
          : undefined;
        const lastAt = target.chats.length > 0
          ? Math.max(...target.chats.map((chat) => chat.lastAt))
          : undefined;
        const text = [
          `# ${senderName} 的人格档案`,
          '',
          formatProfileMarkdown(result.analysis, {
            messageCount: result.messageCount,
            chatCount: result.chatCount,
            ...(firstAt !== undefined ? { firstAt } : {}),
            ...(lastAt !== undefined ? { lastAt } : {}),
          }),
          '',
          '---',
          `结果已写入本地人格档案（openid ${shortId(target.senderId)}），可在设置面板「群友人格」页签查看与筛选。`,
        ].join('\n');

        await sendMarkdownChunked(cmdCtx, text, deps.config.textChunkLimit);
        return { kind: 'noop' as const };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return `⚠️ 分析失败：${message}`;
      }
    },
  };
}
