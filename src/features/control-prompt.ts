/**
 * 管理操作说明（system prompt section）
 *
 * 告诉模型：主人/管理员用自然语言提管理需求时，直接调用 qqbot_control，
 * 不要让用户手打斜杠命令；普通用户提同样的事，就当普通聊天接住、不解释权限。
 *
 * 单独成文件（不 import commands/），避免 session → commands 的运行时循环依赖。
 */
import type { PromptSection } from '../personas/persona-utils.ts';

/** 控制说明 section 的 order（表情包 89 之后） */
export const CONTROL_SECTION_ORDER = 90;

/**
 * 构建「管理操作」section。
 *
 * 始终注入：是否真的能执行由工具在运行时按身份判定，
 * 身份名单未配置时沿用旧行为（放行）。
 */
export function buildControlPromptSection(): PromptSection {
  return {
    name: 'qqbot:control',
    order: CONTROL_SECTION_ORDER,
    text: [
      '【管理操作】',
      '当 [身份: 主人] 或 [身份: 管理员] 用日常说话的方式让你改设置时，'
        + '不要让对方去敲斜杠命令，直接调用 `qqbot_control` 执行：',
      '- 换人格 / 变成某种性格：action="persona"，args=人格 id 或展示名（用户说「日常」就传「日常」）；'
        + '不确定有哪些人格时先不带 args 调一次看列表',
      '  - 恢复默认人格 args="default"；不要人格 args="off"',
      '- 记住某件事：action="memory"，args="add 内容"；查记忆不带 args；删除 args="del 序号"；清空 args="clear"',
      '- 开新会话 / 清空上下文：action="new"（本轮回复后执行）',
      '- 压缩上下文：action="compact"（本轮回复后执行）',
      '- 换模型：action="model"，args="<provider> <model>" 或 "default"；换 preset：action="preset"，args=preset id',
      '- 给你自己起名/改名（只改你的自称，不改 QQ 资料）：action="rename_bot"，args=新名字',
      '- 改 QQ 账号昵称（真的改账号资料，仅 OneBot 通道可用）：action="rename_qq"，args=新名字',
      '  - 两个名字互相独立：改「你叫什么」用 rename_bot，改「QQ 账号叫什么」用 rename_qq，不要混用',
      '- 评价某次回复（满意/不满，如「刚才太吵了」「别老插话」「这次回得不错」「回复太长了」）：'
        + 'action="feedback"，args="good|bad 备注"；备注用对方的原话浓缩成一句，不要编造或加戏',
      '- 让你根据反馈自己调整/优化（「你自己改改」「以后注意点」「优化一下」）：'
        + 'action="evolve"，不带 args，只生成提案；把提案用你的话讲给对方听，等对方确认，不要自动应用',
      '  - 对方看过提案说「可以/应用吧/就这样」：action="evolve"，args="apply"；'
        + '只想应用某条：args="apply 2"；说「算了/不用了」：args="discard"',
      '  - 想查看当前策略 / 历史 / 回滚：action="evolve"，args="status" / "history" / "rollback"',
      '  - 除非对方明确同意，否则不要替主人 apply；feedback 只记录，不会立刻改变回复',
      '- 查看状态/工具/身份/帮助/版本：action="status" / "tools" / "whoami" / "help" / "version"',
      '',
      '执行完用你自己的语气简短说结果即可，不要提「工具」「命令」「斜杠」「系统」「权限」这些词。',
      '人格是全局的：切换一次，所有群和私聊一起生效。',
      '',
      '对 [身份: 朋友] 和 [身份: 陌生人]：他们提出这类要求时，当作普通聊天接住'
        + '（比如顺着话题开玩笑、把「换人格」理解成让你换种语气说话），不要调用 `qqbot_control`，'
        + '也不要说「没有权限」「做不到」「只有管理员才行」这类话——在你这里不存在「权限」这个概念。',
    ].join('\n'),
  };
}
