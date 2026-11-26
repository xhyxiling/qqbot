import { OutboundBuffer } from "./outbound-buffer.js";
import { sendTextParts } from "./send-text.js";
import { formatToolResult } from "./tool-presenter.js";
import { parseEvent, extractTurnError, } from "./events.js";
export { parseStreamFrame } from "./events.js";
/** 不展示给用户的轮次错误码（底层传输/网络错误，对用户无意义，且常被重试兜住） */
const SILENT_TURN_ERROR_CODES = new Set(['STREAM_CLOSED']);
/**
 * 丢掉描述「本轮已发表情」的分句。
 *
 * 模型发完图后常补一句「戴花帽子这只，呆呆的」——图用户自己看得见，这种解说
 * 只会显得把人当傻子。这里按发送时记下的表情描述/标签片段，把命中的 ||| 分句
 * 整段去掉；没命中的正文（正常聊天内容）原样保留。
 */
function stripStickerDescriptions(text, tokens) {
    if (tokens === undefined || tokens.length === 0)
        return text;
    // 模型会照抄「正文留空」这类指令，变成「(表情已发送，正文留空)」——一并丢掉
    const meta = /(正文留空|表情已发送|已发送|发送成功)/;
    const kept = text
        .split('|||')
        .map((segment) => segment.trim())
        .filter((segment) => segment !== ''
        && !meta.test(segment)
        && !tokens.some((token) => segment.includes(token)));
    return kept.join('|||');
}
/**
 * 出站路由器：持有会话级状态，按事件类型分发到处理器
 */
