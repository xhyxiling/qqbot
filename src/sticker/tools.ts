/**
 * 表情包工具注册 — 暴露 qqbot_pick_sticker / qqbot_save_sticker / qqbot_send_sticker 给模型
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { Logger, ReplyTarget } from '../types.ts';
import type { ImQQBotConfig } from '../config.ts';
import { sendMediaFile, type MediaSenderLike } from '../media/send-media.ts';
import { StickerEngine, type StickerSelectionContext, getLatestSessionAttachment } from './index.ts';
import { isOwnerOrAdmin } from '../identity/role.ts';
import type { Sticker } from './types.ts';
import { existsSync, statSync } from 'node:fs';

/** tools 服务本地最小接口（本项目内各工具文件各自定义一份） */
interface ToolsRegistryLike {
  register(definition: unknown): unknown;
}

/** SessionManager 最小投影（工具需要反查会话做权限门控） */
interface SessionManagerLike {
  findByAgent(agent: unknown): {
    sessionKey: string;
    senderId: string;
    scope: 'c2c' | 'group';
    peerId: string;
    replyTarget: ReplyTarget;
  } | undefined;
}

export const PICK_STICKER_TOOL_NAME = 'qqbot_pick_sticker';
export const SAVE_STICKER_TOOL_NAME = 'qqbot_save_sticker';
export const SEND_STICKER_TOOL_NAME = 'qqbot_send_sticker';
export const LIST_STICKERS_TOOL_NAME = 'qqbot_list_stickers';
export const UPDATE_STICKER_TOOL_NAME = 'qqbot_update_sticker';

export function registerStickerTools(
  ctx: Context,
  engine: StickerEngine,
  manager: SessionManagerLike,
  config: ImQQBotConfig,
  logger: Logger,
): void {
  const tools = ctx.get('tools') as ToolsRegistryLike | undefined;
  if (!tools?.register) {
    logger.warn('im-qqbot: tools 服务不可用，qqbot_pick_sticker 工具未注册');
    return;
  }

  // ── qqbot_pick_sticker ──
  tools.register({
    name: PICK_STICKER_TOOL_NAME,
    description:
      '从 dsh-qqbot 的表情包收藏库里挑选一个最适合当前话题/情绪的表情。'
      + '返回表情的本地文件路径，可以直接传给 qqbot_send_file 发送。'
      + '适合：想让 bot 发个应景的表情包回应群聊 / 私聊话题时使用。',
    parameters: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          description: '当前聊天话题/关键词，帮助选到应景的表情。可以是对话摘要或关键词。',
        },
        mood: {
          type: 'string',
          enum: ['happy', 'sad', 'angry', 'silly', 'serious', 'neutral'],
          description: '当前聊天氛围/情绪，帮助选到适合的表情。',
        },
      },
      required: [],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          picked: { type: 'boolean' },
          filePath: { type: 'string' },
          filename: { type: 'string' },
          id: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['picked'],
        additionalProperties: false,
      },
      render: (_args: unknown, value: unknown): ContentBlock[] => {
        const v = value as { picked: boolean; filePath?: string; filename?: string; reason?: string };
        if (!v.picked) {
          return [{ type: 'text', text: `没挑到合适的表情: ${v.reason ?? '表情库为空或频率限制'}` }];
        }
        return [{ type: 'text', text: `🎲 挑到了 ${v.filename} → ${v.filePath}` }];
      },
    },
    async execute(
      args: unknown,
      exec: { agent?: unknown },
    ): Promise<Record<string, unknown>> {
      // 权限门控：qqbot_pick_sticker 返回内部 filePath，owner/admin 才能用
      const record = exec.agent === undefined
        ? undefined
        : manager.findByAgent(exec.agent);
      if (record && !isOwnerOrAdmin(record.senderId, config.identity)) {
        return { picked: false, reason: '这个功能只有主人或管理员才能用哦～' };
      }

      const a = args as { topic?: string; mood?: string };

      const selCtx: StickerSelectionContext = {
        topic: a.topic ?? '',
        mood: a.mood as StickerSelectionContext['mood'],
        trigger: 'matching',
      };

      const sticker = engine.selector.pick(selCtx);
      if (!sticker) {
        const status = engine.evolver.getStatus();
        return { picked: false, reason: `表情库 ${status.total} 个，频率门控未通过` };
      }

      return {
        picked: true,
        filePath: sticker.filePath,
        filename: sticker.filename,
        id: sticker.id,
        reason: `热度 ${sticker.hotScore}, 标签 [${sticker.tags.join(',')}]`,
      };
    },
  });

  logger.info(`im-qqbot: ${PICK_STICKER_TOOL_NAME} 已注册`);
}

