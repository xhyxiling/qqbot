import { describe, expect, it } from 'vitest';
import {
  NATURAL_SPEECH_HINT,
  buildSpeechInstruction,
  cleanTextForSpeech,
  composeSpeechInstruction,
  normalizeVoiceInstruction,
  resolveVoiceSettings,
  resolveVoiceTuning,
} from './voice-config.ts';
import { MAX_VOICE_INSTRUCTION_LEN, type VoiceConfig } from '../config.ts';

function voiceConfig(overrides: Partial<VoiceConfig> = {}): VoiceConfig {
  return {
    enabled: true,
    apiKey: 'sk-test',
    model: 'qwen-audio-3.0-tts-flash',
    voice: 'longanfengyue',
    instruction: '',
    presets: [],
    baseUrl: '',
    workspace: '',
    maxChars: 300,
    timeoutMs: 30000,
    ...overrides,
  };
}

describe('resolveVoiceSettings（开关 + apiKey 门控）', () => {
  it('开关关闭时即使 apiKey 非空也返回 undefined', () => {
    expect(resolveVoiceSettings(voiceConfig({ enabled: false }))).toBeUndefined();
  });

  it('缺省 enabled（旧配置）视为开关打开：有 Key 时仍启用', () => {
    expect(resolveVoiceSettings(voiceConfig({ enabled: undefined as unknown as boolean })))
      .toMatchObject({ apiKey: 'sk-test' });
  });

  it('apiKey 为空（含纯空白）时返回 undefined：语音功能关闭', () => {
    expect(resolveVoiceSettings(undefined)).toBeUndefined();
    expect(resolveVoiceSettings(voiceConfig({ apiKey: '' }))).toBeUndefined();
    expect(resolveVoiceSettings(voiceConfig({ apiKey: '   ' }))).toBeUndefined();
  });

  it('apiKey 非空时去空白并回落到缺省模型/音色（默认 3.1-flash）', () => {
    const settings = resolveVoiceSettings(voiceConfig({
      apiKey: '  sk-test  ',
      model: '',
      voice: '  ',
      baseUrl: '  ',
      workspace: '  ',
    }));
    expect(settings).toEqual({
      apiKey: 'sk-test',
      model: 'qwen-audio-3.1-tts-flash',
      voice: 'longanfengyue_v3.1',
      maxChars: 300,
      timeoutMs: 30000,
    });
  });

  it('音色与模型代际不一致时映射成同代内置音色；复刻音色保持不变', () => {
    expect(resolveVoiceSettings(voiceConfig({
      model: 'qwen-audio-3.1-tts-flash',
      voice: 'longanfengyue',
    }))).toMatchObject({ model: 'qwen-audio-3.1-tts-flash', voice: 'longanfengyue_v3.1' });

    expect(resolveVoiceSettings(voiceConfig({
      model: 'qwen-audio-3.0-tts-flash',
      voice: 'longanfengyue_v3.1',
    }))).toMatchObject({ model: 'qwen-audio-3.0-tts-flash', voice: 'longanfengyue' });

    const clone = 'qwen-audio-3.0-tts-plus-vd-bailian-8521';
    expect(resolveVoiceSettings(voiceConfig({
      model: 'qwen-audio-3.1-tts-flash',
      voice: clone,
    }))).toMatchObject({ voice: clone });
  });

  it('3.1-plus 只支持旗舰音色：不兼容的旧音色回落到该模型缺省音色', () => {
    expect(resolveVoiceSettings(voiceConfig({
      model: 'qwen-audio-3.1-tts-plus',
      voice: 'longanlingxi',
    }))).toMatchObject({ model: 'qwen-audio-3.1-tts-plus', voice: 'longanlingxin_v3.1' });
  });

  it('字数与超时收敛到合法范围，非法数值回落缺省', () => {
    expect(resolveVoiceSettings(voiceConfig({ maxChars: 5, timeoutMs: 100 }))).toMatchObject({
      maxChars: 20,
      timeoutMs: 5000,
    });
    expect(resolveVoiceSettings(voiceConfig({ maxChars: 5000, timeoutMs: 999999 }))).toMatchObject({
      maxChars: 1000,
      timeoutMs: 120000,
    });
    expect(resolveVoiceSettings(voiceConfig({
      maxChars: Number.NaN, timeoutMs: Number.NaN,
    }))).toMatchObject({ maxChars: 300, timeoutMs: 30000 });
  });
});

