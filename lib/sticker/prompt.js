/**
 * 表情包的 system prompt section（order 89）
 *
 * 「要不要发表情」交给模型判断：这里讲清触发场景、禁发场景、剂量，
 * 并列出图库摘要（画面描述 + 标签，不暴露本地路径），让模型知道
 * "我有什么"，选 topic 时才能匹配到合适的图。
 * 表情库为空时不产生 section，模型感知不到这项能力。
 */
import { SEND_STICKER_TOOL_NAME } from "./tools.js";
/** 表情包说明 section 的 order：排在语音（88）之后 */
export const STICKER_PROMPT_ORDER = 89;
/** prompt 里最多列多少张表情（避免 prompt 过长） */
const MAX_CATALOG_IN_PROMPT = 40;
/**
 * 组装表情包使用说明 + 图库摘要。
 *
 * @returns undefined = 图库为空，不注入任何说明
 */
export function buildStickerPromptSection(options) {
    if (options.total <= 0)
        return undefined;
    const catalog = options.catalog.slice(0, MAX_CATALOG_IN_PROMPT);
    const describedCount = catalog.filter((c) => c.description || c.tags.length > 0).length;
    const lines = [
        `【表情包】图库里现有 ${options.total} 个表情。要发的时候直接调用 ${SEND_STICKER_TOOL_NAME}，一次调用就完成挑选和发送。`,
        '',
    ];
    if (catalog.length > 0) {
        lines.push(`库里的表情（编号可用 sticker_no 直接指定发送）：`);
        for (const item of catalog) {
            const desc = item.description?.trim();
            const tagStr = item.tags.length > 0 ? item.tags.join('、') : '';
            if (desc && tagStr) {
                lines.push(`- #${item.no} ${desc}（${tagStr}）`);
            }
            else if (desc) {
                lines.push(`- #${item.no} ${desc}`);
            }
            else if (tagStr) {
                lines.push(`- #${item.no} ${tagStr}`);
            }
        }
        if (options.total > catalog.length) {
            lines.push(`…还有 ${options.total - catalog.length} 张未列出，可调用 qqbot_list_stickers 查看完整清单。`);
        }
        else if (describedCount === 0) {
            lines.push('（目前这些表情还没有画面描述，可以先把大致内容告诉主人，或用 qqbot_list_stickers 看看。）');
        }
        lines.push('');
    }
    lines.push('什么时候发：', '- 该发：对方在开玩笑、吐槽、撒娇，或者情绪很足（得意、无语、委屈、被逗笑），一句短回复配一张表情比纯文字更自然。', '- 不该发：正经提问、解题、技术或工作讨论、对方在难过/生气需要认真回应的时候；这些场合发表情会显得敷衍。', '- 拿不准就不发。宁可少发，也不要在每条回复后面都塞一张。', '', '剂量：', '- 一次回复最多 1 个表情；同一话题不要连着发。', '- 刚刚发过表情的两轮内不再发。', '- 表情不能代替文字：该说的话还是要说，表情只是补充。', '', '怎么选：上面的清单里每张图都有 #编号，能一眼看出哪张最贴合当前话题时，直接调用 qqbot_send_sticker 并传 sticker_no=编号，最准。'
        + '没把握时再退回用 topic（写能命中某张图描述/标签的具体关键词，如「猫」「翻白眼」「比心」）+ mood（按真实氛围选 happy / sad / angry / silly / serious / neutral，不要一律填 happy）自动挑。'
        + '清单里没有贴合当前话题的图时，就不要硬发。', '没挑到合适的、或者发送失败时，不要解释工具和失败原因，用自己的人格口吻一句带过，或者干脆不发。', '', '权限：只有 [身份: 主人] 或 [身份: 管理员] 能让你发表情。其他人提这个要求时按人格口吻推掉，不要调用工具。', '修正元数据：如果主人/管理员指出某张表情的描述或标签识别错了（比如「这几张其实是奶龙」），'
        + '用 qqbot_list_stickers 确认编号后调用 qqbot_update_sticker 改 description / tags，改完简短确认即可。');
    return {
        name: 'qqbot:sticker',
        order: STICKER_PROMPT_ORDER,
        text: lines.join('\n'),
    };
}
//# sourceMappingURL=prompt.js.map