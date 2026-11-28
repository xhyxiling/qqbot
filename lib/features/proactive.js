export function createProactiveState(now = Date.now()) {
    return {
        lastSpokeAt: 0,
        hourKey: hourKeyOf(now),
        hourCount: 0,
        dayKey: dayKeyOf(now),
        dayCount: 0,
        messagesSinceSpoke: 0,
    };
}
/** 纯符号 / 表情 / 数字 / 笑声：不值得接 */
const NOISE_ONLY = /^[\s\p{P}\p{S}\dA-Za-z哈hH草6]+$/u;
const URL_ONLY = /^https?:\/\/\S+$/i;
/** 这条旁听消息是否值得进入候选批次 */
export function isProactiveCandidate(text, config) {
    const value = text.trim();
    if ([...value].length < Math.max(1, Math.trunc(config.minChars)))
        return false;
    if (config.ignorePrefixes.some((prefix) => prefix !== '' && value.startsWith(prefix)))
        return false;
    if (URL_ONLY.test(value))
        return false;
    if (NOISE_ONLY.test(value))
        return false;
    return true;
}
/** 每收到一条旁听消息调用一次（无论最终是否发言） */
export function registerAmbient(state, now = Date.now()) {
    rollBuckets(state, now);
    state.messagesSinceSpoke += 1;
}
/** 频率、冷却、概率都通过才允许发言 */
export function shouldSpeak(state, config, now = Date.now(), random = Math.random) {
    rollBuckets(state, now);
    // 刚说过话，先让别人说两句
    if (state.messagesSinceSpoke < 2)
        return false;
    if (state.lastSpokeAt > 0 && now - state.lastSpokeAt < Math.max(0, config.minIntervalSec) * 1000) {
        return false;
    }
    if (state.hourCount >= Math.max(0, Math.trunc(config.maxPerHour)))
        return false;
    if (state.dayCount >= Math.max(0, Math.trunc(config.maxPerDay)))
        return false;
    const probability = Math.min(1, Math.max(0, config.probability));
    return random() < probability;
}
/** 真正触发一次主动发言后调用 */
export function noteSpoke(state, now = Date.now()) {
    rollBuckets(state, now);
    state.lastSpokeAt = now;
    state.hourCount += 1;
    state.dayCount += 1;
    state.messagesSinceSpoke = 0;
}
/**
 * 正常 @ 回复后调用：只重置冷却和连续计数，不占用「主动发言」配额。
 * 否则被 @ 回几句就把每小时主动次数用完了。
 */
export function noteActivity(state, now = Date.now()) {
    rollBuckets(state, now);
    state.lastSpokeAt = now;
    state.messagesSinceSpoke = 0;
}
function rollBuckets(state, now) {
    const day = dayKeyOf(now);
    if (state.dayKey !== day) {
        state.dayKey = day;
        state.dayCount = 0;
    }
    const hour = hourKeyOf(now);
    if (state.hourKey !== hour) {
        state.hourKey = hour;
        state.hourCount = 0;
    }
}
function dayKeyOf(now) {
    const d = new Date(now);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function hourKeyOf(now) {
    return `${dayKeyOf(now)}-${new Date(now).getHours()}`;
}
//# sourceMappingURL=proactive.js.map