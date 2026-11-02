/**
 * 网关组装 — 创建 bot、编排中间件、注册事件、出站、生命周期
 *
 * 将 QQ 消息平台作为 dsh 前端协议驱动：入站消息 → handleInbound → dsh agent，
 * dsh session/event → createOutboundHandler → QQ 出站。
 */
import type { Context } from '@deepseek-ai/cordis';
import { QQBot } from '@tencent-connect/qqbot-nodejs';
import type { GatewayDisconnect, InteractionEvent, MiddlewareContext } from '@tencent-connect/qqbot-nodejs';
import { SessionManager, type DshAgentRegistry } from '../session/index.ts';
import { handleInbound, createOutboundHandler } from '../transport/index.ts';
import { parseStreamFrame } from '../transport/events.ts';
import { ReplyLimiter } from '../transport/reply-limiter.ts';
import { cacheMsgId, cacheEventId } from '../transport/msgid-cache.ts';
import { resolveReplyTarget, sendResolvedMarkdown } from '../transport/reply-target.ts';
import type { ToolsRegistryLike } from '../transport/tool-presenter.ts';
import type { QQBotSender } from '../transport/outbound-buffer.ts';
import { QuestionChannel } from '../features/question-channel.ts';
import { ApprovalChannel, type ApprovalChannelContext } from '../features/approval-channel.ts';
import { decodeButtonData } from '../features/button-utils.ts';
import { buildUserAgent } from '../shared/index.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { ChatScope, Logger } from '../types.ts';
import { setupMiddlewares } from './middleware-setup.ts';
import { startMediaCleanup } from '../media/media-cleaner.ts';
import { ensureVisionInputModal, registerDescribeImageTool } from '../media/vision-tool.ts';
import { registerSolveTool } from '../features/solve-tool.ts';
import { registerTextTools } from '../features/text-tools.ts';
import { getPersonaArchive } from '../features/persona-archive.ts';
import { getPersonaProfileStore } from '../features/persona-profiles.ts';
import { PersonaAutoAnalyzer } from '../features/persona-auto-analyzer.ts';
import type { LlmRuntimeLike } from '../features/model-route.ts';
import { registerPersonaAnalysisTool } from '../features/persona-analysis-tool.ts';
import { registerSendFileTool, type MediaSenderLike } from '../media/send-file-tool.ts';
import { DeliverablesDeliverer } from '../transport/deliverables.ts';
import { createVoiceSpeaker } from '../voice/voice-reply.ts';
import { resolveActiveVoiceSettings } from '../voice/voice-config.ts';
import { buildVoiceOptions } from '../voice/voice-presets.ts';
import { registerVoiceTool, VOICE_TOOL_NAME } from '../voice/voice-tool.ts';

/**
 * interaction 统一分发器：按 button_data 的顶层 `t` 判别字段，路由到对应
 * channel（question / approval）。QQ 只有一个 interaction 入口，集中路由
 * 避免多通道各自 try 导致误判。
 */
function dispatchInteraction(event: InteractionEvent, manager: SessionManager): boolean {
  const raw = event.data?.resolved?.button_data;
  if (!raw) return false;
  const button = decodeButtonData(raw);
  if (!button) return false;
  if (button.t === 'question') return manager.questionChannel?.handleInteraction(event) ?? false;
  if (button.t === 'approval') return manager.approvalChannel?.handleInteraction(event) ?? false;
  return false;
}

