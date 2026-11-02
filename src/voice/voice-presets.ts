/**
 * Qwen-Audio-TTS 系统音色预设
 *
 * 数据来源：阿里云百炼「Qwen-Audio-TTS 音色列表」；每个 id 都在真实账号上
 * 实测合成成功过（2026-10 / 2026-11）。
 *
 * 音色 id 与模型**代际**强绑定：3.1 的音色全部带 `_v3.1` 后缀，3.0 的旧 id
 * 不能跨代使用（会报 InvalidParameter / Engine error [411]）。flash 支持全部
 * 系统音色；plus 只有 4 个旗舰音色（见各 preset 的 models）以及声音复刻/
 * 设计的专属 id。面板下拉会把当前模型不支持的音色标注成「需 xxx 模型」，
 * 避免选完才发现合成失败。
 */

/** 当前默认（推荐）语音模型：3.1-flash（低延迟，支持全部系统音色） */
export const VOICE_PRESET_MODEL = 'qwen-audio-3.1-tts-flash';
/** 3.1 高音质模型（只支持 4 个旗舰系统音色 + 复刻/设计音色） */
export const VOICE_PRESET_MODEL_PLUS = 'qwen-audio-3.1-tts-plus';
/** 上一代模型（仍可使用：已有 3.0 克隆音色的配置切过来会失效，所以保留兼容） */
export const VOICE_PRESET_MODEL_30_FLASH = 'qwen-audio-3.0-tts-flash';
export const VOICE_PRESET_MODEL_30_PLUS = 'qwen-audio-3.0-tts-plus';

/** 缺省语音模型（3.1-flash） */
export const DEFAULT_VOICE_MODEL = VOICE_PRESET_MODEL;
/** 缺省音色（3.1-flash 默认音色，同时也是 3.1-plus 的旗舰音色之一） */
export const DEFAULT_VOICE_ID = 'longanfengyue_v3.1';

export type VoiceGeneration = '3.0' | '3.1';

/** 内置语音模型（面板「语音模型」下拉的选项；目前只接入 Qwen-Audio-TTS） */
export interface VoiceModelOption {
  /** 传给 TTS 的 model 参数 */
  id: string;
  /** 下拉展示名 */
  label: string;
  /** 一句话定位，显示在模型下拉下方 */
  help: string;
  generation: VoiceGeneration;
  /** 是否缺省推荐项 */
  recommended?: boolean;
}

/**
 * 面板可选的语音模型清单（按推荐顺序排列）。
 *
 * 只收录已在真实账号上验证过的 Qwen-Audio-TTS 模型；其他 MaaS 模型（如
 * cosyvoice-v2）没有对应的音色清单，面板里走「其他模型 id」手动输入，
 * 音色只能靠「自定义音色」添加。
 */
export const VOICE_MODELS: readonly VoiceModelOption[] = [
  {
    id: VOICE_PRESET_MODEL,
    label: 'Qwen-Audio 3.1 TTS Flash',
    help: '低延迟，支持全部 26 个系统音色与 3.1 复刻/设计音色（缺省推荐）。',
    generation: '3.1',
    recommended: true,
  },
  {
    id: VOICE_PRESET_MODEL_PLUS,
    label: 'Qwen-Audio 3.1 TTS Plus',
    help: '高音质，只支持 4 个旗舰系统音色（longanfengyue_v3.1 / longanlingxin_v3.1 / '
      + 'longanhuan_v3.1 / xunanchuan_v3.1）与 3.1 复刻/设计音色。',
    generation: '3.1',
  },
  {
    id: VOICE_PRESET_MODEL_30_FLASH,
    label: 'Qwen-Audio 3.0 TTS Flash（旧版）',
    help: '兼容旧配置：12 个 3.0 系统音色与 3.0 克隆/设计音色（3.0 音色不能用在 3.1 上）。',
    generation: '3.0',
  },
  {
    id: VOICE_PRESET_MODEL_30_PLUS,
    label: 'Qwen-Audio 3.0 TTS Plus（旧版）',
    help: '兼容旧配置：只支持 longanlingxi / longanhuan_v3.6 两个系统音色与 3.0 克隆/设计音色。',
    generation: '3.0',
  },
];