describe('normalizeVoiceInstruction（情感指令）', () => {
  it('换行变成「；」：保留场景/逐句结构，同时去掉多余空白', () => {
    expect(normalizeVoiceInstruction('  请用清冷、平静的语气\n\n语速稍慢  ')).toBe('请用清冷、平静的语气；语速稍慢');
    expect(normalizeVoiceInstruction('场景：夜里她叫住学长\n第1句：轻声、迟疑\n第2句：吞吐、句尾落地'))
      .toBe('场景：夜里她叫住学长；第1句：轻声、迟疑；第2句：吞吐、句尾落地');
    expect(normalizeVoiceInstruction('用 元气满满 的语气')).toBe('用 元气满满 的语气');
  });

  it('空值/非字符串/纯空白返回 undefined（不下发 instruction）', () => {
    expect(normalizeVoiceInstruction('')).toBeUndefined();
    expect(normalizeVoiceInstruction('   \n ')).toBeUndefined();
    expect(normalizeVoiceInstruction(undefined)).toBeUndefined();
    expect(normalizeVoiceInstruction(123)).toBeUndefined();
  });

  it('超长时截断到上限且不留尾随空白', () => {
    const long = `${'柔'.repeat(MAX_VOICE_INSTRUCTION_LEN)}  多余`;
    const normalized = normalizeVoiceInstruction(long);
    expect(normalized).toBe('柔'.repeat(MAX_VOICE_INSTRUCTION_LEN));
  });
});

describe('resolveVoiceSettings（情感指令透出）', () => {
  it('配置了 instruction 时规范化后随设置返回', () => {
    const settings = resolveVoiceSettings(voiceConfig({
      instruction: ' 请用清冷\n克制的语气，语速稍慢 ',
    }));
    expect(settings?.instruction).toBe('请用清冷；克制的语气，语速稍慢');
  });

  it('未配置 instruction 时设置里不带该字段', () => {
    expect(resolveVoiceSettings(voiceConfig())?.instruction).toBeUndefined();
    expect(resolveVoiceSettings(voiceConfig({ instruction: '   ' }))?.instruction).toBeUndefined();
  });
});

describe('resolveVoiceTuning', () => {
  const settings = resolveVoiceSettings(voiceConfig())!;

  it('未配置人格音色时使用全局音色', () => {
    expect(resolveVoiceTuning(settings)).toEqual({ voice: 'longanfengyue' });
    expect(resolveVoiceTuning(settings, {})).toEqual({ voice: 'longanfengyue' });
    expect(resolveVoiceTuning(settings, { voice: '   ' })).toEqual({ voice: 'longanfengyue' });
  });

  it('人格音色覆盖全局音色，语速/音量收敛并随参数透出', () => {
    expect(resolveVoiceTuning(settings, { voice: 'longxiaochun_v2', rate: 1.2, volume: 60 })).toEqual({
      voice: 'longxiaochun_v2',
      rate: 1.2,
      volume: 60,
    });
    expect(resolveVoiceTuning(settings, { rate: 5, volume: 101 })).toEqual({
      voice: 'longanfengyue',
      rate: 2,
      volume: 100,
    });
  });

  it('人格音色按全局模型的代际映射（内置同名音色），自定义 id 不动', () => {
    const settings31 = resolveVoiceSettings(voiceConfig({
      model: 'qwen-audio-3.1-tts-flash',
      voice: 'longanfengyue_v3.1',
    }))!;
    expect(resolveVoiceTuning(settings31, { voice: 'longanfengyue' })).toEqual({
      voice: 'longanfengyue_v3.1',
    });
    expect(resolveVoiceTuning(settings31, { voice: 'vd-custom' })).toEqual({ voice: 'vd-custom' });
  });

  it('人格音色不被当前模型支持时回落到该模型缺省音色（避免整轮退回文字）', () => {
    const plus = resolveVoiceSettings(voiceConfig({
      model: 'qwen-audio-3.1-tts-plus',
      voice: 'longanlingxin_v3.1',
    }))!;
    expect(resolveVoiceTuning(plus, { voice: 'longwan_v3.1' })).toEqual({ voice: 'longanlingxin_v3.1' });
    // 复刻/设计音色例外：跨代仍可合成，保持原 id
    const clone = 'qwen-audio-3.0-tts-plus-vd-bailian-5e1b01d';
    expect(resolveVoiceTuning(plus, { voice: clone })).toEqual({ voice: clone });
  });

  it('情感指令：人格覆盖全局，人格留空则沿用全局', () => {
    const withInstruction = resolveVoiceSettings(voiceConfig({
      instruction: '请用元气满满、语速稍快的语气',
    }))!;
    expect(resolveVoiceTuning(withInstruction)).toEqual({
      voice: 'longanfengyue',
      instruction: '请用元气满满、语速稍快的语气',
    });
    expect(resolveVoiceTuning(withInstruction, { instruction: '  ' })).toEqual({
      voice: 'longanfengyue',
      instruction: '请用元气满满、语速稍快的语气',
    });
    expect(resolveVoiceTuning(withInstruction, { instruction: '用清冷、克制的语气' })).toEqual({
      voice: 'longanfengyue',
      instruction: '用清冷、克制的语气',
    });
  });
});

