/**
 * NamesStore — 机器人的「自称」与 QQ 账号昵称
 *
 * 两者完全独立：
 * - botName：机器人怎么称呼自己（只进提示词，不改 QQ 资料）
 * - qqAccountName：QQ 账号资料上的昵称（通过 OneBot set_qq_profile 修改后同步记录）
 *
 * 存储：~/.dsh-qqbot/names.json（与 config 解耦，改名不需要改 cordis 配置）
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
/** 名字 section 的 order：身份 82 之后、人格 85 之前 */
export const NAMES_SECTION_ORDER = 84;
/** 名字清洗：去换行、压缩空白、限长（QQ 昵称上限 24 字） */
export function sanitizeName(raw, maxLength = 24) {
    return raw.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}
/**
 * 构建「名字」section。
 *
 * 把两个名字的用途写清楚，避免模型把「我怎么自称」和「我 QQ 叫什么」混用；
 * 人格 prompt 里若写了别的名字，以这里为准（运行时可改）。
 */
export function buildNamesPromptSection(names) {
    const botName = names.botName?.trim();
    const qqName = names.qqAccountName?.trim();
    if (!botName && !qqName)
        return undefined;
    const lines = ['【名字】'];
    if (botName) {
        lines.push(`你的名字是「${botName}」。这是你自己的名字，别人问「你叫什么」就这么回答；`
            + '人格设定里如果写了别的名字，以这里为准。不要把它当成对方的名字。');
    }
    if (qqName) {
        lines.push(`你这个 QQ 账号的昵称是「${qqName}」。它只是账号资料，不是你给自己起的名字，两者不要混用。`);
    }
    if (botName && qqName) {
        lines.push('两个名字互相独立：改其中一个不会影响另一个。');
    }
    return {
        name: 'qqbot:names',
        order: NAMES_SECTION_ORDER,
        text: lines.join('\n'),
    };
}
/** 名字持久化（同步读写，数据量极小） */
export class NamesStore {
    filePath;
    debugLog;
    names = {};
    constructor(filePath, debugLog) {
        this.filePath = filePath ?? resolve(homedir(), '.dsh-qqbot', 'names.json');
        this.debugLog = debugLog;
        this.load();
    }
    get() {
        return { ...this.names };
    }
    /** 设置机器人自称；传空串清除 */
    setBotName(name) {
        this.names = { ...this.names };
        if (name === '')
            delete this.names.botName;
        else
            this.names.botName = name;
        this.write();
    }
    /** 设置 QQ 账号昵称（调用方负责真正改资料）；传空串清除记录 */
    setQqAccountName(name) {
        this.names = { ...this.names };
        if (name === '')
            delete this.names.qqAccountName;
        else
            this.names.qqAccountName = name;
        this.write();
    }
    load() {
        try {
            if (!existsSync(this.filePath))
                return;
            const data = JSON.parse(readFileSync(this.filePath, 'utf8'));
            const next = {};
            if (typeof data.botName === 'string' && data.botName.trim() !== '') {
                next.botName = data.botName.trim();
            }
            if (typeof data.qqAccountName === 'string' && data.qqAccountName.trim() !== '') {
                next.qqAccountName = data.qqAccountName.trim();
            }
            this.names = next;
        }
        catch (err) {
            this.debugLog?.(`loadNames failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    write() {
        try {
            mkdirSync(dirname(this.filePath), { recursive: true });
            writeFileSync(this.filePath, JSON.stringify(this.names, null, 2), 'utf8');
        }
        catch (err) {
            this.debugLog?.(`writeNames failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
//# sourceMappingURL=names-store.js.map