export interface VoicePreset {
  /** 传给 TTS 的 voice 参数 */
  id: string;
  /** 官方音色名称 */
  name: string;
  /** 官方音色特质 */
  trait?: string;
  gender?: '女' | '男';
  age?: number;
  /** 适用模型（同一代际内 flash / plus 的兼容矩阵） */
  models: readonly string[];
  /** 音色代际（跨代 id 不兼容，用于下拉文案与映射） */
  generation: VoiceGeneration;
}

/** 3.1 旗舰音色：flash 与 plus 都支持 */
const FLAGSHIP_31: readonly string[] = [VOICE_PRESET_MODEL, VOICE_PRESET_MODEL_PLUS];
/** 3.1 其余系统音色：仅 flash 支持 */
const FLASH_ONLY_31: readonly string[] = [VOICE_PRESET_MODEL];
const FLASH_30: readonly string[] = [VOICE_PRESET_MODEL_30_FLASH];
const PLUS_30: readonly string[] = [VOICE_PRESET_MODEL_30_FLASH, VOICE_PRESET_MODEL_30_PLUS];

export const VOICE_PRESETS: readonly VoicePreset[] = [
  // ---- 3.1 旗舰音色（plus 也支持）----
  { id: 'longanfengyue_v3.1', name: '龙安风悦', trait: '自然亲切音', gender: '女', models: FLAGSHIP_31, generation: '3.1' },
  { id: 'longanlingxin_v3.1', name: '龙安灵心', gender: '女', models: FLAGSHIP_31, generation: '3.1' },
  { id: 'longanhuan_v3.1', name: '龙安欢', gender: '女', models: FLAGSHIP_31, generation: '3.1' },
  { id: 'xunanchuan_v3.1', name: '许南川', gender: '男', models: FLAGSHIP_31, generation: '3.1' },
  // ---- 3.1 系统音色（仅 flash）----
  { id: 'longanyuanfei_v3.1', name: '龙安元妃', trait: '高傲妃子音', gender: '女', models: FLASH_ONLY_31, generation: '3.1' },
  { id: 'longanlingxi_v3.1', name: '龙安灵希', trait: '可爱甜美音', gender: '女', models: FLASH_ONLY_31, generation: '3.1' },
  { id: 'longjielidou_v3.1', name: '龙杰力豆', trait: '天真男童音', gender: '男', models: FLASH_ONLY_31, generation: '3.1' },
  { id: 'longhuohuo_v3.1', name: '龙火火', trait: '顽皮少年音', gender: '男', models: FLASH_ONLY_31, generation: '3.1' },
  { id: 'longpaopao_v3.1', name: '龙泡泡', trait: '飞天泡泡音', gender: '女', models: FLASH_ONLY_31, generation: '3.1' },
  { id: 'longhua_v3.1', name: '龙华', trait: '元气甜美女', gender: '女', models: FLASH_ONLY_31, generation: '3.1' },
  { id: 'longwan_v3.1', name: '龙婉', trait: '细腻柔声女', gender: '女', models: FLASH_ONLY_31, generation: '3.1' },
  { id: 'longxing_v3.1', name: '龙星', trait: '温婉邻家女', gender: '女', models: FLASH_ONLY_31, generation: '3.1' },
  { id: 'longyue_v3.1', name: '龙悦', trait: '温暖、磁性', gender: '女', models: FLASH_ONLY_31, generation: '3.1' },
  { id: 'longyan_v3.1', name: '龙颜', trait: '温暖、自然、亲切', gender: '女', models: FLASH_ONLY_31, generation: '3.1' },
  { id: 'longyuan_v3.1', name: '龙媛', trait: '温暖治愈女', gender: '女', models: FLASH_ONLY_31, generation: '3.1' },
  { id: 'longmiao_v3.1', name: '龙妙', trait: '抑扬顿挫女', gender: '女', models: FLASH_ONLY_31, generation: '3.1' },
  { id: 'longhan_v3.1', name: '龙寒', trait: '温暖痴情男', gender: '男', models: FLASH_ONLY_31, generation: '3.1' },
  { id: 'longanyang_v3.1', name: '龙安洋', trait: '阳光大男孩', gender: '男', models: FLASH_ONLY_31, generation: '3.1' },
  { id: 'longanzhi_v3.1', name: '龙安智', trait: '睿智轻熟男', gender: '男', models: FLASH_ONLY_31, generation: '3.1' },
  { id: 'longzhe_v3.1', name: '龙哲', trait: '呆板大暖男', gender: '男', models: FLASH_ONLY_31, generation: '3.1' },
  { id: 'loongbella_v3.1', name: 'Bella', trait: '干练、磁性、知性', gender: '女', models: FLASH_ONLY_31, generation: '3.1' },
  { id: 'loongstella_v3.1', name: 'Stella', trait: '飒爽利落女', gender: '女', models: FLASH_ONLY_31, generation: '3.1' },
  { id: 'longxiaobai_v3.1', name: '龙小白', trait: '磁性、质感', gender: '女', models: FLASH_ONLY_31, generation: '3.1' },
  { id: 'longshu_v3.1', name: '龙书', trait: '沉稳、磁性', gender: '男', models: FLASH_ONLY_31, generation: '3.1' },
  { id: 'longcheng_v3.1', name: '龙橙', trait: '智慧、磁性', gender: '男', models: FLASH_ONLY_31, generation: '3.1' },
  { id: 'longtian_v3.1', name: '龙天', trait: '磁性、理智', gender: '男', models: FLASH_ONLY_31, generation: '3.1' },
  // ---- 3.0 旧音色（兼容保留：已有克隆音色绑定在 3.0 上）----
  { id: 'longanfengyue', name: '龙安风悦', trait: '自然亲切音', gender: '女', age: 30, models: FLASH_30, generation: '3.0' },
  { id: 'longanyuanfei', name: '龙安元妃', trait: '高傲妃子音', gender: '女', age: 30, models: FLASH_30, generation: '3.0' },
  { id: 'longanlingxi', name: '龙安灵希', trait: '可爱甜美音', gender: '女', age: 25, models: PLUS_30, generation: '3.0' },
  { id: 'longanxiaoxin', name: '龙安小昕', trait: '亲切活泼音', gender: '女', age: 22, models: FLASH_30, generation: '3.0' },
  { id: 'longanhuan_v3.6', name: '龙安欢', gender: '女', age: 25, models: PLUS_30, generation: '3.0' },
  { id: 'longjielidou_v3.6', name: '龙杰力豆', trait: '天真男童', gender: '男', age: 5, models: FLASH_30, generation: '3.0' },
  { id: 'longpaopao_v3.6', name: '龙泡泡', trait: '软糯可爱音', gender: '女', age: 5, models: FLASH_30, generation: '3.0' },
  { id: 'longhuohuo_v3.6', name: '龙火火', trait: '顽皮少年音', gender: '男', age: 8, models: FLASH_30, generation: '3.0' },
  { id: 'longchuanshu_v3.6', name: '龙川叔', trait: '川普大叔音', gender: '男', age: 40, models: FLASH_30, generation: '3.0' },
  { id: 'loongmary', name: 'Loong Mary', trait: '温暖英音', gender: '女', age: 20, models: FLASH_30, generation: '3.0' },
  { id: 'loongjohn', name: 'Loong John', trait: '沉稳亲切美音', gender: '男', age: 28, models: FLASH_30, generation: '3.0' },
  { id: 'loongeva_v3.6', name: 'Loong Eva', trait: '高智美音', gender: '女', age: 28, models: FLASH_30, generation: '3.0' },
];

