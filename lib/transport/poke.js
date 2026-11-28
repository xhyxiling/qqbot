/**
 * QQ「戳一戳」→ 会话信号
 *
 * 戳一戳不是普通消息，但和主动搭话一样是在引起机器人注意。这里把它转成一次
 * agent followup：模型可以照常回一句，也可以选择沉默（[SILENT]）。
 * 「回击一个戳一戳」由 OneBot 传输层负责（见 onebot/gateway.ts），
 * 这里只处理「说完之后说什么」。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { buildIdentityPrefix } from "../identity/role.js";
import { shortSenderId } from "../shared/utils.js";
/**
 * 把一次戳一戳投递给会话。
 *
 * 与旁听不同：戳一戳是直接冲着机器人来的，不经过概率/冷却筛选；
 * 是否真的说话由模型决定（不想理就输出 [SILENT]）。
 */
export async function handlePokeSignal(manager, config, logger, signal) {
    const { scope, peerId, senderId, senderName, replyTarget } = signal;
    const name = senderName ?? shortSenderId(senderId);
    const identity = buildIdentityPrefix(senderId, config.identity);
    const body = [
        `【戳一戳】${identity}${name} 戳了戳你。`,
        '这不是一条普通消息，是对方在引起你的注意。',
        '想回应就照平时说话那样回一句（1-2 句，不要客套）；不想理就只输出 [SILENT]。',
    ].join('\n');
    manager.recordInteraction(scope, peerId, senderId, senderName, '[戳一戳]', replyTarget.channel);
    const record = await manager.getOrCreate(scope, peerId, senderId, replyTarget);
    record.lastUserText = '[戳一戳]';
    delete record.voiceRequested;
    delete record.voiceInstruction;
    delete record.stickerDescTokens;
    const message = createUserMessage({
        content: [{ type: 'text', text: body }],
        source: { kind: 'user' },
    });
    record.agent.followup(message);
    logger.info(`im-qqbot: poke → followup ${scope}:${peerId} sender=${senderId}`);
    await record.agent.whenIdle();
}
//# sourceMappingURL=poke.js.map