/**
 * QQ 机器人配置面板 — 必要配置的 UI 编辑
 *
 * UI 复刻 DSW 通用设置（settings-form 原语）的视觉风格：
 * 配置按「服务范围 / 身份与权限 / 群友人格 / 对话设置 / 语音回复 / 模型与提示词 / 人格预设」七个分区呈现；
 * 一次只渲染一个分区，避免单列过长；每个分区有未保存修改时 tab 显示小圆点。
 * 「群友人格」页签含自动分析开关与人格表格（可按昵称 / openid / 人格特点筛选）。
 * 另有一个不写入配置的「插件更新」页签：检查远端版本并执行一键更新。
 * 左对齐设置列、0.5px 行分隔、label 13px/500、控件右置；
 * Switch 为 36×20 aria-checked 结构（thumb translateX 动画）；
 * 三值选择用分段控件（滑动指示器按段数/索引的 CSS 变量定位）；
 * 保存按钮为 DSW 反色主按钮（label-primary 底 + bg-layer-3 字）。
 *
 * 数据流：GET /qqbot/im-qqbot/config 回显当前生效配置（appSecret
 * 已由宿主剔除）→ 表单编辑 → dirty diff → POST 仅提交变更键 →
 * 宿主白名单 + Schema 校验 → 最小写入 profile patch → HMR 重载生效。
 *
 * 字段策略：只开放用户必要的配置；cwd 只读展示；超时与性能调优
 * 类字段走 profile patch / 环境变量。
 */
import { createElement, useCallback, useEffect, useState, type CSSProperties, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import {
  BIND_CONFIG_PATH,
  BIND_PERSONAS_PATH,
  BIND_UPDATE_PATH,
  type PersonaProfileWire,
  type PersonaProfilesResponse,
  type UpdateCheckWire,
  type UpdateInstallWire,
  type UpdateStateWire,
} from '../shared/bind-protocol.ts';
import { catalogToolNames, groupToolNames, isPluginToolName, mergeToolNames } from '../shared/tool-catalog.ts';
import { KAOMOJI_STYLES, DEFAULT_KAOMOJI_STYLE, findKaomojiStyle } from '../expressions/kaomoji.ts';
import {
  DEFAULT_VOICE_MODEL,
  VOICE_MODELS,
  buildVoiceOptions,
  findVoiceModel,
  followVoiceModel,
  voiceOptionLabel,
  type VoiceOption,
} from '../voice/voice-presets.ts';

/** 访问控制配置（与 src/config.ts 的 AccessControlConfig 对应的局部投影） */
interface AccessControlWire {
  c2cMode: 'open' | 'allowlist' | 'disabled';
  c2cAllow: string[];
  groupMode: 'open' | 'allowlist' | 'disabled';
  groupAllow: string[];
}

/** 身份识别配置（与 src/config.ts 的 IdentityConfig 对应的局部投影） */
interface IdentityWire {
  enabled: boolean;
  ownerOpenIds: string[];
  adminOpenIds: string[];
  friendOpenIds: string[];
}

/** 记忆与关系状态配置（与 src/config.ts 的 MemoryConfig 对应的局部投影） */
interface MemoryWire {
  enabled: boolean;
  autoCapture: boolean;
  maxNotes: number;
}

/** 群聊人格档案配置（与 src/config.ts 的 PersonaAnalysisConfig 对应的局部投影） */
interface PersonaAnalysisWire {
  enabled: boolean;
  /** 每个会话最多保留的消息条数（20–1000） */
  maxMessages: number;
  /** 保留天数（1–365） */
  retentionDays: number;
  /** 是否在某位群友累计发言达到阈值后自动生成/更新人格档案 */
  autoAnalyze: boolean;
  /** 自动分析触发条数（5–200） */
  autoAnalyzeThreshold: number;
}

/** 人格表达方式（与 src/config.ts 的 ExpressionsConfig 对应的局部投影） */
interface KaomojiWire {
  enabled?: boolean;
  style?: string;
  custom?: string[];
  maxPerReply?: number;
}

/** 人格语音音色（空对象不带任何字段；留空继承全局音色） */
interface PersonaVoiceWire {
  voice?: string;
  rate?: number;
  volume?: number;
  /** 情感/语气指令（留空继承全局 voice.instruction） */
  instruction?: string;
}

/** 用户手动添加的音色（名称 + 音色 id） */
interface VoicePresetEntryWire {
  name?: string;
  voice?: string;
}

/** 全局语音回复配置（apiKey 永不回显，只回 hasApiKey） */
interface VoiceWire {
  /** 语音总开关（关闭后即使有 Key 也不启用） */
  enabled?: boolean;
  apiKey?: string;
  /** GET 回显的只读提示；提交时忽略 */
  hasApiKey?: boolean;
  /** 提交时显式清空已保存的 Key（Key 管理，不再等价于停用语音） */
  clearApiKey?: boolean;
  model?: string;
  voice?: string;
  /** 情感/语气指令（自然语言） */
  instruction?: string;
  /** 自定义音色（下拉里排在内置系统预设之前） */
  presets?: VoicePresetEntryWire[];
  baseUrl?: string;
  workspace?: string;
  maxChars?: number;
  timeoutMs?: number;
}

/** 人格预设（与 src/config.ts 的 PersonaPreset 对应的局部投影） */
interface PersonaWire {
  id: string;
  name: string;
  prompt: string;
  /** 工具白名单；undefined = 使用默认放行清单（插件内置工具 + 只读联网/提问） */
  tools?: string[];
  /** 表达方式；必须显式 enabled:true 才启用（Schema 会物化默认子对象） */
  expressions?: { kaomoji?: KaomojiWire; voice?: PersonaVoiceWire };
}

/** GET 回显的生效配置（appSecret 已剔除） */
type ReplySplitMode = 'none' | 'delimiter' | 'line' | 'paragraph';

type ConfigWire = {
  requireMention?: boolean;
  streaming?: boolean;
  replySplitMode?: ReplySplitMode;
  replySplitIntervalMs?: number;
  showToolResults?: boolean;
  debug?: boolean;
  provider?: string;
  model?: string;
  preset?: string;
  globalPrompt?: string;
  personas?: PersonaWire[];
  defaultPersona?: string;
  identity?: IdentityWire;
  memory?: MemoryWire;
  personaAnalysis?: PersonaAnalysisWire;
  access?: AccessControlWire;
  voice?: VoiceWire;
  cwd?: string;
};

/** 样式注入标记（幂等；版本变化时替换旧样式，避免客户端热更新后仍用旧样式） */
const STYLE_ID = 'im-qqbot-config-panel-styles';
const STYLE_VERSION = '8';

/** DSW 通用设置风格（settings-form / Switch / SegmentedControl 原语复刻） */
function useConfigPanelStyles(): void {
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById(STYLE_ID);
    if (existing !== null) {
      if (existing.getAttribute('data-version') === STYLE_VERSION) return;
      existing.remove();
    }
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.setAttribute('data-version', STYLE_VERSION);
    style.textContent = `
.imqb2-form { display: flex; flex-direction: column; width: 100%; }
.imqb2-group-title {
  padding: 14px 0 2px; font-size: 12px; font-weight: 600; line-height: 18px;
  color: var(--dsw-alias-label-tertiary); text-transform: uppercase; letter-spacing: .04em;
}
.imqb2-field { display: flex; flex-direction: column; gap: 6px; padding: 12px 0; }
.imqb2-field + .imqb2-field { border-top: 0.5px solid var(--dsw-alias-border-l2); }
.imqb2-head { display: flex; align-items: center; gap: 8px; min-height: 28px; }
.imqb2-label {
  flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}
.imqb2-help { margin: 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary); }
.imqb2-hint { margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.imqb2-hint-warn {
  margin: 4px 0 0; font-size: 12px; line-height: 1.5;
  color: var(--dsw-alias-state-warning-primary, #b26b00);
}
/* Switch（aria-checked 驱动，视觉态与无障碍态同源） */
.imqb2-switch {
  box-sizing: border-box; position: relative; flex: 0 0 auto;
  width: 36px; height: 20px; padding: 2px; border: 0; border-radius: 999px;
  background: var(--dsw-alias-border-l3); cursor: pointer; font: inherit;
}
.imqb2-switch[aria-checked='true'] { background: var(--dsw-alias-brand-primary); }
.imqb2-switch:disabled { cursor: default; opacity: 0.5; }
.imqb2-switch:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px;
}
.imqb2-switch-thumb {
  display: block; width: 16px; height: 16px; border-radius: 50%;
  background: var(--dsw-alias-switch-thumb, #ffffff);
  transition: transform 120ms ease;
}
.imqb2-switch[aria-checked='true'] .imqb2-switch-thumb {
  background: var(--dsw-alias-label-primary-foreground, #ffffff);
  transform: translateX(16px);
}
/* 输入（官方 fields.input 复刻） */
.imqb2-input {
  box-sizing: border-box; width: 100%; height: 34px; padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l4); border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-bg-layer-3); font: inherit; font-size: 13px; line-height: 1.5;
  color: var(--dsw-alias-label-primary); outline: none;
}
.imqb2-input:focus { outline: none; border-color: var(--dsw-alias-state-business-primary); }
.imqb2-input:disabled { color: var(--dsw-alias-label-tertiary); cursor: default; }
.imqb2-textarea { height: auto; min-height: 68px; padding: 8px 12px; resize: vertical; line-height: 1.5; }
/* 工具下拉（原生 select + 已选 chip） */
.imqb2-select { padding: 0 8px; cursor: pointer; }
.imqb2-select:disabled { cursor: default; }
.imqb2-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.imqb2-chip {
  display: inline-flex; align-items: center; gap: 4px; max-width: 100%;
  padding: 3px 8px; border: 0.5px solid var(--dsw-alias-border-l3);
  border-radius: 999px; background: var(--dsw-alias-bg-layer-3);
  font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-primary);
  word-break: break-all;
}
.imqb2-chip-x {
  appearance: none; flex: none; border: 0; background: transparent; padding: 0 1px;
  font: inherit; font-size: 13px; line-height: 1; cursor: pointer;
  color: var(--dsw-alias-label-tertiary);
}
.imqb2-chip-x:hover { color: var(--dsw-alias-label-primary); }
/* 分段控件（官方 SegmentedControl 复刻：指示器按段数/索引定位） */
.imqb2-seg {
  position: relative; display: inline-grid; grid-auto-flow: column; grid-auto-columns: 1fr;
  gap: 2px; padding: 4px; border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-interactive-bg-hover);
}
.imqb2-seg-indicator {
  position: absolute; top: 4px; left: 4px;
  width: calc((100% - 8px - 2px * (var(--imqb2-seg-count) - 1)) / var(--imqb2-seg-count));
  height: calc(100% - 8px);
  border: 0; border-radius: var(--dsw-radius-sm, 6px);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-elevation-soft, 0 1px 3px rgba(0,0,0,.08));
  transform: translateX(calc(var(--imqb2-seg-index) * (100% + 2px)));
  transition: transform 160ms ease;
  pointer-events: none;
}
.imqb2-seg-tab {
  box-sizing: border-box; position: relative; z-index: 1; height: 28px; padding: 0 16px;
  border: 0; border-radius: var(--dsw-radius-sm, 6px); background: transparent;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; line-height: 20px;
  font-weight: 500; white-space: nowrap; cursor: pointer; transition: color 120ms ease;
}
.imqb2-seg-tab:hover, .imqb2-seg-tab[aria-selected='true'] { color: var(--dsw-alias-label-primary); }
.imqb2-seg-tab:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
/* 人格预设卡片（折叠抽屉：默认只显示标题，点击标题展开编辑） */
.imqb2-persona {
  display: flex; flex-direction: column; gap: 8px; padding: 10px 0;
  border-top: 0.5px solid var(--dsw-alias-border-l2);
}
.imqb2-persona-head { display: flex; align-items: center; gap: 8px; }
.imqb2-persona-toggle {
  appearance: none; flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px;
  border: 0; background: transparent; padding: 2px 0; cursor: pointer; font: inherit;
  text-align: left; color: inherit;
}
.imqb2-persona-toggle:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 2px; border-radius: var(--dsw-radius-sm, 6px);
}
.imqb2-persona-arrow {
  flex: none; font-size: 11px; line-height: 1; color: var(--dsw-alias-label-tertiary);
  transition: transform 120ms ease;
}
.imqb2-persona-arrow[data-expanded='true'] { transform: rotate(90deg); }
.imqb2-persona-title {
  flex: 1; min-width: 0; font-size: 13px; font-weight: 500; line-height: 1.5;
  color: var(--dsw-alias-label-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.imqb2-persona-sub {
  flex: none; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.imqb2-persona-body { display: flex; flex-direction: column; gap: 8px; padding-left: 19px; }
.imqb2-persona-remove {
  appearance: none; border: 0; background: transparent; padding: 2px 6px;
  border-radius: var(--dsw-radius-sm, 6px); cursor: pointer; font: inherit;
  font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary);
}
.imqb2-persona-remove:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.imqb2-persona-add {
  appearance: none; align-self: flex-start; border: 0.5px solid var(--dsw-alias-border-l4);
  background: transparent; border-radius: var(--dsw-radius-md, 8px); padding: 5px 12px;
  font: inherit; font-size: 12px; line-height: 1.5; cursor: pointer;
  color: var(--dsw-alias-label-secondary);
}
.imqb2-persona-add:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
/* 自定义音色行（名称 + 音色 id + 删除） */
.imqb2-voice-row { display: flex; gap: 6px; align-items: center; }
.imqb2-voice-row .imqb2-input { min-width: 0; }
.imqb2-voice-name { flex: 0 0 140px; }
.imqb2-voice-id { flex: 1 1 auto; }
/* 分区 tab 栏（自动换行，选中态为浮起胶囊） */
.imqb2-tabs {
  display: flex; flex-wrap: wrap; gap: 2px; padding: 4px; margin: 2px 0 4px;
  border-radius: var(--dsw-radius-md, 8px);
  background: var(--dsw-alias-interactive-bg-hover);
}
.imqb2-tab {
  appearance: none; flex: 0 0 auto; display: inline-flex; align-items: center; gap: 5px;
  height: 28px; padding: 0 10px; border: 0; border-radius: var(--dsw-radius-sm, 6px);
  background: transparent; font: inherit; font-size: 13px; line-height: 20px;
  font-weight: 500; color: var(--dsw-alias-label-secondary); white-space: nowrap; cursor: pointer;
  transition: color 120ms ease, background 120ms ease;
}
.imqb2-tab:hover, .imqb2-tab[aria-selected='true'] { color: var(--dsw-alias-label-primary); }
.imqb2-tab[aria-selected='true'] {
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-elevation-soft, 0 1px 3px rgba(0,0,0,.08));
}
.imqb2-tab:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.imqb2-tab-dot {
  flex: none; width: 5px; height: 5px; border-radius: 50%;
  background: var(--dsw-alias-state-business-primary);
}
.imqb2-tabpanel { display: flex; flex-direction: column; padding-top: 2px; }
/* 底栏（官方 SettingsForm.footer 复刻） */
.imqb2-footer { display: flex; align-items: center; gap: 8px; padding-top: 16px; }
.imqb2-note { flex: 1; min-width: 0; margin: 0; font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-tertiary); }
.imqb2-note--error { color: var(--dsw-alias-state-error-primary, var(--dsw-alias-label-error)); }
.imqb2-note--ok { color: var(--dsw-alias-label-secondary); }
.imqb2-save {
  appearance: none; flex: none; border: 1px solid transparent;
  border-radius: var(--dsw-radius-md, 8px); padding: 5px 14px;
  font: inherit; font-size: 13px; line-height: 1.5; cursor: pointer;
  background: var(--dsw-alias-label-primary); color: var(--dsw-alias-bg-layer-3);
}
.imqb2-save:disabled { opacity: 0.4; cursor: default; }
.imqb2-save:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: 1px;
}
/* cwd 只读行 */
.imqb2-readonly { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--dsw-alias-label-secondary); word-break: break-all; margin: 0; }
/* 群友人格：筛选栏 + 表格 + 详情 */
.imqb2-filters { display: flex; flex-wrap: wrap; gap: 6px; padding: 4px 0 10px; }
.imqb2-filter { flex: 1 1 140px; min-width: 120px; }
.imqb2-table-wrap { width: 100%; overflow-x: auto; padding-bottom: 4px; }
.imqb2-table { width: 100%; border-collapse: collapse; font-size: 12px; line-height: 1.5; }
.imqb2-table th {
  padding: 6px 8px; text-align: left; white-space: nowrap; font-weight: 600;
  color: var(--dsw-alias-label-tertiary); border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.imqb2-table td {
  padding: 7px 8px; vertical-align: top; color: var(--dsw-alias-label-primary);
  border-bottom: 0.5px solid var(--dsw-alias-border-l2);
}
.imqb2-table tr[data-expanded='true'] td { background: var(--dsw-alias-interactive-bg-hover); }
.imqb2-table-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: var(--dsw-alias-label-secondary); white-space: nowrap;
}
.imqb2-table-name { font-weight: 500; white-space: nowrap; }
.imqb2-table-click {
  appearance: none; border: 0; background: transparent; padding: 0;
  font: inherit; color: var(--dsw-alias-label-secondary); cursor: pointer; white-space: nowrap;
}
.imqb2-table-click:hover { color: var(--dsw-alias-label-primary); text-decoration: underline; }
.imqb2-table-meta { color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
.imqb2-chip--trait { font-size: 11px; padding: 2px 6px; }
.imqb2-chip--warn {
  border-color: var(--dsw-alias-state-warning-primary, #b26b00);
  color: var(--dsw-alias-state-warning-primary, #b26b00);
}
.imqb2-detail {
  display: flex; flex-direction: column; gap: 6px; padding: 8px 0 4px;
  font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-secondary);
}
.imqb2-detail-title { font-weight: 600; color: var(--dsw-alias-label-primary); }
.imqb2-detail-row { display: flex; gap: 6px; }
.imqb2-detail-key { flex: none; width: 76px; color: var(--dsw-alias-label-tertiary); }
.imqb2-empty { margin: 0; padding: 12px 0; font-size: 12px; line-height: 1.6; color: var(--dsw-alias-label-tertiary); }
    `;
    document.head.appendChild(style);
    return () => { style.remove(); };
  }, []);
}

