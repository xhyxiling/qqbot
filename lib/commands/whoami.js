import { getScopePeer } from "../shared/index.js";
import { hasIdentityConfig, resolveSenderRole, ROLE_LABELS, } from "../identity/role.js";
export function whoamiCommand({ config }) {
    const isOnebot = config.backend === 'onebot' || config.backend === 'both';
    const idLabel = isOnebot ? 'QQ 号' : 'openid';
    const idExample = isOnebot ? '（纯数字）' : '（u_ 开头）';
    return {
        name: ['whoami', '我是谁'],
        category: 'qqbot',
        description: `查看我的身份与${idLabel}（用于配置主人/管理员名单）`,
        handler: (cmdCtx) => {
            const { scope, peerId } = getScopePeer(cmdCtx);
            const senderId = (cmdCtx.message.senderId ?? '').trim();
            const configured = hasIdentityConfig(config.identity);
            const enabled = config.identity?.enabled !== false;
            const role = resolveSenderRole(senderId, config.identity);
            const lines = [
                '🪪 身份信息',
                `判定结果: ${ROLE_LABELS[role]}${configured ? '' : '（身份名单未配置，默认按陌生人处理）'}`,
                `${idLabel}: ${senderId || '（当前消息没有 senderId）'}${idExample}`,
                `场景: ${scope === 'group' ? `群聊（群 ${peerId}）` : '私聊'}`,
                `后端: ${config.backend}`,
            ];
            if (senderId) {
                lines.push('', `把这个 ${idLabel} 填到设置面板 →「身份与权限」对应名单即可生效。`);
            }
            if (!isOnebot) {
                if (scope === 'group') {
                    lines.push('注意：群聊用的是 member_openid，与私聊 user_openid 不同，两处需要分别添加。');
                }
                else {
                    lines.push('注意：私聊用的是 user_openid；你在群聊里的 openid 是另一个值，需要到群里再发一次 /whoami 查看。');
                }
            }
            if (!enabled) {
                lines.push('', '⚠️ 身份识别当前已关闭，可在设置面板「身份与权限」里重新开启。');
            }
            return lines.join('\n');
        },
    };
}
//# sourceMappingURL=whoami.js.map