/**
 * 注册 qqbot_list_stickers — 查看图库里有哪些表情
 *
 * 只返回文件名/大小/标签/热度，不返回本地路径。
 * 主人/admin 才能调用（图库属于内部数据）。
 */
export function registerListStickerTool(
  ctx: Context,
  engine: StickerEngine,
  manager: SessionManagerLike,
  config: ImQQBotConfig,
  logger: Logger,
): void {
  const tools = ctx.get('tools') as ToolsRegistryLike | undefined;
  if (!tools?.register) return;

  tools.register({
    name: LIST_STICKERS_TOOL_NAME,
    description:
      '列出表情包收藏库里有哪些表情（编号、画面描述、标签、大小、热度）。'
      + '用户问“你的图库里有什么表情/收藏了多少张”时调用，也可用于挑选前确认编号。'
      + '⚠️ 只有主人（owner）或管理员（admin）能调用，普通成员会被拒绝。',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '最多返回多少条，默认 20，最大 50' },
      },
      required: [],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          listed: { type: 'boolean' },
          total: { type: 'number' },
          stickers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                no: { type: 'number' },
                filename: { type: 'string' },
                description: { type: 'string' },
                sizeKB: { type: 'number' },
                tags: { type: 'array', items: { type: 'string' } },
                hotScore: { type: 'number' },
                useCount: { type: 'number' },
              },
              required: ['no', 'filename', 'sizeKB', 'tags', 'hotScore', 'useCount'],
              additionalProperties: false,
            },
          },
          reason: { type: 'string' },
        },
        required: ['listed'],
        additionalProperties: false,
      },
      render: (_args: unknown, value: unknown): ContentBlock[] => {
        const v = value as {
          listed: boolean;
          total?: number;
          stickers?: Array<{
            no: number;
            filename: string;
            description?: string;
            sizeKB: number;
            tags: string[];
            hotScore: number;
            useCount: number;
          }>;
          reason?: string;
        };
        if (!v.listed) return [{ type: 'text', text: `看不了图库: ${v.reason ?? '未知原因'}` }];
        const items = v.stickers ?? [];
        if (items.length === 0) return [{ type: 'text', text: '图库还是空的，还没收藏任何表情。' }];

        // render 的输出才是模型真正看到的 tool result，必须给完整明细，不能只说总数
        const lines: string[] = [`图库共 ${v.total ?? items.length} 个表情（发送时传 sticker_no=编号 即可指定）：`];
        for (const s of items) {
          const desc = s.description?.trim() || '（无画面描述）';
          const tags = s.tags.length > 0 ? s.tags.join('、') : '（无标签）';
          lines.push(
            `#${s.no} ${desc}\n   标签: ${tags} | 热度 ${s.hotScore} | 用过 ${s.useCount} 次 | ${s.sizeKB}KB | 文件 ${s.filename}`,
          );
        }
        return [{ type: 'text', text: lines.join('\n') }];
      },
    },
    async execute(
      args: unknown,
      exec: { agent?: unknown },
    ): Promise<Record<string, unknown>> {
      const record = exec.agent === undefined
        ? undefined
        : manager.findByAgent(exec.agent);
      if (!record) {
        return { listed: false, reason: '只能在 QQ 会话里使用这个工具' };
      }

      if (!isOwnerOrAdmin(record.senderId, config.identity)) {
        return { listed: false, reason: '只有主人或管理员才能查看表情包图库' };
      }

      const rawLimit = Number((args as { limit?: number }).limit ?? 20);
      const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(50, Math.floor(rawLimit))) : 20;
      const all = engine.store.all();
      const stickers = engine.store.numbered().slice(0, limit).map(({ no, sticker: s }) => ({
        no,
        filename: s.filename,
        description: s.description ?? '',
        sizeKB: Math.round(s.size / 1024),
        tags: s.tags,
        hotScore: s.hotScore,
        useCount: s.useCount,
      }));
      return { listed: true, total: all.length, stickers };
    },
  });

  logger.info(`im-qqbot: ${LIST_STICKERS_TOOL_NAME} 已注册`);
}

