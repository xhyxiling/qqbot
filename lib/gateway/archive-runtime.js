import { getPersonaArchive } from "../features/persona-archive.js";
export function createArchiveRuntime(ctx, config, logger) {
    // 关闭时既不记录也不提供工具数据；工具仍注册，调用时给出明确提示。
    const archive = config.personaAnalysis.enabled
        ? getPersonaArchive({
            maxMessages: config.personaAnalysis.maxMessages,
            retentionDays: config.personaAnalysis.retentionDays,
            debugLog: (msg) => logger.debug(msg),
        })
        : undefined;
    let llm;
    try {
        llm = ctx.get('llm');
    }
    catch {
        llm = undefined;
    }
    return {
        ...(archive !== undefined ? { archive } : {}),
        ...(llm !== undefined ? { llm } : {}),
    };
}
//# sourceMappingURL=archive-runtime.js.map