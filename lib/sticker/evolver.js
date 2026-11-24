export class StickerEvolver {
    config;
    store;
    logger;
    timer = null;
    constructor(config, store, logger) {
        this.config = config;
        this.store = store;
        this.logger = logger;
    }
    /** 启动周期检查（bootstrap 在所有服务就绪后调用） */
    start() {
        if (!this.config.enabled)
            return;
        const intervalMs = this.config.checkIntervalHours * 60 * 60 * 1000;
        this.timer = setInterval(() => {
            void this.runEvolution();
        }, intervalMs);
        // 启动 30s 后先跑一次（冷启动）
        setTimeout(() => void this.runEvolution(), 30_000);
        this.logger.info(`sticker-evolver: 启动 (每 ${this.config.checkIntervalHours}h 进化一次)`);
    }
    stop() {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    // ── 手动触发反馈（QQ 侧收到群友反应时调用） ──
    recordFeedback(stickerId, positive, weight = 1) {
        if (positive)
            this.store.markPositive(stickerId, weight);
        else
            this.store.markNegative(stickerId, weight);
        const s = this.store.get(stickerId);
        if (s) {
            const newScore = this.recalcScore(s);
            this.store.update(stickerId, { hotScore: newScore });
        }
    }
    // ── 热度重算 ──
    recalcScore(s) {
        const { learningRate, hotExpireDays } = this.config;
        const useScore = Math.min(100, s.useCount * 2);
        const feedbackScore = (s.positiveReactions - s.negativeReactions * 2) * 10;
        const exploreBonus = s.useCount < 5 ? 15 : 0;
        const qualityBonus = s.quality * 5;
        // 时间衰减
        const daysSinceUse = s.lastUsedAt
            ? (Date.now() - s.lastUsedAt) / (24 * 60 * 60 * 1000)
            : hotExpireDays;
        const decay = Math.max(0, 1 - daysSinceUse / hotExpireDays);
        let next = s.hotScore + learningRate * (useScore + feedbackScore + exploreBonus + qualityBonus - s.hotScore);
        next *= decay;
        return Math.max(0, Math.min(100, Math.round(next * 10) / 10));
    }
    // ── 完整进化流程 ──
    async runEvolution() {
        const beforeStats = this.store.stats();
        const beforeCount = beforeStats.total;
        const stickers = this.store.all();
        this.logger.info(`sticker-evolver: 开始进化 (当前 ${beforeCount} 个)`);
        // 1. 重算所有热度
        for (const s of stickers) {
            const newScore = this.recalcScore(s);
            if (Math.abs(newScore - s.hotScore) > 0.5) {
                this.store.update(s.id, { hotScore: newScore });
            }
        }
        // 2. 淘汰
        const evicted = await this.evict(stickers);
        // 3. 给没标签的补标签
        const tagged = this.autoTag();
        // 4. 归一化（防止分数累积坍缩）
        const normalized = this.normalizeScores();
        await this.store.flush();
        const afterStats = this.store.stats();
        const report = {
            timestamp: Date.now(),
            before: { count: beforeCount, avgHotScore: beforeStats.avgHotScore },
            after: { count: afterStats.total, avgHotScore: afterStats.avgHotScore },
            evicted,
            tagged,
            normalized,
        };
        this.logger.info(`sticker-evolver: 完成 — 淘汰 ${evicted.length}, 补标签 ${tagged}, ` +
            `总 ${afterStats.total} 个, 平均热度 ${afterStats.avgHotScore}`);
        return report;
    }
    // ── 淘汰逻辑 ──
    async evict(all) {
        if (all.length <= this.config.minKeepCount)
            return [];
        // 按综合淘汰分排序（越高越危险）
        const sorted = [...all].sort((a, b) => {
            const aScore = a.hotScore * 0.4 + (10 - a.useCount) * 5 + (a.negativeReactions - a.positiveReactions) * 3;
            const bScore = b.hotScore * 0.4 + (10 - b.useCount) * 5 + (b.negativeReactions - b.positiveReactions) * 3;
            return aScore - bScore;
        });
        const toEvict = sorted
            .slice(0, Math.min(this.config.maxEvictPerRun, sorted.length - this.config.minKeepCount))
            .filter((s) => s.hotScore < 30); // 热度 > 30 的不淘汰
        const evicted = [];
        for (const s of toEvict) {
            const ok = await this.store.remove(s.id);
            if (ok)
                evicted.push(s);
        }
        return evicted;
    }
    // ── 自动补标签 ──
    autoTag() {
        let count = 0;
        for (const s of this.store.all()) {
            if (s.tags.length === 0) {
                const parts = s.filename.replace(/\.[^.]+$/, '').split(/[_-\s]+/);
                const tags = parts.filter((w) => w.length >= 2 && w.length <= 30).slice(0, 5);
                if (tags.length > 0) {
                    this.store.update(s.id, { tags });
                    count++;
                }
            }
        }
        return count;
    }
    // ── 归一化 ──
    normalizeScores() {
        const all = this.store.all();
        if (all.length === 0)
            return false;
        const scores = all.map((s) => s.hotScore);
        const min = Math.min(...scores);
        const max = Math.max(...scores);
        if (max - min < 1)
            return false;
        for (const s of all) {
            const normalized = ((s.hotScore - min) / (max - min)) * 100;
            if (Math.abs(normalized - s.hotScore) > 1) {
                this.store.update(s.id, { hotScore: Math.round(normalized * 10) / 10 });
            }
        }
        return true;
    }
    // ── 状态查询 ──
    getStatus() {
        const all = this.store.all();
        return {
            total: all.length,
            hot: all.filter((s) => s.hotScore >= 70).length,
            warm: all.filter((s) => s.hotScore >= 30 && s.hotScore < 70).length,
            cold: all.filter((s) => s.hotScore < 30).length,
            untagged: all.filter((s) => s.tags.length === 0).length,
            noUse: all.filter((s) => s.useCount === 0).length,
        };
    }
}
//# sourceMappingURL=evolver.js.map