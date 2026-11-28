/**
 * 发言档案运行时 — 本地群聊/私聊档案 + LLM 引用
 *
 * 它不再包含「群友人设分析」或自动分析器：档案只作为
 * `qqbot_view_person` 工具的数据源，模型按需查看，不再后台生成人格。
 *
 * official / OneBot 两个传输层共用同一份实例：设置面板路由与网关同进程，
 * 重复 new 会各自持有内存副本并互相覆盖写盘。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { ImQQBotConfig } from '../config.ts';
import type { Logger } from '../types.ts';
import { getPersonaArchive, type PersonaArchive } from '../features/persona-archive.ts';
import type { LlmRuntimeLike } from '../features/model-route.ts';

export interface ArchiveRuntime {
  archive?: PersonaArchive;
  llm?: LlmRuntimeLike;
}

export function createArchiveRuntime(
  ctx: Context,
  config: ImQQBotConfig,
  logger: Logger,
): ArchiveRuntime {
  // 关闭时既不记录也不提供工具数据；工具仍注册，调用时给出明确提示。
  const archive = config.personaAnalysis.enabled
    ? getPersonaArchive({
        maxMessages: config.personaAnalysis.maxMessages,
        retentionDays: config.personaAnalysis.retentionDays,
        debugLog: (msg) => logger.debug(msg),
      })
    : undefined;

  let llm: LlmRuntimeLike | undefined;
  try {
    llm = ctx.get('llm') as LlmRuntimeLike | undefined;
  } catch {
    llm = undefined;
  }

  return {
    ...(archive !== undefined ? { archive } : {}),
    ...(llm !== undefined ? { llm } : {}),
  };
}
