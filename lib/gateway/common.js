import { createOutboundHandler } from "../transport/outbound.js";
import { parseStreamFrame } from "../transport/events.js";
import { QuestionChannel } from "../features/question-channel.js";
import { ApprovalChannel } from "../features/approval-channel.js";
import { startMediaCleanup } from "../media/media-cleaner.js";
import { ensureVisionInputModal, registerDescribeImageTool } from "../media/vision-tool.js";
import { registerSolveTool } from "../features/solve-tool.js";
import { registerTextTools } from "../features/text-tools.js";
import { registerPersonaAnalysisTool } from "../features/persona-analysis-tool.js";
import { registerSendFileTool } from "../media/send-file-tool.js";
import { DeliverablesDeliverer } from "../transport/deliverables.js";
import { createVoiceSpeaker } from "../voice/voice-reply.js";
import { resolveActiveVoiceSettings } from "../voice/voice-config.js";
import { buildVoiceOptions } from "../voice/voice-presets.js";
import { registerVoiceTool, VOICE_TOOL_NAME } from "../voice/voice-tool.js";
import { StickerEngine, mergeStickerConfig, registerStickerEngine } from "../sticker/index.js";
import { registerStickerTools, registerSendStickerTool, registerSaveStickerTool, registerListStickerTool, registerUpdateStickerTool } from "../sticker/tools.js";
export async function bootstrapCommon(deps) {
    const { ctx, config, logger, manager, persona, transport } = deps;
    const { sender, mediaSender } = transport;
    // ── 出站：dsh session/event → QQ 消息 ──
    // 获取 tools 服务（工具结果结构化展示），可选
    let toolsRegistry;
    try {
        toolsRegistry = ctx.get('tools');
    }
    catch {
        toolsRegistry = undefined;
    }
    // 交付物投递：present 声明的文件在轮末发送到当前会话（outbound 路由触发）
    const deliverablesDeliverer = new DeliverablesDeliverer(sender, mediaSender, config, logger);
    // ── 表情包进化系统 ──
    const stickerEnabled = config.sticker?.enabled ?? false;
    let stickerEngine;
    if (stickerEnabled) {
        const stickerConfig = mergeStickerConfig(config.sticker ?? {});
        // 注入 vision 服务：收藏时调视觉模型生成画面描述 + 标签
        const attachments = ctx.get('attachments');
        const visionDeps = stickerConfig.collector.autoDescribe && persona.llm?.stream && attachments?.saveImage && config.vision?.enabled
            ? { services: { llm: persona.llm, attachments: attachments }, config: config.vision }
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
    }
    else {
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
    }
    else {
        const voiceOptions = buildVoiceOptions(config.voice?.presets, config.voice?.model);
        registerVoiceTool(ctx, { manager, settings: voiceSettings, voiceOptions, logger });
        logger.info(`im-qqbot: 语音回复已启用（model=${voiceSettings.model}, voice=${voiceSettings.voice}）`);
        // 启动状态打到 stdout：logger.info 不落在终端日志里，本地起服务时靠这行确认语音是否生效
        console.log(`[im-qqbot] Voice enabled (model=${voiceSettings.model}, voice=${voiceSettings.voice}, tool=${VOICE_TOOL_NAME})`);
    }
    const outbound = createOutboundHandler(manager, sender, config, logger, toolsRegistry, deliverablesDeliverer, voiceSpeaker);
    ctx
        .on('session/event', outbound.routeSessionEvent);
    // ── 出站流式：agent/assistant-stream → 流式帧路由 ──
    // 实时流式走瞬态 agent/assistant-stream（chunk 不进 session log）。
    // 该事件按 agent 作用域派发，根作用域监听器不带 global 会被过滤（同
    // approval/request），帧到达后自行按 agent.id 路由，非 QQ 会话在 router 内忽略。
    ctx
        .on('agent/assistant-stream', (payload) => {
        const parsed = parseStreamFrame(payload);
        if (parsed !== undefined)
            outbound.routeStreamFrame(parsed.agentId, parsed.delta);
    }, { global: true });
    // ── 问答通道（ask_user_question → QQ 文本 + 按钮） ──
    const questionChannel = new QuestionChannel(manager, sender, config, logger);
    manager.questionChannel = questionChannel;
    questionChannel.install(ctx);
    // ── 审批通道（approval/request → QQ 两按钮审批） ──
    const approvalChannel = new ApprovalChannel(manager, sender, config, logger);
    manager.approvalChannel = approvalChannel;
    approvalChannel.install(ctx);
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
    registerPersonaAnalysisTool(ctx, {
        manager,
        config,
        archive: persona.archive,
        profiles: persona.profileStore,
        logger,
    });
    // ── 附件发送工具注册（qqbot_send_file，发送器见 mediaSender） ──
    registerSendFileTool(ctx, mediaSender, manager, config, logger);
    // ── 生命周期 ──
    ctx
        .effect(() => {
        void transport.start().catch((err) => {
            logger.error(`Transport start failed: ${err instanceof Error ? err.message : String(err)}`);
        });
        return async () => {
            logger.info('Shutting down');
            // 写盘是 1s 防抖的，退出前补一次，避免最后一条消息/分析结果丢失
            persona.autoAnalyzer?.dispose();
            persona.archive?.flush();
            persona.profileStore?.flush();
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
//# sourceMappingURL=common.js.map