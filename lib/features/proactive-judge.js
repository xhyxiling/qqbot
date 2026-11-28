/**
 * 主动发言前的模型判断：这一步只回答「现在插话会不会打断别人」。
 *
 * 确定性门控负责频率与候选，真正的社交尺度交给模型：
 * 两个人在互相接话、话题只属于他们、对话已经收尾时，输出 speak=false。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { collectStreamText } from "../shared/llm-text.js";
const JUDGE_SYSTEM_PROMPT = [
    '你在帮一个 QQ 群里的聊天机器人做「要不要插话」的判断。只看社交场合，不生成回复。',
    '',
    '【不要插话】',
    '- 最近主要是两个人在互相接话（A 说完 B 回、B 说完 A 回），话题只在他们之间',
    '- 有人在回答另一个人的问题，或明显在私聊化',
    '- 对话已经收尾，比如“好的”“睡了”“明天见”“先这样”',
    '- 看不懂在聊什么，或插一句只会显得突兀',
    '',
    '【可以插话】',
    '- 话题是开放的，像是对整个群说的，不是只对着某一个人',
    '- 有人在吐槽、分享、提问，旁人接一句不会打断',
    '- 已经冷场一会儿，接一句能把话接住',
    '',
    '不确定时选不要。只输出 JSON：{"speak":true} 或 {"speak":false}，不要别的字。',
].join('\n');
/**
 * 「这条没 @ 机器人的消息，是不是在问机器人」的判断。
 *
 * 模型给 0-100 的回复意愿：>=50 就跳过概率/冷却直接回；低于 50 落回普通旁听。
 */
const DIRECTED_JUDGE_SYSTEM_PROMPT = [
    '你在帮一个 QQ 群里的聊天机器人判断：一条没有 @ 机器人的消息，是不是在对机器人说话、该不该回。',
    '',
    '【应该回】',
    '- 明显在问机器人（第二人称“你/您”、追问、请求帮忙、问它的人格/状态等）',
    '- 引用了机器人之前说的话，继续追问',
    '- 群友在喊它（在吗、人呢、出来）',
    '',
    '【不该回】',
    '- 第二人称是在对群里另一个人说的（A 问 B）',
    '- 只是旁敲侧击的吐槽，不需要回应',
    '- 话题已经收尾',
    '',
    '只输出 JSON：{"reply":0-100}，表示“现在由机器人回复”的合适程度。',
    '很确定该回给 80-100；比较像在问它给 50-70；只是旁人说给旁人给 0-30；不确定给 40-60。',
    '不要输出任何别的字。',
].join('\n');
export class ProactiveJudge {
    llm;
    getRoute;
    logger;
    timeoutMs;
    controller;
    constructor(options) {
        this.llm = options.llm;
        this.getRoute = options.getRoute;
        this.logger = options.logger;
        this.timeoutMs = Math.max(1_000, Math.trunc(options.timeoutMs ?? 8_000));
    }
    async shouldSpeak(scope, peerId, input) {
        const route = this.getRoute(scope, peerId);
        if (route === undefined)
            return false;
        const recent = (input.recent.length > 0 ? input.recent : input.batch).slice(-12);
        const format = (messages) => messages
            .map((item) => `${item.senderName ?? item.senderId}: ${item.content}`)
            .join('\n');
        const prompt = [
            '最近群聊（旧→新）：',
            format(recent),
            '',
            '机器人刚刚旁听到的批次：',
            format(input.batch.slice(-6)),
        ].join('\n');
        const message = createUserMessage({
            content: [{ type: 'text', text: prompt }],
            // 与 memory-extractor 相同的 v4 source 类型桥接
            source: { kind: 'plugin:dsh-im-qqbot' },
        });
        const controller = new AbortController();
        this.controller = controller;
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const generate = {
                provider: route.provider,
                model: route.model,
                system: JUDGE_SYSTEM_PROMPT,
                messages: [message],
                maxTokens: 40,
                signal: controller.signal,
            };
            const raw = await collectStreamText(this.llm.stream(generate), 'qqbot_proactive_judge');
            const speak = parseProactiveDecision(raw);
            this.logger?.debug(`proactive judge: speak=${speak} raw=${raw.slice(0, 120)}`);
            return speak;
        }
        catch (err) {
            // 判断失败时保守处理：宁可不插话，也不冒打断别人的风险
            this.logger?.debug(`proactive judge failed: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
        finally {
            clearTimeout(timer);
            this.controller = undefined;
        }
    }
    /**
     * 判断「这条没 @ 的消息由机器人回复的合适程度」，返回 0-1。
     *
     * 与 shouldSpeak 的区别：shouldSpeak 只判断插话会不会打断别人；
     * 这里判断消息是不是在跟机器人说话，>=0.5 时调用方会跳过概率/冷却。
     */
    async replyChance(scope, peerId, input) {
        const route = this.getRoute(scope, peerId);
        if (route === undefined)
            return 0;
        const recent = (input.recent.length > 0 ? input.recent : input.batch).slice(-12);
        const format = (messages) => messages
            .map((item) => `${item.senderName ?? item.senderId}: ${item.content}`)
            .join('\n');
        const prompt = [
            '最近群聊（旧→新）：',
            format(recent),
            '',
            ...(input.hint !== undefined ? [`补充信息：${input.hint}`, ''] : []),
            '要判断的消息：',
            format(input.batch.slice(-1)),
        ].join('\n');
        const message = createUserMessage({
            content: [{ type: 'text', text: prompt }],
            source: { kind: 'plugin:dsh-im-qqbot' },
        });
        const controller = new AbortController();
        this.controller = controller;
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const generate = {
                provider: route.provider,
                model: route.model,
                system: DIRECTED_JUDGE_SYSTEM_PROMPT,
                messages: [message],
                maxTokens: 20,
                signal: controller.signal,
            };
            const raw = await collectStreamText(this.llm.stream(generate), 'qqbot_directed_judge');
            const chance = parseDirectedReplyChance(raw);
            this.logger?.debug(`directed judge: chance=${chance.toFixed(2)} raw=${raw.slice(0, 80)}`);
            return chance;
        }
        catch (err) {
            // 判断失败时按「不强制回复」处理，交给普通旁听概率
            this.logger?.debug(`directed judge failed: ${err instanceof Error ? err.message : String(err)}`);
            return 0;
        }
        finally {
            clearTimeout(timer);
            this.controller = undefined;
        }
    }
    dispose() {
        this.controller?.abort();
        this.controller = undefined;
    }
}
/** 解析模型的判断；任何异常都按「不插话」处理 */
/** 解析「回复合适程度」；支持 0-100 与 0-1 两种写法，异常按 0 处理 */
export function parseDirectedReplyChance(raw) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start)
        return 0;
    try {
        const data = JSON.parse(raw.slice(start, end + 1));
        const value = typeof data.reply === 'number' ? data.reply : Number(data.reply);
        if (!Number.isFinite(value))
            return 0;
        const normalized = value <= 1 ? value : value / 100;
        return Math.min(1, Math.max(0, normalized));
    }
    catch {
        return 0;
    }
}
export function parseProactiveDecision(raw) {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start)
        return false;
    try {
        const data = JSON.parse(raw.slice(start, end + 1));
        return data.speak === true;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=proactive-judge.js.map