/** 开关（官方 Switch 原语结构：aria-checked 驱动视觉态） */
function Switch({ checked, label, onChange }: {
  checked: boolean; label: string; onChange: (next: boolean) => void;
}): ReactNode {
  return createElement('button', {
    type: 'button', role: 'switch', 'aria-checked': checked, 'aria-label': label,
    className: 'imqb2-switch',
    onClick: () => { onChange(!checked); },
  }, createElement('span', { className: 'imqb2-switch-thumb' }));
}

/** 访问模式分段选择（官方 SegmentedControl 结构：CSS 变量定位滑动指示器） */
function Segmented({ value, options, onChange, label }: {
  value: string; options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (next: string) => void; label: string;
}): ReactNode {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const trackStyle = {
    '--imqb2-seg-count': options.length,
    '--imqb2-seg-index': index,
  } as CSSProperties;
  return createElement('div', { className: 'imqb2-seg', role: 'tablist', 'aria-label': label, style: trackStyle },
    createElement('span', { className: 'imqb2-seg-indicator' }),
    options.map((o) => createElement('button', {
      key: o.value, type: 'button', role: 'tab', 'aria-selected': o.value === value,
      className: 'imqb2-seg-tab', onClick: () => { onChange(o.value); },
    }, o.label)),
  );
}

/** 开关行（label 左 + Switch 右 + 可选 help） */
function SwitchRow({ label, help, checked, onChange }: {
  label: string; help?: string; checked: boolean; onChange: (next: boolean) => void;
}): ReactNode {
  return createElement('div', { className: 'imqb2-field' },
    createElement('div', { className: 'imqb2-head' },
      createElement('span', { className: 'imqb2-label' }, label),
      createElement(Switch, { checked, label, onChange }),
    ),
    help === undefined ? null : createElement('p', { className: 'imqb2-help' }, help),
  );
}

/** 文本行（label 上 + 输入下，与官方 fields 布局一致） */
function FieldRow({ label, help, value, placeholder, type, onChange }: {
  label: string; help?: string; value: string; placeholder?: string;
  /** input 类型（如 password）；缺省 text */
  type?: 'text' | 'password';
  onChange: (next: string) => void;
}): ReactNode {
  return createElement('div', { className: 'imqb2-field' },
    createElement('span', { className: 'imqb2-label' }, label),
    createElement('input', {
      className: 'imqb2-input', value, placeholder, spellCheck: false,
      type: type ?? 'text', autoComplete: 'off',
      onChange: (event: ChangeEvent<HTMLInputElement>) => { onChange(event.currentTarget.value); },
    }),
    help === undefined ? null : createElement('p', { className: 'imqb2-hint' }, help),
  );
}