describe('buildSpeechInstruction（自然口语提示）', () => {
  it('未配置语气时只下发自然提示', () => {
    expect(buildSpeechInstruction()).toBe(NATURAL_SPEECH_HINT);
    expect(buildSpeechInstruction('   ')).toBe(NATURAL_SPEECH_HINT);
  });

  it('人格/单轮语气在前，自然提示追加在后', () => {
    expect(buildSpeechInstruction('带点笑意')).toBe(`带点笑意；${NATURAL_SPEECH_HINT}`);
  });

  it('场景 + 逐句走向按「；」下发给 TTS', () => {
    const scene = buildSpeechInstruction('场景：夜里她叫住学长\n第1句：轻声、迟疑\n第2句：吞吐、句尾落地');
    expect(scene).toBe(`场景：夜里她叫住学长；第1句：轻声、迟疑；第2句：吞吐、句尾落地；${NATURAL_SPEECH_HINT}`);
  });

  it('超长语气被裁剪，总长不超过上限且提示语完整保留', () => {
    const text = buildSpeechInstruction('柔'.repeat(MAX_VOICE_INSTRUCTION_LEN));
    expect(text.endsWith(NATURAL_SPEECH_HINT)).toBe(true);
    expect(text.length).toBeLessThanOrEqual(MAX_VOICE_INSTRUCTION_LEN);
  });

  it('超长时停在分句边界，不留下半句走向', () => {
    const base = `${'柔'.repeat(100)}；${'刚'.repeat(100)}；${'稳'.repeat(100)}；${'定'.repeat(100)}`;
    const text = buildSpeechInstruction(base);
    expect(text.endsWith(NATURAL_SPEECH_HINT)).toBe(true);
    expect(text.length).toBeLessThanOrEqual(MAX_VOICE_INSTRUCTION_LEN);
    expect(text).not.toContain('定');
    expect(text.slice(0, -NATURAL_SPEECH_HINT.length - 1)).toBe(
      `${'柔'.repeat(100)}；${'刚'.repeat(100)}；${'稳'.repeat(100)}`,
    );
  });
});

describe('composeSpeechInstruction（本轮走向 + 人格语气叠加）', () => {
  it('只有一方时原样返回', () => {
    expect(composeSpeechInstruction('场景：深夜；这一句：放轻', undefined)).toBe('场景：深夜；这一句：放轻');
    expect(composeSpeechInstruction(undefined, '中低音、句尾落下')).toBe('中低音、句尾落下');
    expect(composeSpeechInstruction('   ', '  ')).toBeUndefined();
  });

  it('两方都有时本轮走向在前、人格语气在后，不再互相顶掉', () => {
    expect(composeSpeechInstruction('场景：沙发上；这一句：慢、带笑', '中低音、略微沙哑'))
      .toBe('场景：沙发上；这一句：慢、带笑；中低音、略微沙哑');
  });

  it('内容互相包含时只保留更完整的一份', () => {
    expect(composeSpeechInstruction('中低音、略微沙哑', '中低音')).toBe('中低音、略微沙哑');
    expect(composeSpeechInstruction('带笑', '带笑')).toBe('带笑');
  });

  it('叠加后仍受总长上限约束：本轮走向不会被裁剪掉', () => {
    const turn = '场景：晚上她靠在沙发上，声音放松；这一句：先轻笑一声，语速放慢，句尾轻轻落下';
    const base = '柔'.repeat(MAX_VOICE_INSTRUCTION_LEN);
    const text = buildSpeechInstruction(composeSpeechInstruction(turn, base));
    expect(text).toContain(turn);
    expect(text.endsWith(NATURAL_SPEECH_HINT)).toBe(true);
    expect(text.length).toBeLessThanOrEqual(MAX_VOICE_INSTRUCTION_LEN);
  });
});

