/**
 * 语音回复发送器 — 合成 → 临时文件 → QQ 语音消息
 *
 * 只在开关打开且 `voice.apiKey` 非空时创建（见 createVoiceSpeaker）。是否发语音由上层模型
 * 决定（调用 qqbot_voice），本模块只在轮末把已扣下的正文合成成语音；任何失败都
 * 返回 false，由出站路由退回文字，避免用户什么都收不到。
 */
import { randomUUID } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MEDIA_ROOT } from "../media/media-cleaner.js";
import { isSpeechWebSocketAvailable, synthesizeSpeech } from "./tts.js";
import { buildSpeechInstruction, cleanTextForSpeech, composeSpeechInstruction, resolveVoiceSettings, resolveVoiceTuning, } from "./voice-config.js";
/** 合成的临时音频名（放在 MEDIA_ROOT，发送后立即删除） */
function temporaryAudioPath() {
    return join(MEDIA_ROOT, `voice-${Date.now()}-${randomUUID().slice(0, 8)}.mp3`);
}
/**
 * 创建语音发送器；开关关闭、未配置 API Key 或运行时缺少内置 WebSocket 时返回 undefined。
 *
 * Node 20 没有全局 WebSocket：此时即使填了 Key 也无法合成，启动时告警并关闭，
 * 而不是每轮对话都抛错。
 */
export function createVoiceSpeaker(options) {
    const settings = resolveVoiceSettings(options.voice);
    if (settings === undefined)
        return undefined;
    if (!isSpeechWebSocketAvailable()) {
        options.logger.warn('im-qqbot: 已配置语音 Key，但当前 Node 运行时没有内置 WebSocket（需要 Node 22+），语音回复已关闭');
        return undefined;
    }
    return new VoiceSpeaker(options.manager, settings, options.sender, options.logger);
}
/** 语音回复发送器（每个网关一个实例，无状态） */
export class VoiceSpeaker {
    manager;
    settings;
    sender;
    logger;
    constructor(manager, settings, sender, logger) {
        this.manager = manager;
        this.settings = settings;
        this.sender = sender;
        this.logger = logger;
    }
    /**
     * 用语音朗读一段回复文本。
     *
     * 情感指令优先级：本轮 `qqbot_voice({ instruction })` > 人格配置 > 全局配置。
     *
     * @returns true = 已发送语音；false = 文本不可朗读或合成/发送失败（已记日志）
     */
    async speak(record, text) {
        const speech = cleanTextForSpeech(text, this.settings.maxChars);
        if (speech === '')
            return false;
        const persona = this.manager.getEffectivePersona(record.scope, record.peerId);
        const tuning = resolveVoiceTuning(this.settings, persona?.expressions?.voice);
        const personaVoice = persona?.expressions?.voice?.voice?.trim();
        if (personaVoice !== undefined && personaVoice !== '' && tuning.voice !== personaVoice) {
            // 人格音色与当前模型不兼容时会被换成该模型的缺省音色：不说一声，用户只会觉得「声线变了」
            this.logger.warn(`im-qqbot: 人格音色 ${personaVoice} 不被模型 ${this.settings.model} 支持，本轮改用 ${tuning.voice}`);
        }
        // 本轮走向 + 人格/全局语气叠加（不能互相顶掉），再统一追加
        // 「像发微信语音、不要播音腔」的口语提示，否则静态的朗读指令会把每一句都念成同一种播报腔
        const instruction = buildSpeechInstruction(composeSpeechInstruction(record.voiceInstruction, tuning.instruction));
        let audio;
        try {
            audio = await synthesizeSpeech(speech, {
                apiKey: this.settings.apiKey,
                model: this.settings.model,
                voice: tuning.voice,
                ...(this.settings.baseUrl !== undefined ? { baseUrl: this.settings.baseUrl } : {}),
                ...(this.settings.workspace !== undefined ? { workspace: this.settings.workspace } : {}),
                ...(tuning.rate !== undefined ? { rate: tuning.rate } : {}),
                ...(tuning.volume !== undefined ? { volume: tuning.volume } : {}),
                instruction,
                timeoutMs: this.settings.timeoutMs,
            });
        }
        catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            // AccessDenied = 账号/API Key 没有这个模型的权限点；ModelNotFound = 模型 id 写错或未开通。
            // 这两种退化在 QQ 端只表现为「说好发语音却发了文字」，日志里得能一眼看出来。
            const hint = /AccessDenied/i.test(reason)
                ? '（请到阿里云百炼控制台，给这个 API Key 勾选该语音模型的权限点）'
                : /ModelNotFound/i.test(reason)
                    ? '（模型 id 不存在或账号未开通该模型）'
                    : '';
            this.logger.warn(`im-qqbot: 语音合成失败，本轮改为发送文字: ${reason}${hint}`);
            return false;
        }
        const filePath = temporaryAudioPath();
        try {
            await mkdir(MEDIA_ROOT, { recursive: true });
            await writeFile(filePath, audio);
            await this.sender.sendVoice(record.replyTarget, { localPath: filePath });
            this.logger.info(`im-qqbot: 已发送语音 voice=${tuning.voice} bytes=${audio.length} chars=${speech.length}`
                + ` instruction=${instruction.length}字`);
            return true;
        }
        catch (err) {
            this.logger.warn(`im-qqbot: 语音发送失败，本轮改为发送文字: ${err instanceof Error ? err.message : String(err)}`);
            return false;
        }
        finally {
            await rm(filePath, { force: true }).catch(() => { });
        }
    }
}
//# sourceMappingURL=voice-reply.js.map