import { runMiddlewareChain } from '@tencent-connect/qqbot-nodejs';
import { buildMiddlewares } from "../gateway/middleware-setup.js";
import { handleInbound } from "../transport/inbound.js";
import { OneBotClient } from "./client.js";
import { OneBotBot } from "./sender.js";
import { buildInboundMessage } from "./message.js";
/** 同一会话内两次自动回戳的最小间隔，避免互戳刷屏 */
const POKE_BACK_COOLDOWN_MS = 10_000;
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
    const { config, manager, logger, archive } = deps;
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
        ...(archive.archive !== undefined ? { personaArchive: archive.archive } : {}),
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
    /** 每个会话最近一次自动回戳的时间 */
    const lastPokeBackAt = new Map();
    /**
     * 戳完之后等「对方的下一条消息」，不设固定的 6 秒回复：等到就正常回应，
     * 等不到就什么都不发。连续戳只保留一个等待项，避免回多次。
     */
    const POKE_REPLY_WINDOW_MS = 5 * 60_000;
    /** key → 被戳的人与截止时间：只认被戳者自己发来的下一条消息 */
    const pokeReplyPending = new Map();
    /**
     * 戳一戳：回戳一下，然后等对方的下一条消息。
     *
     * NapCat / LLOneBot 的字段：`notice_type=notify, sub_type=poke`，
     * 被戳对象在 `target_id`；部分实现用 `notice_type=poke`，这里都兼容。
     */
    async function handlePoke(event) {
        const noticeType = String(event.notice_type ?? '');
        const subType = String(event.sub_type ?? '');
        if (noticeType !== 'poke' && !(noticeType === 'notify' && subType === 'poke'))
            return;
        if (selfId === '')
            return;
        const userId = event.user_id !== undefined ? String(event.user_id) : '';
        const targetId = event.target_id !== undefined ? String(event.target_id) : '';
        // 只处理「别人戳机器人」；自己戳自己 / 戳别人一律忽略
        if (userId === '' || userId === selfId)
            return;
        if (targetId !== '' && targetId !== selfId)
            return;
        const groupId = event.group_id !== undefined ? String(event.group_id) : '';
        const scope = groupId !== '' ? 'group' : 'c2c';
        const peerId = groupId !== '' ? groupId : userId;
        const key = `${scope}:${peerId}`;
        const now = Date.now();
        // 记下「刚戳过，接下来你发的那条消息大概率是跟我说的」；
        // 不启动定时器，也不主动发消息——只在对方下一条消息到来时消费。
        pokeReplyPending.set(key, { userId, deadline: now + POKE_REPLY_WINDOW_MS });
        logger.debug(`im-qqbot: poke 等待对方下一条消息 ${key} user=${userId}`);
        // 回击一个戳一戳（带冷却）：这是「视情况」的最低成本回应
        if (now - (lastPokeBackAt.get(key) ?? 0) >= POKE_BACK_COOLDOWN_MS) {
            lastPokeBackAt.set(key, now);
            const params = {};
            if (groupId !== '')
                params.group_id = /^\d+$/.test(groupId) ? Number(groupId) : groupId;
            params.user_id = /^\d+$/.test(userId) ? Number(userId) : userId;
            try {
                await client.call('send_poke', params);
                logger.info(`im-qqbot: poke back → ${key} user=${userId}`);
            }
            catch (err) {
                logger.debug(`im-qqbot: send_poke 失败 ${key}: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    }
    /**
     * 收到普通消息：返回这条消息是否是被戳者发来的「戳的后续」。
     *
     * 只认被戳者本人的下一条消息；其他人先说话不会消费这次等待，
     * 避免把别人的闲聊当成对戳的回应。
     */
    function noteMessageActivity(event) {
        const groupId = event.group_id !== undefined ? String(event.group_id) : '';
        const userId = event.user_id !== undefined ? String(event.user_id) : '';
        const key = groupId !== '' ? `group:${groupId}` : `c2c:${userId}`;
        const pending = pokeReplyPending.get(key);
        if (pending === undefined)
            return false;
        if (pending.deadline < Date.now()) {
            pokeReplyPending.delete(key);
            return false;
        }
        if (pending.userId !== userId)
            return false;
        pokeReplyPending.delete(key);
        return true;
    }
    async function handleEvent(event) {
        if (event.post_type === 'notice') {
            await handlePoke(event);
            return;
        }
        if (event.post_type !== 'message')
            return;
        // selfId 未配置时用事件自带字段兜底（OneBot 事件都带 self_id）
        if (selfId === '' && event.self_id !== undefined) {
            selfId = String(event.self_id);
        }
        const messageEvent = event;
        if (messageEvent.user_id !== undefined && String(messageEvent.user_id) === selfId)
            return;
        const pokeFollowUp = noteMessageActivity(messageEvent);
        const built = await buildInboundMessage(messageEvent, {
            selfId,
            logger,
            getMessage,
        });
        if (built === undefined)
            return;
        if (pokeFollowUp) {
            // 旁听链路会读取这个标记：戳完后的第一条消息直接当「在跟机器人说」
            built.message.pokeFollowUp = true;
        }
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