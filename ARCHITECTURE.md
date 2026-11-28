# 架构与代码导览

面向第一次读这个仓库的人。目标不是把每个函数讲一遍，而是让你在 10 分钟内知道：

- 一条 QQ 消息从哪里进来、经过哪些层、最后从哪里发出去；
- 想改一个功能应该动哪个目录；
- 哪些模块边界是刻意设计的，哪些地方是历史包袱。

> 配套阅读：仓库根目录 [README.md](../README.md) 讲产品能力与配置；本文只讲代码。

## 1. 建议阅读顺序

按这个顺序读，概念不会打架：

1. `src/index.ts` — Cordis 插件入口，启动 OneBot 传输。
2. `src/gateway/bootstrap.ts` — 选择传输层，创建唯一的 SessionManager。
3. `src/gateway/common.ts` — 与传输无关的共享能力：出站、语音、表情、工具、问答/审批、生命周期。
4. `src/gateway/middleware-setup.ts` — 中间件链顺序，理解「消息在什么阶段被过滤/记录/回复」。
5. `src/transport/inbound.ts` — 一条消息如何组装成 agent 能读的 `agentBody`。
6. `src/transport/outbound.ts` — agent 的输出如何变成 QQ 消息。
7. `src/session/session-manager.ts` + `src/session/prompt-assembly.ts` — 会话生命周期与系统提示词分层。
8. `src/features/` — 主动发言、群友资料查询、问答、审批、控制工具等横切功能。

## 2. 分层与依赖规则

```
src/index.ts                     插件入口（Cordis apply）
        │
        ▼
src/gateway/                     装配层：建会话、配中间件、启动/停止传输
        │
        ├───────────────┐
        ▼               ▼
src/transport/     src/onebot/   传输层：QQ 协议适配、入站/出站
        │               │
        └───────┬───────┘
                ▼
src/session/                     会话层：agent 生命周期、系统提示词
                │
                ▼
src/{memory,personas,identity,features,media,voice,sticker,model,commands,expressions,shared}/
                                  领域能力：每个目录一个主题，尽量不互相穿透
```

约定：

- **领域模块不导入 `gateway/` 或 `transport/`**。例如 `memory/` 不应该知道 QQ 中间件长什么样。
- `gateway/` 可以导入 `transport/` 与所有领域模块；`transport/` 不反向导入 `gateway/`（`onebot/gateway.ts` 是传输实现，它会复用 `gateway/middleware-setup.ts`，这是有意的例外）。
- `shared/` 只放无业务状态的纯函数/常量，谁都可以依赖。
- 新增功能优先落到对应领域目录，不要在 `session-manager.ts` 或 `inbound.ts` 里继续堆逻辑。

## 3. 目录导览

