/**
 * SDK 中间件编排
 *
 * 根据插件配置组装 SDK 内置中间件链（洋葱模型）。
 * 中间件负责过滤与上下文富化；最终消息统一由 bot.on('message') 处理转发。
 *
 * 传输层无关：buildMiddlewares 只产出中间件数组，official 用 bot.use 注册，
 * onebot 用 runMiddlewareChain 直接执行，两边行为完全一致。
 */
import type { Middleware, QQBot } from '@tencent-connect/qqbot-nodejs';
import {
  errorHandler,
  messageFilter,
  accessPolicy,
  mentionGate,
  contentSanitizer,
  rateLimiter,
  slashCommand,
  concurrencyGuard,
  typingIndicator,
  quoteRef,
  historyBuffer,
  envelopeFormatter,
} from '@tencent-connect/qqbot-nodejs';
import type { ImQQBotConfig } from '../config.ts';
import type { SessionManager } from '../session/index.ts';
import type { Logger } from '../types.ts';
import { buildCommandList } from '../commands/index.ts';
import { attachmentProcessor } from '../middleware/attachment.ts';
import { historyMedia } from '../middleware/history-media.ts';
import { handleAmbientGroupMessage } from '../transport/ambient.ts';
import { questionAnswer, approvalAnswer } from '../middleware/question-answer.ts';
import { getHistoryStore, historyGroupKey } from '../features/history-store.ts';
import {
  createPersonaArchiveMiddleware,
  type PersonaArchive,
} from '../features/persona-archive.ts';

export interface MiddlewareSetupOptions {
  config: ImQQBotConfig;
  manager: SessionManager;
  logger: Logger;
  /** 群友发言档案（personaAnalysis.enabled=false 时不传，不记录） */
  personaArchive?: PersonaArchive;
  /** 富媒体下载是否允许 http / 内网地址（OneBot 本地 NapCat 媒体） */
  allowInsecureMedia?: boolean;
}

/**
 * 构建中间件链（不注册到 bot，便于不同传输层复用）。
 *
 * 中间件在运行时通过 ctx.bot 读取 appId 与发送提示（sendText/sendTyping），
 * OneBot 传入满足同一最小契约的门面对象即可。
 */