/** 毫秒时间戳 → 本地 MM-DD HH:mm（表格紧凑展示） */
function formatShortTime(timestamp?: number): string {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return '—';
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 可信度中文 */
function confidenceText(confidence?: PersonaProfileWire['confidence']): string {
  return confidence === 'high' ? '高' : confidence === 'medium' ? '中' : confidence === 'low' ? '低' : '未评估';
}

/** 特点 chips（最多展示 4 个，超出用 +N） */
function traitChips(traits: readonly string[]): ReactNode {
  if (traits.length === 0) return createElement('span', { className: 'imqb2-table-meta' }, '—');
  const shown = traits.slice(0, 4);
  return createElement('span', { className: 'imqb2-chips' },
    ...shown.map((trait) => createElement('span', {
      key: trait, className: 'imqb2-chip imqb2-chip--trait',
    }, trait)),
    traits.length > shown.length
      ? createElement('span', { className: 'imqb2-table-meta' }, `+${traits.length - shown.length}`)
      : null,
  );
}

/** 会话分布文案（群聊只拿得到 openid，用短 id 区分） */
function chatDistribution(profile: PersonaProfileWire): string {
  if (profile.chats.length === 0) return '—';
  return profile.chats
    .filter((chat) => chat.messageCount > 0)
    .slice(0, 4)
    .map((chat) => `${chat.scope === 'group' ? '群' : '私聊'} ${chat.peerId.slice(0, 8)} · ${chat.messageCount} 条`)
    .join('；');
}

/**
 * 表格里的会话摘要（区分群聊 / 私聊）。
 *
 * 私聊与群聊下发的是同一个 openid（实测一致），所以同一个人的两处发言
 * 会落在一行里；这里把「几个群、几个私聊」直接标出来，避免只看到数字。
 */
function chatSummary(profile: PersonaProfileWire): string {
  const groupCount = profile.chats.filter((chat) => chat.scope === 'group').length;
  const c2cCount = profile.chats.filter((chat) => chat.scope === 'c2c').length;
  const parts = [
    groupCount > 0 ? `群 ${groupCount}` : '',
    c2cCount > 0 ? `私聊 ${c2cCount}` : '',
  ].filter((part) => part !== '');
  return parts.length > 0 ? parts.join(' · ') : String(profile.chatCount);
}

/** 一行卡的详情（展开后展示结构化分析结果） */
function PersonaProfileDetail({ profile }: { profile: PersonaProfileWire }): ReactNode {
  const rows: Array<{ key: string; value: ReactNode }> = [
    {
      key: '分析状态',
      value: profile.analyzedAt === undefined
        ? profile.pending
          ? '累计发言已达阈值，等待自动分析（也可在群里让机器人手动分析）'
          : '尚未分析（发言达到阈值后会自动生成）'
        : `${formatShortTime(profile.analyzedAt)} · 覆盖 ${profile.analyzedMessageCount ?? 0} 条`
          + ` · 可信度 ${confidenceText(profile.confidence)}`,
    },
    ...(profile.provider !== undefined
      ? [{ key: '分析模型', value: `${profile.provider} / ${profile.model ?? ''}` }]
      : []),
    { key: '说话风格', value: profile.style ?? '—' },
    { key: '口头禅', value: profile.catchphrases.length > 0 ? profile.catchphrases.join('；') : '—' },
    { key: '兴趣', value: profile.interests.length > 0 ? profile.interests.join('；') : '—' },
    { key: '群内角色', value: profile.role ?? '—' },
    { key: '相处建议', value: profile.advice ?? '—' },
    { key: '会话分布', value: chatDistribution(profile) },
    { key: 'openid', value: createElement('span', { className: 'imqb2-table-mono' }, profile.senderId) },
    ...(profile.lastError !== undefined
      ? [{ key: '上次失败', value: createElement('span', { className: 'imqb2-hint-warn' }, profile.lastError) }]
      : []),
  ];
  return createElement('div', { className: 'imqb2-detail' },
    ...rows.map((row) => createElement('div', { key: row.key, className: 'imqb2-detail-row' },
      createElement('span', { className: 'imqb2-detail-key' }, row.key),
      createElement('span', {}, row.value),
    )),
  );
}

/**
 * 群友人格表格（设置面板「群友人格」页签）。
 *
 * 数据来自 `GET /qqbot/im-qqbot/personas`，筛选在服务端完成（名称 / openid /
 * 人格特点），300ms 防抖；点一行展开结构化分析结果。
 */
function PersonaProfilesTable({ archived }: { archived: boolean }): ReactNode {
  const [name, setName] = useState('');
  const [openid, setOpenid] = useState('');
  const [trait, setTrait] = useState('');
  const [query, setQuery] = useState({ name: '', openid: '', trait: '' });
  const [profiles, setProfiles] = useState<PersonaProfileWire[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  // 输入防抖：连续输入时只在停顿 300ms 后查询，避免每敲一个字都打路由
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery({ name, openid, trait });
    }, 300);
    return () => { clearTimeout(timer); };
  }, [name, openid, trait]);

  useEffect(() => {
    let stopped = false;
    const params = new URLSearchParams();
    if (query.name.trim() !== '') params.set('name', query.name.trim());
    if (query.openid.trim() !== '') params.set('openid', query.openid.trim());
    if (query.trait.trim() !== '') params.set('trait', query.trait.trim());
    setLoading(true);
    setError(null);
    void fetch(`${BIND_PERSONAS_PATH}?${params.toString()}`, { cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as PersonaProfilesResponse;
        if (stopped) return;
        if (body.ok !== true) {
          setProfiles([]);
          setTotal(0);
          setError(body.error ?? `读取人格档案失败（HTTP ${res.status}）`);
          return;
        }
        setProfiles(Array.isArray(body.profiles) ? body.profiles : []);
        setTotal(typeof body.total === 'number' ? body.total : 0);
      })
      .catch((err: unknown) => {
        if (!stopped) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!stopped) setLoading(false);
      });
    return () => { stopped = true; };
  }, [query.name, query.openid, query.trait, refreshKey, archived]);

  const filterInput = (
    label: string,
    value: string,
    onChange: (next: string) => void,
  ): ReactNode => createElement('input', {
    className: 'imqb2-input imqb2-filter',
    value,
    placeholder: label,
    'aria-label': label,
    spellCheck: false,
    autoComplete: 'off',
    onChange: (event: ChangeEvent<HTMLInputElement>) => { onChange(event.currentTarget.value); },
    // 面板整体在 <form> 里：回车不应触发表单提交（保存配置）
    onKeyDown: (event: { key: string; preventDefault: () => void }) => {
      if (event.key === 'Enter') event.preventDefault();
    },
  });

  const header = createElement('tr', {},
    createElement('th', {}, '昵称'),
    createElement('th', {}, 'openid'),
    createElement('th', {}, '会话'),
    createElement('th', {}, '消息'),
    createElement('th', {}, '人格特点'),
    createElement('th', {}, '一句话印象'),
    createElement('th', {}, '最近发言'),
  );

  const rows = profiles.map((profile) => {
    const isOpen = expanded === profile.senderId;
    const trimmedName = profile.senderName?.trim() ?? '';
    const displayName = trimmedName !== '' ? trimmedName : `${profile.senderId.slice(0, 8)}…`;
    return createElement('tbody', { key: profile.senderId },
      createElement('tr', { 'data-expanded': isOpen },
        createElement('td', {},
          createElement('button', {
            type: 'button', className: 'imqb2-table-click',
            onClick: () => { setExpanded(isOpen ? null : profile.senderId); },
          }, displayName),
        ),
        createElement('td', {},
          createElement('span', { className: 'imqb2-table-mono', title: profile.senderId },
            `${profile.senderId.slice(0, 8)}…`),
        ),
        createElement('td', {
          className: 'imqb2-table-meta',
          title: chatDistribution(profile),
        }, chatSummary(profile)),
        createElement('td', {},
          createElement('span', { className: 'imqb2-table-meta' },
            `${profile.messageCount} 条`
            + (profile.analyzedMessageCount !== undefined && profile.analyzedMessageCount > 0
              ? ` · 分析 ${profile.analyzedMessageCount}`
              : '')),
          profile.pending
            ? createElement('span', { className: 'imqb2-chip imqb2-chip--warn', title: '累计发言已达到自动分析阈值' },
                '待分析')
            : null,
        ),
        createElement('td', {}, traitChips(profile.traits)),
        createElement('td', {}, profile.summary ?? createElement('span', { className: 'imqb2-table-meta' }, '—')),
        createElement('td', { className: 'imqb2-table-meta' }, formatShortTime(profile.lastAt)),
      ),
      isOpen
        ? createElement('tr', {},
            createElement('td', { colSpan: 7 }, createElement(PersonaProfileDetail, { profile }),
            ),
          )
        : null,
    );
  });

  return createElement('div', { className: 'imqb2-table-wrap' },
    createElement('div', { className: 'imqb2-head', style: { paddingBottom: '4px' } },
      createElement('span', { className: 'imqb2-label' }, '群友人格档案'),
      createElement('button', {
        type: 'button', className: 'imqb2-persona-add',
        onClick: () => { setRefreshKey((key) => key + 1); },
      }, loading ? '刷新中…' : '刷新'),
    ),
    createElement('div', { className: 'imqb2-filters' },
      filterInput('按昵称筛选', name, setName),
      filterInput('按 openid 筛选', openid, setOpenid),
      filterInput('按人格特点筛选（如 慢热 / 毒舌）', trait, setTrait),
    ),
    error !== null
      ? createElement('p', { className: 'imqb2-empty' }, `人格档案读取失败：${error}`)
      : profiles.length === 0
        ? createElement('p', { className: 'imqb2-empty' },
            loading
              ? '正在读取人格档案…'
              : archived
                ? '还没有匹配的人格档案。群友累计发言达到阈值后会自动分析（也可在群里 @机器人 说「分析一下某某的性格」）。'
                : '请先打开上方「群聊人格档案」。')
        : createElement('table', { className: 'imqb2-table' },
            createElement('thead', {}, header),
            ...rows,
          ),
    profiles.length > 0
      ? createElement('p', { className: 'imqb2-empty' },
          `共 ${total} 位群友${total > profiles.length ? `（当前展示 ${profiles.length} 位）` : ''}`
          + '；同一 openid 在多个群/私聊的发言会合并成一份档案。')
      : null,
  );
}

/** 不在候选项里的历史音色值的占位（不可重新选中，只用于回显） */
const CURRENT_VOICE_OPTION = '__imqb2-current-voice__';

/**
 * 音色下拉（原生 select，不允许手输）
 *
 * 候选项 = 自定义音色（置顶）+ 内置系统音色。当前模型不支持的预设也会列出来，
 * 但标注「需 xxx 模型」；选中这类音色时下面会出现警告，提醒先把「语音模型」改掉。
 * 旧配置里不在清单中的音色 id 会作为「当前音色」保留，避免一打开面板就被静默改掉。
 */
function VoiceSelectField({ label, value, placeholder, help, options, onChange }: {
  label: string; value: string; placeholder?: string; help?: ReactNode;
  options: VoiceOption[]; onChange: (next: string) => void;
}): ReactNode {
  const current = value.trim();
  const known = options.some((option) => option.value === current);
  const mismatch = known ? options.find((option) => option.value === current)?.requiresModel : undefined;
  // 不在清单里的历史音色：可能来自另一代语音模型（3.0 / 3.1 的复刻/设计音色不通用）
  const unknown = current !== '' && !known && options.length > 0;
  const selectValue = known ? current : current === '' ? '' : CURRENT_VOICE_OPTION;
  return createElement('div', { className: 'imqb2-field' },
    createElement('span', { className: 'imqb2-label' }, label),
    createElement('select', {
      className: 'imqb2-input imqb2-select', value: selectValue,
      onChange: (event: ChangeEvent<HTMLSelectElement>) => {
        const next = event.currentTarget.value;
        // 历史音色占位项不可再被选中（它只用于展示当前值）
        if (next === CURRENT_VOICE_OPTION) return;
        onChange(next);
      },
    },
      createElement('option', { value: '' }, placeholder ?? '（留空，继承全局音色）'),
      current !== '' && !known
        ? createElement('option', { value: CURRENT_VOICE_OPTION },
            `${current}（当前音色，不在列表中）`)
        : null,
      options.map((option) => createElement('option', { key: option.value, value: option.value },
        option.requiresModel === undefined
          ? option.label
          : `${option.label} · 需 ${option.requiresModel} 模型`)),
    ),
    mismatch === undefined
      ? null
      : createElement('p', { className: 'imqb2-hint-warn' },
          `当前音色只支持 ${mismatch}，与现用语音模型不匹配，合成会失败；请把「语音模型」改成 ${mismatch}。`),
    unknown
      ? createElement('p', { className: 'imqb2-hint-warn' },
          '当前音色不在内置清单中（多半是复刻/设计音色）：它绑定在创建时的账号与模型上，'
          + '换代际后通常仍可合成，若失败请回到原代际模型，或在当前代际重新克隆。')
      : null,
    help === undefined ? null : createElement('p', { className: 'imqb2-hint' }, help),
  );
}

/** 不在候选里的历史模型占位（只用于回显，不可重新选中） */
const CURRENT_MODEL_OPTION = '__imqb2-current-model__';
/** 模型下拉里的「手动输入其他模型 id」项 */
const MANUAL_MODEL_OPTION = '__imqb2-manual-model__';

/**
 * 语音模型下拉（只列插件内置验证过的 Qwen 模型；其他模型走「其他模型 id」手动输入）
 *
 * 与「默认音色」联动：切换模型后由面板统一把内置同名音色改写到目标代际、
 * 目标模型不支持的内置音色回落到该模型缺省音色（见 applyVoiceModel）。
 */
