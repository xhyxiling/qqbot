/**
 * 网关共享装配 — 出站路由、表情包、语音、工具注册、问答/审批通道、生命周期
 *
 * 与传输层无关：official 与 onebot 只提供 sender / mediaSender / start / stop。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionManager } from '../session/index.ts';
import { createOutboundHandler } from '../transport/outbound.ts';
import { parseStreamFrame } from '../transport/events.ts';
import type { ToolsRegistryLike } from '../transport/tool-presenter.ts';
import { QuestionChannel } from '../features/question-channel.ts';
import { ApprovalChannel, type ApprovalChannelContext } from '../features/approval-channel.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import { startMediaCleanup } from '../media/media-cleaner.ts';
import { ensureVisionInputModal, registerDescribeImageTool } from '../media/vision-tool.ts';
import { registerSolveTool } from '../features/solve-tool.ts';
import { registerTextTools } from '../features/text-tools.ts';
import { registerCurrentPersonaTool } from '../features/persona-tool.ts';
import { registerPersonSummaryTool } from '../features/persona-summary.ts';
import { registerControlTool } from '../features/control-tool.ts';
import { registerSendFileTool } from '../media/send-file-tool.ts';
import { DeliverablesDeliverer } from '../transport/deliverables.ts';
import { createVoiceSpeaker } from '../voice/voice-reply.ts';
import { resolveActiveVoiceSettings } from '../voice/voice-config.ts';
import { buildVoiceOptions } from '../voice/voice-presets.ts';
import { registerVoiceTool, VOICE_TOOL_NAME } from '../voice/voice-tool.ts';
import { StickerEngine, mergeStickerConfig, registerStickerEngine, type StickerVisionDeps } from '../sticker/index.ts';
import { registerStickerTools, registerSendStickerTool, registerSaveStickerTool, registerListStickerTool, registerUpdateStickerTool } from '../sticker/tools.ts';
import type { StickerConfig } from '../sticker/types.ts';
import type { ArchiveRuntime } from './archive-runtime.ts';
import type { GatewayTransport } from './transport.ts';

export interface GatewayCommonDeps {
  ctx: Context;
  config: ImQQBotConfig;
  logger: Logger;
  manager: SessionManager;
  archive: ArchiveRuntime;
  transport: GatewayTransport;
}

export async function bootstrapCommon(deps: GatewayCommonDeps): Promise<void> {
  const { ctx, config, logger, manager, archive, transport } = deps;
  const { sender, mediaSender } = transport;

  // ── 出站：dsh session/event → QQ 消息 ──
  // 获取 tools 服务（工具结果结构化展示），可选
  let toolsRegistry: ToolsRegistryLike | undefined;
  try {
    toolsRegistry = ctx.get('tools') as ToolsRegistryLike | undefined;
  } catch {
    toolsRegistry = undefined;
  }

  // 交付物投递：present 声明的文件在轮末发送到当前会话（outbound 路由触发）
  const deliverablesDeliverer = new DeliverablesDeliverer(sender, mediaSender, config, logger);

  // ── 表情包进化系统 ──
  const stickerEnabled = config.sticker?.enabled ?? false;
  let stickerEngine: StickerEngine | undefined;
  if (stickerEnabled) {
    const stickerConfig = mergeStickerConfig(config.sticker ?? {} as Partial<StickerConfig>);
    // 注入 vision 服务：收藏时调视觉模型生成画面描述 + 标签
    const attachments = ctx.get('attachments') as { saveImage?: unknown } | undefined;
    const visionDeps: StickerVisionDeps | undefined =
      stickerConfig.collector.autoDescribe && archive.llm?.stream && attachments?.saveImage && config.vision?.enabled
        ? { services: { llm: archive.llm, attachments: attachments as never }, config: config.vision }
        : undefined;
    stickerEngine = new StickerEngine(stickerConfig, logger, visionDeps);
    await stickerEngine.start();

    // 注册到模块级 holder（Cordis Context 不能直接挂属性）
    registerStickerEngine(stickerEngine);

    // 注册工具（模型可调用 qqbot_pick_sticker / qqbot_save_sticker / qqbot_send_sticker）
    registerStickerTools(ctx, stickerEngine, manager, config, logger);
    registerSendStickerTool(ctx, stickerEngine, mediaSender, manager, logger);
    registerSaveStickerTool(ctx, stickerEngine, manager, config, logger);
    registerListStickerTool(ctx, stickerEngine, manager, config, logger);
    registerUpdateStickerTool(ctx, stickerEngine, manager, config, logger);

    console.log('[im-qqbot] Sticker engine enabled ✨');
  } else {
    logger.info('im-qqbot: 表情包进化系统未启用（sticker.enabled = false）');
  }

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

  // ── 群友资料查看（qqbot_view_person，按本地发言档案返回统计与最近发言） ──
  registerPersonSummaryTool(ctx, {
    manager,
    config,
    archive: archive.archive,
    logger,
  });

  // ── 取当前人格（qqbot_current_persona：模型每轮发言前先确认自己是谁） ──
  registerCurrentPersonaTool(ctx, { manager, logger });

  // ── 管理工具（qqbot_control：主人用自然语言改人格/记忆/会话） ──
  registerControlTool(ctx, { manager, config, logger });

  // ── 附件发送工具注册（qqbot_send_file，发送器见 mediaSender） ──
  registerSendFileTool(ctx, mediaSender, manager, config, logger);

  // ── 生命周期 ──
  (ctx as unknown as { effect(fn: () => (() => Promise<void>) | void, name?: string): void })
    .effect(() => {
      void transport.start().catch((err: unknown) => {
        logger.error(`Transport start failed: ${err instanceof Error ? err.message : String(err)}`);
      });

      return async () => {
        logger.info('Shutting down');
        // 写盘是 1s 防抖的，退出前补一次，避免最后一条消息丢失
        archive.archive?.flush();
        // 刷盘 sticker 元数据
        if (stickerEngine) {
          registerStickerEngine(null); // 先注销 holder，防止 dispose 期间 inbound 还在访问
          await stickerEngine.dispose();
        }
        await manager.disposeAll();
        transport.stop();
      };
    }, 'im-qqbot.lifecycle');
}