export function buildMiddlewares(options: MiddlewareSetupOptions): Middleware[] {
  const { config, manager, logger, personaArchive, allowInsecureMedia } = options;
  const middlewares: Middleware[] = [];

  // 1. 错误兜底（最外层洋葱皮）
  middlewares.push(errorHandler());

  // 2. 消息过滤：bot 回声 + 消息去重
  middlewares.push(messageFilter({ skipSelfEcho: false }));

  // 3. 访问控制（空名单 = 拒绝所有人，fail-closed）
  middlewares.push(accessPolicy({
    c2c: {
      mode: config.access.c2cMode,
      allow: config.access.c2cAllow,
    },
    group: {
      mode: config.access.groupMode,
      allow: config.access.groupAllow,
    },
    onBlock: (_mCtx, reason) => {
      if (config.debug) {
        logger.debug(`Access blocked: ${reason}`);
      }
    },
  }));

  // 4. 群历史缓冲 — 放在门控之前，确保所有消息（含未 @bot）都计入上下文
  //    store 走共享单例（getHistoryStore），groupKey 带 appId 前缀，供回复后清空
  middlewares.push(historyBuffer({
    limit: config.historyLimit,
    store: getHistoryStore(),
    recordOnSkip: true,
    groupKey: (ctx) => {
      const gid = ctx.message.groupOpenid;
      if (ctx.message.kind !== 'group' || !gid) return undefined;
      return historyGroupKey(config.appId, gid);
    },
  }));

  // 4.5. 群友发言档案 — 同样在 @ 门控之前，未 @bot 的消息也计入本地样本；
  //      访问控制已在第 3 步完成，被拒绝的群/用户不会写盘。
  //      档案只供 qqbot_view_person 按需查询，不再自动分析。
  if (personaArchive !== undefined) {
    middlewares.push(createPersonaArchiveMiddleware(config, personaArchive, logger));
  }

  // 4.6. 引用解析与索引 — 门控之前：未 @ 的消息也参与索引，之后被引用时查得到
  middlewares.push(quoteRef({
    maxSize: 500,
    preferMsgElements: true,
  }));

  // 4.7. 当前消息媒体下载 — 门控之前：@ 只决定「回不回」，不决定「收不收」。
  //      群里别人发的图也要落盘，否则后面被引用/@ 时模型只能看到 [图片] 两个占位符。
  middlewares.push(attachmentProcessor(config, logger, {
    allowInsecureMedia: allowInsecureMedia === true,
    downloadQuote: false,
  }));

  // 4.8. 把刚下载的媒体路径回填历史，供后续被 @ 时作为上下文
  middlewares.push(historyMedia(config));

  // 4.9. 旁听消息：未 @ 的群消息在这里记记忆、按概率主动接话，然后结束链路。
  //      必须放在 mentionGate 之前：SDK 命中未 @ 会直接 stop，后面的
  //      handleInbound 收不到消息，主动发言也就无从谈起。
  middlewares.push(async (ctx, next) => {
    if (handleAmbientGroupMessage(ctx, manager, config, logger)) {
      ctx.stop('ambient');
      return;
    }
    await next();
  });

  // 5. 群聊 @bot 门控（只拦回复，前面的接收/记录已经完成）
  middlewares.push(mentionGate({
    requireMentionInGroup: config.requireMention,
  }));

  // 6. 内容清洗（去 @marker、表情标签、多余空白）
  middlewares.push(contentSanitizer({
    parseFaceTags: true,
  }));

  // 7. 三层限流（sender / group / global）
  middlewares.push(rateLimiter());

  // 8. 斜杠命令（在 concurrencyGuard 之前，命令匹配后不排队直接响应）
  const slash = slashCommand({
    // 关闭 autoHelp：help 命令由 qqbot 注册为 /bot-help，
    // 避免 SDK 再自动注册一个无前缀的 /help 造成重复
    autoHelp: false,
    commands: buildCommandList({ manager, config }),
  });
  middlewares.push(slash.middleware);

  // 8.5. 待答问题 / 待批审批截获（在 concurrencyGuard 之前，答案消息不排队直接作答）
  middlewares.push(questionAnswer(manager));
  middlewares.push(approvalAnswer(manager));

  // 9. 并发串行 + 消息合并（同 peer 排队，避免 session 冲突）
  middlewares.push(concurrencyGuard({
    strategy: 'merge',
    maxQueue: config.maxQueue,
    maxProcessingMs: config.processingTimeoutMs,
  }));

  // 10. C2C 输入状态指示（OneBot 门面里是空实现）
  middlewares.push(typingIndicator());

  // 11. 引用消息媒体下载 — 只对真正要回复的消息补引用里的图/视频/文件
  middlewares.push(attachmentProcessor(config, logger, {
    allowInsecureMedia: allowInsecureMedia === true,
    downloadCurrent: false,
  }));

  // 12. 上下文组装（将 history + quote + sender 组成 envelope）
  middlewares.push(envelopeFormatter({
    historyLimit: config.historyLimit,
    includeQuote: true,
    includeSender: true,
  }));

  return middlewares;
}

export function setupMiddlewares(
  bot: QQBot,
  config: ImQQBotConfig,
  manager: SessionManager,
  logger: Logger,
  /** 群友发言档案（personaAnalysis.enabled=false 时不传，不记录） */
  personaArchive?: PersonaArchive,
): void {
  for (const middleware of buildMiddlewares({
    config,
    manager,
    logger,
    ...(personaArchive !== undefined ? { personaArchive } : {}),
  })) {
    bot.use(middleware);
  }
}
