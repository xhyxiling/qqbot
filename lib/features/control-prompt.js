/** 控制说明 section 的 order（表情包 89 之后） */
export const CONTROL_SECTION_ORDER = 90;
/**
 * 构建「管理操作」section。
 *
 * 始终注入：是否真的能执行由工具在运行时按身份判定，
 * 身份名单未配置时沿用旧行为（放行）。
 */
export function buildControlPromptSection() {
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
//# sourceMappingURL=control-prompt.js.map