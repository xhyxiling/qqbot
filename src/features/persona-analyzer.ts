/**
 * 单目标人格分析编排 — 手动工具与自动分析共用
 *
 * 负责任务式的流程：把某位群友跨会话的归档发言拼成 prompt → 调用会话模型 →
 * 解析结构化 JSON。调用方决定模型路由、是否落库、如何展示。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import { collectStreamText } from '../shared/llm-text.ts';
import type { ModelRoute } from './model-route.ts';
import type { LlmRuntimeLike } from './model-route.ts';
import type { PersonaArchive } from './persona-archive.ts';
import {
  buildProfilePrompt,
  parseProfileAnalysis,
  PROFILE_ANALYSIS_MAX_TOKENS,
  PROFILE_ANALYSIS_SYSTEM_PROMPT,
  type PersonaAnalysisResult,
  type PersonaChatInput,
} from './persona-profile-analysis.ts';
import { parseChatKey } from './persona-profiles.ts';

/** 分析标签（错误信息前缀） */
export const PERSONA_ANALYZER_LABEL = 'qqbot_analyze_persona';

/** 调用参数 */
export interface AnalyzeSenderProfileInput {
  llm: LlmRuntimeLike;
  route: ModelRoute;
  senderId: string;
  senderName?: string;
  /** 该成员在各会话的发言（至少一个会话） */
  chats: readonly PersonaChatInput[];
  /** 用户额外关注点 */
  focus?: string;
  /** 聊天记录字符预算 */
  budget?: number;
  /** 输出 token 上限 */
  maxTokens?: number;
  /** 中断信号（自动分析超时 / 插件卸载） */
  signal?: AbortSignal;
}

/** 调用结果 */
export interface AnalyzeSenderProfileResult {
  analysis: PersonaAnalysisResult;
  /** 本次送入模型的消息总量 */
  messageCount: number;
  /** 覆盖的会话数 */
  chatCount: number;
  provider: string;
  model: string;
}

/**
 * 收集某位成员跨会话的归档消息。
 *
 * 只取 `senderId` 完全相同的条目：QQ 群消息的 `member_openid` 由平台下发，
 * 跨群是否一致取决于平台，不能按昵称推断同一人。
 */
export function loadSenderChats(
  archive: PersonaArchive,
  senderId: string,
): PersonaChatInput[] {
  const chats: PersonaChatInput[] = [];
  for (const chat of archive.chatsForSender(senderId)) {
    const messages = archive.listBySender(chat.chatKey, senderId);
    if (messages.length === 0) continue;
    const parsed = parseChatKey(chat.chatKey);
    chats.push({
      chatKey: chat.chatKey,
      scope: parsed.scope,
      peerId: parsed.peerId,
      messages,
    });
  }
  return chats;
}

/**
 * 分析一位群友（跨会话聚合），返回结构化结果。
 *
 * 调用方负责校验样本量、模型路由与失败记录；这里只保证「有输入 → 有结构」。
 */
export async function analyzeSenderProfile(
  input: AnalyzeSenderProfileInput,
): Promise<AnalyzeSenderProfileResult> {
  const chats = input.chats.filter((chat) => chat.messages.length > 0);
  const messageCount = chats.reduce((sum, chat) => sum + chat.messages.length, 0);
  if (messageCount === 0) {
    throw new Error(`${PERSONA_ANALYZER_LABEL}: 没有可分析的归档消息`);
  }

  const prompt = buildProfilePrompt({
    senderId: input.senderId,
    ...(input.senderName !== undefined ? { senderName: input.senderName } : {}),
    chats,
    ...(input.focus !== undefined ? { focus: input.focus } : {}),
    ...(input.budget !== undefined ? { budget: input.budget } : {}),
  });
  const message = createUserMessage({
    content: [{ type: 'text', text: prompt }],
    // v4 producer-owned source kind；本地 dsh-llm 类型尚为 v3 联合，做类型桥接
    source: { kind: 'plugin:dsh-im-qqbot' } as unknown as { kind: 'plugin'; plugin: string },
  });
  const generate: GenerateOptions = {
    provider: input.route.provider,
    model: input.route.model,
    system: PROFILE_ANALYSIS_SYSTEM_PROMPT,
    messages: [message],
    maxTokens: input.maxTokens ?? PROFILE_ANALYSIS_MAX_TOKENS,
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
  };

  const text = await collectStreamText(input.llm.stream(generate), PERSONA_ANALYZER_LABEL);
  return {
    analysis: parseProfileAnalysis(text, messageCount),
    messageCount,
    chatCount: chats.length,
    provider: input.route.provider,
    model: input.route.model,
  };
}