| 目录 | 职责 | 关键文件 |
|------|------|----------|
| `src/index.ts` | 插件入口：读取配置、启动网关 | `apply()` |
| `src/config.ts` | 全部配置类型与 Schema（单一事实源） | `ConfigSchema`、各子 Schema |
| `src/types.ts` | 跨模块最小类型：`ChatScope`、`ReplyTarget`、`ChannelKind`、`Logger` | — |
| `src/gateway/` | 装配层 | `bootstrap.ts`、`common.ts`、`middleware-setup.ts`、`multiplex.ts`、`archive-runtime.ts` |
| `src/transport/` | 入站/出站与协议辅助 | `inbound.ts`、`ambient.ts`、`outbound.ts`、`outbound-buffer.ts`、`splitter.ts`、`reply-limiter.ts`、`attachment.ts` |
| `src/onebot/` | OneBot 11 传输实现 | `gateway.ts`、`client.ts`、`sender.ts`、`message.ts`、`napcat.ts` |
| `src/session/` | 会话生命周期与提示词 | `session-manager.ts`、`prompt-assembly.ts`、`idle-evictor.ts`、`types.ts` |
| `src/memory/` | 长期记忆、人物画像、身份别名 | `memory-store.ts`、`identity-store.ts`、`memory-extractor.ts`、`memory-prompt.ts` |
| `src/personas/` | 人格解析与工具白名单 | `persona-utils.ts`、`persona-tools.ts` |
| `src/identity/` | 身份判定、名字、消息标签 | `role.ts`、`names-store.ts` |
| `src/features/` | 横切功能 | `proactive*.ts`、`control-tool.ts`、`question-channel.ts`、`approval-channel.ts`、`persona-*.ts`、`solve-tool.ts`、`text-tools.ts` |
| `src/media/` | 图片/视频/文件 | `vision-tool.ts`、`send-file-tool.ts`、`media-cleaner.ts`、`send-media.ts` |
| `src/voice/` | TTS 语音回复 | `voice-config.ts`、`voice-tool.ts`、`voice-reply.ts`、`tts.ts`、`voice-prompt.ts` |
| `src/sticker/` | 表情包收藏/选择/进化 | `collector.ts`、`selector.ts`、`evolver.ts`、`storage.ts`、`tools.ts` |
| `src/model/` | 模型路由与偏好持久化 | `model-resolver.ts`、`prefs-store.ts`、`settings-reader.ts` |
| `src/evolve/` | 反馈与策略进化 | `store.ts`（反馈/策略持久化、版本与回滚）、`analyze.ts`（确定性归因） |
| `src/commands/` | 斜杠命令 | `index.ts` 编排，其余一命令一文件 |
| `src/setup/` | 配置写入辅助 | `persist.ts` 等 |
| `src/client/` | 浏览器半边（设置面板） | `index.ts`、`config-panel.ts` |
| `src/shared/` | 纯工具与共享协议 | `utils.ts`、`scope.ts`、`send-helper.ts`、`tool-catalog.ts`、`llm-text.ts` |
| `src/host/` | 宿主服务适配（compaction、preset 等） | `adapter.ts` |
| `src/update/` | 插件更新检查与执行 | `update-service.ts` |
| `src/expressions/` | 颜文字库与 prompt 片段 | `kaomoji.ts` |

## 4. 启动流程

```
apply(ctx, config)
  └─ bootstrapGateway()
       ├─ 创建 SessionManager
       ├─ 创建 OneBot 传输（WS/HTTP）
       └─ bootstrapCommon()
```

`bootstrapGateway`：

1. 创建**唯一**的 `SessionManager`（它会加载记忆、身份、名字、模型偏好）。
2. `createArchiveRuntime()` 创建群友发言档案与 LLM 引用（不做后台分析）。
3. 把 LLM 注入 `SessionManager`：记忆慢路径、主动发言判断。
4. 创建 `onebot/gateway.ts`：OneBot WS/HTTP、中间件、入站、发送适配。
5. 用 `MultiplexSender` 把 sender/mediaSender 合成一个出口。
6. `bootstrapCommon()`：注册出站、语音、表情、工具、问答/审批、媒体清理、生命周期。

关键设计：**传输层与业务实例分离**。将来新增另一种 QQ 接入方式时，不需要复制 SessionManager / 工具 / 命令。

## 5. 入站链路

### 5.1 中间件链

中间件在 `gateway/middleware-setup.ts` 的 `buildMiddlewares()` 中按顺序构建：

1. `errorHandler` — 兜底异常。
2. `messageFilter` — bot 回声与重复消息。
3. `accessPolicy` — 访问控制（c2c / group）。
4. `historyBuffer` — 群历史环形缓冲；在 @ 门控之前，未 @ 也计数。
5. `personaArchive` — 群友发言档案（`qqbot_view_person` 的数据源）。
6. `quoteRef` — 引用消息索引与解析。
7. `attachmentProcessor`（当前消息）— 下载图片/视频/文件。
8. `historyMedia` — 把媒体本地路径回填历史。
9. `handleAmbientGroupMessage` — 未 @ 群消息的旁听与主动发言（见 `transport/ambient.ts`）。
10. `mentionGate` — 群聊 @ 门控。
11. `contentSanitizer` — 去 @marker / 表情标签 / 多余空白。
12. `rateLimiter` — sender / group / global 三层限流。
13. `slashCommand` — 斜杠命令。
14. `questionAnswer` / `approvalAnswer` — 待答问题与待批审批截获。
15. `concurrencyGuard` — 同 peer 串行 + 消息合并。
16. `typingIndicator` — 输入状态。
17. `attachmentProcessor`（引用消息）— 只给真正要回复的消息补引用媒体。
18. `envelopeFormatter` — history + quote + sender 组装 envelope。
19. 传输层的 terminal middleware → `handleInbound()`。

