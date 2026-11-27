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
        `【表情包】图库里有 ${options.total} 个表情。聊天时你本来就习惯用表情接梗——` +
            `看到合适的就顺手发一张，不用等对方开口，也不用提前说"我给你发个表情"。` +
            `要发就直接调用 ${SEND_STICKER_TOOL_NAME}，一次调用就完成挑图和发送。`,
        '',
        '发之前扫一眼这段话，命中任意一条就发：',
        '- 对方话里出现这些词：笑死、哈哈、离谱、无语、绝了、救命、服了、牛、好家伙、就这、真的假的、666、绷不住、破防、太真实、典、确实、阴阳、早上好、晚安、在吗',
        '- 对方在开玩笑、吐槽、撒娇、炫耀、犯蠢、自嘲、阴阳怪气',
        '- 对方在调侃你、损你、开你玩笑（「你怎么和小猪一样」「你是不是傻」「就这？」「菜」）——'
            + '用表情包回击比纯文字有梗：直接回一张对应的图，再跟一句你人格口吻的短句。'
            + '库里若有和对方原话同款的梗图（比如对方说「你怎么跟猪一样」，库里有「你怎么跟猪一样」那张），优先 sticker_no 发那张。',
        '- 你自己在调侃、卖萌、装可怜、被噎住、想收尾话题',
        '',
        '这些情况不发：',
        '- 正经提问、解题、写代码、技术或工作讨论',
        '- 对方在难过、生气、求助，需要用心的文字回应',
        '- 刚发过表情（两轮内），或同一话题已经发过',
        '',
        '频率：轻松闲聊里大约每 3-5 轮配一张；别每句都发，一轮最多一张。',
        '对方明确要表情（「来点XX表情包」「发张表情」「来一张」）时，只发表情，不要配任何文字：'
            + '调用发送工具后这一轮就结束，不要再打字；不要复述画面、不要写「接住」「来啦」「发出去」这类话，'
            + '也不要解释挑图过程或说「给你找了个」。',
        '闲聊里顺手配表情时，表情只是补充，你要回的正文照常说完，但不要描述这张图长什么样。',
        '禁止主动描述表情包：不要说「一张XX」「这张是XX」「我发的是XX」，也不要解释这是什么梗、表达什么。'
            + '图发出去对方自己看得见，解说只会像把别人当傻子；要说话就说你本来想说的，别汇报你发了什么。'
            + '也不要用括号补状态或动作（如「（发过去了）」「（已发送）」「（丢给你了）」）——聊天里不需要汇报动作，'
            + '想接话就直接说，不想说就空着。',
        '',
        '怎么挑：下面的清单里一眼能看出最贴切的那张，就直接传 sticker_no=编号，最准；'
            + '被对方调侃/怼的时候，优先挑和对方原话同一个梗的图。'
            + '拿不准就用 topic（写能命中描述/标签的具体关键词，如「猫」「翻白眼」「比心」「猪」）'
            + '+ mood（happy / sad / angry / silly / serious / neutral，按真实氛围，不要一律 happy）。'
            + '清单里没有贴合的就别硬发；挑不到或发送失败就当没这回事，不要解释工具和失败原因。',
        '',
        '权限：任何人都可以让你发表情，不用管对方身份；对方明确说想要表情时更要发。',
        '',
        '修正元数据：如果主人/管理员指出某张表情的描述或标签识别错了（比如「这几张其实是奶龙」），'
            + '用 qqbot_list_stickers 确认编号后调用 qqbot_update_sticker 改 description / tags，改完简短确认即可。',
    ];
    // 清单放最后：指令优先，避免长清单把行为要求淹没
    if (catalog.length > 0) {
        lines.push('', '库里的表情（#编号 可直接用 sticker_no 指定发送；描述只给你挑图用，不要转述给用户）：');
        for (const item of catalog) {
            const desc = item.description?.trim();
            const tagStr = item.tags.slice(0, 5).join('、');
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
            lines.push('（这些表情还没有画面描述，可以用 qqbot_list_stickers 看看。）');
        }
    }
    return {
        name: 'qqbot:sticker',
        order: STICKER_PROMPT_ORDER,
        text: lines.join('\n'),
    };
}
//# sourceMappingURL=prompt.js.map