describe('cleanTextForSpeech', () => {
  it('去掉分隔符/代码块/URL/Markdown 与颜文字，||| 与换行都当句号', () => {
    const text = [
      '真的假的|||你别骗我',
      '```ts',
      'const a = 1',
      '```',
      '看这个 https://example.com/a',
      '(｡•́︿•̀｡) 好耶',
    ].join('\n');
    expect(cleanTextForSpeech(text, 300)).toBe('真的假的。你别骗我。看这个。好耶。');
  });

  it('舞台指示不念：括号动作、方括号情绪标签、星号动作整段剔除', () => {
    expect(cleanTextForSpeech('（小声）别闹，我有点困了', 300)).toBe('别闹，我有点困了。');
    expect(cleanTextForSpeech('【突然】你吓我一跳', 300)).toBe('你吓我一跳。');
    expect(cleanTextForSpeech('*叹气* 好吧，我陪你说会儿话', 300)).toBe('好吧，我陪你说会儿话。');
    expect(cleanTextForSpeech('乖，别哭（摸摸头）（笑）', 300)).toBe('乖，别哭。');
  });

  it('语音按句断句：换行变成句子边界，而不是空格连读', () => {
    expect(cleanTextForSpeech('晚安\n早点睡\n明天见', 300)).toBe('晚安。早点睡。明天见。');
  });

  it('多个气泡不会连成一句话：||| 全部变成句号', () => {
    expect(cleanTextForSpeech('这么黏人啊|||那今天有没有好好吃饭|||别光顾着找我', 300)).toBe('这么黏人啊。那今天有没有好好吃饭。别光顾着找我。');
  });

  it('句尾没有标点时补句号（TTS 靠句末标点收尾，缺了会读得平）', () => {
    expect(cleanTextForSpeech('今天过得怎么样', 300)).toBe('今天过得怎么样。');
    expect(cleanTextForSpeech('乖，别哭', 300)).toBe('乖，别哭。');
  });

  it('重复标点被合并，标点旁的空格被去掉', () => {
    expect(cleanTextForSpeech('真的假的？？\n\n你别骗我 ，。', 300)).toBe('真的假的？？你别骗我。');
  });

  it('白名单情感标签保留给 TTS；其它方括号标记整体丢弃', () => {
    expect(cleanTextForSpeech('别闹[whispers]快睡', 300)).toBe('别闹[whispers]快睡。');
    expect(cleanTextForSpeech('[excited]真的假的|||你别骗我', 300)).toBe('[excited]真的假的。你别骗我。');
    // 非白名单标签不念（否则会念出 pause:1s / 突然）
    expect(cleanTextForSpeech('你吓我一跳[pause:1s]', 300)).toBe('你吓我一跳。');
  });

  it('截断不会切坏情感标签', () => {
    expect(cleanTextForSpeech('晚安晚安晚安晚安晚安晚安[whispers]', 20)).toBe('晚安晚安晚安晚安晚安晚安。');
    expect(cleanTextForSpeech('一二三四五六七八九十一二三四五六七八九十[whispers]好梦', 25))
      .toBe('一二三四五六七八九十一二三四五六七八九十。');
  });

  it('截断优先停在句末，不硬切半句话', () => {
    expect(cleanTextForSpeech('今天天气很好。你吃饭了吗。我也刚吃完。晚上早点睡。', 20))
      .toBe('今天天气很好。你吃饭了吗。我也刚吃完。');
  });

  it('超出上限且没有句末标点时硬截断，且不留尾随空白', () => {
    const text = '一'.repeat(50);
    expect(cleanTextForSpeech(text, 20)).toBe(`${'一'.repeat(19)}。`);
  });

  it('只有符号/颜文字时返回空字符串（本轮不朗读）', () => {
    expect(cleanTextForSpeech('(｡•́︿•̀｡) ||| *** ###', 300)).toBe('');
    expect(cleanTextForSpeech('   ', 300)).toBe('');
    expect(cleanTextForSpeech('', 300)).toBe('');
  });

  it('保留正常标点并折叠空白', () => {
    expect(cleanTextForSpeech('你好，世界！\n\n  今天过得怎么样？', 300)).toBe('你好，世界！今天过得怎么样？');
  });
});
