/** 情绪 → 关键词映射（中英文混） */
const MOOD_TAGS = {
    happy: ['开心', '笑脸', '笑哭', '大笑', '耶', '赞', '加油', '哈哈', '庆祝', '开心', 'lol', 'haha', 'smile'],
    sad: ['哭', '委屈', '无语', '难过', 'emmm', '叹气', '泪', 'sad', 'cry'],
    angry: ['怒', '哼', '生气', '白眼', '嫌弃', 'angry'],
    silly: ['沙雕', '狗头', '滑稽', '恶搞', '抖肩', '搞笑', 'meme', 'dog'],
    serious: ['认真', '好', '点赞', '加油', '认真'],
    neutral: [],
};
export class StickerSelector {
    config;
    store;
    logger;
    /** 群级别：上次发送时间 + 连续发送计数 */
    lastSentAt = new Map();
    consecutive = new Map();
    constructor(config, store, logger) {
        this.config = config;
        this.store = store;
        this.logger = logger;
    }
    /**
     * 核心入口：选一个表情，或返回 null 表示「这次不该发」
     */
    pick(ctx) {
        if (!this.config.enabled)
            return null;
        const all = this.store.all();
        if (all.length === 0)
            return null;
        // 群级别频率门控
        if (ctx.groupId && !this.checkGroupRateLimit(ctx.groupId)) {
            return null;
        }
        const strategy = this.resolveStrategy(ctx);
        const sticker = this.applyStrategy(all, strategy, ctx);
        if (sticker) {
            // 记录本次发送（影响后续门控 + 反馈）
            if (ctx.groupId) {
                this.lastSentAt.set(ctx.groupId, Date.now());
                this.consecutive.set(ctx.groupId, (this.consecutive.get(ctx.groupId) ?? 0) + 1);
            }
            this.store.markUsed(sticker.id);
            this.logger.debug(`sticker-selector: ${strategy} → ${sticker.id}`);
        }
        return sticker;
    }
    /** 收到群里新消息时重置连续计数（说明上一个话题已结束） */
    onNewGroupMessage(groupId) {
        this.consecutive.set(groupId, 0);
    }
    // ── 策略分发 ──
    resolveStrategy(ctx) {
        // explore: 偶尔（30% * proactiveProbability）用冷门表情
        if (ctx.trigger === 'proactive' && Math.random() < this.config.proactiveProbability * 0.3) {
            return 'explore';
        }
        if (ctx.trigger === 'explore')
            return 'explore';
        if (ctx.mood)
            return 'mood-match';
        if (ctx.topic.trim().length > 0)
            return 'topic-match';
        return this.config.strategy;
    }
    applyStrategy(all, strategy, ctx) {
        switch (strategy) {
            case 'hot':
                return this.pickHot(all);
            case 'random':
                return this.pickRandom(all);
            case 'mood-match':
                return this.pickByMood(all, ctx.mood ?? 'neutral');
            case 'topic-match':
                return this.pickByTopic(all, ctx.topic);
            case 'explore':
                return this.pickExplore(all);
            default:
                return this.pickRandom(all);
        }
    }
    // ── 具体策略 ──
    pickHot(all) {
        const topN = Math.max(5, Math.floor(all.length * 0.3));
        const top = [...all].sort((a, b) => b.hotScore - a.hotScore).slice(0, topN);
        return top[Math.floor(Math.random() * top.length)];
    }
    pickRandom(all) {
        return all[Math.floor(Math.random() * all.length)];
    }
    pickByMood(all, mood) {
        const targetTags = MOOD_TAGS[mood] ?? [];
        const scored = all.map((s) => {
            let score = s.hotScore * 0.3;
            const matched = s.tags.filter((t) => targetTags.some((mt) => t.includes(mt) || mt.includes(t.toLowerCase())));
            score += matched.length * 20;
            score += (s.positiveReactions - s.negativeReactions * 0.5) * 5;
            return { s, score };
        });
        scored.sort((a, b) => b.score - a.score);
        const top3 = scored.slice(0, Math.min(3, scored.length));
        return top3[Math.floor(Math.random() * top3.length)].s;
    }
    pickByTopic(all, topic) {
        const topicLower = topic.toLowerCase();
        const scored = all.map((s) => {
            let score = s.hotScore * 0.2;
            for (const t of s.tags) {
                if (topicLower.includes(t.toLowerCase()))
                    score += 30;
                if (t.toLowerCase().includes(topicLower))
                    score += 20;
            }
            return { s, score };
        });
        scored.sort((a, b) => b.score - a.score);
        const top3 = scored.slice(0, Math.min(3, scored.length));
        return top3[Math.floor(Math.random() * top3.length)].s;
    }
    pickExplore(all) {
        // 偏好：使用次数少但正向反馈不错的
        const scored = all.map((s) => ({
            s,
            score: (s.positiveReactions / Math.max(1, s.useCount)) + (10 - s.useCount),
        }));
        scored.sort((a, b) => b.score - a.score);
        const poolSize = Math.max(1, Math.floor(scored.length * 0.2));
        return scored.slice(0, poolSize)[Math.floor(Math.random() * poolSize)].s;
    }
    // ── 门控 ──
    checkGroupRateLimit(groupId) {
        const now = Date.now();
        const last = this.lastSentAt.get(groupId) ?? 0;
        // 间隔检查
        const minIntervalMs = this.config.minIntervalSec * 1000;
        const maxIntervalMs = this.config.maxIntervalSec * 1000;
        const interval = minIntervalMs + Math.random() * (maxIntervalMs - minIntervalMs);
        if (now - last < interval) {
            return false;
        }
        // 连续发送限制
        const consecutiveCount = this.consecutive.get(groupId) ?? 0;
        if (consecutiveCount >= this.config.maxConsecutiveStickers) {
            return false;
        }
        return true;
    }
}
//# sourceMappingURL=selector.js.map