/**
 * 人格档案运行时 — 群聊档案、人格库、自动分析器
 *
 * official / onebot 两个传输层共用同一份实例：
 * 设置面板路由与网关同进程，重复 new 会各自持有内存副本并互相覆盖写盘。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { SessionManager } from '../session/index.ts';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import { getPersonaArchive, type PersonaArchive } from '../features/persona-archive.ts';
import { getPersonaProfileStore, type PersonaProfileStore } from '../features/persona-profiles.ts';
import { PersonaAutoAnalyzer } from '../features/persona-auto-analyzer.ts';
import type { LlmRuntimeLike } from '../features/model-route.ts';
import type { PersonaCommandServices } from '../commands/types.ts';

export interface PersonaRuntime {
  archive?: PersonaArchive;
  profileStore?: PersonaProfileStore;
  llm?: LlmRuntimeLike;
  autoAnalyzer?: PersonaAutoAnalyzer;
  /** /人格分析 命令所需服务（档案未启用时 undefined） */
  services?: PersonaCommandServices;
}

export function createPersonaRuntime(
  ctx: Context,
  config: ImQQBotConfig,
  manager: SessionManager,
  logger: Logger,
): PersonaRuntime {
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

  let llm: LlmRuntimeLike | undefined;
  try {
    llm = ctx.get('llm') as LlmRuntimeLike | undefined;
  } catch {
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