/**
 * 注册 qqbot_update_sticker — 修正某张表情的描述 / 标签
 *
 * 用户发现某张图识别错了（比如"这几张黄团子其实是奶龙"）时，
 * 主人/admin 可以让模型直接改元数据，不用手动编辑 json。
 * 只改 description 和 tags，不动文件、不影响使用统计。
 */
export function registerUpdateStickerTool(
  ctx: Context,
  engine: StickerEngine,
  manager: SessionManagerLike,
  config: ImQQBotConfig,
  logger: Logger,
): void {
  const tools = ctx.get('tools') as ToolsRegistryLike | undefined;
  if (!tools?.register) return;

  tools.register({
    name: UPDATE_STICKER_TOOL_NAME,
    description:
      '修改图库里某个表情的画面描述和/或标签。'
      + '当用户指出某张表情识别错了（描述或标签不对）、要求修正时调用。'
      + '先用 qqbot_list_stickers 确认编号，再用本工具改。'
      + '⚠️ 只有主人（owner）或管理员（admin）能调用。',
    parameters: {
      type: 'object',
      properties: {
        sticker_no: { type: 'number', description: '要修改的表情编号（#N）' },
        description: { type: 'string', description: '新的画面描述（一句话，整体覆盖旧的）。不改描述就不传。' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '新的标签列表（整体替换旧的，最多 8 个）。不改标签就不传。',
        },
      },
      required: ['sticker_no'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          updated: { type: 'boolean' },
          no: { type: 'number' },
          description: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          reason: { type: 'string' },
        },
        required: ['updated'],
        additionalProperties: false,
      },
      render: (_args: unknown, value: unknown): ContentBlock[] => {
        const v = value as { updated: boolean; no?: number; description?: string; tags?: string[]; reason?: string };
        if (!v.updated) return [{ type: 'text', text: `改不了: ${v.reason ?? '未知原因'}` }];
        const parts = [`✅ 已更新 #${v.no} 的元数据`];
        if (v.description) parts.push(`描述: ${v.description}`);
        if (v.tags && v.tags.length > 0) parts.push(`标签: ${v.tags.join('、')}`);
        return [{ type: 'text', text: parts.join('\n') }];
      },
    },
    async execute(
      args: unknown,
      exec: { agent?: unknown },
    ): Promise<Record<string, unknown>> {
      const record = exec.agent === undefined ? undefined : manager.findByAgent(exec.agent);
      if (!record) {
        return { updated: false, reason: '只能在 QQ 会话里使用这个工具' };
      }

      // 权限门控：图库属于内部数据，只有主人/admin 能改
      if (!isOwnerOrAdmin(record.senderId, config.identity)) {
        return { updated: false, reason: '只有主人或管理员才能修改表情包元数据' };
      }

      const a = args as { sticker_no?: number; description?: string; tags?: string[] };
      if (typeof a.sticker_no !== 'number' || !Number.isFinite(a.sticker_no)) {
        return { updated: false, reason: '需要传 sticker_no（表情编号）' };
      }
      const sticker = engine.store.byNo(Math.floor(a.sticker_no));
      if (!sticker) {
        return { updated: false, reason: `没有 #${Math.floor(a.sticker_no)} 号表情，先用 qqbot_list_stickers 确认编号` };
      }

      const patch: Partial<Sticker> = {};
      const desc = a.description?.trim();
      if (desc !== undefined && desc.length > 0) patch.description = desc.slice(0, 60);

      let nextTags = sticker.tags;
      if (Array.isArray(a.tags)) {
        const cleaned: string[] = [];
        const seen = new Set<string>();
        for (const t of a.tags) {
          const tl = String(t).trim().toLowerCase();
          if (tl.length < 2 || tl.length > 20) continue;
          if (seen.has(tl)) continue;
          seen.add(tl);
          cleaned.push(tl);
        }
        nextTags = cleaned.slice(0, 8);
        patch.tags = nextTags;
      }

      if (Object.keys(patch).length === 0) {
        return { updated: false, reason: '没有传要修改的内容（description 或 tags 至少要给一个）' };
      }

      const updated = engine.store.update(sticker.id, patch);
      if (!updated) {
        return { updated: false, reason: '更新失败' };
      }
      await engine.store.flush();
      logger.info(`im-qqbot: ${UPDATE_STICKER_TOOL_NAME} 更新 #${Math.floor(a.sticker_no)} (${sticker.filename})`);

      return {
        updated: true,
        no: Math.floor(a.sticker_no),
        description: updated.description ?? '',
        tags: updated.tags,
      };
    },
  });

  logger.info(`im-qqbot: ${UPDATE_STICKER_TOOL_NAME} 已注册`);
}

