/**
 * 可进化策略与反馈存储
 *
 * 两件事：
 *   - 反馈（feedback.json）：主人对某条回复的评价，是策略调整的唯一依据；
 *   - 策略（policies.json）：从反馈推导出的主动发言参数与表达偏好，带版本历史，
 *     可回滚。
 *
 * 设计原则：
 *   - 只写本地（~/.dsh-qqbot/），不上传、不自动改代码；
 *   - 策略必须由主人执行 `/evolve apply` 才生效，提案先落 pending；
 *   - 读路径（每条旁听消息）走内存缓存，避免频繁 I/O。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
/** 反馈最多保留条数 */
export const MAX_FEEDBACK = 500;
/** 策略历史最多保留版本数 */
const MAX_HISTORY = 50;
/** 主动发言概率下限 / 上限（防止反馈把参数推到极端） */
export const PROBABILITY_FLOOR = 0.02;
export const PROBABILITY_CEIL = 0.3;
/** 单条备注最大长度 */
const MAX_NOTE_LEN = 100;
/** 表达偏好单条最大长度与总条数 */
const MAX_STYLE_NOTE_LEN = 100;
const MAX_STYLE_NOTES = 12;
/** 空策略：所有字段都回落到配置默认值 */
export function emptyPolicyValues() {
    return { proactive: {}, styleNotes: [] };
}
function cloneValues(values) {
    return { proactive: { ...values.proactive }, styleNotes: [...values.styleNotes] };
}
function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}
/**
 * 合并提案到策略值（纯函数，便于测试）。
 *
 * probability 再次夹到 [0.02, 0.3]：pending 是本地 JSON，不能信任里面的数字。
 */
