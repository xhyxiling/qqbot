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
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import type { VisionConfig } from '../config.ts';
import { collectStreamText } from '../shared/llm-text.ts';
import {
  loadImageBytes,
  type ImageAttachmentRef,
  type ImageMediaType,
} from './image-input.ts';

/** attachments 服务最小接口 */
export interface AttachmentStoreLike {
  saveImage(input: { data: Uint8Array; mediaType: ImageMediaType; name?: string }): Promise<ImageAttachmentRef>;
}

/** llm 服务最小接口 */
export interface LlmRuntimeLike {
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}

/** 视觉调用需要的运行时依赖 */
export interface DescribeImageServices {
  llm: LlmRuntimeLike;
  attachments: AttachmentStoreLike;
}

/**
 * 给图片生成文字描述。
 *
 * @param image  本地绝对路径或 http(s) URL
 * @param prompt 给视觉模型的指令（精确描述要什么）
 * @param label  日志/错误里的标识
 * @throws       图片加载失败 / 模型调用失败时抛错，调用方决定是否吞掉
 */
export async function describeImage(
  services: DescribeImageServices,
  vision: VisionConfig,
  image: string,
  prompt: string,
  signal: AbortSignal,
  label = 'describe-image',
): Promise<string> {
  const loaded = await loadImageBytes(image, vision.maxBytes, signal, label);
  const ref = await services.attachments.saveImage({
    data: loaded.data,
    mediaType: loaded.mediaType,
    name: /^https?:\/\//i.test(image) ? undefined : basename(image),
  });

  // v4 producer-owned source kind（与 vision-tool 保持一致）
  const visionSource = { kind: 'plugin:dsh-im-qqbot' } as unknown as { kind: 'plugin'; plugin: string };

  const message = createUserMessage({
    content: [
      { type: 'image', attachment: ref },
      { type: 'text', text: prompt },
    ],
    source: visionSource,
  });

  const options: GenerateOptions = {
    provider: vision.provider,
    model: vision.model,
    messages: [message],
    maxTokens: vision.maxTokens,
    signal,
  };

  return collectStreamText(services.llm.stream(options), label);
}

/**
 * 纯文本补全（不带图）。
 *
 * 用于表情包识别的第二阶段：视觉模型先 OCR + 描述画面，再把文字交给文本模型
 * 判断「这是什么梗」——文本模型的中文网络梗知识远强于视觉描述。
 */
export async function completeText(
  services: DescribeImageServices,
  opts: { provider: string; model: string; maxTokens: number },
  prompt: string,
  signal: AbortSignal,
  label = 'complete-text',
): Promise<string> {
  const source = { kind: 'plugin:dsh-im-qqbot' } as unknown as { kind: 'plugin'; plugin: string };
  const message = createUserMessage({
    content: [{ type: 'text', text: prompt }],
    source,
  });

  const options: GenerateOptions = {
    provider: opts.provider,
    model: opts.model,
    messages: [message],
    maxTokens: opts.maxTokens,
    signal,
  };

  return collectStreamText(services.llm.stream(options), label);
}
