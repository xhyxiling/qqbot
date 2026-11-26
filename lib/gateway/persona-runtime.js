import { getPersonaArchive } from "../features/persona-archive.js";
import { getPersonaProfileStore } from "../features/persona-profiles.js";
import { PersonaAutoAnalyzer } from "../features/persona-auto-analyzer.js";
export function createPersonaRuntime(ctx, config, manager, logger) {
    // ── 群聊人格档案与人格库（qqbot_analyze_persona / 自动分析的数据源）──
    // 关闭时既不记录也不分析；工具仍注册，调用时给出明确的「未启用」提示。
    const archive = config.personaAnalysis.enabled
        ? getPersonaArchive({
            maxMessages: config.personaAnalysis.maxMessages,
            retentionDays: config.personaAnalysis.retentionDays,
            debugLog: (msg) => logger.debug(msg),
        })
        : undefined;
    const profileStore = archive === undefined
        ? undefined
        : getPersonaProfileStore({ debugLog: (msg) => logger.debug(msg) });
    let llm;
    try {
        llm = ctx.get('llm');
    }
    catch {
        llm = undefined;
    }
    const autoAnalyzer = archive !== undefined && profileStore !== undefined && llm?.stream !== undefined
        ? new PersonaAutoAnalyzer({
            archive,
            store: profileStore,
            manager,
            config,
            llm,
            logger,
        })
        : undefined;
    if (archive !== undefined && config.personaAnalysis.autoAnalyze !== false && autoAnalyzer === undefined) {
        logger.warn('im-qqbot: llm 服务不可用，自动人格分析未启用（可手动调用 qqbot_analyze_persona）');
    }
    const services = archive === undefined || profileStore === undefined
        ? undefined
        : { archive, profiles: profileStore, ...(llm !== undefined ? { llm } : {}) };
    return {
        ...(archive !== undefined ? { archive } : {}),
        ...(profileStore !== undefined ? { profileStore } : {}),
        ...(llm !== undefined ? { llm } : {}),
        ...(autoAnalyzer !== undefined ? { autoAnalyzer } : {}),
        ...(services !== undefined ? { services } : {}),
    };
}
//# sourceMappingURL=persona-runtime.js.map