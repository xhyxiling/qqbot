export class MultiplexSender {
    endpoints;
    fallback;
    logger;
    constructor(endpoints, fallback, logger) {
        this.endpoints = endpoints;
        this.fallback = fallback;
        this.logger = logger;
    }
    /** 目标通道缺失时回退到默认通道（例如历史会话未带通道标记） */
    pick(target) {
        const wanted = target.channel ?? this.fallback;
        const endpoint = this.endpoints.get(wanted) ?? this.endpoints.get(this.fallback);
        if (endpoint === undefined) {
            throw new Error(`没有可用的 ${wanted} 发送通道`);
        }
        if (target.channel !== undefined && !this.endpoints.has(target.channel)) {
            this.logger.warn(`im-qqbot: 通道 ${target.channel} 未启用，回退到 ${this.fallback}`);
        }
        return endpoint;
    }
    sendMarkdown(target, content, opts) {
        return this.pick(target).sender.sendMarkdown(target, content, opts);
    }
    openStream(target) {
        return this.pick(target).sender.openStream(target);
    }
    sendImage(target, source, opts) {
        return this.pick(target).mediaSender.sendImage(target, source, opts);
    }
    sendVideo(target, source) {
        return this.pick(target).mediaSender.sendVideo(target, source);
    }
    sendVoice(target, source) {
        return this.pick(target).mediaSender.sendVoice(target, source);
    }
    sendFile(target, source, opts) {
        return this.pick(target).mediaSender.sendFile(target, source, opts);
    }
}
//# sourceMappingURL=multiplex.js.map