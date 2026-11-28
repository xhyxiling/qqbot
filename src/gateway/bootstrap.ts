/**
 * 网关组装 — 选择传输层并装配共享能力
 *
 * 传输后端：
 *   - official：QQ 开放平台机器人（AppID/AppSecret，WebSocket 网关）
 *   - onebot：普通 QQ 账号（OneBot 11，自建 NapCat / LLOneBot 等）
 *   - both：两套同时在线，各自收发；会话按 replyTarget.channel 分流发送
 *
 * 无论几套传输，SessionManager / 工具 / 问答与审批通道都只有一份：
 * 每个会话在 replyTarget 上记录它来自哪个通道，出站经 MultiplexSender 分发。
 */
import type { Context } from '@deepseek-ai/cordis';
import { SessionManager, type DshAgentRegistry } from '../session/index.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { ChannelKind, Logger } from '../types.ts';
import { createArchiveRuntime } from './archive-runtime.ts';
import { createOfficialTransport } from './official.ts';
import { bootstrapCommon } from './common.ts';
import { MultiplexSender, type ChannelEndpoint } from './multiplex.ts';
import { createOneBotTransport } from '../onebot/gateway.ts';
import type { GatewayTransport } from './transport.ts';

/** OneBot 会话命名空间：与官方 appId 区分，避免历史/表情键串台 */
function onebotNamespace(config: ImQQBotConfig): string {
  const selfId = config.onebot.selfId.trim();
  return `onebot-${selfId !== '' ? selfId : 'default'}`;
}

export async function bootstrapGateway(
  ctx: Context,
  agents: DshAgentRegistry,
  config: ImQQBotConfig,
  logger: Logger,
): Promise<void> {
  const wantsOfficial = config.backend === 'official' || config.backend === 'both';
  const wantsOneBot = config.backend === 'onebot' || config.backend === 'both';

  // both 模式下官方凭据缺失时降级为仅 OneBot，避免整插件起不来
  const officialReady = config.appId.trim() !== '' && config.appSecret.trim() !== '';
  const officialEnabled = wantsOfficial && officialReady;
  if (wantsOfficial && !officialReady) {
    logger.warn('im-qqbot: 缺少官方机器人 AppID/AppSecret，官方通道未启动');
  }

  // 官方通道保持用户配置的流式开关；含 OneBot 时强制关闭（普通 QQ 无流式）
  const officialConfig: ImQQBotConfig = {
    ...config,
    backend: 'official',
    streaming: config.backend === 'official' ? config.streaming : false,
  };
  const onebotConfig: ImQQBotConfig = {
    ...config,
    backend: 'onebot',
    streaming: false,
    appId: config.backend === 'onebot' && config.appId.trim() !== ''
      ? config.appId
      : onebotNamespace(config),
  };

  // 会话命名空间：官方优先（两者 peer id 本身不同，不会互相覆盖）
  const baseConfig = officialEnabled || !wantsOneBot ? officialConfig : onebotConfig;

  logger.info(`im-qqbot: backend=${config.backend}${officialEnabled ? '' : '（官方通道未启用）'}`);

  const manager = new SessionManager(ctx, agents, baseConfig, logger);
  const archive = createArchiveRuntime(ctx, baseConfig, logger);
  // 长期记忆的 LLM 慢路径：拿到宿主 llm 服务后接管异步抽取
  manager.attachMemoryLlm(archive.llm);
  // 主动发言前的模型判断：两人对话/话题封闭时不插话
  manager.attachProactiveLlm(archive.llm);

  const endpoints = new Map<ChannelKind, ChannelEndpoint>();
  const transports: GatewayTransport[] = [];

  if (officialEnabled) {
    const transport = createOfficialTransport({ config: officialConfig, manager, logger, archive });
    endpoints.set('official', { sender: transport.sender, mediaSender: transport.mediaSender });
    transports.push(transport);
  }

  if (wantsOneBot) {
    const transport = createOneBotTransport({ config: onebotConfig, manager, logger, archive });
    endpoints.set('onebot', { sender: transport.sender, mediaSender: transport.mediaSender });
    transports.push(transport);
  }

  if (transports.length === 0) {
    throw new Error('没有可用的传输通道：请检查 backend / AppID / AppSecret 配置');
  }

  const fallback: ChannelKind = endpoints.has('official') ? 'official' : 'onebot';
  const sender = new MultiplexSender(endpoints, fallback, logger);

  // 多通道合成一个「传输层」交给共享装配：启动全部，停止全部
  const transport: GatewayTransport = {
    sender,
    mediaSender: sender,
    async start(): Promise<void> {
      await Promise.all(transports.map(async (item) => await item.start()));
    },
    stop(): void {
      for (const item of transports) item.stop();
    },
  };

  await bootstrapCommon({ ctx, config: baseConfig, logger, manager, archive, transport });
}
