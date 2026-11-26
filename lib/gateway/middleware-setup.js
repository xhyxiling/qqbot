import { errorHandler, messageFilter, accessPolicy, mentionGate, contentSanitizer, rateLimiter, slashCommand, concurrencyGuard, typingIndicator, quoteRef, historyBuffer, envelopeFormatter, } from '@tencent-connect/qqbot-nodejs';
import { buildCommandList } from "../commands/index.js";
import { attachmentProcessor } from "../middleware/attachment.js";
import { questionAnswer, approvalAnswer } from "../middleware/question-answer.js";
import { getHistoryStore, historyGroupKey } from "../features/history-store.js";
import { createPersonaArchiveMiddleware, } from "../features/persona-archive.js";
/**
 * 构建中间件链（不注册到 bot，便于不同传输层复用）。
 *
 * 中间件在运行时通过 ctx.bot 读取 appId 与发送提示（sendText/sendTyping），
 * OneBot 传入满足同一最小契约的门面对象即可。
 */
export function buildMiddlewares(options) {
    const { config, manager, logger, personaArchive, onArchived, personaServices, allowInsecureMedia } = options;
    const middlewares = [];
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
            if (ctx.message.kind !== 'group' || !gid)
                return undefined;
            return historyGroupKey(config.appId, gid);
        },
    }));
    // 4.5. 群聊人格档案 — 同样在 @ 门控之前，未 @bot 的消息也计入长期样本；
    //      访问控制已在第 3 步完成，被拒绝的群/用户不会写盘
    if (personaArchive !== undefined) {
        middlewares.push(createPersonaArchiveMiddleware(config, personaArchive, logger, onArchived));
    }
    // 5. 群聊 @bot 门控
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
        commands: buildCommandList({
            manager,
            config,
            ...(personaServices !== undefined ? { persona: personaServices } : {}),
        }),
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
    // 11. 引用消息解析（记录 + 解析被引用原文）
    middlewares.push(quoteRef({
        maxSize: 500,
        preferMsgElements: true,
    }));
    // 11.5. 附件下载（file 附件下载到本地，供 @提及 / 工具访问）
    middlewares.push(attachmentProcessor(config, logger, { allowInsecureMedia: allowInsecureMedia === true }));
    // 12. 上下文组装（将 history + quote + sender 组成 envelope）
    middlewares.push(envelopeFormatter({
        historyLimit: config.historyLimit,
        includeQuote: true,
        includeSender: true,
    }));
    return middlewares;
}
export function setupMiddlewares(bot, config, manager, logger, 
/** 群聊人格档案（personaAnalysis.enabled=false 时不传，不记录） */
personaArchive, 
/** 新消息写入档案后的同步通知（自动人格分析排队用，不能阻塞消息链） */
onArchived, 
/** /人格分析 命令使用的档案与模型服务（档案未启用时不传） */
personaServices) {
    for (const middleware of buildMiddlewares({
        config,
        manager,
        logger,
        ...(personaArchive !== undefined ? { personaArchive } : {}),
        ...(onArchived !== undefined ? { onArchived } : {}),
        ...(personaServices !== undefined ? { personaServices } : {}),
    })) {
        bot.use(middleware);
    }
}
//# sourceMappingURL=middleware-setup.js.map