> `handleAmbientGroupMessage` 必须在 `mentionGate` **之前**：SDK 命中「未 @」时会直接 `stop` 整条链，后面的处理器收不到消息。

### 5.2 `handleInbound` 的五层组装

`transport/inbound.ts` 只做「消息 → agentBody」：

1. Layer 1 `userContent`：正文 + 语音转录 + 附件类型标签。
2. Layer 2 `quotePart`：引用消息块。
3. Layer 3 `userMessage`：身份标签 + 发送者标签（群聊）。
4. Layer 4 `dynamicCtx`：媒体本地路径、ASR、引用附件。
5. Layer 5 `agentBody`：群历史 + 当前消息拼合。

之后：

```
recordInteraction()  # 先写记忆，与会话生命周期无关
getOrCreate()        # 复用 / 恢复 / 新建 agent
agent.followup()     # 投递这一轮
await whenIdle()     # 等本轮收敛，避免后续消息打断
```

群聊回复后会清空历史缓存，避免下次 @ 时重复组包；同时重置主动发言冷却并取消未触发的旁听批次。

## 6. 出站链路

```
session/event
  ├─ assistant 文本 → OutboundBuffer → 拆分/切分 → ReplyLimiter → sender.sendMarkdown
  ├─ agent/assistant-stream → 流式帧 → StreamingWriter
  ├─ 工具调用/结果 → tool-presenter
  ├─ present 交付物 → DeliverablesDeliverer
  └─ turn/end → 处理 pendingControl / 清理本轮标记
```

- `MultiplexSender` 按 `ReplyTarget.channel` 选择通道；缺失时回退到默认通道。
- 发送失败或触发回复限流时，出站会记录日志，并按拆分/重试配置继续处理。
- 模型输出 `[SILENT]` 时出站直接丢弃。
- 语音轮：`qqbot_voice` 置位 `record.voiceRequested`，轮末由 `voice-reply.ts` 合成并发送语音，正文不再作为文字发送。

## 7. 会话与提示词

### 7.1 会话

- `sessionKey = qqbot:${namespace}:${scope}:${peerId}`（OneBot 下 namespace 形如 `onebot-<selfId>`）。
- `SessionManager.getOrCreate()`：进程内复用 → 持久化恢复 → 新建。
- 每个 `SessionRecord` 保存 `agent`、`handle`、`replyTarget`、`scope`、`peerId`、`senderId`、`lastActivity`，以及本轮临时状态（`voiceRequested`、`stickerDescTokens`、`pendingControl`）。
- 闲置回收由 `IdleEvictor` 负责，回收时取消生成、释放工具限制、清理待答问题/待批审批。

### 7.2 系统提示词

`system-prompt/assemble` 在每轮构建 request 时触发。`SessionManager` 只负责取数据，真正的拼接在 `session/prompt-assembly.ts`：

| order | section | 说明 |
|-------|---------|------|
| 80 | `qqbot:global-prompt` | 所有会话通用约束 |
| 82 | `qqbot:identity` | 主人/管理员/朋友/陌生人 |
| 84 | `qqbot:names` | 机器人自称 / QQ 昵称 |
| 85 | `qqbot:persona-directive` | 指令：每轮先调 `qqbot_current_persona` 获取当前人格 |
| 86 | `qqbot:persona-tools` | 工具白名单说明 |
| 86.5 | `qqbot:vision` | 图片路径 → 调 `qqbot_describe_image` |
| 86.8 | `qqbot:person-lookup` | 需要时调 `qqbot_view_person` 查发言档案 |
| 87 | 记忆 / 人物画像 | 会话关系 + 跨会话画像 |
| 88 | 语音 | 何时发语音、怎么发 |
| 89 | 表情包 | 何时发表情、图库里有什么 |
| 90 | 管理操作 | `qqbot_control` 说明 |