function VoiceModelField({ value, help, onChange }: {
  value: string; help?: ReactNode; onChange: (next: string) => void;
}): ReactNode {
  const current = value.trim();
  const preset = findVoiceModel(current);
  const [manual, setManual] = useState(preset === undefined && current !== '');
  const selectValue = manual
    ? MANUAL_MODEL_OPTION
    : preset === undefined
      ? (current === '' ? '' : CURRENT_MODEL_OPTION)
      : current;
  return createElement('div', { className: 'imqb2-field' },
    createElement('span', { className: 'imqb2-label' }, '语音模型'),
    createElement('select', {
      className: 'imqb2-input imqb2-select', value: selectValue,
      onChange: (event: ChangeEvent<HTMLSelectElement>) => {
        const next = event.currentTarget.value;
        // 历史模型占位项不可再被选中（它只用于展示当前值）
        if (next === CURRENT_MODEL_OPTION) return;
        if (next === MANUAL_MODEL_OPTION) { setManual(true); return; }
        setManual(false);
        onChange(next);
      },
    },
      createElement('option', { value: '' }, `（留空，使用缺省 ${DEFAULT_VOICE_MODEL}）`),
      current !== '' && preset === undefined
        ? createElement('option', { value: CURRENT_MODEL_OPTION },
            `${current}（当前模型，不在列表中）`)
        : null,
      VOICE_MODELS.map((model) => createElement('option', { key: model.id, value: model.id },
        model.recommended === true ? `${model.label}（推荐）` : model.label)),
      createElement('option', { value: MANUAL_MODEL_OPTION }, '其他模型 id（手动输入）'),
    ),
    manual
      ? createElement('input', {
          className: 'imqb2-input', value: current,
          placeholder: '自定义模型 id（如 cosyvoice-v2）',
          spellCheck: false, autoComplete: 'off',
          onChange: (event: ChangeEvent<HTMLInputElement>) => { onChange(event.currentTarget.value); },
        })
      : null,
    manual
      ? createElement('p', { className: 'imqb2-hint' },
          '内置音色清单只覆盖 Qwen-Audio-TTS；其他模型的音色请在「自定义音色」里手动添加。')
      : preset === undefined
        ? createElement('p', { className: 'imqb2-hint' },
            current === ''
              ? `留空时使用缺省模型 ${DEFAULT_VOICE_MODEL}。`
              : '当前模型不在内置清单里：只能使用「自定义音色」，内置系统音色不会列出。')
        : createElement('p', { className: 'imqb2-hint' }, preset.help),
    help === undefined ? null : createElement('p', { className: 'imqb2-hint' }, help),
  );
}

/**
 * 自定义音色编辑器：用户自己填「名称 + 音色 id」。
 *
 * 新增行插到数组头部，因此下拉里最新添加的音色排在最上面（在系统预设之前）。
 */
function VoicePresetListField({ value, onChange }: {
  value: VoicePresetEntryWire[]; onChange: (next: VoicePresetEntryWire[]) => void;
}): ReactNode {
  const updateRow = (index: number, next: Partial<VoicePresetEntryWire>): void => {
    onChange(value.map((row, i) => (i === index ? { ...row, ...next } : row)));
  };
  return createElement('div', { className: 'imqb2-field' },
    createElement('span', { className: 'imqb2-label' }, '自定义音色'),
    value.length === 0
      ? createElement('p', { className: 'imqb2-hint' },
          '还没有自定义音色。点击下方按钮新增，填名称 + 音色 id；新增项会排在音色下拉的最上方。')
      : value.map((row, index) => createElement('div', {
          key: `voice-preset-${index}`, className: 'imqb2-voice-row',
        },
          createElement('input', {
            className: 'imqb2-input imqb2-voice-name', value: row.name ?? '',
            placeholder: '名称（如 元气少女）', spellCheck: false, autoComplete: 'off',
            onChange: (event: ChangeEvent<HTMLInputElement>) => {
              updateRow(index, { name: event.currentTarget.value });
            },
          }),
          createElement('input', {
            className: 'imqb2-input imqb2-voice-id', value: row.voice ?? '',
            placeholder: '音色 id（如 longanfengyue_v3.1 或克隆音色 id）',
            spellCheck: false, autoComplete: 'off',
            onChange: (event: ChangeEvent<HTMLInputElement>) => {
              updateRow(index, { voice: event.currentTarget.value });
            },
          }),
          createElement('button', {
            type: 'button', className: 'imqb2-chip-x',
            'aria-label': `删除音色 ${(row.name ?? '').trim() || index + 1}`,
            title: '删除这个音色',
            onClick: () => { onChange(value.filter((_, i) => i !== index)); },
          }, '×'),
        )),
    createElement('button', {
      type: 'button', className: 'imqb2-persona-add',
      onClick: () => { onChange([{ name: '', voice: '' }, ...value]); },
    }, '＋ 添加音色'),
    createElement('p', { className: 'imqb2-hint' },
      '这里填的是你自己的声音复刻 / 声音设计音色 id（绑定在创建它的账号上；旧代际的音色在 3.1 模型下通常也能用，但官方未承诺），'
      + '下拉里排在内置系统音色之前；留空的音色 id 保存时会被丢弃。'),
  );
}

/** 多行文本行 */
function AreaRow({ label, help, value, rows, onChange }: {
  label: string; help?: string; value: string; rows?: number; onChange: (next: string) => void;
}): ReactNode {
  return createElement('div', { className: 'imqb2-field' },
    createElement('span', { className: 'imqb2-label' }, label),
    createElement('textarea', {
      className: 'imqb2-input imqb2-textarea', value, rows: rows ?? 3,
      onChange: (event: ChangeEvent<HTMLTextAreaElement>) => { onChange(event.currentTarget.value); },
    }),
    help === undefined ? null : createElement('p', { className: 'imqb2-hint' }, help),
  );
}

/** 访问模式分段选择行 */
function SegmentedRow({ label, help, value, options, onChange }: {
  label: string; help?: string; value: string;
  options: ReadonlyArray<{ value: string; label: string }>; onChange: (next: string) => void;
}): ReactNode {
  return createElement('div', { className: 'imqb2-field' },
    createElement('div', { className: 'imqb2-head' },
      createElement('span', { className: 'imqb2-label' }, label),
      createElement(Segmented, { value, options, onChange, label }),
    ),
    help === undefined ? null : createElement('p', { className: 'imqb2-hint' }, help),
  );
}

/**
 * 人格工具下拉：已选工具以 chip 展示，下拉只列还没选中的候选。
 *
 * 候选 = 宿主运行时工具 ∪ 内置常用清单 ∪ 当前已配置的名字，
 * 所以清空后还能从下拉里把同一个工具加回来。
 */
function ToolPicker({ selected, available, onChange }: {
  selected: string[]; available: string[]; onChange: (next: string[]) => void;
}): ReactNode {
  const chosen = selected.map((name) => name.trim()).filter(Boolean);
  const groups = groupToolNames(available.filter((name) => !chosen.includes(name)));

  return createElement('div', { className: 'imqb2-field', style: { padding: '4px 0 0', borderTop: 0 } },
    chosen.length === 0
      ? createElement('p', { className: 'imqb2-hint' }, '还没选任何工具：留空 = 该人格没有任何工具能力。')
      : createElement('div', { className: 'imqb2-chips' },
          chosen.map((name) => createElement('span', { key: name, className: 'imqb2-chip' },
            name,
            createElement('button', {
              type: 'button', className: 'imqb2-chip-x',
              'aria-label': `移除 ${name}`, title: `移除 ${name}`,
              onClick: () => { onChange(chosen.filter((item) => item !== name)); },
            }, '×'),
          )),
        ),
    createElement('select', {
      className: 'imqb2-input imqb2-select',
      'aria-label': '添加工具',
      value: '',
      onChange: (event: ChangeEvent<HTMLSelectElement>) => {
        const name = event.currentTarget.value;
        if (name !== '') onChange([...chosen, name]);
      },
    },
      createElement('option', { value: '' },
        groups.length === 0 ? '已选完全部可用工具' : '＋ 选择要允许的工具…'),
      groups.map(({ group, tools }) => createElement('optgroup', { key: group, label: group },
        tools.map((tool) => createElement('option', { key: tool.name, value: tool.name },
          `${tool.label}（${tool.name}）`)),
      )),
    ),
  );
}

/**
 * 单个人格预设编辑卡片（抽屉式：默认收起，点击标题展开 id / 名称 / prompt）
 *
 * 收起态只占一行，人格多时面板不会被撑得过长。
 */
