import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOICE_ID,
  DEFAULT_VOICE_MODEL,
  VOICE_MODELS,
  VOICE_PRESETS,
  VOICE_PRESET_MODEL,
  VOICE_PRESET_MODEL_30_FLASH,
  VOICE_PRESET_MODEL_30_PLUS,
  VOICE_PRESET_MODEL_PLUS,
  buildVoiceOptions,
  defaultVoiceForModel,
  ensureVoiceForModel,
  findVoiceModel,
  findVoicePreset,
  followVoiceModel,
  formatVoicePresetLabel,
  resolveVoicePresetForModel,
  voiceOptionLabel,
  voicePresetsForModel,
} from './voice-presets.ts';

/** 3.1 系统音色数量（4 个旗舰 + 22 个 flash 专用） */
const PRESETS_31 = 26;
/** 3.0 旧音色数量（兼容保留） */
const PRESETS_30 = 12;

describe('voicePresets', () => {
  it('音色 id 唯一', () => {
    const ids = VOICE_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每个预设都有名称、适用模型与代际', () => {
    for (const preset of VOICE_PRESETS) {
      expect(preset.id.trim()).not.toBe('');
      expect(preset.name.trim()).not.toBe('');
      expect(preset.models.length).toBeGreaterThan(0);
      expect(['3.0', '3.1']).toContain(preset.generation);
    }
  });

  it('3.1 音色都带 _v3.1 后缀，3.0 都不带', () => {
    for (const preset of VOICE_PRESETS) {
      if (preset.generation === '3.1') expect(preset.id).toContain('_v3.1');
      else expect(preset.id).not.toContain('_v3.1');
    }
  });

  it('默认模型是 3.1-flash，缺省音色与其同代际', () => {
    expect(DEFAULT_VOICE_MODEL).toBe(VOICE_PRESET_MODEL);
    expect(findVoicePreset(DEFAULT_VOICE_ID)?.generation).toBe('3.1');
  });

  it('按模型过滤：默认模型返回 3.1 的全部预设', () => {
    expect(voicePresetsForModel(VOICE_PRESET_MODEL)).toHaveLength(PRESETS_31);
    expect(voicePresetsForModel(undefined)).toHaveLength(PRESETS_31);
    expect(voicePresetsForModel(VOICE_PRESET_MODEL_30_FLASH)).toHaveLength(PRESETS_30);
    expect(VOICE_PRESETS).toHaveLength(PRESETS_31 + PRESETS_30);
  });

  it('按模型过滤：未知模型（如 cosyvoice-v2）不返回预设', () => {
    expect(voicePresetsForModel('cosyvoice-v2')).toHaveLength(0);
  });

  it('plus 模型只列出 4 个旗舰音色', () => {
    const plusOnly = voicePresetsForModel(VOICE_PRESET_MODEL_PLUS).map((preset) => preset.id);
    expect(plusOnly).toEqual([
      'longanfengyue_v3.1',
      'longanlingxin_v3.1',
      'longanhuan_v3.1',
      'xunanchuan_v3.1',
    ]);
  });

  it('findVoicePreset 命中与未命中', () => {
    expect(findVoicePreset('longanfengyue')?.name).toBe('龙安风悦');
    expect(findVoicePreset('  longanfengyue  ')?.name).toBe('龙安风悦');
    expect(findVoicePreset('longanfengyue_v3.1')?.name).toBe('龙安风悦');
    expect(findVoicePreset('')).toBeUndefined();
    expect(findVoicePreset('custom-voice-id')).toBeUndefined();
  });

  it('label 包含名称、特质与代际（3.0 带年龄）', () => {
    const legacy = findVoicePreset('longanyuanfei');
    expect(legacy).toBeDefined();
    expect(formatVoicePresetLabel(legacy!)).toContain('龙安元妃');
    expect(formatVoicePresetLabel(legacy!)).toContain('高傲妃子音');
    expect(formatVoicePresetLabel(legacy!)).toContain('30岁');
    expect(formatVoicePresetLabel(legacy!)).toContain('v3.0');

    const current = findVoicePreset('longanyuanfei_v3.1');
    expect(current).toBeDefined();
    expect(formatVoicePresetLabel(current!)).toContain('龙安元妃');
    expect(formatVoicePresetLabel(current!)).toContain('v3.1');
  });
});