/** 3.1 → 3.0 的同名音色（仅用于内置音色跨代切换；复刻/设计 id 不在此列） */
const PRESET_31_TO_30: Readonly<Record<string, string>> = {
  'longanfengyue_v3.1': 'longanfengyue',
  'longanyuanfei_v3.1': 'longanyuanfei',
  'longanlingxi_v3.1': 'longanlingxi',
  'longanhuan_v3.1': 'longanhuan_v3.6',
  'longjielidou_v3.1': 'longjielidou_v3.6',
  'longpaopao_v3.1': 'longpaopao_v3.6',
  'longhuohuo_v3.1': 'longhuohuo_v3.6',
};

/** 3.0 → 3.1 的同名音色（上表的反向映射） */
const PRESET_30_TO_31: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(PRESET_31_TO_30).map(([current, legacy]) => [legacy, current]),
);

/**
 * 该模型缺省用哪个音色。
 *
 * plus 只支持 4 个旗舰音色，取其中默认项；3.0 的默认音色与其旧的兼容清单一致，
 * 保证「只写了模型、没写音色」的配置也能合成成功。
 */
export function defaultVoiceForModel(model?: string): string {
  const target = model?.trim() || DEFAULT_VOICE_MODEL;
  if (target === VOICE_PRESET_MODEL_PLUS) return 'longanlingxin_v3.1';
  if (target === VOICE_PRESET_MODEL) return DEFAULT_VOICE_ID;
  if (target === VOICE_PRESET_MODEL_30_PLUS) return 'longanlingxi';
  if (target === VOICE_PRESET_MODEL_30_FLASH) return 'longanfengyue';
  return DEFAULT_VOICE_ID;
}