新增提示词层时，优先在 `prompt-assembly.ts` 里加，不要往 `SessionManager` 里塞。

## 8. 数据与状态

所有本机数据默认在 `~/.dsh-qqbot/`：

- `memory.onebot.json`：会话记忆与人物画像（按 QQ 号）。
- `identities.json`：同一账号命名空间内 personId → 别名列表。
- `names.json`：机器人自称 / QQ 账号昵称。
- `model-prefs.json`：per-peer 模型 / preset / 人格 / sessionId。
- `persona-archive.json`：群友发言档案（只由 `qqbot_view_person` 按需读取）。
- `stickers.json`：表情包元数据。
- `workspace/`：agent 默认工作目录。
- `media/`：临时媒体，按 TTL 清理。
- `napcat/`：面板托管的 NapCat。

OneBot 的 `accessToken` 等连接信息写入 profile 的 `cordis.patch.yml`，不在上面这些文件里。

## 9. 三个横切特性

### 9.1 群聊主动发言 / 戳一戳

未 @ 的消息如果看起来在问机器人（`features/proactive.ts` 的 `isDirectedAtBot`：第二人称 + 疑问、
引用机器人消息、或「在吗」这类召唤），先由 `ProactiveJudge.replyChance` 让模型给出 0-1 的回复
概率，再按这个概率掷骰：命中就跳过 6%/冷却/插话判断直接回复（`runDirectedTurn`），没命中沉默。
既不装死，也不会把旁人的对话全接过来。

`onebot/gateway.ts` 还会处理 `notice` 事件里的戳一戳：被戳时先自动回戳（10 秒冷却），
然后等 6 秒再决定要不要说话——期间对方发消息就取消等待（那条消息才是要回的）；
最近 5 分钟没有上文则不回应，等对方的下一条消息；连续戳只保留一个待处理项、只回一次。
真正接话时通过 `transport/poke.ts` 投递「【戳一戳】…」，模型结合会话历史决定回复或 `[SILENT]`。

```
transport/ambient.ts       计时、批次、上下文、模型调用
features/proactive.ts      纯策略：候选过滤、概率、冷却、配额
features/proactive-judge.ts 纯判断：两人对话/话题封闭 → speak=false
transport/outbound.ts      [SILENT] 丢弃
```

调整「多久说一次」改 `features/proactive.ts`；调整「什么场合该说」改 `features/proactive-judge.ts`。

### 9.2 语音

```
voice-config.ts   解析开关/Key/模型/音色，决定是否启用
voice-tool.ts     qqbot_voice：模型声明本轮发语音
voice-reply.ts    轮末合成并发送，失败退回文字
tts.ts            DashScope WebSocket 协议
voice-prompt.ts   给模型的语音说明（order 88）
```

### 9.3 表情包

```
collector.ts  从下载的媒体里自动收藏
selector.ts   按策略挑图
evolver.ts    热度与淘汰
storage.ts    stickers.json 持久化
tools.ts      qqbot_pick/send/save/list/update_sticker
prompt.ts     给模型的表情说明（order 89）
```

### 9.4 群友资料查询

```
persona-archive.ts   滚动归档消息（数据源）
persona-summary.ts   目标选择 + 统计/最近发言摘要 + 注册 qqbot_view_person
persona-tool.ts      注册 qqbot_current_persona（每轮返回当前人格名字/设定）
prompt-assembly.ts   order 86.8 告诉模型何时调用工具
```

没有后台分析器：档案只写盘，模型在需要时调用工具读取。当前对话对象可被所有人查看；指定其他人需要 owner/admin。

### 9.5 反馈驱动进化

