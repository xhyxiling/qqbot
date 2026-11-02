/**
 * 人格工具绑定的候选清单（设置面板下拉用）。
 *
 * 本部署只给 QQ 聊天放行「插件内置工具」：做题、看图、发文件，以及翻译/总结/
 * 讲解/改写四个实用小工具，再加上按本地群聊档案分析群友人格。
 * 宿主 preset 里的文件读写、PowerShell、子 agent
 * 等能力一律不进候选，运行时也不会放行（见 DEFAULT_TOOL_ALLOWLIST）。
 *
 * 这里的名字只是候选：未注册的名字在绑定时会被忽略并在服务端日志告警，
 * 因此清单比宿主实际注册多几个名字也不会影响功能。
 */

/** 下拉里的一条候选工具 */
export interface ToolCatalogEntry {
  /** 工具名（dsh 注册名） */
  name: string;
  /** 中文说明（下拉选项展示用） */
  label: string;
  /** 分组（对应 optgroup 标题） */
  group: string;
}

const GROUP_PLUGIN = '插件内置';
export const GROUP_OTHER = '其他';

export const TOOL_CATALOG: ReadonlyArray<ToolCatalogEntry> = [
  { name: 'qqbot_solve', label: '做题（答案+过程）', group: GROUP_PLUGIN },
  { name: 'qqbot_describe_image', label: '看图 / OCR / 读图表', group: GROUP_PLUGIN },
  { name: 'qqbot_send_file', label: '把本地文件发给用户', group: GROUP_PLUGIN },
  { name: 'qqbot_translate', label: '翻译', group: GROUP_PLUGIN },
  { name: 'qqbot_summarize', label: '长文总结', group: GROUP_PLUGIN },
  { name: 'qqbot_explain', label: '讲解概念 / 代码 / 报错', group: GROUP_PLUGIN },
  { name: 'qqbot_rewrite', label: '改写 / 润色', group: GROUP_PLUGIN },
  { name: 'qqbot_analyze_persona', label: '分析群友人格（按群聊记录）', group: GROUP_PLUGIN },
];

/**
 * QQ 机器人默认放行的工具。
 *
 * 插件内置工具之外，只额外保留三个宿主只读能力：
 * - `ask_user_question`：QQ 端的按钮提问通道要靠它（不读写文件）
 * - `web_search` / `web_fetch`：查资料、读链接正文（不改本地文件、不执行命令）
 *
 * 文件读写、PowerShell、子 agent、定时任务等一律不在清单里，因此在 QQ 会话
 * 里不可见也调不到。
 */
export const DEFAULT_TOOL_ALLOWLIST: readonly string[] = [
  ...TOOL_CATALOG.map((entry) => entry.name),
  'ask_user_question',
  'web_search',
  'web_fetch',
];

/** 清单里的全部工具名（稳定顺序） */
export function catalogToolNames(): string[] {
  return TOOL_CATALOG.map((entry) => entry.name);
}

/** 是否是插件内置工具（客户端只展示这些候选） */
export function isPluginToolName(name: string): boolean {
  return TOOL_CATALOG.some((entry) => entry.name === name.trim());
}

/**
 * 合并多个来源的工具名：按首次出现顺序去重。
 *
 * @param sources - 任意个名字数组（可含 undefined）
 */
export function mergeToolNames(
  ...sources: ReadonlyArray<ReadonlyArray<string> | undefined>
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const source of sources) {
    for (const raw of source ?? []) {
      const name = raw.trim();
      if (name === '' || seen.has(name)) continue;
      seen.add(name);
      result.push(name);
    }
  }
  return result;
}

/**
 * 按分组整理候选工具（清单外的名字归入「其他」）。
 *
 * @param names - 合并后的工具名列表
 * @returns 分组标题 + 该组工具（空组不出现）
 */
export function groupToolNames(names: ReadonlyArray<string>): Array<{
  group: string;
  tools: Array<{ name: string; label: string }>;
}> {
  const catalog = new Map(TOOL_CATALOG.map((entry) => [entry.name, entry]));
  const buckets = new Map<string, Array<{ name: string; label: string }>>();
  for (const raw of names) {
    const name = raw.trim();
    if (name === '') continue;
    const entry = catalog.get(name);
    const group = entry?.group ?? GROUP_OTHER;
    const row = { name, label: entry?.label ?? '自定义工具' };
    const bucket = buckets.get(group);
    if (bucket === undefined) buckets.set(group, [row]);
    else bucket.push(row);
  }
  const order = [...new Set(TOOL_CATALOG.map((entry) => entry.group)), GROUP_OTHER];
  return order
    .filter((group) => buckets.has(group))
    .map((group) => ({ group, tools: buckets.get(group) ?? [] }));
}