/**
 * 按模型代际修正音色 id（**只处理内置系统音色的同名映射**）。
 *
 * 场景：面板把缺省音色物化成 3.1 的 `..._v3.1`，用户却把模型改回了 3.0，
 * 或反过来。两代系统音色 id 不能混用，这里做同名映射；映射结果若不被目标
 * 模型支持（如 3.1-plus 只有 4 个旗舰音色），回落到该模型的缺省音色，
 * 避免合成必然失败。复刻/设计音色（`vd-...`、`qwen-audio-...-vd-...`）与
 * 没有同名对应的旧音色一律原样返回，不静默改成别的声线。空音色按模型取缺省值。
 */
export function resolveVoicePresetForModel(id: string | undefined, model?: string): string {
  const target = id?.trim() ?? '';
  const modelId = model?.trim() || DEFAULT_VOICE_MODEL;
  if (target === '') return defaultVoiceForModel(modelId);

  const mapped = modelId === VOICE_PRESET_MODEL || modelId === VOICE_PRESET_MODEL_PLUS
    ? PRESET_30_TO_31[target]
    : modelId === VOICE_PRESET_MODEL_30_FLASH || modelId === VOICE_PRESET_MODEL_30_PLUS
      ? PRESET_31_TO_30[target]
      : undefined;
  if (mapped === undefined) return target;

  const preset = findVoicePreset(mapped);
  if (preset === undefined || !preset.models.includes(modelId)) return defaultVoiceForModel(modelId);
  return mapped;
}

/** 取某模型可用的预设（模型留空时按默认模型处理） */
export function voicePresetsForModel(model: string | undefined): VoicePreset[] {
  const target = model?.trim() || VOICE_PRESET_MODEL;
  return VOICE_PRESETS.filter((preset) => preset.models.includes(target));
}

/** 按 id 查内置语音模型（不在清单里的模型返回 undefined） */
export function findVoiceModel(id: string | undefined): VoiceModelOption | undefined {
  const target = id?.trim() ?? '';
  if (target === '') return undefined;
  return VOICE_MODELS.find((model) => model.id === target);
}

/**
 * 面板「切换语音模型」时的音色联动：算出切到 `model` 后当前音色应该变成什么。
 *
 * 与 `resolveVoicePresetForModel` 的区别是这里处理**用户显式切换模型**：内置系统
 * 音色若在目标模型下不可用（如 3.1-plus 只有 4 个旗舰音色，或 3.1 独有的
 * `longwan_v3.1` 切回 3.0），回落到目标模型的缺省音色，避免切完模型必然合成失败。
 * 复刻/设计等未知 id 原样返回（需要用户在新代际下重新创建）；空音色仍返回空，
 * 面板里表示「按模型缺省」，不物化具体 id。
 */
export function followVoiceModel(id: string | undefined, model: string): string {
  const current = id?.trim() ?? '';
  if (current === '') return '';
  const modelId = model.trim() || DEFAULT_VOICE_MODEL;
  // 未知模型（cosyvoice-v2 等）没有可确认的兼容矩阵：既不映射也不回落，避免把用户
  // 自备的音色悄悄换成 Qwen 的缺省音色
  if (findVoiceModel(modelId) === undefined) return current;
  const mapped = resolveVoicePresetForModel(current, modelId);
  const preset = findVoicePreset(mapped);
  if (preset === undefined) return mapped;
  return preset.models.includes(modelId) ? mapped : defaultVoiceForModel(modelId);
}