describe('defaultVoiceForModel', () => {
  it('按代际取默认音色', () => {
    expect(defaultVoiceForModel(undefined)).toBe('longanfengyue_v3.1');
    expect(defaultVoiceForModel(VOICE_PRESET_MODEL)).toBe('longanfengyue_v3.1');
    expect(defaultVoiceForModel(VOICE_PRESET_MODEL_PLUS)).toBe('longanlingxin_v3.1');
    expect(defaultVoiceForModel(VOICE_PRESET_MODEL_30_FLASH)).toBe('longanfengyue');
    expect(defaultVoiceForModel(VOICE_PRESET_MODEL_30_PLUS)).toBe('longanlingxi');
  });

  it('未知模型回落到缺省音色（不抛错）', () => {
    expect(defaultVoiceForModel('cosyvoice-v2')).toBe(DEFAULT_VOICE_ID);
  });
});

describe('resolveVoicePresetForModel（跨代同名映射）', () => {
  it('空音色按模型取缺省值', () => {
    expect(resolveVoicePresetForModel('', VOICE_PRESET_MODEL)).toBe('longanfengyue_v3.1');
    expect(resolveVoicePresetForModel(undefined, VOICE_PRESET_MODEL_30_FLASH)).toBe('longanfengyue');
    expect(resolveVoicePresetForModel('   ', VOICE_PRESET_MODEL_PLUS)).toBe('longanlingxin_v3.1');
  });

  it('3.0 内置音色切到 3.1 模型时映射成同名 3.1 音色', () => {
    expect(resolveVoicePresetForModel('longanfengyue', VOICE_PRESET_MODEL)).toBe('longanfengyue_v3.1');
    expect(resolveVoicePresetForModel('longanyuanfei', VOICE_PRESET_MODEL)).toBe('longanyuanfei_v3.1');
    expect(resolveVoicePresetForModel('longanhuan_v3.6', VOICE_PRESET_MODEL)).toBe('longanhuan_v3.1');
    expect(resolveVoicePresetForModel('longjielidou_v3.6', VOICE_PRESET_MODEL)).toBe('longjielidou_v3.1');
  });

  it('映射结果不被目标模型支持时回落到该模型缺省音色（避免必然失败）', () => {
    // 3.1-plus 只有 4 个旗舰音色：灵希/杰力豆不在其中
    expect(resolveVoicePresetForModel('longanlingxi', VOICE_PRESET_MODEL_PLUS)).toBe('longanlingxin_v3.1');
    expect(resolveVoicePresetForModel('longjielidou_v3.6', VOICE_PRESET_MODEL_PLUS)).toBe('longanlingxin_v3.1');
  });

  it('3.1 内置音色切回 3.0 模型时映射成同名旧音色', () => {
    expect(resolveVoicePresetForModel('longanfengyue_v3.1', VOICE_PRESET_MODEL_30_FLASH)).toBe('longanfengyue');
    expect(resolveVoicePresetForModel('longpaopao_v3.1', VOICE_PRESET_MODEL_30_FLASH)).toBe('longpaopao_v3.6');
  });

  it('没有同名旧/新音色时保持原 id（不静默换声线）', () => {
    expect(resolveVoicePresetForModel('longanxiaoxin', VOICE_PRESET_MODEL)).toBe('longanxiaoxin');
    expect(resolveVoicePresetForModel('longanlingxin_v3.1', VOICE_PRESET_MODEL_30_FLASH)).toBe('longanlingxin_v3.1');
    expect(resolveVoicePresetForModel('longhua_v3.1', VOICE_PRESET_MODEL_30_FLASH)).toBe('longhua_v3.1');
  });

  it('复刻/设计音色原样返回；未知模型不做映射', () => {
    const clone = 'qwen-audio-3.0-tts-plus-vd-bailian-8521';
    expect(resolveVoicePresetForModel(clone, VOICE_PRESET_MODEL)).toBe(clone);
    expect(resolveVoicePresetForModel('longanfengyue', 'cosyvoice-v2')).toBe('longanfengyue');
    // 缺省模型按 3.1-flash 处理
    expect(resolveVoicePresetForModel('longanfengyue')).toBe('longanfengyue_v3.1');
  });
});