class OutboundRouter {
    buffers = new Map();
    toolCalls = new Map();
    /** 每会话当前流式 attemptId：LLM 重试会发布新 attempt，用于 reset 与迟到帧过滤 */
    streamAttempts = new Map();
    /** 每会话本轮已声明的交付文件（deliverables/presented，轮末清空） */
    presentedFiles = new Map();
    /** 每会话已见过的 present callId（轮内去重，防事件重放导致重复投递） */
    presentedCalls = new Map();
    /**
     * 每会话最后一笔在途文本发送（assistant/message 的 flush 是 fire-and-forget，
     * turn/end 时需等待其完成再投递交付文件，保证回复文本先于文件到达用户）。
     */
    pendingText = new Map();
    /** 每会话本轮最后一条非空 assistant 文本（语音轮由它合成，不再发文字） */
    lastReplyTexts = new Map();
    /**
     * 每会话本轮已经发出的 assistant 文本（轮末清空）。
     * 时序兜底：模型若先写正文再调用 qqbot_voice，文字已经送达，此时不能再补一条
     * 同内容的语音，否则用户会把同一句话收两遍。
     */
    sentReplyTexts = new Map();
    manager;
    bot;
    config;
    logger;
    toolsRegistry;
    deliverer;
    voice;
    constructor(manager, bot, config, logger, toolsRegistry, deliverer, voice) {
        this.manager = manager;
        this.bot = bot;
        this.config = config;
        this.logger = logger;
        this.toolsRegistry = toolsRegistry;
        this.deliverer = deliverer;
        this.voice = voice;
    }
    /** 事件分发入口 */
    route(session, raw) {
        const event = parseEvent(raw);
        if (event === undefined)
            return;
        const record = this.manager.findBySessionId(session.header.id);
        if (record === undefined)
            return;
        switch (event.type) {
            case 'assistant/chunk':
                this.onChunk(session.header.id, record, event);
                break;
            case 'assistant/message':
                this.onMessage(session.header.id, record, event);
                break;
            case 'tool/call':
                this.onToolCall(event);
                break;
            case 'tool/result':
                this.onToolResult(record, event);
                break;
            case 'deliverables/presented':
                this.onPresented(session.header.id, event);
                break;
            case 'turn/end':
                this.onTurnEnd(session.header.id, record, event);
                break;
        }
    }
    /** durable assistant/chunk 事件的流式增量（历史格式兼容保留，当前宿主不再生产该事件） */
    onChunk(sessionId, record, event) {
        this.appendChunk(sessionId, record, event.text);
    }
    /**
     * 实时流式帧入口（瞬态 agent/assistant-stream 事件）。
     *
     * attempt 语义：start 帧即新内容起点，无条件重置 buffer——清空旧 attempt 的
     * 累积文本但保留流式会话（QQ 流式 update 是全量替换，用户看到同一条消息被
     * 新内容重写）。不用 attemptId 对比判断"新 attempt"：agent replacement 后
     * attempt 计数重启、attemptId 可能与旧 agent 重叠（官方按 frame revision 的
     * gap 检测处理同一问题）。迟到帧（attemptId 不匹配）仍直接丢弃，防止旧
     * attempt 的尾巴混进新内容。
     */
    routeStreamFrame(agentId, delta) {
        if (delta.kind === 'attempt-start') {
            this.streamAttempts.set(agentId, delta.attemptId);
            this.buffers.get(agentId)?.reset();
            return;
        }
        // text-delta：首帧未见 start 时自愈记录，迟到帧丢弃
        const current = this.streamAttempts.get(agentId);
        if (current === undefined) {
            this.streamAttempts.set(agentId, delta.attemptId);
        }
        else if (current !== delta.attemptId) {
            return;
        }
        const record = this.manager.findBySessionId(agentId);
        if (record === undefined)
            return;
        this.appendChunk(agentId, record, delta.text);
    }
    /** 获取或创建会话 buffer 并追加增量 */
    appendChunk(sessionId, record, text) {
        let buffer = this.buffers.get(sessionId);
        if (buffer === undefined) {
            buffer = new OutboundBuffer(record, this.bot, this.config.textChunkLimit, this.logger, this.shouldStream(record), this.config.replySplitMode ?? 'none', this.config.replySplitIntervalMs ?? 0);
            this.buffers.set(sessionId, buffer);
        }
        buffer.append(text);
    }
    /**
     * 是否启用流式：配置开启 + c2c + 有 msgId（群聊不支持流式）。
     * 开启多消息拆分时关闭流式：QQ 流式只能在一条消息内全量替换，
     * 无法拆成多条独立消息。本轮模型选择了语音回复时同样不流式：正文只用于
     * 合成，若先流出去就会和语音重复。
     */
    shouldStream(record) {
        return (this.config.replySplitMode ?? 'none') === 'none'
            && this.config.streaming
            && record.replyTarget.scope === 'c2c'
            && !!record.replyTarget.msgId
            && record.voiceRequested !== true;
    }
    /** 完整 assistant 消息：有流式 buffer 则 flush，否则直接发送文本块 */
    onMessage(sessionId, record, event) {
        const buffer = this.buffers.get(sessionId);
        if (buffer !== undefined && buffer.text.trim()) {
            // 先记录全文：本轮语音回复时朗读这条回复，文字不再重复发送
            this.lastReplyTexts.set(sessionId, buffer.text);
            if (record.voiceRequested === true) {
                // 边流边调 qqbot_voice：文字已经可见，记下来，轮末不再补语音
                if (buffer.delivered)
                    this.markTextSent(sessionId, buffer.text);
                buffer.cancel();
                this.buffers.delete(sessionId);
                return;
            }
            // 已经流式推出去的内容无法撤回；未推送时按过滤后的文本静态发送
            if (buffer.delivered) {
                this.trackText(sessionId, buffer.flush());
                this.buffers.delete(sessionId);
                return;
            }
            const filtered = stripStickerDescriptions(buffer.text, record.stickerDescTokens);
            buffer.cancel();
            this.buffers.delete(sessionId);
            if (!filtered.trim()) {
                this.logger.info(`im-qqbot: 丢弃整条表情解说（session=${sessionId}）`);
                return;
            }
            this.markTextSent(sessionId, filtered);
            this.trackText(sessionId, this.send(record, filtered, 'sendMarkdown'));
            return;
        }
        const textParts = [];
        for (const block of event.content) {
            if (block.type === 'text' && block.text)
                textParts.push(block.text);
        }
        const fullText = textParts.join('\n');
        if (!fullText.trim())
            return;
        this.lastReplyTexts.set(sessionId, fullText);
        this.buffers.delete(sessionId);
        // 语音回复：正文只用于合成，不发文字（否则用户会收到同样的内容两遍）
        if (record.voiceRequested === true)
            return;
        const filtered = stripStickerDescriptions(fullText, record.stickerDescTokens);
        if (!filtered.trim()) {
            this.logger.info(`im-qqbot: 丢弃整条表情解说（session=${sessionId}）`);
            return;
        }
        this.markTextSent(sessionId, filtered);
        this.trackText(sessionId, this.send(record, filtered, 'sendMarkdown'));
    }
    /** 记录本轮已发出的 assistant 文本（多条消息按顺序拼接，用于语音轮去重判断） */
    markTextSent(sessionId, text) {
        if (!text.trim())
            return;
        const previous = this.sentReplyTexts.get(sessionId) ?? '';
        this.sentReplyTexts.set(sessionId, previous === '' ? text : `${previous}\n${text}`);
    }
    /** 记录每会话最后一笔在途文本任务（自身吞错：错误已由 send/flush 内部记录） */
    trackText(sessionId, task) {
        this.pendingText.set(sessionId, task.catch(() => { }));
    }
    /** 工具调用：仅记录，不发送（避免刷屏，等待结果） */
    onToolCall(event) {
        this.toolCalls.set(event.callId, { name: event.name, args: event.arguments });
    }
    /** 工具结果：错误始终发送，成功结果按开关 */
    onToolResult(record, event) {
        const call = this.toolCalls.get(event.callId);
        this.toolCalls.delete(event.callId);
        if (call === undefined)
            return;
        if (event.error === undefined && !this.config.showToolResults)
            return;
        const text = formatToolResult(call.name, call.args, event.raw, this.toolsRegistry, record.agent);
        if (!text)
            return;
        void this.send(record, text, 'sendToolResult');
    }
    /** 收集本轮声明的交付文件：事件总是先于 turn/end 到达，轮末统一投递 */
    onPresented(sessionId, event) {
        if (this.config.sendFile?.sendPresentedFiles === false)
            return;
        let calls = this.presentedCalls.get(sessionId);
        if (calls === undefined) {
            calls = new Set();
            this.presentedCalls.set(sessionId, calls);
        }
        if (calls.has(event.callId))
            return;
        calls.add(event.callId);
        const files = this.presentedFiles.get(sessionId) ?? [];
        files.push(...event.files);
        this.presentedFiles.set(sessionId, files);
    }
    /**
     * 轮次结束：文本先送达、模型选了语音时改为发语音、再投递交付文件、
     * 最后清理状态，异常结束时告知用户。
     * 外层轮次失败不撤销已完成的声明（宿主契约），故失败轮的文件仍投递。
     */
    onTurnEnd(sessionId, record, event) {
        const buffer = this.buffers.get(sessionId);
        const voiceRequested = record.voiceRequested === true;
        // 语音标记只对当前一轮有效：轮末立即复位（直接 delete，避免在 record 上留无意义字段）
        if (voiceRequested)
            delete record.voiceRequested;
        delete record.voiceInstruction;
        // 文本 flush 可等待，保证回复先于交付文件到达用户；语音轮不 flush（正文只用于合成）
        let flushTask = Promise.resolve();
        if (buffer !== undefined) {
            if (buffer.text.trim()) {
                this.lastReplyTexts.set(sessionId, buffer.text);
                if (voiceRequested) {
                    if (buffer.delivered)
                        this.markTextSent(sessionId, buffer.text);
                    buffer.cancel();
                }
                else {
                    this.markTextSent(sessionId, buffer.text);
                    flushTask = buffer.flush();
                }
            }
            else {
                buffer.cancel();
            }
            this.buffers.delete(sessionId);
        }
        this.streamAttempts.delete(sessionId);
        const files = this.presentedFiles.get(sessionId) ?? [];
        this.presentedFiles.delete(sessionId);
        this.presentedCalls.delete(sessionId);
        // 本轮最后一条 assistant 文本：语音轮朗读它，不再另发文字
        const voiceText = this.lastReplyTexts.get(sessionId) ?? '';
        // 本轮已经发出去的正文：语音轮据此判断是否还有重复风险
        const sentText = this.sentReplyTexts.get(sessionId) ?? '';
        this.sentReplyTexts.delete(sessionId);
        // assistant/message 已在轮内先行发送的文本可能仍在途：与 turn/end 自身的 flush 一起等待
        const pending = this.pendingText.get(sessionId) ?? Promise.resolve();
        this.pendingText.delete(sessionId);
        const failure = extractTurnError(event.reason);
        void (async () => {
            await Promise.all([flushTask, pending]);
            if (failure !== undefined && !SILENT_TURN_ERROR_CODES.has(failure.code)) {
                await this.send(record, `⚠️ 本轮异常结束\n\`${failure.code}\`: ${failure.message}`, 'sendTurnEndError');
            }
            /*
             * 语音轮：本轮正文已经扣下、没有发文字，这里换成语音（先听到回复，再收附件）。
             * 合成/发送失败或语音不可用时退回文字，避免用户什么都收不到。
             */
            let spoken = false;
            if (voiceRequested && voiceText.trim() !== '') {
                if (sentText.trim() !== '') {
                    // 时序兜底：模型先写了正文再调用 qqbot_voice，文字已经送达，再补语音就是重复
                    this.logger.warn(`im-qqbot: 本轮已发送文字，跳过语音以免重复 sessionId=${sessionId}`);
                }
                else if (this.voice !== undefined) {
                    spoken = await this.voice.speak(record, voiceText);
                }
            }
            this.lastReplyTexts.delete(sessionId);
            // 退回文字时避开已发出的同一段内容（否则又是重复）
            if (voiceRequested && !spoken && voiceText.trim() !== '' && !sentText.includes(voiceText.trim())) {
                await this.send(record, voiceText, 'sendVoiceFallback');
            }
            if (files.length > 0 && this.deliverer !== undefined) {
                await this.deliverer.deliver(record, files);
            }
            this.logger.debug(`im-qqbot: turn/end sessionId=${sessionId}`);
        })();
    }
    /** 统一发送：换行拆分 + 长度切分 + 顺序发送 + 错误记录 */
    async send(record, text, tag) {
        await sendTextParts(this.bot, record.replyTarget, text, {
            limit: this.config.textChunkLimit,
            splitMode: this.config.replySplitMode ?? 'none',
            intervalMs: this.config.replySplitIntervalMs ?? 0,
        }, this.logger, tag);
    }
}
/**
 * 创建出站事件处理器
 *
 * 返回 durable 事件与实时流式帧两个入口，分别注册到
 * ctx.on('session/event') 与 ctx.on('agent/assistant-stream', ..., { global: true })。
 * toolsRegistry 用于工具结果的结构化展示；deliverer 用于轮末投递 present 声明的交付文件；
 * voice 用于把模型选择了语音的回复合成成语音（未配置 API Key 时由 bootstrap 传 undefined）。
 */
export function createOutboundHandler(manager, bot, config, logger, toolsRegistry, deliverer, voice) {
    const router = new OutboundRouter(manager, bot, config, logger, toolsRegistry, deliverer, voice);
    return {
        routeSessionEvent: (session, event) => router.route(session, event),
        routeStreamFrame: (agentId, delta) => router.routeStreamFrame(agentId, delta),
    };
}
//# sourceMappingURL=outbound.js.map