<div align="center">

<img width="120" src="https://img.shields.io/badge/QQ_Bot-blue?style=for-the-badge" alt="QQ Bot" />

**基于 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) 的 QQ 机器人插件，通过 OneBot 11 接入普通 QQ 账号。**

[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![GitHub](https://img.shields.io/badge/github-xiong--universe%2Fqqbot-blue)](https://github.com/xiong-universe/qqbot)

**[English](./README_EN.md) | 简体中文**

</div>

## 目录

- [这是什么](#这是什么)
- [能力一览](#能力一览)
- [核心概念（新人必读）](#核心概念新人必读)
- [安装](#安装)
- [连接 QQ](#连接-qq)
- [消息处理链路](#消息处理链路)
- [配置](#配置)
- [内置命令](#内置命令)
- [内置工具](#内置工具)
- [数据文件](#数据文件)
- [本地开发](#本地开发)
- [排障](#排障)
- [深入阅读](#深入阅读)

## 这是什么

dsh-qqbot 是 deepseek-harness 的一个 Cordis 插件：它把 QQ 当成 dsh agent 的一个前端通道。每个 QQ 私聊用户或群聊都有独立的 dsh 会话，消息进来后交给 agent 跑一轮，模型输出再发回 QQ。

本项目使用 **OneBot 11** 连接普通 QQ 账号（NapCat / LLOneBot 等实现），不依赖任何机器人平台账号或审核流程。

- 本仓库：GitHub <https://github.com/xiong-universe/qqbot> ｜ Gitee <https://gitee.com/x17598923823/qq-bot>
- 版本：`0.12.0`（QQ 内发 `/bot-version` 查看实际运行版本）
- 运行要求：Node.js >= 22.19（语音回复依赖内置 WebSocket）

> 使用普通 QQ 账号接入第三方协议存在账号风险（风控、封号等），建议使用小号并遵守平台规则。本项目不提供账号，也不对账号风险负责。

## 能力一览

- **OneBot 11 接入**：连接 NapCat / LLOneBot 等实现，收发私聊与群聊消息。
- **会话隔离**：每个私聊用户 / 群聊各一个 dsh agent，闲置超时自动回收。
- **人格预设**：`/persona` 切换人格；人格可绑定工具白名单（运行时硬约束）。
- **长期记忆**：按会话记录互动次数、关系阶段与要点；另有按 personId 合并的跨会话人物画像。
- **群友资料查询**：本地保留群聊/私聊发言档案，模型在对话中按需调用 `qqbot_view_person` 查看某个人的统计与最近发言；owner/管理员可以点名查看其他人。
- **群聊主动发言**：对未 @ 的旁听消息，按概率、冷却、配额筛选后让模型判断「现在插话会不会打断别人」；模型也可以输出 `[SILENT]` 保持沉默。
- **戳一戳**：别人戳机器人时先自动回戳（10 秒冷却），但不主动说话——只等被戳的人下一条消息（最多 5 分钟），等到了就当「在跟机器人说」直接回应；连续戳多次只回一次，其他人先说话不算。
- **语音回复**：模型调用 `qqbot_voice` 后，本轮回复直接合成 QQ 语音；失败自动退回文字。
- **表情包进化**：自动收藏群图片、按语境挑选并发送，定期重算热度与淘汰。
- **反馈驱动进化**：`/feedback` 记录对回复的评价，`/evolve` 先让模型理解差评并归因（模型不可用时回落关键词规则），生成主动发言频率或表达偏好提案；主人确认后才生效，可查看历史与回滚，不改代码。
- **富媒体理解**：图片/视频下载、视觉理解（`qqbot_describe_image`）、文件发送（`qqbot_send_file`）。
- **设置面板**：连接方式、访问控制、身份、对话、语音、表情包、模型、人格、插件更新等页签。
- **插件更新**：识别 git / npm / 本地安装，对比远端后一键更新并 HMR 重载。

## 核心概念（新人必读）

### 1. OneBot 连接

插件通过 OneBot 11 与 QQ 通信。需要先准备一个 OneBot 实现，并开启：

- **HTTP API**：插件调用它发消息、查资料。
- **正向 WebSocket**：插件通过它接收消息事件。

在插件配置中必须显式设置：

```yaml
backend: onebot
```

然后填写连接信息：

```yaml
onebot:
  httpUrl: http://127.0.0.1:3000
  wsUrl: ws://127.0.0.1:3001
  accessToken: ''
  selfId: ''
```

- `selfId` 留空时，插件会在启动后自动向 OneBot 读取机器人 QQ 号。
- `accessToken` 与 OneBot 实现里配置的 token 保持一致；没配置就留空。
- Windows 桌面版可在设置面板一键下载/启动/停止 NapCat；其他平台请自行部署 OneBot 实现。
- 普通 QQ 账号能收到多少消息，取决于 OneBot 实现、账号权限与风控策略；群聊未 @ 消息能否入档/触发主动发言也取决于此。

### 2. 会话（session）

- `sessionKey` 格式：`qqbot:${namespace}:${scope}:${peerId}`
  - 私聊：`scope=c2c`，`peerId=用户 QQ 号`
  - 群聊：`scope=group`，`peerId=群号`
  - `namespace` 由 OneBot 账号决定（形如 `onebot-<selfId>`），换账号相当于换一套会话与记忆。
- 每个 key 对应一个 dsh agent。优先复用进程内 agent，其次从磁盘恢复，最后新建。
- 默认闲置 30 分钟回收（`sessionIdleTimeout`）。

### 3. 人格（persona）

人格只描述「是谁、什么语气」，通用规则写在 `globalPrompt`。生效优先级：

```
本会话 /persona 选择 > config.defaultPersona > 不启用人格（仅 globalPrompt）
```

人格还可以绑定工具白名单：`tools` 不写使用默认放行清单，`tools: []` 表示没有任何工具。工具权限是硬约束，不是提示词约束。

### 4. 记忆 vs 发言档案

这是两套独立数据，别混用：

| | 长期记忆 `memory` | 群友发言档案 `personaAnalysis` |
|---|---|---|
| 存什么 | 关系阶段、互动次数、自述要点、人物画像 | 消息原文与基础统计 |
| 粒度 | 按会话 + 按 personId | 按 senderId 跨群/跨私聊合并 |
| 用途 | 让对话记得「我们聊过什么」 | 供 `qqbot_view_person` 按需查看历史发言 |
| 存储 | `memory.onebot.json` | `persona-archive.json` |

发言档案不做后台人格分析，也不会自动写进提示词；只有模型调用 `qqbot_view_person` 时才读取。记忆按 OneBot 账号命名空间隔离；同一个人在不同群、私聊里的身份可以在同一份人物画像里合并。

### 5. 群聊主动发言

只作用于「机器人能收到、但没有 @ 机器人」的群消息。它不是每条都回，而是：

```
旁听消息 → 记记忆 → 进入候选批次（debounce 3s）
        → 概率 6% + 冷却 180s + 每小时 3 次 / 每天 15 次
        → 模型判断「两人对话 / 话题封闭 → 不插话」
        → 模型输出 [SILENT] 也可以保持沉默
```

例外：如果一条未 @ 的消息**看起来是在问机器人**（带「你/您」且是疑问句、引用了机器人的消息、或直接喊「在吗」），会先让模型给出 0-100% 的回复概率，再按这个百分比掷骰：命中就直接回复，不受 6% 概率、冷却和插话判断的限制；没命中就沉默（不再回落到 6% 二次掷骰）。这样群里点名问它不会被装死，也不会句句都接。

前提是你的 OneBot 实现会把未 @ 的群消息投递给插件；如果群里只能收到 @ 消息，主动发言不会触发。

## 安装

### 方式一：桌面版安装（推荐）

1. 左侧栏「插件」→「添加插件」→ 输入仓库地址 → 安装并立即启动
   - Gitee（国内更快）：`https://gitee.com/x17598923823/qq-bot`
   - GitHub：`https://github.com/xiong-universe/qqbot`
2. 左下角头像 → 设置 →「QQ 机器人」→ 连接方式选择「普通 QQ 账号」。
3. 填写 `httpUrl` / `wsUrl` / `accessToken` / `selfId`，保存后插件自动重载。
4. 需要托管 NapCat 时，在同一页面下载并启动。

<img src="./assets/docs/install.png" alt="端内添加插件" width="560" />

### 方式二：命令行安装

```bash
# 从本仓库安装（推荐，跟随本仓库更新）
npx @deepseek-ai/dsh plugin --profile qqbot add https://gitee.com/x17598923823/qq-bot.git

# 启动
npx @deepseek-ai/dsh --profile qqbot
```

命令行安装后，需要在 profile 的 `cordis.patch.yml` 中显式写入：

```yaml
backend: onebot
onebot:
  httpUrl: http://127.0.0.1:3000
  wsUrl: ws://127.0.0.1:3001
  accessToken: ''
  selfId: ''
```

### 方式三：本地源码 / `--patch` 开发

```bash
git clone https://github.com/xiong-universe/qqbot
cd qqbot
pnpm install && pnpm build

# 安装到 profile（本地路径）
npx @deepseek-ai/dsh plugin --profile qqbot add /path/to/qqbot

# 或直接用源码 patch 调试（OneBot 配置仍然写在 profile 的 cordis.patch.yml）
npx @deepseek-ai/dsh web --profile qqbot --patch /path/to/qqbot/cordis.dev.yml
```

`lib/` 已随仓库提交，直接安装仓库可以不构建；改了 `src/` 后需要 `pnpm build`。

## 连接 QQ

### 1. 准备 OneBot 实现

以 NapCat 为例：

1. 安装并登录 NapCat（桌面版可在插件设置面板一键托管）。
2. 打开 NapCat 的 WebUI / 配置文件，开启：
   - HTTP 服务（默认 `http://127.0.0.1:3000`）
   - 正向 WebSocket 服务（默认 `ws://127.0.0.1:3001`）
3. 如设置了 token，把同一个 token 填到插件的 `onebot.accessToken`。
4. 确认机器人 QQ 号；插件可自动读取，也可以手动填 `onebot.selfId`。

LLOneBot 等其他实现同理：只要兼容 OneBot 11 的 HTTP API 与正向 WebSocket 即可。

### 2. 在插件里填写连接信息

```yaml
backend: onebot
onebot:
  httpUrl: http://127.0.0.1:3000
  wsUrl: ws://127.0.0.1:3001
  accessToken: ''
  selfId: ''
```

保存后观察日志：应出现 OneBot 连接成功、机器人账号就绪的提示。在 QQ 里发 `/bot-ping` 可验证链路。

### 3. 群聊与私聊

- 私聊：直接给机器人 QQ 号发消息。
- 群聊：默认需要 @ 机器人（`requireMention: true`）。
- 想让机器人在群里旁听并主动接话：需要 OneBot 投递未 @ 的群消息，并在配置中开启 `proactive`（见下文）。
- 如果群里完全不响应，先检查 OneBot 日志里有没有收到事件，再看插件的访问控制与 @ 门控。

## 消息处理链路

### 入站

```
QQ 客户端
   │
   ▼
OneBot 实现（NapCat / LLOneBot）
   │  HTTP API + 正向 WebSocket
   ▼
插件传输层
   │
   ▼
SDK 中间件链（顺序见下）
   │
   ▼
handleInbound → 组装 agentBody → SessionManager.getOrCreate → agent.followup()
   │
   ▼
dsh agent loop → LLM
```

中间件顺序（`src/gateway/middleware-setup.ts`）：

1. `errorHandler` — 错误兜底
2. `messageFilter` — bot 回声 / 去重
3. `accessPolicy` — 私聊 / 群聊访问控制
4. `historyBuffer` — 群历史缓冲（@ 门控之前，未 @ 也计数）
5. `personaArchive` — 群友发言档案（`qqbot_view_person` 的数据源）
6. `quoteRef` — 引用解析与索引
7. `attachmentProcessor`（当前消息）— 媒体下载
8. `historyMedia` — 回填媒体路径到历史
9. `handleAmbientGroupMessage` — 未 @ 群消息的旁听 / 主动发言
10. `mentionGate` — 群聊 @ 门控
11. `contentSanitizer` — 去 @marker / 表情标签
12. `rateLimiter` — 三层限流
13. `slashCommand` — 斜杠命令
14. `questionAnswer` / `approvalAnswer` — 待答问题 / 待批审批截获
15. `concurrencyGuard` — 同 peer 串行 + 消息合并
16. `typingIndicator` — 输入状态
17. `attachmentProcessor`（引用消息）— 补引用里的媒体
18. `envelopeFormatter` — history + quote + sender 组装
19. `handleInbound` — 最终入站处理

> 主动发言必须放在 `mentionGate` 之前：SDK 命中未 @ 会直接 stop 整条链，后面的入站处理器就收不到旁听消息了。

### 出站

```
agent session/event
   │
   ▼
outbound.routeSessionEvent()
   │  文本 / 流式帧 / 工具展示 / 交付物
   ▼
chunker 切分 → OneBotSender.sendMarkdown
   │
   ▼
OneBot HTTP API
```

- 流式输出通过 `agent/assistant-stream`；群聊始终关闭流式。
- 模型输出 `[SILENT]` 时出站直接丢弃，不发送任何内容。
- 语音轮：`qqbot_voice` 置位后，轮末合成语音并发送，正文不再重复发文字。

### 系统提示词分层

插件通过 `system-prompt/assemble` 注入 section，按 order 合并：

| order | 内容 | 来源 |
|-------|------|------|
| 80 | 全局提示词 | `globalPrompt` |
| 82 | 身份说明 | `identity` |
| 84 | 机器人自称 / QQ 昵称 | `names.json` |
| 85 | 人格指令：每轮先调 `qqbot_current_persona` 获取当前人格 | 全局人格覆盖 > `defaultPersona` |
| 86 | 人格工具白名单说明 | `personas[].tools` |
| 86.5 | 看图说明 | `vision.enabled` |
| 86.8 | 群友资料查询说明 | `personaAnalysis.enabled` |
| 87 | 会话记忆 + 人物画像 | `memory` |
| 88 | 语音回复说明 | `voice` |
| 89 | 表情包说明 | `sticker` |
| 90 | 管理操作说明 | `qqbot_control` |

组装逻辑在 [src/session/prompt-assembly.ts](./src/session/prompt-assembly.ts)，不再和会话生命周期混在一起。

## 配置

配置文件通常是 profile 下的 `cordis.patch.yml`（桌面版由设置面板写入）。最小示例：

```yaml
- id: im-qqbot
  name: '@tencent-connect/dsh-qqbot'
  config:
    backend: onebot
    onebot:
      httpUrl: http://127.0.0.1:3000
      wsUrl: ws://127.0.0.1:3001
      accessToken: ''
      selfId: ''
    requireMention: true
    globalPrompt: |
      【多条消息规则】
      - 想把一句话拆成多条气泡时，用固定分隔符 ||| 分隔
      - 普通回答不要拆，一次最多 3 条
```

> `name` 沿用插件包名，安装时按本仓库地址添加即可；下文配置项直接写在 `config` 下。

### 核心配置

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `backend` | `onebot` | 必须显式设置 | 传输后端 |
| `provider` | string | 宿主默认 | LLM provider |
| `model` | string | 宿主默认 | 模型名 |
| `preset` | string | 宿主默认 | Agent preset id |
| `cwd` | string | `~/.dsh-qqbot/workspace` | Agent 工作目录 |
| `requireMention` | boolean | `true` | 群聊是否必须 @ 才回复 |
| `globalPrompt` | string | `''` | 所有会话生效的全局提示词 |
| `personas` | array | `[]` | 人格预设 |
| `defaultPersona` | string | `''` | 默认人格 id |
| `textChunkLimit` | number | `4500` | 单条消息最大字符数 |
| `streaming` | boolean | `true` | 是否启用流式（群聊始终关闭） |
| `replySplitMode` | `none` / `delimiter` / `line` / `paragraph` | `none` | 回复拆分方式 |
| `replySplitIntervalMs` | number | `0` | 拆分后消息间隔（ms） |
| `sessionIdleTimeout` | number | `1800000` | 会话闲置回收（ms） |
| `maxQueue` | number | `20` | 并发队列上限 |
| `processingTimeoutMs` | number | `1800000` | 单轮处理超时（ms） |
| `askTimeoutMs` | number | `300000` | 待答问题超时（ms） |
| `historyLimit` | number | `10` | 群历史缓冲条数 |
| `showToolResults` | boolean | `false` | 是否展示工具成功结果（错误始终展示） |
| `debug` | boolean | `false` | 调试日志 |

`replySplitMode` 建议用 `delimiter`：分隔符固定为 `|||`，出现分隔符时段内剩余换行也按分条处理；代码块与连续表格行不拆。

### OneBot

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `onebot.httpUrl` | string | `http://127.0.0.1:3000` | HTTP API 地址 |
| `onebot.wsUrl` | string | `ws://127.0.0.1:3001` | 正向 WebSocket 地址 |
| `onebot.accessToken` | string | `''` | 访问令牌 |
| `onebot.selfId` | string | `''` | 机器人 QQ 号，留空自动读取 |

### 人格与表达

```yaml
defaultPersona: assistant
personas:
  - id: assistant
    name: 严谨助手
    prompt: 你是严谨、简洁的助手，回答先给结论。
  - id: catgirl
    name: 猫娘
    prompt: 你是一只可爱的猫娘，句尾带「喵」。
    tools: []
    expressions:
      kaomoji:
        enabled: true
        style: cat
  - id: media
    name: 看图助手
    prompt: 你擅长看图和发文件。
    tools:
      - qqbot_describe_image
      - qqbot_send_file
```

- `id`：字母/数字/`-`/`_`，列表内唯一；`name` 是菜单展示名；`prompt` 是该人格的 system prompt。
- `tools` 不写 = 默认放行清单；`[]` = 无工具；写了的名字会和默认清单求交，默认清单之外的宿主工具（`read`、`write`、`pwsh`、`bash` 等）不会生效。
- `expressions.kaomoji`：必须显式 `enabled: true`；风格 `daily` / `genki` / `chuuni` / `cat` / `tsundere` / `soft` / `cool` / `maid`；可配 `custom` 与 `maxPerReply`（1–3）。
- `expressions.voice`：覆盖全局音色、语速（0.5–2）、音量（0–100）与情感指令。
- 切换人格后下一条消息立即生效，无需 `/new`；工具权限同步重新绑定。

### 身份与权限

```yaml
identity:
  enabled: true
  ownerOpenIds: []
  adminOpenIds: []
  friendOpenIds: []
```

- 数组里填 QQ 号（OneBot 的 sender id）；私聊与群聊里同一个人的 QQ 号一致，通常不需要重复添加。
- 三份名单都为空时视为未启用权限控制，所有人可用全部命令（避免把自己锁在外面）。
- 身份标签只影响称呼与语气，不放宽 `access` 访问控制。
- 在 QQ 里发 `/whoami` 查看当前场景的 QQ 号 / 群号与被判定的身份。

### 访问控制

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `access.c2cMode` | `open` | `open` / `allowlist` / `disabled` |
| `access.c2cAllow` | `[]` | 私聊白名单（QQ 号） |
| `access.groupMode` | `open` | `open` / `allowlist` / `disabled` |
| `access.groupAllow` | `[]` | 群聊白名单（群号） |

### 长期记忆

```yaml
memory:
  enabled: true
  autoCapture: true
  maxNotes: 40
  llmExtract: true
  extractThreshold: 8
  aliases: []
```

- 数据落在 `~/.dsh-qqbot/memory.onebot.json`，与会话历史相互独立；`/new` 或重启都不会清除。
- `autoCapture`：从「我叫… / 我喜欢…」这类明确自述里规则抽取，不额外调用模型。
- `llmExtract`：用 LLM 异步补足规则抽取，`extractThreshold` 是累计多少条新消息合并抽取一次。
- `aliases`：人工指定同一账号命名空间内的别名组，启动时归并到同一份人物记忆。
- 关系阶段由互动次数推导：初识（<5）→ 眼熟（<20）→ 熟悉（<60）→ 亲近（<200）→ 很亲近。
- `/memory` 仅管理员可用：查看、`add`、`del`、`clear`。

### 群友发言档案

```yaml
personaAnalysis:
  enabled: true
  maxMessages: 300
  retentionDays: 30
```

- 数据只在本机：`persona-archive.json`；不做后台分析，也不生成人格画像。
- 模型在对话中调用 `qqbot_view_person` 时，才返回某个人的消息数、会话分布与最近发言；owner/管理员可指定昵称或 QQ 号查看其他人。
- 记录发生在访问控制之后、@ 门控之前；未 @ 的群消息也会入档，但不会逐条触发回复。
- 只有 OneBot 把消息投递给插件，档案才有内容；如果实现只转发 @ 消息，未 @ 的聊天不会入档。

### 群聊主动发言

```yaml
proactive:
  enabled: false
  channels: [onebot]
  probability: 0.06
  modelJudge: true
  minIntervalSec: 180
  maxPerHour: 3
  maxPerDay: 15
  debounceMs: 3000
  minChars: 2
  ignorePrefixes: ['/', '#']
```

- 默认关闭，避免升级后突然在群里插话。
- `modelJudge: true` 时，概率通过后还会让模型判断是否适合插话；两人对话通常保持沉默。
- 模型也可以在本轮输出 `[SILENT]`，出站会直接丢弃这条回复。
- 需要 OneBot 投递未 @ 的群消息；否则只能在被 @ 时触发正常回复。

### 语音回复

```yaml
voice:
  enabled: true
  apiKey: ''
  model: qwen-audio-3.1-tts-flash
  voice: longanfengyue_v3.1
  instruction: ''
  presets: []
  maxChars: 300
  timeoutMs: 30000
```

- `voice.enabled` 关闭**或** `apiKey` 为空时，语音功能完全关闭：不注册 `qqbot_voice`、不合成、不发语音。
- 模型决定何时发语音；本轮正文只用于合成，不再重复发文字；合成失败自动退回文字。
- 人格可用 `expressions.voice` 覆盖音色、语速、音量与情感指令。
- 语气指令是叠加而非替换：本轮走向 + 人格/全局语气 + 口语提示，总长 ≤400 字。
- 运行时需要 Node 22+（内置 WebSocket）；Node 20 即使填了 Key 也会关闭语音。
- 百炼 API Key 需要给对应 TTS 模型勾选权限点，否则会返回 `AccessDenied`。

<details>
<summary>3.1 / 3.0 内置音色与代际说明</summary>

- `qwen-audio-3.1-tts-flash`：支持 26 个 3.1 系统音色。
- `qwen-audio-3.1-tts-plus`：仅支持 4 个旗舰音色 `longanfengyue_v3.1` / `longanlingxin_v3.1` / `longanhuan_v3.1` / `xunanchuan_v3.1`，以及 3.1 的复刻/设计音色。
- `qwen-audio-3.0-tts-flash` / `qwen-audio-3.0-tts-plus`：兼容旧配置；3.0 系统音色 id 不能用在 3.1 模型上，反之亦然。
- 3.1 系统音色一律带 `_v3.1` 后缀；切换模型代际时同名内置音色会自动映射，复刻/设计音色不会自动改 id。
- 自定义音色（声音复刻 / 声音设计）通过 `voice.presets` 或设置面板「自定义音色」添加，名称 + 音色 id，最多 20 条。

</details>

### 语音以外的表达

- **颜文字**：人格 `expressions.kaomoji`，运行时并入人格 prompt，不需要工具调用。
- **表情包**：`sticker.enabled: true` 开启收藏 / 选择 / 进化；元数据在 `~/.dsh-qqbot/stickers.json`，图片默认复用 `media/`。
- **视觉理解**：`vision.enabled` + `vision.provider` + `vision.model`，注册 `qqbot_describe_image`。
- **附件发送**：`sendFile.restrictPaths` 默认开启路径白名单（`media` + agent cwd + `extraRoots`）；`sendPresentedFiles` 控制是否在轮末投递 `present` 声明的交付文件。

## 内置命令

| 命令 | 说明 | 权限 |
|------|------|------|
| `/new`（`/reset` `/clear`） | 开始新会话，清空上下文 | 管理员 |
| `/compact` | 压缩会话历史，保留上下文 | 管理员 |
| `/model` | 查看或切换模型 | 管理员 |
| `/preset` | 查看或切换 agent preset | 管理员 |
| `/persona`（`/人格`） | 查看 / 切换人格；`default` 跟随默认，`off` 关闭本会话人格 | 管理员 |
| `/tools`（`/工具`） | 诊断当前人格的工具绑定与宿主工具清单 | 管理员 |
| `/memory`（`/记忆`） | 查看 / 管理本会话长期记忆 | 管理员 |
| `/feedback`（`/反馈`） | 评价这次回复：`/feedback good\|bad [备注]` | 管理员 |
| `/evolve`（`/进化`） | 根据反馈生成 / 应用策略：`apply [序号]`、`discard`、`status`、`history`、`rollback` | 管理员 |

> 主人/管理员也可以直接在对话里说：「刚才太吵了」「这次回得不错」→ 自动记录反馈；「你自己调整一下」→ 生成提案；「应用吧」→ 确认应用，不需要手打斜杠命令。
| `/whoami`（`/我是谁`） | 查看当前场景 QQ 号 / 群号与身份 | 所有人 |
| `/stop` | 中止当前生成 | 管理员 |
| `/bot-ping` | 网络延迟检测 | 所有人 |
| `/bot-version` | 查看版本（非管理员不显示模型） | 所有人 |
| `/bot-status` | 查看当前会话状态 | 管理员 |
| `/bot-help` | 按身份列出可用指令 | 所有人 |

## 内置工具

默认放行清单：

- 插件工具：`qqbot_solve`、`qqbot_describe_image`、`qqbot_send_file`、`qqbot_translate`、`qqbot_summarize`、`qqbot_explain`、`qqbot_rewrite`、`qqbot_view_person`、`qqbot_pick_sticker`、`qqbot_save_sticker`、`qqbot_send_sticker`、`qqbot_list_stickers`、`qqbot_update_sticker`
- 运行时人格：`qqbot_current_persona`（每轮回复前获取当前人格的名字、完整设定与颜文字规则；人格可被全局切换，始终放行）
- 管理工具：`qqbot_control`（主人/管理员用自然语言改人格/记忆/会话）
- 宿主只读能力：`ask_user_question`、`web_search`、`web_fetch`

宿主文件读写、命令执行、子 agent、定时任务等**不在**放行清单里，QQ 会话里不可见也调不到。语音与表情工具属于消息投递能力，始终放行，不受人格白名单限制。

## 数据文件

默认都在 `~/.dsh-qqbot/`：

| 文件 / 目录 | 内容 |
|-------------|------|
| `memory.onebot.json` | 会话记忆与人物画像（按 QQ 号） |
| `identities.json` | 同一人跨 senderId 的身份别名 |
| `names.json` | 机器人自称 / QQ 账号昵称 |
| `model-prefs.json` | per-peer 模型 / preset / 人格 / sessionId |
| `persona-archive.json` | 群聊/私聊消息档案（`qqbot_view_person` 的数据源） |
| `stickers.json` | 表情包元数据 |
| `workspace/` | Agent 默认工作目录 |
| `media/` | 临时媒体（按 TTL 清理） |
| `napcat/` | 面板托管的 NapCat 安装目录 |

OneBot 的 `accessToken` 等连接信息写入 profile 的 `cordis.patch.yml`。

## 本地开发

```bash
pnpm install       # 安装依赖
pnpm build         # tsc + 客户端 bundle
pnpm dev           # tsc --watch
pnpm test          # vitest run
pnpm lint          # eslint src/
```

源码调试时，OneBot 配置仍然写在 profile 的 `cordis.patch.yml`，用 `--patch` 把插件指向源码：

```bash
npx @deepseek-ai/dsh web --profile qqbot --patch /path/to/dsh-qqbot/cordis.dev.yml
```

约定：

- 源码使用 `.ts` 后缀导入；测试与源码同目录（`*.test.ts`）。
- `lib/` 是构建产物且已入库；改源码后需要重新构建，安装仓库的用户才能拿到新代码。
- 当前测试基线：754 个用例，750 通过；4 个既有环境失败（3 个 Windows symlink `EPERM`、1 个 NapCat 非 Windows 平台判断），与业务代码无关。

## 排障

| 现象 | 先检查 |
|------|--------|
| 私聊 / 群里完全没反应 | OneBot 是否启动、HTTP/WS 端口与 token 是否一致、`onebot.selfId` 是否正确、插件日志是否连上 |
| 群里 @ 了机器人但不回复 | `requireMention`、访问控制、机器人是否真的被 @、日志里是否出现 `mentionGate` 拦截 |
| 群友资料查不到 / 很少 | OneBot 是否投递未 @ 的群消息；检查 NapCat / LLOneBot 的群消息上报设置与 `personaAnalysis.enabled` |
| 主动发言一直不触发 | 是否收到未 @ 群消息；`proactive.enabled`；概率、冷却、每小时/每天配额；模型判断可能选择沉默 |
| `/whoami` 和配置里的 QQ 号对不上 | 使用 `/whoami` 输出的当前场景 ID；多数实现里私聊与群聊的 sender id 都是 QQ 号 |
| 记忆「串号」或丢了一部分 | 是否换了 `selfId`；不同 OneBot 账号命名空间使用不同存储 |
| 调了 `qqbot_voice` 却收到文字 | 百炼 Key 是否勾选对应 TTS 模型权限点；Node 是否 22+；日志里的合成失败原因 |
| 设置面板保存后没生效 | 保存写入的是 profile 的 `cordis.patch.yml`，确认当前 profile 与运行中的插件一致 |
| 插件更新检查说「不支持自更新」 | `file:` / `link:` 本地路径安装、`--patch` 源码直载、固定 commit 依赖都不跟随远端 |
| 行为重复 / 装了两份 | 同一 profile 只能保留一份插件，卸载旧实例后重启 |

## 深入阅读

- [ARCHITECTURE.md](./ARCHITECTURE.md) — 代码分层、目录导览、模块职责、扩展点与新人阅读顺序
- [CHANGELOG.md](./CHANGELOG.md) — 版本变更

## 反馈

- 问题反馈：<https://github.com/xiong-universe/qqbot/issues>（请附上 `/bot-version` 输出的版本号与相关日志）

## License

[MIT](./LICENSE)