/** 按音色 id 查预设（用于展示友好名称） */
export function findVoicePreset(id: string | undefined): VoicePreset | undefined {
  const target = id?.trim() ?? '';
  if (target === '') return undefined;
  return VOICE_PRESETS.find((preset) => preset.id === target);
}

/** 下拉提示文案：龙安风悦（自然亲切音 · 女 · v3.1） */
export function formatVoicePresetLabel(preset: VoicePreset): string {
  const ageGender = `${preset.age === undefined ? '' : `${preset.age}岁`}${preset.gender ?? ''}`;
  const details = [preset.trait, ageGender === '' ? undefined : ageGender, `v${preset.generation}`]
    .filter((part): part is string => part !== undefined && part !== '')
    .join(' · ');
  return details === '' ? preset.name : `${preset.name}（${details}）`;
}

/** 面板音色下拉的候选项（select 的 value/label） */
export interface VoiceOption {
  value: string;
  label: string;
  /**
   * 当前语音模型不支持该内置音色时，这里给出它可用的模型 id。
   * 面板据此标注「需 xxx 模型」并在选中后提示改模型；合成前不依赖它做校验。
   */
  requiresModel?: string;
}

/** 用户自定义音色的最小形状（与 config.ts 的 VoicePresetEntry 对齐，避免循环依赖） */
export interface CustomVoiceLike {
  name?: string;
  voice?: string;
}

/**
 * 面板音色下拉：**用户自定义音色在最上，内置系统音色在其后**。
 *
 * 内置音色不再按模型直接过滤掉（否则 plus 模型下只剩自定义项，用户会以为
 * 没有系统音色）：当前模型不支持的项仍列出来，但带上 `requiresModel`，
 * 面板显示「需 xxx 模型」并提示把语音模型一起改掉。
 * 未知模型（如 cosyvoice-v2）没有可确认的兼容矩阵，返回空清单，只保留自定义音色。
 */
export function buildVoiceOptions(
  custom: readonly CustomVoiceLike[] | undefined,
  model?: string,
): VoiceOption[] {
  const options: VoiceOption[] = [];
  const seen = new Set<string>();
  for (const entry of custom ?? []) {
    const id = (entry?.voice ?? '').trim();
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    const name = (entry?.name ?? '').trim() || id;
    options.push({ value: id, label: `${name}（自定义）` });
  }

  const target = model?.trim() || VOICE_PRESET_MODEL;
  const knownModel = VOICE_PRESETS.some((preset) => preset.models.includes(target));
  if (!knownModel) return options;
  for (const preset of VOICE_PRESETS) {
    if (seen.has(preset.id)) continue;
    seen.add(preset.id);
    const supported = preset.models.includes(target);
    options.push({
      value: preset.id,
      label: formatVoicePresetLabel(preset),
      ...(supported ? {} : { requiresModel: preset.models[0] ?? VOICE_PRESET_MODEL }),
    });
  }
  return options;
}

/** 按 id 取下拉里的展示文案（找不到就用 id 本身，自定义与内置都覆盖） */
export function voiceOptionLabel(options: readonly VoiceOption[], id: string | undefined): string {
  const target = id?.trim() ?? '';
  if (target === '') return '';
  return options.find((option) => option.value === target)?.label ?? target;
}

/**
 * 说明文案里的音色短名：自定义项去掉「（自定义）」、内置项去掉特质/年龄。
 *
 * 下拉 label 为了区分来源写得很长（`御姐（自定义）`、`龙安风悦（自然亲切音 · 女 · v3.1）`），
 * 塞进 system prompt / 工具回执里太啰嗦，这里只取括号前的名字。
 */
export function voiceShortLabel(
  options: readonly VoiceOption[] | undefined,
  id: string | undefined,
): string {
  const label = options === undefined ? '' : voiceOptionLabel(options, id);
  if (label === '') return '';
  const cut = label.indexOf('（');
  return cut === -1 ? label : label.slice(0, cut);
}