describe('VOICE_MODELS（模型下拉清单）', () => {
  it('只收录 Qwen 模型，id 唯一且缺省项在最前', () => {
    const ids = VOICE_MODELS.map((model) => model.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(VOICE_MODELS[0]?.id).toBe(DEFAULT_VOICE_MODEL);
    expect(VOICE_MODELS[0]?.recommended).toBe(true);
    for (const model of VOICE_MODELS) {
      expect(model.label.trim()).not.toBe('');
      expect(model.help.trim()).not.toBe('');
      expect(model.id).toContain('qwen-audio');
      expect(['3.0', '3.1']).toContain(model.generation);
    }
  });

  it('每个内置模型都至少有一个可用的系统音色', () => {
    for (const model of VOICE_MODELS) {
      expect(voicePresetsForModel(model.id).length).toBeGreaterThan(0);
    }
  });

  it('findVoiceModel 命中与未命中', () => {
    expect(findVoiceModel('qwen-audio-3.1-tts-plus')?.generation).toBe('3.1');
    expect(findVoiceModel('  ')).toBeUndefined();
    expect(findVoiceModel(undefined)).toBeUndefined();
    expect(findVoiceModel('cosyvoice-v2')).toBeUndefined();
  });
});

describe('ensureVoiceForModel（合成前的音色校验）', () => {
  it('空音色按模型取缺省值', () => {
    expect(ensureVoiceForModel('', VOICE_PRESET_MODEL)).toBe(DEFAULT_VOICE_ID);
    expect(ensureVoiceForModel(undefined, VOICE_PRESET_MODEL_PLUS)).toBe('longanlingxin_v3.1');
  });

  it('内置音色受支持时保持原 id（含同名跨代映射）', () => {
    expect(ensureVoiceForModel('longanlingxin_v3.1', VOICE_PRESET_MODEL_PLUS)).toBe('longanlingxin_v3.1');
    expect(ensureVoiceForModel('longanfengyue', VOICE_PRESET_MODEL)).toBe('longanfengyue_v3.1');
  });

  it('内置音色不被目标模型支持时回落到该模型缺省音色（避免 411 后整轮退回文字）', () => {
    expect(ensureVoiceForModel('longwan_v3.1', VOICE_PRESET_MODEL_PLUS)).toBe('longanlingxin_v3.1');
    // 3.0 的 longanlingxi 切到 3.1-flash：先做同名映射（新代际支持），不回落
    expect(ensureVoiceForModel('longanlingxi', VOICE_PRESET_MODEL)).toBe('longanlingxi_v3.1');
    expect(ensureVoiceForModel('longanlingxin_v3.1', VOICE_PRESET_MODEL_30_FLASH)).toBe('longanfengyue');
  });

  it('克隆/设计音色与未知模型原样返回', () => {
    const clone = 'qwen-audio-3.0-tts-plus-vd-bailian-5e1b01d';
    expect(ensureVoiceForModel(clone, VOICE_PRESET_MODEL_PLUS)).toBe(clone);
    expect(ensureVoiceForModel('longanfengyue_v3.1', 'cosyvoice-v2')).toBe('longanfengyue_v3.1');
  });
});

describe('followVoiceModel（面板切模型的音色联动）', () => {
  it('空音色保持空（面板里表示按模型缺省）', () => {
    expect(followVoiceModel('', VOICE_PRESET_MODEL)).toBe('');
    expect(followVoiceModel(undefined, VOICE_PRESET_MODEL_30_FLASH)).toBe('');
  });

  it('内置同名音色跨代改写', () => {
    expect(followVoiceModel('longanfengyue', VOICE_PRESET_MODEL)).toBe('longanfengyue_v3.1');
    expect(followVoiceModel('longanhuan_v3.6', VOICE_PRESET_MODEL)).toBe('longanhuan_v3.1');
    expect(followVoiceModel('longanfengyue_v3.1', VOICE_PRESET_MODEL_30_FLASH)).toBe('longanfengyue');
  });

  it('目标模型不支持的内置音色回落到该模型缺省音色', () => {
    // 3.1 独有的 longwan_v3.1 切到 3.1-plus（只有 4 个旗舰音色）
    expect(followVoiceModel('longwan_v3.1', VOICE_PRESET_MODEL_PLUS)).toBe('longanlingxin_v3.1');
    // 没有 3.0 同名音色的 3.1 音色切到 3.0-flash，也回落到 3.0 缺省音色
    expect(followVoiceModel('longwan_v3.1', VOICE_PRESET_MODEL_30_FLASH)).toBe('longanfengyue');
  });

  it('目标模型支持的内置音色保持原 id', () => {
    expect(followVoiceModel('longanlingxin_v3.1', VOICE_PRESET_MODEL_PLUS)).toBe('longanlingxin_v3.1');
    expect(followVoiceModel('longanlingxin_v3.1', VOICE_PRESET_MODEL)).toBe('longanlingxin_v3.1');
  });

  it('克隆/设计等未知音色原样保留（不静默换声线）', () => {
    const clone = 'qwen-audio-3.1-tts-plus-vd-bailian-8521';
    expect(followVoiceModel(clone, VOICE_PRESET_MODEL)).toBe(clone);
    expect(followVoiceModel('cosyvoice-v2-voice', VOICE_PRESET_MODEL_30_PLUS)).toBe('cosyvoice-v2-voice');
    // 未知模型没有兼容矩阵：不映射、也不回落成 Qwen 缺省音色
    expect(followVoiceModel('longanfengyue_v3.1', 'cosyvoice-v2')).toBe('longanfengyue_v3.1');
  });
});

describe('buildVoiceOptions（自定义音色置顶）', () => {
  const custom = [
    { name: '御姐', voice: 'vd-ee1c' },
    { name: '女仆', voice: 'vd-ab17' },
  ];

  it('自定义音色全部排在系统预设之前，且顺序原样保留', () => {
    const options = buildVoiceOptions(custom, VOICE_PRESET_MODEL);
    expect(options).toHaveLength(custom.length + VOICE_PRESETS.length);
    expect(options.slice(0, 2)).toEqual([
      { value: 'vd-ee1c', label: '御姐（自定义）' },
      { value: 'vd-ab17', label: '女仆（自定义）' },
    ]);
    expect(options[2]?.value).toBe(VOICE_PRESETS[0]?.id);
  });

  it('没有自定义音色时只剩系统预设；未知模型时清单为空', () => {
    expect(buildVoiceOptions(undefined, VOICE_PRESET_MODEL)).toHaveLength(VOICE_PRESETS.length);
    expect(buildVoiceOptions([], VOICE_PRESET_MODEL)).toHaveLength(VOICE_PRESETS.length);
    expect(buildVoiceOptions([], 'cosyvoice-v2')).toHaveLength(0);
  });

  it('3.1-plus 下 3.1 旗舰音色可用，其余标注需要 flash', () => {
    const options = buildVoiceOptions([{ name: '御姐', voice: 'vd-ee1c' }], VOICE_PRESET_MODEL_PLUS);
    expect(options).toHaveLength(1 + VOICE_PRESETS.length);
    expect(options[0]).toEqual({ value: 'vd-ee1c', label: '御姐（自定义）' });

    const lingxin = options.find((option) => option.value === 'longanlingxin_v3.1');
    expect(lingxin?.requiresModel).toBeUndefined();
    const hua = options.find((option) => option.value === 'longhua_v3.1');
    expect(hua?.requiresModel).toBe(VOICE_PRESET_MODEL);
    // 3.0 音色与 3.1 模型跨代不兼容
    const legacy = options.find((option) => option.value === 'longanfengyue');
    expect(legacy?.requiresModel).toBe(VOICE_PRESET_MODEL_30_FLASH);
  });

  it('3.0-flash 下 3.1 音色全部标注需要 3.1-flash', () => {
    const options = buildVoiceOptions([], VOICE_PRESET_MODEL_30_FLASH);
    const current = options.find((option) => option.value === 'longanfengyue_v3.1');
    expect(current?.requiresModel).toBe(VOICE_PRESET_MODEL);
    const legacy = options.find((option) => option.value === 'longanfengyue');
    expect(legacy?.requiresModel).toBeUndefined();
  });

  it('没有音色 id / 重复 id 的自定义项被跳过，名称留空时用 id 兜底', () => {
    const options = buildVoiceOptions([
      { name: '待填', voice: '' },
      { name: '', voice: 'vd-abc' },
      { name: '重复', voice: 'vd-abc' },
      { name: '自定义覆盖', voice: 'longanfengyue' },
    ], VOICE_PRESET_MODEL);
    expect(options[0]).toEqual({ value: 'vd-abc', label: 'vd-abc（自定义）' });
    expect(options[1]).toEqual({ value: 'longanfengyue', label: '自定义覆盖（自定义）' });
    // 与自定义 id 重复的内置预设被跳过，所以总数 = 2 + (内置数 - 1)
    expect(options).toHaveLength(2 + VOICE_PRESETS.length - 1);
  });
});

describe('voiceOptionLabel', () => {
  it('按 id 找到下拉文案，找不到时回退 id 本身', () => {
    const options = buildVoiceOptions([{ name: '元气少女', voice: 'vd-8521' }], VOICE_PRESET_MODEL);
    expect(voiceOptionLabel(options, 'vd-8521')).toBe('元气少女（自定义）');
    expect(voiceOptionLabel(options, ' longanyuanfei ')).toContain('龙安元妃');
    expect(voiceOptionLabel(options, 'unknown-id')).toBe('unknown-id');
    expect(voiceOptionLabel(options, '')).toBe('');
    expect(voiceOptionLabel(options, undefined)).toBe('');
  });
});
