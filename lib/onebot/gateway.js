import { runMiddlewareChain } from '@tencent-connect/qqbot-nodejs';
import { buildMiddlewares } from "../gateway/middleware-setup.js";
import { handleInbound } from "../transport/inbound.js";
import { OneBotClient } from "./client.js";
import { OneBotBot } from "./sender.js";
import { buildInboundMessage } from "./message.js";
/** 构造与 SDK createMiddlewareContext 等价的上下文（SDK 未导出该工厂） */
function createContext(bot, message, log) {
    const receivedAt = Date.now();
    let stopped = false;
    let stopReason;
    const controller = new AbortController();
    const ctx = {
        bot: bot,
        message: message,
        replyTarget: message.replyTarget,
        state: {},
        log,
        stop(reason) {
            stopped = true;
            stopReason = reason;
        },
        get stopped() {
            return stopped;
        },
        get stopReason() {
            return stopReason;
        },
        get signal() {
            return controller.signal;
        },
        abort(reason) {
            controller.abort(reason);
            stopped = true;
            stopReason = reason ?? 'aborted';
        },
        get aborted() {
            return controller.signal.aborted;
        },
        receivedAt,
    };
    return ctx;
}
/** 创建 OneBot 传输层（未连接，start() 时才建立 WS） */
export function createOneBotTransport(deps) {
    const { config, manager, logger, persona } = deps;
    let selfId = config.onebot.selfId.trim();
    let middlewares = [];
    const client = new OneBotClient({
        httpUrl: config.onebot.httpUrl,
        wsUrl: config.onebot.wsUrl,
        accessToken: config.onebot.accessToken,
        logger,
        onEvent: (event) => {
            // 事件处理内部已兜错；这里再 catch 一次避免未处理 rejection
            void handleEvent(event).catch((err) => {
                logger.error(`OneBot 事件处理异常: ${err instanceof Error ? err.message : String(err)}`);
            });
        },
    });
    const bot = new OneBotBot({
        client,
        logger,
        appId: config.appId,
    });
    // 中间件链只构建一次（与 official 完全相同的顺序）
    middlewares = buildMiddlewares({
        config,
        manager,
        logger,
        ...(persona.archive !== undefined ? { personaArchive: persona.archive } : {}),
        ...(persona.autoAnalyzer !== undefined ? { onArchived: (notice) => persona.autoAnalyzer?.notify(notice) } : {}),
        ...(persona.services !== undefined ? { personaServices: persona.services } : {}),
        allowInsecureMedia: true,
    });
    /** 解析引用消息（get_msg），失败返回 undefined 由上层降级 */
    async function getMessage(messageId) {
        try {
            return await client.call('get_msg', { message_id: messageId });
        }
        catch (err) {
            logger.debug(`OneBot get_msg 失败 id=${messageId}: ${err instanceof Error ? err.message : String(err)}`);
            return undefined;
        }
    }
    async function handleEvent(event) {
        if (event.post_type !== 'message')
            return;
        // selfId 未配置时用事件自带字段兜底（OneBot 事件都带 self_id）
        if (selfId === '' && event.self_id !== undefined) {
            selfId = String(event.self_id);
        }
        const messageEvent = event;
        if (messageEvent.user_id !== undefined && String(messageEvent.user_id) === selfId)
            return;
        const built = await buildInboundMessage(messageEvent, {
            selfId,
            logger,
            getMessage,
        });
        if (built === undefined)
            return;
        const ctx = createContext(bot, built.message, logger);
        if (built.quote !== undefined) {
            // 直接写入 state.quote：SDK 的 quoteRef 只按 refMsgIdx 覆盖，
            // 这里已通过 get_msg 解析完成，结构满足 inbound 的消费契约
            ctx.state.quote = built.quote;
        }
        // 与 SDK 一致：把入站处理作为链的最后一环，保证并发守卫/限流在整轮处理期间持有锁
        const terminal = async () => {
            await handleInbound(ctx, manager, config, logger);
        };
        await runMiddlewareChain([...middlewares, terminal], ctx);
    }
    return {
        sender: bot,
        mediaSender: bot,
        async start() {
            if (selfId === '') {
                try {
                    const info = await client.getLoginInfo();
                    if (info.user_id !== undefined) {
                        selfId = String(info.user_id);
                        logger.info(`OneBot 已连接账号 ${selfId}${info.nickname ? `（${info.nickname}）` : ''}`);
                    }
                }
                catch (err) {
                    logger.warn(`OneBot get_login_info 失败，selfId 将从事件中推断: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
            await client.start();
        },
        stop() {
            client.stop();
        },
    };
}
//# sourceMappingURL=gateway.js.map