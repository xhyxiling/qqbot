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
    dispose() {
        this.controller?.abort();
        this.controller = undefined;
    }
}
/** 解析模型的判断；任何异常都按「不插话」处理 */
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