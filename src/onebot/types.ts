/**
 * OneBot 11 事件与消息段类型（最小子集，仅覆盖插件用到的部分）
 */

/** 消息段（数组格式） */
export interface OneBotSegment {
  type: string;
  data: Record<string, unknown>;
}

/** OneBot 11 事件（只关心 message / meta_event） */
export interface OneBotEvent {
  post_type?: string;
  time?: number;
  self_id?: number | string;
  [key: string]: unknown;
}

/** 普通消息事件 */
export interface OneBotMessageEvent extends OneBotEvent {
  post_type: 'message';
  message_type: 'private' | 'group';
  sub_type?: string;
  message_id: number | string;
  user_id: number | string;
  group_id?: number | string;
  message: OneBotSegment[] | string;
  raw_message?: string;
  sender?: {
    user_id?: number | string;
    nickname?: string;
    card?: string;
    role?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/** get_msg 返回的消息体（用于解析引用） */
export interface OneBotMessageDetail {
  message_id?: number | string;
  sender?: { user_id?: number | string; nickname?: string; card?: string };
  message?: OneBotSegment[] | string;
  time?: number;
}

/** OneBot API 响应 */
export interface OneBotApiResponse<T = unknown> {
  status?: 'ok' | 'failed' | 'async' | string;
  retcode?: number;
  data?: T;
  message?: string;
  wording?: string;
}

/** 登录信息 */
export interface OneBotLoginInfo {
  user_id?: number | string;
  nickname?: string;
}