function PersonaCard({ index, value, expanded, available, voiceOptions, onChange, onToggle, onRemove }: {
  index: number; value: PersonaWire; expanded: boolean; available: string[];
  /** 语音音色预设（与全局页签使用同一份清单） */
  voiceOptions: VoiceOption[];
  onChange: (next: Partial<PersonaWire>) => void; onToggle: () => void; onRemove: () => void;
}): ReactNode {
  const title = value.name.trim() || value.id.trim() || `人格 ${index + 1}`;
  const kaomojiEnabled = value.expressions?.kaomoji?.enabled === true;
  const kaomojiStyle = kaomojiEnabled
    ? (value.expressions?.kaomoji?.style?.trim() || 'daily')
    : '';
  const voiceId = value.expressions?.voice?.voice?.trim() ?? '';
  const voiceLabel = voiceOptionLabel(voiceOptions, voiceId);
  const subtitle = [
    value.id.trim(),
    value.tools === undefined ? undefined : `工具 ${value.tools.filter((t) => t.trim()).length}`,
    kaomojiEnabled ? `颜文字·${findKaomojiStyle(kaomojiStyle)?.name ?? kaomojiStyle}` : undefined,
    voiceId !== '' ? `语音·${voiceLabel}` : undefined,
    (value.expressions?.voice?.instruction ?? '').trim() !== '' ? '情感指令' : undefined,
  ].filter((part): part is string => part !== undefined).join(' · ');
  const updatePersonaVoice = (next: Partial<PersonaVoiceWire>): void => {
    const { voice: _removedVoice, ...restExpressions } = value.expressions ?? {};
    const merged: PersonaVoiceWire = { ...value.expressions?.voice, ...next };
    const nextVoice: PersonaVoiceWire = {};
    if ((merged.voice ?? '').trim() !== '') nextVoice.voice = merged.voice;
    if (merged.rate !== undefined) nextVoice.rate = merged.rate;
    if (merged.volume !== undefined) nextVoice.volume = merged.volume;
    const instruction = (merged.instruction ?? '').trim();
    if (instruction !== '') nextVoice.instruction = instruction;
    const hasVoice = Object.keys(nextVoice).length > 0;
    const expressions = hasVoice
      ? { ...restExpressions, voice: nextVoice }
      : restExpressions;
    onChange({ expressions: Object.keys(expressions).length > 0 ? expressions : undefined });
  };
  return createElement('div', { className: 'imqb2-persona' },
    createElement('div', { className: 'imqb2-persona-head' },
      createElement('button', {
        type: 'button', className: 'imqb2-persona-toggle',
        'aria-expanded': expanded,
        title: expanded ? '收起' : '展开编辑',
        onClick: onToggle,
      },
        createElement('span', {
          className: 'imqb2-persona-arrow', 'data-expanded': expanded,
        }, '▶'),
        createElement('span', { className: 'imqb2-persona-title' }, title),
        createElement('span', { className: 'imqb2-persona-sub' }, subtitle),
      ),
      createElement('button', {
        type: 'button', className: 'imqb2-persona-remove',
        onClick: onRemove,
      }, '删除'),
    ),
    expanded
      ? createElement('div', { className: 'imqb2-persona-body' },
          createElement('input', {
            className: 'imqb2-input', value: value.id, spellCheck: false,
            placeholder: 'id（字母/数字/-/_，QQ 端 /persona <id> 用）',
            onChange: (event: ChangeEvent<HTMLInputElement>) => { onChange({ id: event.currentTarget.value }); },
          }),
          createElement('input', {
            className: 'imqb2-input', value: value.name, spellCheck: false,
            placeholder: '展示名称（QQ 菜单里显示）',
            onChange: (event: ChangeEvent<HTMLInputElement>) => { onChange({ name: event.currentTarget.value }); },
          }),
          createElement('textarea', {
            className: 'imqb2-input imqb2-textarea', value: value.prompt, rows: 5,
            placeholder: '该人格的 system prompt（只写角色设定/说话风格）',
            onChange: (event: ChangeEvent<HTMLTextAreaElement>) => { onChange({ prompt: event.currentTarget.value }); },
          }),
          createElement('div', { className: 'imqb2-field', style: { padding: '8px 0 4px', borderTop: 0 } },
            createElement('div', { className: 'imqb2-head' },
              createElement('span', { className: 'imqb2-label' }, '颜文字'),
              createElement(Switch, {
                checked: kaomojiEnabled,
                label: '颜文字',
                onChange: (checked) => {
                  if (!checked) {
                    // 只移除 kaomoji，保留同一容器下的 voice（反之亦然）
                    const { kaomoji: _kaomoji, ...rest } = value.expressions ?? {};
                    onChange({ expressions: Object.keys(rest).length > 0 ? rest : undefined });
                    return;
                  }
                  const current = value.expressions?.kaomoji;
                  onChange({
                    expressions: {
                      ...value.expressions,
                      kaomoji: {
                        ...current,
                        enabled: true,
                        style: current?.style?.trim() || DEFAULT_KAOMOJI_STYLE,
                      },
                    },
                  });
                },
              }),
            ),
            kaomojiEnabled
              ? createElement('div', { className: 'imqb2-head', style: { marginTop: '6px' } },
                  createElement('span', { className: 'imqb2-label' }, '风格'),
                  createElement('select', {
                    className: 'imqb2-input imqb2-select', style: { width: 'auto', minWidth: '160px' },
                    'aria-label': '颜文字风格',
                    value: kaomojiStyle || DEFAULT_KAOMOJI_STYLE,
                    onChange: (event: ChangeEvent<HTMLSelectElement>) => {
                      const style = event.currentTarget.value;
                      const current = value.expressions?.kaomoji;
                      onChange({
                        expressions: {
                          ...value.expressions,
                          kaomoji: { ...current, enabled: true, style },
                        },
                      });
                    },
                  },
                    KAOMOJI_STYLES.map((style) => createElement('option', { key: style.id, value: style.id },
                      `${style.name}（${style.id}）`)),
                  ),
                )
              : null,
            createElement('p', { className: 'imqb2-hint' },
              '开启后把该风格的颜文字清单写进 system prompt，模型按语境自然使用（默认一条回复最多 1 个），不需要工具调用。'),
          ),
          createElement(VoiceSelectField, {
            label: '语音音色',
            value: value.expressions?.voice?.voice ?? '',
            placeholder: '（留空，继承全局音色）',
            options: voiceOptions,
            help: '从下拉里选内置系统音色或自定义音色；留空继承全局音色。'
              + '标了「需 xxx 模型」的音色与当前语音模型不匹配，需要先把全局「语音模型」改过去。',
            onChange: (nextVoiceId) => { updatePersonaVoice({ voice: nextVoiceId }); },
          }),
          createElement(FieldRow, {
            label: '语音情感/语气（可选）',
            value: value.expressions?.voice?.instruction ?? '',
            placeholder: '如：用清冷、克制的语气，语速稍慢',
            help: '自然语言指令，合成时随请求下发；留空继承全局「情感/语气指令」。qwen-audio-3.1/3.0-tts-plus/flash 支持。',
            onChange: (next) => { updatePersonaVoice({ instruction: next }); },
          }),
          createElement('div', { className: 'imqb2-head' },
            createElement('span', { className: 'imqb2-label' }, '限制可用工具'),
            createElement(Switch, {
              checked: value.tools !== undefined,
              label: '限制可用工具',
              onChange: (checked) => { onChange({ tools: checked ? [] : undefined }); },
            }),
          ),
          value.tools === undefined
            ? createElement('p', { className: 'imqb2-hint' },
                '关闭时使用默认放行清单（插件内置工具 + 只读联网/提问）；开启后模型只能看到下面选中的工具（硬约束，不是提示词）。')
            : createElement(ToolPicker, {
                selected: value.tools,
                available,
                onChange: (next) => { onChange({ tools: next }); },
              }),
          createElement('p', { className: 'imqb2-hint' },
            '候选只有 QQ 插件内置工具（做题 / 看图 / 发文件 / 翻译 / 总结 / 讲解 / 改写）；文件读写、命令执行等宿主能力默认不开放。'),
        )
      : null,
  );
}

type AccessMode = AccessControlWire['c2cMode'];

const MODE_OPTIONS: ReadonlyArray<{ value: AccessMode; label: string }> = [
  { value: 'open', label: '所有人' },
  { value: 'allowlist', label: '白名单' },
  { value: 'disabled', label: '禁用' },
];

const SPLIT_OPTIONS: ReadonlyArray<{ value: ReplySplitMode; label: string }> = [
  { value: 'none', label: '按长度' },
  { value: 'delimiter', label: '约定分隔符' },
  { value: 'line', label: '每个换行' },
  { value: 'paragraph', label: '按空行' },
];

/** 配置分区：每页只展示一组相关配置，避免单列过长 */
type TabId = 'access' | 'identity' | 'members' | 'conversation' | 'voice' | 'model' | 'personas' | 'update';

interface TabDef {
  id: TabId;
  label: string;
  /** 该分区包含的配置键（用于在 tab 上显示「未保存」小圆点） */
  keys: ReadonlyArray<keyof ConfigWire>;
}

const TABS: ReadonlyArray<TabDef> = [
  { id: 'access', label: '服务范围', keys: ['access'] },
  { id: 'identity', label: '身份与权限', keys: ['identity'] },
  { id: 'members', label: '群友人格', keys: ['personaAnalysis'] },
  {
    id: 'conversation', label: '对话设置',
    keys: ['requireMention', 'streaming', 'replySplitMode', 'replySplitIntervalMs', 'showToolResults'],
  },
  { id: 'voice', label: '语音回复', keys: ['voice'] },
  { id: 'model', label: '模型与提示词', keys: ['provider', 'model', 'preset', 'globalPrompt'] },
  { id: 'personas', label: '人格预设', keys: ['personas', 'defaultPersona'] },
  // 插件更新不是配置项（keys 为空，永远不会出现「未保存」小圆点）
  { id: 'update', label: '插件更新', keys: [] },
];

/** 安装方式的中文说明 */
function updateKindLabel(kind: UpdateInstallWire['kind']): string {
  switch (kind) {
    case 'git': return 'Git 安装';
    case 'npm': return 'npm 安装';
    case 'local': return '本地路径安装';
    default: return '未知安装方式';
  }
}

/** commit 缩写（非 commit 的引用原样返回） */
function shortHash(ref: string): string {
  return /^[0-9a-f]{7,40}$/i.test(ref) ? ref.slice(0, 7) : ref;
}

/** 深比较（表单值与初始回显值的 dirty 判断） */
function shallowEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * 配置面板主体。
 *
 * 保存仅提交变更键（服务端按白名单合并），保存成功后提示
 * HMR 重载语义（进行中的机器人会话将重置）。
 */