export async function bootstrapGateway(
  ctx: Context,
  agents: DshAgentRegistry,
  config: ImQQBotConfig,
  logger: Logger,
): Promise<void> {
  const manager = new SessionManager(ctx, agents, config, logger);

  // ── 初始化 QQ Bot SDK ──
  const userAgent = buildUserAgent();
  const bot = new QQBot({
    appId: config.appId,
    appSecret: config.appSecret,
    transport: 'websocket',
    baseUrl: process.env.QQBOT_BASE_URL?.replace(/\/+$/, '') || 'https://api.bot.qq.com',
    tokenBaseUrl: process.env.QQBOT_TOKEN_BASE_URL?.replace(/\/+$/, '') || 'https://api.bot.qq.com',
    userAgent,
    logger,
  } as ConstructorParameters<typeof QQBot>[0]);
  logger.info(`QQBot SDK initialized (UA: ${userAgent})`);

  // ── 群聊人格档案与人格库（qqbot_analyze_persona / 自动分析的数据源）──
  // 关闭时既不记录也不分析；工具仍注册，调用时给出明确的「未启用」提示。
  // 档案与人格库都走进程内共享实例：设置面板路由与网关同进程，重复 new
  // 会各自持有内存副本并互相覆盖写盘。
  const personaArchive = config.personaAnalysis.enabled
    ? getPersonaArchive({
        maxMessages: config.personaAnalysis.maxMessages,
        retentionDays: config.personaAnalysis.retentionDays,
        debugLog: (msg) => logger.debug(msg),
      })
    : undefined;
  const profileStore = personaArchive === undefined
    ? undefined
    : getPersonaProfileStore({ debugLog: (msg) => logger.debug(msg) });

  let llm: LlmRuntimeLike | undefined;
  try {
    llm = ctx.get('llm') as LlmRuntimeLike | undefined;
  } catch {
    llm = undefined;
  }

  const autoAnalyzer = personaArchive !== undefined && profileStore !== undefined && llm?.stream !== undefined
    ? new PersonaAutoAnalyzer({
        archive: personaArchive,
        store: profileStore,
        manager,
        config,
        llm,
        logger,
      })
    : undefined;
  if (personaArchive !== undefined && config.personaAnalysis.autoAnalyze !== false && autoAnalyzer === undefined) {
    logger.warn('im-qqbot: llm 服务不可用，自动人格分析未启用（可手动调用 qqbot_analyze_persona）');
  }

  // ── 中间件链 ──
  setupMiddlewares(
    bot, config, manager, logger, personaArchive,
    autoAnalyzer === undefined ? undefined : (notice) => autoAnalyzer.notify(notice),
    personaArchive === undefined || profileStore === undefined
      ? undefined
      : { archive: personaArchive, profiles: profileStore, ...(llm !== undefined ? { llm } : {}) },
  );

  // ── 入站：经过中间件链后的消息交给 dsh agent ──
  bot.on('message', async (mCtx: MiddlewareContext) => {
    const msg = mCtx.message;
    // 记录最近 msgId，供无上下文的出站发送（文件发送显式 target、主动推送等）获取被动回复目标
    cacheMsgId(mCtx.replyTarget.scope, mCtx.replyTarget.targetId, mCtx.replyTarget.msgId);
    if (config.debug) {
      logger.debug(`← message (post-middleware): ${JSON.stringify(msg, null, 2).slice(0, 500)}`);
    }
    await handleInbound(mCtx, manager, config, logger);
  });

  // ── 出站：dsh session/event → QQ 消息 ──
  // 获取 tools 服务（工具结果结构化展示），可选
  let toolsRegistry: ToolsRegistryLike | undefined;
  try {
    toolsRegistry = ctx.get('tools') as ToolsRegistryLike | undefined;
  } catch {
    toolsRegistry = undefined;
  }

  // 发送适配器：将 QQBot 实例适配为 QQBotSender（openStream 参数形态不同）。
  // sendMarkdown 统一做被动回复限额管控：同一 msgId 超限/过期时降级主动推送。
  const replyLimiter = new ReplyLimiter({ limit: 4 });
  const sender: QQBotSender = {
    sendMarkdown: (target, content, opts) => sendResolvedMarkdown(bot, resolveReplyTarget(target, replyLimiter, true), content, opts),
    openStream: (target) => bot.openStream({
      target: {
        scope: target.scope,
        targetId: target.targetId,
        msgId: target.msgId as string,
      },
    }),
  };

  // ── 附件发送适配器（qqbot_send_file 工具与交付物投递共用） ──
  // 包装 bot：让文件发送也走 msgId 兜底 + 被动回复限额管控。
  // 注意：SDK 文件发送暂不支持 event_id，故 allowEvent=false，跳过 event 候选。
  const mediaSender: MediaSenderLike = {
    sendImage: (target, source) => bot.sendImage(resolveReplyTarget(target, replyLimiter, false), source),
    sendVideo: (target, source) => bot.sendVideo(resolveReplyTarget(target, replyLimiter, false), source),
    sendVoice: (target, source) => bot.sendVoice(resolveReplyTarget(target, replyLimiter, false), source),
    sendFile: (target, source, opts) => bot.sendFile(resolveReplyTarget(target, replyLimiter, false), source, opts),
  };

  // 交付物投递：present 声明的文件在轮末发送到当前会话（outbound 路由触发）
  const deliverablesDeliverer = new DeliverablesDeliverer(sender, mediaSender, config, logger);

  // ── 语音回复（TTS）──
  // 门控完全由配置决定：开关关闭或 voice.apiKey 为空 = 不创建 speaker、不注册工具、不发语音。
  // 是否真的要发语音由上层模型判断（调用 qqbot_voice），不再做字符匹配。
  // 运行时缺少内置 WebSocket（Node 20）时同样关闭，并给出一次启动告警。
  const voiceSpeaker = createVoiceSpeaker({ manager, voice: config.voice, sender: mediaSender, logger });
  const voiceSettings = resolveActiveVoiceSettings(config.voice);
  if (voiceSpeaker === undefined || voiceSettings === undefined) {
    logger.info('im-qqbot: 语音回复未启用（开关关闭、voice.apiKey 为空或运行时缺少 WebSocket）');
  } else {
    const voiceOptions = buildVoiceOptions(config.voice?.presets, config.voice?.model);
    registerVoiceTool(ctx, { manager, settings: voiceSettings, voiceOptions, logger });
    logger.info(`im-qqbot: 语音回复已启用（model=${voiceSettings.model}, voice=${voiceSettings.voice}）`);
    // 启动状态打到 stdout：logger.info 不落在终端日志里，本地起服务时靠这行确认语音是否生效
    console.log(`[im-qqbot] Voice enabled (model=${voiceSettings.model}, voice=${voiceSettings.voice}, tool=${VOICE_TOOL_NAME})`);
  }

  const outbound = createOutboundHandler(
    manager, sender, config, logger, toolsRegistry, deliverablesDeliverer, voiceSpeaker,
  );
  (ctx as unknown as { on(event: string, handler: (...args: unknown[]) => void): void })
    .on('session/event', outbound.routeSessionEvent as (...args: unknown[]) => void);

  // ── 出站流式：agent/assistant-stream → 流式帧路由 ──
  // 实时流式走瞬态 agent/assistant-stream（chunk 不进 session log）。
  // 该事件按 agent 作用域派发，根作用域监听器不带 global 会被过滤（同
  // approval/request），帧到达后自行按 agent.id 路由，非 QQ 会话在 router 内忽略。
  (ctx as unknown as { on(event: string, handler: (...args: unknown[]) => void, options?: { global?: boolean }): void })
    .on('agent/assistant-stream', (payload: unknown) => {
      const parsed = parseStreamFrame(payload);
      if (parsed !== undefined) outbound.routeStreamFrame(parsed.agentId, parsed.delta);
    }, { global: true });

  // ── 问答通道（ask_user_question → QQ 文本 + 按钮） ──
  const questionChannel = new QuestionChannel(manager, sender, config, logger);
  manager.questionChannel = questionChannel;
  questionChannel.install(ctx);

  // ── 审批通道（approval/request → QQ 两按钮审批） ──
  const approvalChannel = new ApprovalChannel(manager, sender, config, logger);
  manager.approvalChannel = approvalChannel;
  approvalChannel.install(ctx as unknown as ApprovalChannelContext);

  // ── 按钮点击回调（interaction）：统一分发到问答/审批通道 ──
  bot.on('interaction', async (_iCtx: unknown, event: InteractionEvent) => {
    // scope/targetId 推导对齐消息事件（inbound.ts）：按 scene 判定类型，群用 group_openid，私聊用 user_openid
    const scope: ChatScope = event.scene === 'group' ? 'group' : 'c2c';
    const targetId = scope === 'group' ? (event.group_openid ?? event.user_openid) : event.user_openid;
    // 记录互动事件 id，作为后续被动回复候选（event_id）
    cacheEventId(scope, targetId, event.id);

    const matched = dispatchInteraction(event, manager);
    await bot.acknowledgeInteraction(event.id, matched ? 0 : 3).catch(() => {});
  });

  bot.on('error', (err: unknown) => {
    logger.error(`bot error: ${err instanceof Error ? err.message : String(err)}`);
  });

  // 掉线可观测：willReconnect=false 表示不会再重连（随后 bot.start() 的 Promise 会失败）。
  // disconnected 事件为 SDK 1.0.5+ 新增：旧版 handlers 表缺该键，bot.on 会抛
  // TypeError（profiles 增量安装可能残留旧版 SDK）——降级为跳过监听而非崩溃
  try {
    bot.on('disconnected', (event: GatewayDisconnect) => {
      const detail = `code=${event.code}${event.reason ? ` reason=${event.reason}` : ''}`;
      if (event.willReconnect) {
        logger.warn(`Bot disconnected (${detail}), reconnecting...`);
      } else {
        logger.error(`Bot disconnected permanently (${detail}), giving up`);
      }
    });
  } catch (err) {
    logger.warn(`qqbot-nodejs SDK 不支持 disconnected 事件（请升级 @tencent-connect/qqbot-nodejs 至 1.0.5+）: ${err instanceof Error ? err.message : String(err)}`);
  }

  bot.on('ready', () => {
    console.log(`[im-qqbot] Bot ready! appId=${config.appId}`);
  });

  // ── 富媒体过期清理 ──
  if (config.media.enabled) {
    startMediaCleanup(ctx, config.media.ttlHours, logger);
  }

  // ── 视觉工具注册（qqbot_describe_image，复用 dsh llm + attachments） ──
  ensureVisionInputModal(config.vision, logger);
  registerDescribeImageTool(ctx, config.vision, logger);

  // ── 做题工具注册（qqbot_solve，走会话当前模型） ──
  registerSolveTool(ctx, manager, config, logger);

  // ── 实用小工具注册（翻译 / 总结 / 讲解 / 改写，同样走会话当前模型） ──
  registerTextTools(ctx, manager, config, logger);

  // ── 群友人格分析（qqbot_analyze_persona，按本地群聊档案总结） ──
  registerPersonaAnalysisTool(ctx, { manager, config, archive: personaArchive, profiles: profileStore, logger });

  // ── 附件发送工具注册（qqbot_send_file，发送器见上方 mediaSender） ──
  registerSendFileTool(ctx, mediaSender, manager, config, logger);

  // ── 生命周期 ──
  (ctx as unknown as { effect(fn: () => (() => Promise<void>) | void, name?: string): void })
    .effect(() => {
      logger.info(`Starting bot (appId=${config.appId})`);
      bot.start().catch((err: unknown) => {
        logger.error(`Bot start failed: ${err instanceof Error ? err.message : String(err)}`);
      });

      return async () => {
        logger.info('Shutting down');
        // 写盘是 1s 防抖的，退出前补一次，避免最后一条消息/分析结果丢失
        autoAnalyzer?.dispose();
        personaArchive?.flush();
        profileStore?.flush();
        await manager.disposeAll();
        bot.stop();
      };
    }, 'im-qqbot.lifecycle');
}