/**
 * 注册 qqbot_send_sticker — 一步到位的组合工具
 *
 * 模型只需调用一次：同时挑表情 + 发送到当前会话。
 * 通过 exec.agent 反查当前会话，与 qqbot_send_file 共用发送逻辑。
 */
export function registerSendStickerTool(
  ctx: Context,
  engine: StickerEngine,
  mediaSender: MediaSenderLike,
  manager: SessionManagerLike,
  logger: Logger,
): void {
  const tools = ctx.get('tools') as ToolsRegistryLike | undefined;
  if (!tools?.register) return;

  tools.register({
    name: SEND_STICKER_TOOL_NAME,
    description:
      '从表情包收藏库挑选并直接发送一个应景的表情到当前 QQ 会话。'
      + '等于 qqbot_pick_sticker + qqbot_send_file 的组合，一次调用完成。'
      + '聊天中对方在开玩笑、吐槽、撒娇，或情绪很足时，可以主动调用，不需要对方要求。',
    parameters: {
      type: 'object',
      properties: {
        sticker_no: {
          type: 'number',
          description: '要发送的表情编号（系统提示里每张图前的 #N）。能确定哪张最合适时优先用这个，最精准。',
        },
        topic: { type: 'string', description: '当前聊天话题/关键词（不传 sticker_no 时用于自动匹配）' },
        mood: {
          type: 'string',
          enum: ['happy', 'sad', 'angry', 'silly', 'serious', 'neutral'],
          description: '当前聊天氛围/情绪（不传 sticker_no 时用于自动匹配）',
        },
      },
      required: [],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          sent: { type: 'boolean' },
          filename: { type: 'string' },
          description: { type: 'string' },
          fileUuid: { type: 'string' },
          messageId: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['sent'],
        additionalProperties: false,
      },
      render: (_args: unknown, value: unknown): ContentBlock[] => {
        const v = value as { sent: boolean; filename?: string; description?: string; reason?: string };
        if (!v.sent) return [{ type: 'text', text: `没发出去: ${v.reason ?? '未知原因'}` }];
        const desc = v.description ? `（${v.description}）` : '';
        return [{ type: 'text', text: `🎨 已发送表情${desc} ${v.filename}` }];
      },
    },
    async execute(
      args: unknown,
      exec: { agent?: unknown },
    ): Promise<Record<string, unknown>> {
      const record = exec.agent === undefined
        ? undefined
        : manager.findByAgent(exec.agent);
      if (!record) {
        return { sent: false, reason: '只能在 QQ 会话里使用这个工具' };
      }

      const replyTarget = record.replyTarget;
      const a = args as { sticker_no?: number; topic?: string; mood?: string };

      // 指定编号时直接按编号取，最精准；否则退回话题/情绪自动匹配
      let sticker: Sticker | undefined;
      if (typeof a.sticker_no === 'number' && Number.isFinite(a.sticker_no)) {
        sticker = engine.store.byNo(Math.floor(a.sticker_no));
        if (!sticker) {
          return { sent: false, reason: `没有 #${Math.floor(a.sticker_no)} 号表情，可以先用 qqbot_list_stickers 确认编号` };
        }
      } else {
        sticker = engine.selector.pick({
          topic: a.topic ?? '',
          mood: a.mood as StickerSelectionContext['mood'],
          trigger: 'matching',
        }) ?? undefined;
      }

      if (!sticker) {
        return { sent: false, reason: '没挑到合适的表情' };
      }

      if (!existsSync(sticker.filePath)) {
        return { sent: false, reason: `文件已不存在: ${sticker.filePath}` };
      }

      // 先试主动消息（不带 msg_id，群里不会 @ 人）；没有主动权限时降级为被动回复（会 @ 触发者）
      let result = await sendMediaFile(mediaSender, replyTarget, sticker.filePath);
      if (result.outcome === 'failed') {
        const fallback = await sendMediaFile(mediaSender, replyTarget, sticker.filePath, { asReply: true });
        if (fallback.outcome !== 'missing') result = fallback;
      }
      if (result.outcome === 'missing') {
        return { sent: false, reason: `文件不存在或不可读: ${sticker.filePath}` };
      }
      if (result.outcome === 'failed') {
        return { sent: false, reason: `发送失败: ${result.error}` };
      }

      logger.info(`im-qqbot: qqbot_send_sticker 发送 ${sticker.filename} (${result.size} bytes) → ${replyTarget.scope}:${replyTarget.targetId}`);
      return {
        sent: true,
        filename: sticker.filename,
        description: sticker.description ?? '',
        fileUuid: result.fileUuid ?? '',
        ...(result.messageId !== undefined ? { messageId: result.messageId } : {}),
      };
    },
  });

  logger.info(`im-qqbot: ${SEND_STICKER_TOOL_NAME} 已注册`);
}

