/**
 * 视觉描述共享函数 — 给一张图生成一句话文字描述。
 *
 * qqbot_describe_image 工具（用户主动让 bot 看图）和 sticker 自动收藏
 * （给表情生成 description + tags）都走这里，避免两份 vision 调用逻辑分叉。
 *
 * 流程和 vision-tool.ts 原 callVision 一致：
 *   loadImageBytes → attachments.saveImage → llm.stream 图片+prompt → 收文本
 */
import { basename } from 'node:path';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { collectStreamText } from "../shared/llm-text.js";
import { loadImageBytes, } from "./image-input.js";
/**
 * 给图片生成文字描述。
 *
 * @param image  本地绝对路径或 http(s) URL
 * @param prompt 给视觉模型的指令（精确描述要什么）
 * @param label  日志/错误里的标识
 * @throws       图片加载失败 / 模型调用失败时抛错，调用方决定是否吞掉
 */
export async function describeImage(services, vision, image, prompt, signal, label = 'describe-image') {
    const loaded = await loadImageBytes(image, vision.maxBytes, signal, label);
    const ref = await services.attachments.saveImage({
        data: loaded.data,
        mediaType: loaded.mediaType,
        name: /^https?:\/\//i.test(image) ? undefined : basename(image),
    });
    // v4 producer-owned source kind（与 vision-tool 保持一致）
    const visionSource = { kind: 'plugin:dsh-im-qqbot' };
    const message = createUserMessage({
        content: [
            { type: 'image', attachment: ref },
            { type: 'text', text: prompt },
        ],
        source: visionSource,
    });
    const options = {
        provider: vision.provider,
        model: vision.model,
        messages: [message],
        maxTokens: vision.maxTokens,
        signal,
    };
    return collectStreamText(services.llm.stream(options), label);
}
//# sourceMappingURL=describe-image.js.map