```
evolve/store.ts       feedback.json（最多 500 条）+ policies.json（当前策略/版本历史/pending）
evolve/analyze.ts     关键词归因（确定性兜底）：同类差评 >= 2 条才提案
evolve/llm-analyze.ts 模型归因：理解自然语言备注，失败时命令层回落 analyze.ts
commands/feedback.ts  /feedback good|bad [备注]
commands/evolve.ts    /evolve（生成提案）、apply、discard、status、history、rollback
transport/ambient.ts  读策略覆盖主动发言的 4 个数值（enabled/channels 仍以配置为准）
session/prompt-*.ts   styleNotes 以 order 86.9 注入 system prompt
```

原则：反馈只记录，提案只展示，`/evolve apply` 后才写策略；不自动改代码。模型归因
仍受白名单约束——只能改主动发言概率（夹在 2%–30%）或追加表达偏好，其余参数不可动。
策略文件在 `~/.dsh-qqbot/policies.json`，回滚会恢复上一个版本的数值与表达偏好。

## 10. 扩展点

| 想做什么 | 改哪里 |
|----------|--------|
| 新增模型可调用的工具 | 在对应领域目录写 `registerXTool(ctx, ...)`，在 `gateway/common.ts` 注册；同步更新 `shared/tool-catalog.ts` |
| 新增斜杠命令 | `commands/` 新建文件，在 `commands/index.ts` 注册；权限用 `minRole` |
| 新增中间件 | `gateway/middleware-setup.ts`，注意放在 @ 门控前还是后 |
| 新增提示词层 | `session/prompt-assembly.ts`，选一个不冲突的 order |
| 新增配置项 | `config.ts` 加类型 + Schema；面板在 `client/config-panel.ts` 加控件（可选） |
| 新增传输后端 | 实现 `GatewayTransport`，在 `gateway/bootstrap.ts` 创建并加入 `endpoints`；复用 `buildMiddlewares` 与 `handleInbound` |
| 新增消息字段 | `transport/inbound.ts` 的 Layer 组装；必要时补 `middleware/` |
| 新增持久化数据 | 放到对应领域目录，统一用 `~/.dsh-qqbot/` 下的独立 JSON |

## 11. 约定与已知痛点

约定：

- 源码导入必须带 `.ts` 后缀。
- 纯逻辑放 `features/` / `shared/`，带 I/O 的放领域目录，二者尽量分开（例如 `proactive.ts` vs `ambient.ts`）。
- 工厂命名：`createXxx` 有状态/依赖注入；`buildXxx` 纯组装；`getXxx` 单例或读取。
- 测试与源码同目录，命名 `*.test.ts`；涉及时间/随机的纯函数尽量支持注入 `now` / `random`。

已知痛点（有意保留，改动前先评估）：

- `config.ts` 仍然是一个大文件：Schema 是跨端（服务端校验 + 面板）共享的单一事实源，拆分成本高。
- `session-manager.ts` 仍有多个职责（模型路由、人格、记忆、工具绑定、会话生命周期）；提示词组装已经拆出，继续拆分需要先补测试。
- 不同 OneBot 实现的字段不完全一致（`rawEventType` / `mentions` / `quote` / `replyTarget.channel`），入站与门控都做了兼容判断；新增字段时优先在 `onebot/message.ts` 归一。
- 群聊历史缓冲是内存环形缓冲，重启即丢失；长期样本依赖 `persona-archive.json`。

## 12. 新人常见误区

- **把 `memory` 和 `personaAnalysis` 当成一套**：前者是关系与自述，后者是消息原文与统计；前者进提示词，后者只在调用 `qqbot_view_person` 时读取。
- **以为群聊里所有消息都会进模型**：取决于 OneBot 实现与账号权限；未 @ 消息可能根本不会投递给插件。
- **以为主动发言是「每条都回」**：它有多层门控，默认关闭，而且模型可以判断沉默。
- **在 `inbound.ts` 里找主动发言**：已经拆到 `transport/ambient.ts`。
- **在 `SessionManager` 里找提示词拼接**：已经拆到 `session/prompt-assembly.ts`。
- **改完源码直接重启安装版**：安装版读 `lib/`，需要先 `pnpm build`。