export function mergeProposals(current, proposals) {
    const next = cloneValues(current);
    for (const proposal of proposals) {
        if (proposal.proactive !== undefined) {
            const { probability, minIntervalSec, maxPerHour, maxPerDay } = proposal.proactive;
            if (probability !== undefined && Number.isFinite(probability)) {
                next.proactive.probability = clamp(probability, PROBABILITY_FLOOR, PROBABILITY_CEIL);
            }
            if (minIntervalSec !== undefined && Number.isFinite(minIntervalSec)) {
                next.proactive.minIntervalSec = Math.max(0, minIntervalSec);
            }
            if (maxPerHour !== undefined && Number.isFinite(maxPerHour)) {
                next.proactive.maxPerHour = Math.max(0, Math.trunc(maxPerHour));
            }
            if (maxPerDay !== undefined && Number.isFinite(maxPerDay)) {
                next.proactive.maxPerDay = Math.max(0, Math.trunc(maxPerDay));
            }
        }
        for (const raw of proposal.styleNotes ?? []) {
            const note = raw.replace(/\s+/g, ' ').trim().slice(0, MAX_STYLE_NOTE_LEN);
            if (note === '' || next.styleNotes.includes(note))
                continue;
            next.styleNotes.push(note);
        }
    }
    if (next.styleNotes.length > MAX_STYLE_NOTES) {
        next.styleNotes = next.styleNotes.slice(-MAX_STYLE_NOTES);
    }
    return next;
}
/** 临时文件 + rename，失败时退回直接覆盖（Windows 下 rename 偶发 EPERM） */
function writeAtomic(path, content) {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.tmp-${process.pid}`;
    writeFileSync(tmp, content, 'utf8');
    try {
        renameSync(tmp, path);
    }
    catch {
        writeFileSync(path, content, 'utf8');
        try {
            rmSync(tmp, { force: true });
        }
        catch {
            // 清理失败不影响主流程
        }
    }
}
function isPolicyValues(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const record = value;
    return typeof record.proactive === 'object'
        && record.proactive !== null
        && Array.isArray(record.styleNotes);
}
function normalizeValues(value) {
    const proactive = {};
    const src = value.proactive;
    if (typeof src.probability === 'number' && Number.isFinite(src.probability)) {
        proactive.probability = clamp(src.probability, PROBABILITY_FLOOR, PROBABILITY_CEIL);
    }
    if (typeof src.minIntervalSec === 'number' && Number.isFinite(src.minIntervalSec)) {
        proactive.minIntervalSec = Math.max(0, src.minIntervalSec);
    }
    if (typeof src.maxPerHour === 'number' && Number.isFinite(src.maxPerHour)) {
        proactive.maxPerHour = Math.max(0, Math.trunc(src.maxPerHour));
    }
    if (typeof src.maxPerDay === 'number' && Number.isFinite(src.maxPerDay)) {
        proactive.maxPerDay = Math.max(0, Math.trunc(src.maxPerDay));
    }
    return {
        proactive,
        styleNotes: value.styleNotes
            .filter((note) => typeof note === 'string' && note.trim() !== '')
            .map((note) => note.trim().slice(0, MAX_STYLE_NOTE_LEN))
            .slice(-MAX_STYLE_NOTES),
    };
}
function isPolicyRecord(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const record = value;
    return typeof record.revision === 'number'
        && typeof record.at === 'number'
        && typeof record.source === 'string'
        && isPolicyValues(record.values);
}
function isProposal(value) {
    if (typeof value !== 'object' || value === null)
        return false;
    const record = value;
    return (record.kind === 'proactive' || record.kind === 'style')
        && typeof record.reason === 'string'
        && typeof record.evidence === 'number';
}
/**
 * 策略存储：当前值 + 版本历史 + 待确认提案。
 *
 * 读路径（ambient / prompt 组装）只调用 snapshot()，数据来自内存；
 * 写操作（apply/rollback/setPending）立即落盘。
 */
export class PolicyStore {
    filePath;
    values = emptyPolicyValues();
    entries = [];
    revisionSeq = 0;
    pendingProposals = [];
    pendingAt = 0;
    debugLog;
    constructor(options = {}) {
        this.filePath = options.path ?? resolve(homedir(), '.dsh-qqbot', 'policies.json');
        this.debugLog = options.debugLog;
        this.load();
    }
    /** 当前生效策略（副本，调用方不应修改） */
    snapshot() {
        return cloneValues(this.values);
    }
    /** 当前版本号（0 = 从未应用过策略） */
    get revision() {
        return this.revisionSeq;
    }
    /** 已生效的版本历史（旧 → 新） */
    history() {
        return this.entries.map((entry) => ({ ...entry, values: cloneValues(entry.values) }));
    }
    /** 待确认提案 */
    pending() {
        return this.pendingProposals.map((proposal) => ({
            ...proposal,
            ...(proposal.proactive !== undefined ? { proactive: { ...proposal.proactive } } : {}),
            ...(proposal.styleNotes !== undefined ? { styleNotes: [...proposal.styleNotes] } : {}),
        }));
    }
    /** 保存提案，替换上一批尚未处理的提案 */
    setPending(proposals, now = Date.now()) {
        this.pendingProposals = proposals.map((proposal) => ({ ...proposal }));
        this.pendingAt = now;
        this.write();
    }
    /** 放弃待确认提案 */
    clearPending() {
        const had = this.pendingProposals.length > 0;
        this.pendingProposals = [];
        this.pendingAt = 0;
        if (had)
            this.write();
        return had;
    }
    /** 应用提案：合并到当前值，记录历史并清空 pending */
    apply(proposals, source, note, now = Date.now()) {
        if (proposals.length > 0) {
            this.values = mergeProposals(this.values, proposals);
            this.revisionSeq += 1;
            this.entries.push({
                revision: this.revisionSeq,
                at: now,
                source,
                ...(note !== undefined && note !== '' ? { note } : {}),
                values: cloneValues(this.values),
            });
            if (this.entries.length > MAX_HISTORY) {
                this.entries.splice(0, this.entries.length - MAX_HISTORY);
            }
        }
        this.pendingProposals = [];
        this.pendingAt = 0;
        this.write();
        return { revision: this.revisionSeq, values: this.snapshot() };
    }
    /** 回滚到上一个版本；没有历史时返回 false */
    rollback() {
        const removed = this.entries.pop();
        if (removed === undefined)
            return false;
        const previous = this.entries[this.entries.length - 1];
        this.values = previous !== undefined ? cloneValues(previous.values) : emptyPolicyValues();
        this.revisionSeq = previous?.revision ?? 0;
        this.pendingProposals = [];
        this.pendingAt = 0;
        this.write();
        return true;
    }
    load() {
        try {
            if (!existsSync(this.filePath))
                return;
            const data = JSON.parse(readFileSync(this.filePath, 'utf8'));
            if (isPolicyValues(data.current))
                this.values = normalizeValues(data.current);
            if (Array.isArray(data.history)) {
                this.entries = data.history
                    .filter(isPolicyRecord)
                    .map((entry) => ({ ...entry, values: normalizeValues(entry.values) }))
                    .slice(-MAX_HISTORY);
            }
            this.revisionSeq = typeof data.revision === 'number'
                ? Math.max(0, Math.trunc(data.revision))
                : (this.entries[this.entries.length - 1]?.revision ?? 0);
            if (data.pending !== undefined && Array.isArray(data.pending.proposals)) {
                this.pendingProposals = data.pending.proposals.filter(isProposal);
                this.pendingAt = typeof data.pending.at === 'number' ? data.pending.at : 0;
            }
        }
        catch (err) {
            this.debugLog?.(`loadPolicies failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    write() {
        try {
            const data = {
                version: 1,
                revision: this.revisionSeq,
                current: this.values,
                history: this.entries,
                ...(this.pendingProposals.length > 0
                    ? { pending: { at: this.pendingAt, proposals: this.pendingProposals } }
                    : {}),
            };
            writeAtomic(this.filePath, JSON.stringify(data, null, 2));
        }
        catch (err) {
            this.debugLog?.(`writePolicies failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
/** 反馈存储：只增不改，超过上限淘汰最旧 */
export class FeedbackStore {
    filePath;
    items = [];
    debugLog;
    constructor(options = {}) {
        this.filePath = options.path ?? resolve(homedir(), '.dsh-qqbot', 'feedback.json');
        this.debugLog = options.debugLog;
        this.load();
    }
    all() {
        return this.items.map((item) => ({ ...item }));
    }
    count() {
        return this.items.length;
    }
    /** 追加一条反馈；source 缺省为当前时间 */
    add(input) {
        const note = input.note?.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE_LEN);
        const item = {
            at: input.at ?? Date.now(),
            scope: input.scope,
            peerId: input.peerId,
            senderId: input.senderId,
            verdict: input.verdict,
            ...(note !== undefined && note !== '' ? { note } : {}),
        };
        this.items.push(item);
        if (this.items.length > MAX_FEEDBACK) {
            this.items.splice(0, this.items.length - MAX_FEEDBACK);
        }
        this.write();
        return { ...item };
    }
    load() {
        try {
            if (!existsSync(this.filePath))
                return;
            const data = JSON.parse(readFileSync(this.filePath, 'utf8'));
            if (!Array.isArray(data.items))
                return;
            this.items = data.items
                .filter((item) => {
                if (typeof item !== 'object' || item === null)
                    return false;
                const record = item;
                return (record.verdict === 'good' || record.verdict === 'bad')
                    && typeof record.at === 'number'
                    && (record.scope === 'c2c' || record.scope === 'group')
                    && typeof record.peerId === 'string'
                    && typeof record.senderId === 'string';
            })
                .slice(-MAX_FEEDBACK);
        }
        catch (err) {
            this.debugLog?.(`loadFeedback failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    write() {
        try {
            const data = { version: 1, items: this.items };
            writeAtomic(this.filePath, JSON.stringify(data, null, 2));
        }
        catch (err) {
            this.debugLog?.(`writeFeedback failed: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}
// ── 进程内单例：读路径与命令共用同一份缓存 ──
let policyStore;
let feedbackStore;
export function getPolicyStore() {
    policyStore ??= new PolicyStore();
    return policyStore;
}
export function getFeedbackStore() {
    feedbackStore ??= new FeedbackStore();
    return feedbackStore;
}
//# sourceMappingURL=store.js.map