export function ConfigPanel(props?: { bindPhase?: string }): ReactNode {
  useConfigPanelStyles();
  const [initial, setInitial] = useState<ConfigWire | null>(null);
  const [form, setForm] = useState<ConfigWire | null>(null);
  // 宿主运行时上报的工具名（与内置清单合并后供人格工具下拉）
  const [discoveredTools, setDiscoveredTools] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // 人格抽屉展开状态（按索引记录；默认全部收起）
  const [expandedPersonas, setExpandedPersonas] = useState<Set<number>>(() => new Set());
  // 当前配置分区（默认落在最常用的「服务范围」）
  const [activeTab, setActiveTab] = useState<TabId>('access');
  // 插件更新页签：安装信息 / 远端检查结果 / 操作状态（不参与配置保存）
  const [updateInfo, setUpdateInfo] = useState<UpdateInstallWire | null>(null);
  const [updateCheck, setUpdateCheck] = useState<UpdateCheckWire | null>(null);
  const [updateBusy, setUpdateBusy] = useState<'check' | 'update' | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateNotice, setUpdateNotice] = useState<string | null>(null);
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  // 绑定相位变化时重拉配置（扫码落库的白名单等新值）
  const bindPhase = props?.bindPhase;

  useEffect(() => {
    let stopped = false;
    void fetch(BIND_CONFIG_PATH, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { config: ConfigWire; tools?: string[] };
        if (stopped) return;
        setInitial(body.config);
        setForm(body.config);
        setDiscoveredTools(Array.isArray(body.tools) ? body.tools : []);
      })
      .catch((err: unknown) => {
        if (!stopped) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => { stopped = true; };
  }, [bindPhase]);

  // 更新页签首次打开时读取安装信息（未打开不请求，避免多一次路由往返）
  useEffect(() => {
    if (activeTab !== 'update' || updateInfo !== null) return;
    let stopped = false;
    void fetch(BIND_UPDATE_PATH, { cache: 'no-store' })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as UpdateStateWire;
        if (stopped) return;
        if (body.install !== undefined) setUpdateInfo(body.install);
        else if (res.status === 404) {
          // 服务端没有 /update 路由 = 在跑的插件进程比面板旧（升级后没重启 DSH 的典型症状）：
          // 面板由磁盘上的 lib/client.js 提供，服务端代码却还是进程启动时加载的那份
          setUpdateError('插件服务端仍在跑旧代码（找不到更新接口）。请完全退出并重启 DSH（不是只关窗口）后重试。');
        } else setUpdateError(body.error ?? `读取安装信息失败（HTTP ${res.status}）`);
      })
      .catch((err: unknown) => {
        if (!stopped) setUpdateError(err instanceof Error ? err.message : String(err));
      });
    return () => { stopped = true; };
  }, [activeTab, updateInfo]);

  const patch = useCallback(<K extends keyof ConfigWire>(key: K, value: ConfigWire[K]): void => {
    setForm((current) => current === null ? current : { ...current, [key]: value });
    setResult(null);
  }, []);

  const submit = useCallback((event: FormEvent): void => {
    event.preventDefault();
    if (busy || initial === null || form === null) return;
    const changed: Record<string, unknown> = {};
    for (const key of Object.keys(form) as Array<keyof ConfigWire>) {
      if (!shallowEqual(form[key], initial[key])) {
        changed[key] = form[key];
      }
    }
    if (Object.keys(changed).length === 0) return;

    // 白名单编辑期间保留原始换行/空行（textarea 可正常回车），提交时才规范化
    if (changed.access !== undefined) {
      const a = changed.access as AccessControlWire;
      changed.access = {
        ...a,
        c2cAllow: a.c2cAllow.map((s) => s.trim()).filter(Boolean),
        groupAllow: a.groupAllow.map((s) => s.trim()).filter(Boolean),
      };
    }

    // 身份名单：提交时裁剪空白与空行，保留原始大小写
    if (changed.identity !== undefined) {
      const i = changed.identity as IdentityWire;
      const clean = (list: string[]): string[] => list.map((s) => s.trim()).filter(Boolean);
      changed.identity = {
        enabled: i.enabled !== false,
        ownerOpenIds: clean(i.ownerOpenIds),
        adminOpenIds: clean(i.adminOpenIds),
        friendOpenIds: clean(i.friendOpenIds),
      };
    }

    // 人格预设：提交时裁剪 id/名称，prompt 保留原文（换行有意义）
    if (changed.personas !== undefined) {
      changed.personas = (changed.personas as PersonaWire[]).map((p) => ({
        id: p.id.trim(),
        name: p.name.trim(),
        prompt: p.prompt,
        ...(p.tools !== undefined
          ? { tools: [...new Set(p.tools.map((t) => t.trim()).filter(Boolean))] }
          : {}),
        // 表达方式（颜文字 / 语音音色）：不提交会被服务端整体替换掉
        ...(p.expressions !== undefined ? { expressions: p.expressions } : {}),
      }));
    }
    if (changed.defaultPersona !== undefined) {
      changed.defaultPersona = String(changed.defaultPersona).trim();
    }

    // 语音配置：hasApiKey 只读提示不透传；空 apiKey = 保持已保存的 Key；
    // 字数/超时收敛到服务端允许的范围
    if (changed.voice !== undefined) {
      const v = changed.voice as VoiceWire;
      const { hasApiKey: _hasApiKey, ...rest } = v;
      const maxChars = Math.round(Number(rest.maxChars));
      const timeoutMs = Math.round(Number(rest.timeoutMs));
      // 自定义音色：去空白、丢弃没有音色 id 的行（顺序保持 = 下拉顺序，新增项在最前）
      const presets = (rest.presets ?? [])
        .map((entry) => ({ name: (entry.name ?? '').trim(), voice: (entry.voice ?? '').trim() }))
        .filter((entry) => entry.voice !== '');
      changed.voice = {
        ...rest,
        apiKey: (rest.apiKey ?? '').trim(),
        instruction: (rest.instruction ?? '').trim(),
        presets,
        maxChars: Number.isFinite(maxChars) ? Math.min(1000, Math.max(20, maxChars)) : 300,
        timeoutMs: Number.isFinite(timeoutMs) ? Math.min(120000, Math.max(5000, timeoutMs)) : 30000,
      };
    }

    // 群聊人格档案：条数收敛到 20–1000，保留天数收敛到 1–365，自动分析阈值收敛到 5–200
    if (changed.personaAnalysis !== undefined) {
      const p = changed.personaAnalysis as PersonaAnalysisWire;
      const maxMessages = Math.round(Number(p.maxMessages));
      const retentionDays = Math.round(Number(p.retentionDays));
      const autoAnalyzeThreshold = Math.round(Number(p.autoAnalyzeThreshold));
      changed.personaAnalysis = {
        enabled: p.enabled !== false,
        maxMessages: Number.isFinite(maxMessages) ? Math.min(1000, Math.max(20, maxMessages)) : 300,
        retentionDays: Number.isFinite(retentionDays) ? Math.min(365, Math.max(1, retentionDays)) : 30,
        autoAnalyze: p.autoAnalyze !== false,
        autoAnalyzeThreshold: Number.isFinite(autoAnalyzeThreshold)
          ? Math.min(200, Math.max(5, autoAnalyzeThreshold))
          : 20,
      };
    }

    setBusy(true);
    void fetch(BIND_CONFIG_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(changed),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
        if (res.ok && body.ok === true) {
          setResult({ ok: true, message: body.message ?? '配置已保存，插件将自动重载' });
          // 语音 Key 不留在客户端内存里：保存成功后清空输入框，只保留 hasApiKey 提示
          let nextForm = form;
          if (changed.voice !== undefined) {
            const submitted = changed.voice as VoiceWire;
            const hasKey = submitted.clearApiKey === true
              ? false
              : (submitted.apiKey ?? '').trim() !== '' || form.voice?.hasApiKey === true;
            nextForm = {
              ...form,
              voice: { ...form.voice, apiKey: '', clearApiKey: false, hasApiKey: hasKey },
            };
            setForm(nextForm);
          }
          setInitial(nextForm);
          return;
        }
        setResult({ ok: false, message: body.error ?? `保存失败（HTTP ${res.status}）` });
      })
      .catch((err: unknown) => {
        setResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
      })
      .finally(() => { setBusy(false); });
  }, [busy, form, initial]);

  // 更新页签动作：check = 对比远端；update = 执行 pnpm update 并等待重载
  const runUpdateAction = useCallback((action: 'check' | 'update'): void => {
    setUpdateBusy(action);
    setUpdateError(null);
    setUpdateNotice(null);
    void fetch(BIND_UPDATE_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action }),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as UpdateStateWire;
        if (body.install !== undefined) setUpdateInfo(body.install);
        if (body.check !== undefined) setUpdateCheck(body.check);
        if (body.ok === true) {
          // 检查成功的结论已经在「版本检查」区展示，这里只处理更新成功的提示；
          // 更新成功后清掉旧的检查结果，避免仍显示「发现新版本」
          if (action === 'update') {
            setUpdateNotice(body.message ?? '更新完成');
            setConfirmUpdate(false);
            setUpdateCheck(null);
          }
          return;
        }
        setUpdateError(body.error ?? `操作失败（HTTP ${res.status}）`);
      })
      .catch((err: unknown) => {
        setUpdateError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => { setUpdateBusy(null); });
  }, []);

  if (loadError !== null) {
    return createElement('p', { className: 'imqb2-hint', style: { padding: '12px 0' } },
      `配置加载失败：${loadError}`);
  }
  if (initial === null || form === null) {
    return createElement('p', { className: 'imqb2-hint', style: { padding: '12px 0' } }, '正在加载配置…');
  }

  const changedKeys = (Object.keys(form) as Array<keyof ConfigWire>)
    .filter((key) => !shallowEqual(form[key], initial[key]));
  const dirty = changedKeys.length > 0;
  const access: AccessControlWire = form.access ?? { c2cMode: 'allowlist', c2cAllow: [], groupMode: 'open', groupAllow: [] };
  const identity: IdentityWire = form.identity
    ?? { enabled: true, ownerOpenIds: [], adminOpenIds: [], friendOpenIds: [] };
  const personaAnalysis: PersonaAnalysisWire = form.personaAnalysis
    ?? { enabled: true, maxMessages: 300, retentionDays: 30, autoAnalyze: true, autoAnalyzeThreshold: 20 };
  const personas = form.personas ?? [];
  // 语音配置：GET 只回 hasApiKey（Key 永远不回显）
  const voice: VoiceWire = form.voice ?? {};
  // 音色下拉候选：用户自定义音色在最上，内置系统音色在后（模型与预设不匹配时只剩自定义项）
  const voiceOptions = buildVoiceOptions(voice.presets, voice.model);
  const customPresetCount = (voice.presets ?? []).filter((entry) => (entry.voice ?? '').trim() !== '').length;

  // 工具下拉候选：只保留插件内置工具（做题/看图/发文件 + 翻译/总结/讲解/改写）。
  // 宿主 preset 的文件读写、命令执行等能力不进候选；已配置的旧名字仍以 chip
  // 展示，方便用户逐个删掉。
  const toolCandidates = mergeToolNames(
    discoveredTools.filter((name) => isPluginToolName(name)),
    catalogToolNames(),
    ...personas.map((persona) => (persona.tools ?? []).filter((name) => isPluginToolName(name))),
  );

  const updatePersona = (index: number, next: Partial<PersonaWire>): void => {
    const list = [...(form.personas ?? [])];
    const current = list[index];
    if (current === undefined) return;
    list[index] = { ...current, ...next };
    patch('personas', list);
    // 改 id 时同步默认人格引用，避免默认人格指向旧 id 而失效
    if (next.id !== undefined && current.id !== '' && form.defaultPersona === current.id) {
      patch('defaultPersona', next.id);
    }
  };

  const togglePersona = (index: number): void => {
    setExpandedPersonas((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const addPersona = (): void => {
    const list = form.personas ?? [];
    const used = new Set(list.map((p) => p.id));
    let n = list.length + 1;
    while (used.has(`persona-${n}`)) n += 1;
    patch('personas', [...list, { id: `persona-${n}`, name: `人格 ${n}`, prompt: '' }]);
    // 新增后自动展开，方便直接编辑
    setExpandedPersonas((current) => new Set(current).add(list.length));
  };

  const removePersona = (index: number): void => {
    const list = (form.personas ?? []).filter((_, i) => i !== index);
    const removedId = form.personas?.[index]?.id;
    patch('personas', list);
    // 删除后索引整体前移，展开状态需要同步重映射
    setExpandedPersonas((current) => {
      const next = new Set<number>();
      for (const i of current) {
        if (i === index) continue;
        next.add(i > index ? i - 1 : i);
      }
      return next;
    });
    // 默认人格指向被删除条目时一并清空，避免留下失效 id
    if (removedId !== undefined && removedId !== '' && form.defaultPersona === removedId) {
      patch('defaultPersona', '');
    }
  };

  /**
   * 切换语音模型并与音色联动。
   *
   * - 全局默认音色：内置同名音色按代际改写；目标模型不支持的内置音色回落到该模型
   *   的缺省音色；空音色保持空（表示按模型缺省），克隆/设计等未知 id 原样保留。
   * - 各人格的覆盖音色：同样按目标模型修正，避免人格里还留着上一代的 id。
   * - preferredVoiceId：用户刚在「默认音色」下拉里选中的 id（它属于目标模型），不再改写。
   */
  const applyVoiceModel = (nextModel: string, preferredVoiceId?: string): void => {
    const nextVoiceId = preferredVoiceId !== undefined
      ? preferredVoiceId
      : voice.voice === undefined ? undefined : followVoiceModel(voice.voice, nextModel);
    patch('voice', {
      ...voice,
      model: nextModel,
      ...(nextVoiceId === undefined ? {} : { voice: nextVoiceId }),
    });

    const list = form.personas ?? [];
    let personasChanged = false;
    const nextPersonas = list.map((persona) => {
      const currentId = persona.expressions?.voice?.voice;
      if (currentId === undefined || currentId.trim() === '') return persona;
      const mapped = followVoiceModel(currentId, nextModel);
      if (mapped === currentId) return persona;
      personasChanged = true;
      return {
        ...persona,
        expressions: { ...persona.expressions, voice: { ...persona.expressions?.voice, voice: mapped } },
      };
    });
    if (personasChanged) patch('personas', nextPersonas);
  };

  const tabDirty = (tab: TabDef): boolean => tab.keys.some((key) => changedKeys.includes(key));

  // 各分区内容：只渲染当前 tab，表单值始终保存在 form 中，切换不会丢失编辑
  const accessPanel: ReactNode[] = [
    createElement(SegmentedRow, {
      label: '私聊', value: access.c2cMode, options: MODE_OPTIONS,
      onChange: (v) => { patch('access', { ...access, c2cMode: v as AccessMode }); },
    }),
    access.c2cMode === 'allowlist'
      ? createElement(AreaRow, {
          label: '私聊白名单', help: '请输入用户 openid，多个请换行输入', rows: 3,
          value: access.c2cAllow.join('\n'),
          onChange: (v) => { patch('access', { ...access, c2cAllow: v.split('\n').map((s) => s.trim()) }); },
        })
      : null,
    createElement(SegmentedRow, {
      label: '群聊', value: access.groupMode, options: MODE_OPTIONS,
      onChange: (v) => { patch('access', { ...access, groupMode: v as AccessMode }); },
    }),
    access.groupMode === 'allowlist'
      ? createElement(AreaRow, {
          label: '群聊白名单', help: '请输入群 openid，多个请换行输入', rows: 3,
          value: access.groupAllow.join('\n'),
          onChange: (v) => { patch('access', { ...access, groupAllow: v.split('\n').map((s) => s.trim()) }); },
        })
      : null,
    createElement('p', { className: 'imqb2-hint', style: { padding: '8px 0 0' } },
      'openid 可在 QQ 里对机器人发送 /whoami 查看；私聊与群聊是两套值。'),
  ];

  const identityPanel: ReactNode[] = [
    createElement(SwitchRow, {
      label: '身份识别', checked: identity.enabled,
      help: '按 openid 判定发送者身份，并在消息前注入 [身份: 主人 / 管理员 / 朋友 / 陌生人]；三份名单都为空时不注入，保持旧行为',
      onChange: (v) => { patch('identity', { ...identity, enabled: v }); },
    }),
    identity.enabled
      ? createElement('p', { className: 'imqb2-hint', style: { padding: '0 0 8px' } },
          '在 QQ 里对机器人发送 /whoami 可查看并复制自己的 openid。私聊（user_openid）与群聊（member_openid）是两套值，需要分别添加。')
      : null,
    identity.enabled
      ? createElement(AreaRow, {
          label: '主人 openid', rows: 2,
          help: '对应「身份: 主人」，人格里的专属称呼只对这些人生效；一行一个',
          value: identity.ownerOpenIds.join('\n'),
          onChange: (v) => { patch('identity', { ...identity, ownerOpenIds: v.split('\n').map((s) => s.trim()) }); },
        })
      : null,
    identity.enabled
      ? createElement(AreaRow, {
          label: '管理员 openid', rows: 2,
          help: '对应「身份: 管理员」，按熟人对待但不套用主人设定；一行一个',
          value: identity.adminOpenIds.join('\n'),
          onChange: (v) => { patch('identity', { ...identity, adminOpenIds: v.split('\n').map((s) => s.trim()) }); },
        })
      : null,
    identity.enabled
      ? createElement(AreaRow, {
          label: '朋友 openid', rows: 2,
          help: '对应「身份: 朋友」，其余未命中名单的人都是「陌生人」；一行一个',
          value: identity.friendOpenIds.join('\n'),
          onChange: (v) => { patch('identity', { ...identity, friendOpenIds: v.split('\n').map((s) => s.trim()) }); },
        })
      : null,
  ];

  const membersPanel: ReactNode[] = [
    createElement(SwitchRow, {
      label: '群聊人格档案', checked: personaAnalysis.enabled,
      help: '按会话滚动保存群聊/私聊消息（~/.dsh-qqbot/persona-archive.json），'
        + '供人格分析总结群友的说话风格与性格；只存本机、不上传，'
        + '关闭后不再记录新消息（已有档案保留）',
      onChange: (v) => { patch('personaAnalysis', { ...personaAnalysis, enabled: v }); },
    }),
    personaAnalysis.enabled
      ? createElement(FieldRow, {
          label: '每个会话最多保留条数', value: String(personaAnalysis.maxMessages), placeholder: '300',
          help: '超出后淘汰最旧的消息（20–1000）；条数越多，人格总结的依据越充分，档案文件也越大',
          onChange: (v) => {
            const n = Math.round(Number(v));
            patch('personaAnalysis', {
              ...personaAnalysis,
              maxMessages: Number.isFinite(n) ? Math.min(1000, Math.max(20, n)) : 300,
            });
          },
        })
      : null,
    personaAnalysis.enabled
      ? createElement(FieldRow, {
          label: '消息保留天数', value: String(personaAnalysis.retentionDays), placeholder: '30',
          help: '超过天数的记录会在启动与写入时清理（1–365）；删除档案文件可立即清空全部记录',
          onChange: (v) => {
            const n = Math.round(Number(v));
            patch('personaAnalysis', {
              ...personaAnalysis,
              retentionDays: Number.isFinite(n) ? Math.min(365, Math.max(1, n)) : 30,
            });
          },
        })
      : null,
    personaAnalysis.enabled
      ? createElement(SwitchRow, {
          label: '自动获取人格', checked: personaAnalysis.autoAnalyze,
          help: '某位群友累计发言达到阈值后自动生成人格档案；之后每新增同样条数再更新一次，'
            + '失败会冷却 10 分钟。关闭后只能手动让机器人分析',
          onChange: (v) => { patch('personaAnalysis', { ...personaAnalysis, autoAnalyze: v }); },
        })
      : null,
    personaAnalysis.enabled && personaAnalysis.autoAnalyze
      ? createElement(FieldRow, {
          label: '自动分析触发条数', value: String(personaAnalysis.autoAnalyzeThreshold), placeholder: '20',
          help: '累计发言达到这个条数就自动分析一次（5–200）；数值越小档案更新越频繁，模型调用也越多',
          onChange: (v) => {
            const n = Math.round(Number(v));
            patch('personaAnalysis', {
              ...personaAnalysis,
              autoAnalyzeThreshold: Number.isFinite(n) ? Math.min(200, Math.max(5, n)) : 20,
            });
          },
        })
      : null,
    createElement('p', { className: 'imqb2-hint', style: { padding: '0 0 8px' } },
      '档案只从开启后开始积累：QQ 官方接口不提供任意群的历史消息，机器人未上线期间的消息无法补录。'
      + '同一个 openid 在多个群/私聊的发言会合并成一份档案；'
      + '设置面板的表格可按昵称、openid、人格特点筛选，分析结果也可作为后续新增人格的参考。'),
    createElement(PersonaProfilesTable, { archived: personaAnalysis.enabled }),
  ];

  const conversationPanel: ReactNode[] = [
    createElement(SwitchRow, {
      label: '群聊仅回复 @机器人的消息', checked: form.requireMention ?? true,
      help: '开启后，机器人仅可回复 @机器人的群聊消息',
      onChange: (v) => { patch('requireMention', v); },
    }),
    createElement(SwitchRow, {
      label: '流式输出', checked: form.streaming ?? true,
      help: '回复内容分段实时推送到聊天（开启回复拆分时自动失效）',
      onChange: (v) => { patch('streaming', v); },
    }),
    createElement(SegmentedRow, {
      label: '回复拆分', value: form.replySplitMode ?? 'none', options: SPLIT_OPTIONS,
      help: '推荐「约定分隔符」：模型输出固定分隔符 ||| 时拆条；只要出现分隔符，段内剩余换行也会拆（模型偶尔把分隔符敲成换行），没出现分隔符时换行不拆；开启后自动关闭流式输出',
      onChange: (v) => { patch('replySplitMode', v as ReplySplitMode); },
    }),
    form.replySplitMode === 'delimiter'
      ? createElement('p', {
          className: 'imqb2-hint', style: { padding: '0 0 8px' },
        }, '分隔符固定为 |||（不可配置）；拆条规则写在「模型与提示词」的「全局提示词」里即可对整个机器人生效')
      : null,
    form.replySplitMode !== undefined && form.replySplitMode !== 'none'
      ? createElement(FieldRow, {
          label: '拆分间隔(ms)', value: String(form.replySplitIntervalMs ?? 0),
          placeholder: '0',
          help: '相邻消息之间的等待时间，0 表示顺序立即发送；遇到平台限流可调大',
          onChange: (v) => {
            const n = Math.max(0, Math.round(Number(v)));
            patch('replySplitIntervalMs', Number.isFinite(n) ? n : 0);
          },
        })
      : null,
    createElement(SwitchRow, {
      label: '显示工具调用结果', checked: form.showToolResults ?? false,
      help: '在聊天中展示 agent 工具调用的结构化结果',
      onChange: (v) => { patch('showToolResults', v); },
    }),
  ];

  const voiceEnabled = voice.enabled !== false;
  const voicePanel: ReactNode[] = [
    createElement(SwitchRow, {
      label: '启用语音回复',
      checked: voiceEnabled,
      help: '关闭后即使已保存 API Key 也不会注册 qqbot_voice 工具、不合成、不发语音；'
        + '重新打开即可恢复，不需要清除 Key。',
      onChange: (v) => { patch('voice', { ...voice, enabled: v }); },
    }),
    createElement('p', { className: 'imqb2-hint', style: { padding: '4px 0 8px' } },
      voiceEnabled
        ? voice.hasApiKey === true
          ? '语音功能已启用：由模型判断这一轮要不要发语音。需要语音时会调用 qqbot_voice，'
            + '本轮回复只发语音、不再重复发文字；合成失败或内容不适合朗读时退回文字。'
          : '语音开关已打开，但还没有填写 API Key：填写并保存后才会真正生效。'
        : '语音已关闭：即使已保存 API Key 也不会注册语音工具、不合成、不发语音，也不消耗额度；'
          + '打开上方开关即可恢复。'),
    createElement(FieldRow, {
      label: 'DashScope API Key', type: 'password',
      value: voice.apiKey ?? '',
      placeholder: voice.hasApiKey === true ? '已保存（输入新 Key 可替换）' : '留空则不启用语音',
      help: '已保存的 Key 不会回显；留空提交表示保持现有 Key。要停用语音请用上方开关，不需要清除 Key。',
      onChange: (v) => { patch('voice', { ...voice, apiKey: v }); },
    }),
    voice.hasApiKey === true && (voice.apiKey ?? '').trim() === ''
      ? createElement('div', { className: 'imqb2-field', style: { padding: '0 0 8px', borderTop: 0 } },
          createElement('div', { className: 'imqb2-head' },
            createElement('span', { className: 'imqb2-hint' }, '已保存 API Key；语音是否生效由上方开关决定。'),
            createElement('button', {
              type: 'button', className: 'imqb2-persona-add',
              onClick: () => { patch('voice', { ...voice, apiKey: '', clearApiKey: true, hasApiKey: false }); },
            }, '清除已保存的 Key'),
          ),
        )
      : null,
    createElement('div', { className: 'imqb2-group-title' }, '模型与音色'),
    createElement(VoiceModelField, {
      value: voice.model ?? '',
      help: '当前只内置 Qwen-Audio-TTS 的 3.1 / 3.0 模型（其他模型走「其他模型 id」手动输入）。'
        + '切换模型会自动修正内置系统音色：同名音色跨代改写（longanfengyue ↔ longanfengyue_v3.1），'
        + '目标模型不支持的内置音色回落到该模型缺省音色；人格里的音色也会跟着改。'
        + '克隆/设计音色不会自动改（面板无法判断其兼容性）；合成失败时日志会写明原因。',
      onChange: (v) => { applyVoiceModel(v); },
    }),
    createElement(VoiceSelectField, {
      label: '默认音色',
      value: voice.voice ?? '',
      placeholder: '（留空，使用缺省音色）',
      options: voiceOptions,
      help: voiceOptions.length > 0
        ? `只能从下拉里选（自定义 ${customPresetCount} 个置顶，其后为内置系统音色）。`
          + '音色与模型代际绑定：标了「需 xxx 模型」的项选中后会自动把上面的「语音模型」切过去。'
          + '要新增复刻/设计音色，请在下方「自定义音色」里添加名称 + id。人格可在「人格预设」里覆盖。'
        : '当前模型没有可确认的内置音色清单：请在下方「自定义音色」里添加名称 + id，'
          + '或把「语音模型」改回 Qwen-Audio 3.1 TTS Flash（3.0 旧模型也可）。',
      onChange: (v) => {
        const picked = voiceOptions.find((option) => option.value === v);
        // 选了另一代模型专属的内置音色：把模型一起切过去（模型下拉就在上面，变化可见）
        if (picked?.requiresModel !== undefined) {
          applyVoiceModel(picked.requiresModel, v);
          return;
        }
        patch('voice', { ...voice, voice: v });
      },
    }),
    createElement(VoicePresetListField, {
      value: voice.presets ?? [],
      onChange: (nextPresets) => { patch('voice', { ...voice, presets: nextPresets }); },
    }),
    createElement('div', { className: 'imqb2-group-title' }, '情感与语气'),
    createElement(AreaRow, {
      label: '情感/语气指令', rows: 4,
      help: '可写成「场景 + 逐句走向」，合成时随请求下发（≤400 字）。'
        + '例：场景：夜里教学楼走廊，她叫住学长，紧张又鼓起勇气；第1句：很轻、迟疑；'
        + '第2句：吞吐、有停顿；第3句：柔和带笑；第4句：转为坚定、加快一点。'
        + '留空 = 模型默认语气；人格可在「人格预设」里单独覆盖。',
      value: voice.instruction ?? '',
      onChange: (v) => { patch('voice', { ...voice, instruction: v }); },
    }),
    createElement('p', { className: 'imqb2-hint' },
      '服务端还支持文本内情感标签（[excited] 兴奋、[sad] 悲伤、[serious] 严肃、[laughing] 笑声、'
      + '[sighing] 叹息、[whispers] 耳语、[very slowly] 放慢…），但标签必须出现在待朗读文本里才生效，'
      + '日常建议用上面的指令控制情感，必要时模型还可以在单轮调用里指定语气。'),
    createElement('div', { className: 'imqb2-group-title' }, '长度与超时'),
    createElement(FieldRow, {
      label: '单次朗读字数上限', value: String(voice.maxChars ?? 300), placeholder: '300',
      help: '超出后截断（20–1000）；QQ 语音不宜过长',
      onChange: (v) => {
        const n = Math.round(Number(v));
        patch('voice', { ...voice, maxChars: Number.isFinite(n) ? Math.min(1000, Math.max(20, n)) : 300 });
      },
    }),
    createElement(FieldRow, {
      label: '合成超时(ms)', value: String(voice.timeoutMs ?? 30000), placeholder: '30000',
      help: '超时后放弃语音、改为发送文字回复（5000–120000）',
      onChange: (v) => {
        const n = Math.round(Number(v));
        patch('voice', { ...voice, timeoutMs: Number.isFinite(n) ? Math.min(120000, Math.max(5000, n)) : 30000 });
      },
    }),
    createElement('div', { className: 'imqb2-group-title' }, '网关'),
    createElement(FieldRow, {
      label: 'WebSocket 地址', value: voice.baseUrl ?? '', placeholder: '留空使用 DashScope 官方网关',
      help: '自定义 MaaS 网关时填完整 wss:// 地址；留空则按 workspace 或官方网关连接',
      onChange: (v) => { patch('voice', { ...voice, baseUrl: v }); },
    }),
    createElement(FieldRow, {
      label: '业务空间 workspace', value: voice.workspace ?? '', placeholder: '留空使用官方共享网关',
      help: '百炼业务空间 id：用于拼接 MaaS 地址并在请求头携带 X-DashScope-WorkSpace',
      onChange: (v) => { patch('voice', { ...voice, workspace: v }); },
    }),
    createElement('p', { className: 'imqb2-hint', style: { padding: '8px 0 0' } },
      '语音走 DashScope 实时合成（需要 Node 22+ 内置 WebSocket）；合成失败时退回文字回复，消息不会丢。'),
  ];

  const modelPanel: ReactNode[] = [
    createElement('div', { className: 'imqb2-group-title' }, '模型'),
    createElement(FieldRow, {
      label: 'Provider', value: form.provider ?? '', placeholder: '留空继承宿主默认',
      onChange: (v) => { patch('provider', v); },
    }),
    createElement(FieldRow, {
      label: 'Model', value: form.model ?? '', placeholder: '留空继承宿主默认',
      onChange: (v) => { patch('model', v); },
    }),
    createElement(FieldRow, {
      label: 'Preset', value: form.preset ?? '', placeholder: 'Agent preset id',
      onChange: (v) => { patch('preset', v); },
    }),
    form.cwd !== undefined
      ? createElement('div', { className: 'imqb2-field' },
          createElement('div', { className: 'imqb2-head' },
            createElement('span', { className: 'imqb2-label' }, 'Agent 工作目录'),
            createElement('span', { className: 'imqb2-hint' }, '只读'),
          ),
          createElement('p', { className: 'imqb2-readonly' }, form.cwd),
        )
      : null,
    createElement('div', { className: 'imqb2-group-title' }, '全局提示词'),
    createElement(AreaRow, {
      label: '全局 system prompt', rows: 6,
      help: '对所有群聊/私聊生效。把「多条消息用固定分隔符 ||| 分隔」这类通用规则写在这里，人格里只写角色设定。',
      value: form.globalPrompt ?? '',
      onChange: (v) => { patch('globalPrompt', v); },
    }),
  ];

  const personasPanel: ReactNode[] = [
    createElement('p', { className: 'imqb2-hint', style: { padding: '4px 0 8px' } },
      '每个人格是一套角色 system prompt，叠加在全局提示词之上。点击标题展开编辑，配置后可在 QQ 聊天发送 /persona（或直接点击菜单）按会话切换；修改过但未保存的分区会在 tab 上显示小圆点。'),
    personas.length === 0
      ? createElement('p', { className: 'imqb2-hint', style: { padding: '4px 0 12px' } },
          '尚未添加人格。添加并保存后，QQ 端 /persona 即可看到切换菜单。')
      : null,
    personas.map((persona, index) => createElement(PersonaCard, {
      key: `persona-${index}`,
      index,
      value: persona,
      expanded: expandedPersonas.has(index),
      available: toolCandidates,
      voiceOptions,
      onChange: (next) => { updatePersona(index, next); },
      onToggle: () => { togglePersona(index); },
      onRemove: () => { removePersona(index); },
    })),
    createElement('button', {
      type: 'button', className: 'imqb2-persona-add',
      onClick: addPersona,
    }, '＋ 添加人格'),
    personas.length > 0
      ? createElement(FieldRow, {
          label: '默认人格 id', value: form.defaultPersona ?? '', placeholder: '留空表示不启用人格',
          help: `可用 id: ${personas.map((p) => p.id).filter(Boolean).join(', ') || '（尚未填写）'}；留空则不启用人格`,
          onChange: (v) => { patch('defaultPersona', v); },
        })
      : null,
  ];

  const updatePanel: ReactNode[] = [
    createElement('p', { className: 'imqb2-hint', style: { padding: '4px 0 8px' } },
      '检查当前安装方式下远端是否有新版本。git 安装会对比远端最新 commit；'
      + '更新后会重新解析依赖并自动重载插件，不需要卸载重装。'),
    updateError !== null
      ? createElement('p', { className: 'imqb2-hint-warn' }, updateError)
      : null,
    createElement('div', { className: 'imqb2-field' },
      createElement('span', { className: 'imqb2-label' }, '当前安装'),
      updateInfo === null
        ? createElement('p', { className: 'imqb2-hint' }, '正在读取安装信息…')
        : createElement('div', null,
            createElement('p', { className: 'imqb2-readonly' },
              `${updateInfo.version} · ${updateKindLabel(updateInfo.kind)}`),
            updateInfo.installed !== ''
              ? createElement('p', { className: 'imqb2-hint' },
                  `已安装引用：${updateInfo.kind === 'git'
                    ? shortHash(updateInfo.installed)
                    : updateInfo.installed}`)
              : null,
            updateInfo.spec !== undefined
              ? createElement('p', { className: 'imqb2-hint' }, `依赖写法：${updateInfo.spec}`)
              : null,
            updateInfo.message !== undefined
              ? createElement('p', { className: 'imqb2-hint-warn' }, updateInfo.message)
              : null,
          ),
    ),
    createElement('div', { className: 'imqb2-field' },
      createElement('span', { className: 'imqb2-label' }, '版本检查'),
      updateCheck === null
        ? createElement('p', { className: 'imqb2-hint' },
            '点击「检查更新」对比远端最新版本；git 安装对比远端 commit，npm 安装对比 registry。')
        : createElement('div', null,
            createElement('p', {
              className: updateCheck.updateAvailable ? 'imqb2-hint-warn' : 'imqb2-hint',
            }, updateCheck.message),
            createElement('p', { className: 'imqb2-hint' },
              `检查时间：${new Date(updateCheck.checkedAt).toLocaleTimeString()}`),
          ),
      createElement('div', {
        style: { display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '8px' },
      },
        createElement('button', {
          type: 'button', className: 'imqb2-save',
          disabled: updateBusy !== null || updateInfo === null,
          onClick: () => { runUpdateAction('check'); },
        }, updateBusy === 'check' ? '正在检查…' : '检查更新'),
        updateCheck?.updateAvailable === true && updateInfo !== null
          ? confirmUpdate
            ? [
                createElement('button', {
                  key: 'confirm',
                  type: 'button', className: 'imqb2-save',
                  disabled: updateBusy !== null,
                  onClick: () => { runUpdateAction('update'); },
                }, updateBusy === 'update' ? '正在更新…' : '确认更新'),
                createElement('button', {
                  key: 'cancel',
                  type: 'button', className: 'imqb2-tab',
                  disabled: updateBusy !== null,
                  onClick: () => { setConfirmUpdate(false); },
                }, '取消'),
              ]
            : createElement('button', {
                key: 'start',
                type: 'button', className: 'imqb2-save',
                disabled: updateBusy !== null || !updateInfo.canUpdate,
                title: updateInfo.canUpdate
                  ? '执行 pnpm update，完成后自动重载插件'
                  : `当前宿主不支持一键更新，请手动执行：${updateInfo.command}`,
                onClick: () => { setConfirmUpdate(true); },
              }, '立即更新')
          : null,
      ),
      updateInfo !== null && !updateInfo.canUpdate && updateCheck?.updateAvailable === true
        ? createElement('p', { className: 'imqb2-hint' },
            `当前宿主不支持一键更新，请手动执行：${updateInfo.command}`)
        : null,
      updateNotice !== null
        ? createElement('p', { className: 'imqb2-note imqb2-note--ok' }, updateNotice)
        : null,
      createElement('p', { className: 'imqb2-hint' },
        '更新完成后插件会自动重载；若界面没有刷新，请重启 DSH。'),
    ),
  ];

  const panels: Record<TabId, ReactNode[]> = {
    access: accessPanel,
    identity: identityPanel,
    members: membersPanel,
    conversation: conversationPanel,
    voice: voicePanel,
    model: modelPanel,
    personas: personasPanel,
    update: updatePanel,
  };
  const activeTabLabel = TABS.find((tab) => tab.id === activeTab)?.label ?? '';

  return createElement('form', { className: 'imqb2-form', onSubmit: submit },
    createElement('div', {
      className: 'imqb2-tabs', role: 'tablist', 'aria-label': '配置分区',
    },
      TABS.map((tab) => createElement('button', {
        key: tab.id, type: 'button', role: 'tab',
        'aria-selected': activeTab === tab.id,
        'aria-controls': 'imqb2-config-tabpanel',
        className: 'imqb2-tab',
        onClick: () => { setActiveTab(tab.id); },
      },
        tab.label,
        tabDirty(tab)
          ? createElement('span', { className: 'imqb2-tab-dot', title: '有未保存的修改' })
          : null,
      )),
    ),
    createElement('div', {
      id: 'imqb2-config-tabpanel',
      className: 'imqb2-tabpanel', role: 'tabpanel', 'aria-label': activeTabLabel,
    }, panels[activeTab]),

    createElement('div', { className: 'imqb2-footer' },
      result !== null
        ? createElement('p', { className: `imqb2-note${result.ok ? ' imqb2-note--ok' : ' imqb2-note--error'}` },
            (result.ok ? '' : '⚠️ ') + result.message)
        : dirty
          ? createElement('p', { className: 'imqb2-note' }, '保存后插件将重载，进行中的机器人会话将重置')
          : createElement('p', { className: 'imqb2-note' }),
      createElement('button', { className: 'imqb2-save', type: 'submit', disabled: busy || !dirty },
        busy ? '正在保存…' : '保存'),
    ),
  );
}