// ── qqbot_save_sticker — 手动收藏 ──

/** 主人/admin 才能用这个工具（stranger/friend 调会被拒绝） */
export function registerSaveStickerTool(
  ctx: Context,
  engine: StickerEngine,
  manager: SessionManagerLike,
  config: ImQQBotConfig,
  logger: Logger,
): void {
  const tools = ctx.get('tools') as ToolsRegistryLike | undefined;
  if (!tools?.register) return;

  tools.register({
    name: SAVE_STICKER_TOOL_NAME,
    description:
      '把当前会话最近的一张图片收藏进表情包库。'
      + '适合主人或管理员说"把这张存起来"、"这几张猫表情都收藏"时调用。'
      + '不传 filePath 时自动用当前会话最近收到的那张图。'
      + '⚠️ 只有主人（owner）或管理员（admin）能调用，普通成员会被拒绝。',
    parameters: {
      type: 'object',
      properties: {
        filePath: {
          type: 'string',
          description: '要收藏的图片本地路径（留空 = 自动用当前会话最近收到的那张图）',
        },
        hint: {
          type: 'string',
          description: '为什么收藏这张图，或者它是什么类型（猫、狗头、搞笑、可爱…）。写什么都行，会变成标签来源，以后选表情时更能匹配上。',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '给这张图手动加标签（用于后续 selector 匹配），最多 5 个。有 hint 就够用了，一般不用传这个。',
        },
      },
      required: [],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          saved: { type: 'boolean' },
          filename: { type: 'string' },
          id: { type: 'string' },
          reason: { type: 'string' },
          alreadyExists: { type: 'boolean' },
        },
        required: ['saved'],
        additionalProperties: false,
      },
      render: (_args: unknown, value: unknown): ContentBlock[] => {
        const v = value as { saved: boolean; filename?: string; reason?: string; alreadyExists?: boolean };
        if (!v.saved) return [{ type: 'text', text: `收藏失败: ${v.reason ?? '未知原因'}` }];
        if (v.alreadyExists) return [{ type: 'text', text: `这张图之前已经收藏过啦 ✅ ${v.filename}` }];
        return [{ type: 'text', text: `✨ 收藏成功！${v.filename} 已入库` }];
      },
    },
    async execute(
      args: unknown,
      exec: { agent?: unknown },
    ): Promise<Record<string, unknown>> {
      // 1. 权限门控
      const record = manager.findByAgent(exec.agent);
      if (!record) {
        return { saved: false, reason: '只能在 QQ 会话里使用这个工具' };
      }

      // 检查 sender 是否在 owner/admin 名单里
      if (!isOwnerOrAdmin(record.senderId, config.identity)) {
        logger.info(`save_sticker 被拒绝: senderId=${record.senderId} 不是 owner/admin`);
        return {
          saved: false,
          reason: '只有主人或管理员才能手动收藏表情包',
        };
      }

      // 2. 确定 filePath
      const a = args as { filePath?: string; hint?: string; tags?: string[] };
      let filePath = a.filePath?.trim() ?? '';

      if (!filePath) {
        // 不传 = 自动用缓存的最近图
        const latest = getLatestSessionAttachment(record.sessionKey);
        if (!latest) {
          return { saved: false, reason: '当前会话最近 10 分钟内没有收到过图片，无法自动收藏' };
        }
        filePath = latest.localPath;
      }

      if (!existsSync(filePath)) {
        return { saved: false, reason: `文件不存在: ${filePath}` };
      }

      // 3. 收藏
      // 先按真实大小给明确提示（否则只能在 collectFile 里统一返回“不合法”）
      const { minKB, maxKB } = engine.collector.sizeLimits;
      const sizeKB = Math.round(statSync(filePath).size / 1024);
      if (sizeKB < minKB) {
        return { saved: false, reason: `文件太小（${sizeKB}KB < ${minKB}KB）` };
      }
      if (sizeKB > maxKB) {
        return { saved: false, reason: `文件太大（${sizeKB}KB > ${maxKB}KB），需要调大 sticker.collector.maxSizeKB` };
      }

      const sourceGroup = record.scope === 'group' ? record.peerId : undefined;

      // 把 hint 和手动 tags 拼成 context，让 extractTags 一起抽
      const ctxParts = [a.hint ?? '', ...(a.tags ?? [])].filter((x) => x && x.trim().length > 0);
      const context = ctxParts.length > 0 ? ctxParts.join(' ') : undefined;

      const result = await engine.collector.collectFile(
        filePath,
        { groupId: sourceGroup, senderId: record.senderId },
        context,
      );

      if (!result) {
        return { saved: false, reason: '收藏器未启用或文件不合法（非图片/超大/超小）' };
      }

      // 如果已经存在（tryAdd 返回的是已有对象）
      // 简单判断：新收藏 hotScore=50 且 firstCollectedAt 刚创建；老对象 useCount>0 可能有区别
      // 这里 tryAdd 本身返回 existing 时也是同一个对象，我们用 quickId 判断是否是新加的
      return {
        saved: true,
        filename: result.filename,
        id: result.id,
        reason: `热度 ${result.hotScore}, 标签 [${result.tags.join(',')}]`,
        alreadyExists: result.useCount > 0, // 简化：已有 useCount 的就是之前收藏过的
      };
    },
  });

  logger.info(`im-qqbot: ${SAVE_STICKER_TOOL_NAME} 已注册`);
}

export type { ReplyTarget };
