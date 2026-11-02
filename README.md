<div align="center">

<img width="120" src="https://img.shields.io/badge/🤖-QQ_Bot-blue?style=for-the-badge" alt="QQ Bot" />

**基于 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) 的 QQ Bot 插件，将 DeepSeek AI 助手接入 QQ 私聊与群聊。**

[![npm version](https://img.shields.io/npm/v/@tencent-connect/dsh-qqbot)](https://www.npmjs.com/package/@tencent-connect/dsh-qqbot)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/tencent-connect/dsh-qqbot)](https://github.com/tencent-connect/dsh-qqbot)
[![QQ Bot](https://img.shields.io/badge/QQ_Bot-API_v2-red)](https://bot.q.qq.com/wiki/)

<br/>

**[English](./README_EN.md) | 简体中文**

扫码加入 QQ 群 / 频道

<table>
<tr>
<td align="center" width="50%"><img src="./assets/docs/qqgroup.jpg" height="360" alt="QQ 群二维码" /><br /><b>QQ 开发者交流群</b><br /><sub>1群: 1032635674 · 2群: 1056948758</sub></td>
<td align="center" width="50%"><img src="./assets/docs/qqchannel.jpg" height="360" alt="QQ 频道二维码" /><br /><b>QQ 开发者社区频道</b><br /><sub>频道号: 20dnumts4z</sub></td>
</tr>
</table>

</div>

## 架构

```
QQ 用户 → QQ WebSocket → dsh-qqbot → ctx.agents → dsh agent loop → LLM
                                 ↑                           │
                                 └── session/event ──────────┘
                                       (assistant reply → QQ sendMarkdown)
```

## 安装

### 方式一：桌面版安装（推荐）

无需命令行，全程在应用内完成：

1. **安装**：左侧栏点击「插件」→「添加插件」→ 输入 `@tencent-connect/dsh-qqbot@latest` → 安装并立即启动

<img src="./assets/docs/install.png" alt="端内添加插件" width="560" />

2. **连接**：左下角头像 → 设置 →「QQ 机器人」→ 手机 QQ 扫码连接

<img src="./assets/docs/setting.png" alt="设置页扫码连接" width="560" />

扫码成功后凭据自动保存，后续启动无需再次扫码。

### 方式二：手动执行

```bash
# 安装到 profile
npx @deepseek-ai/dsh plugin --profile qqbot add @tencent-connect/dsh-qqbot

# 启动
npx @deepseek-ai/dsh --profile qqbot
```

首次启动时，插件检测到凭据未配置会自动进入扫码引导：终端输出二维码 → 手机 QQ 扫码绑定 → 凭据自动保存到 profile，后续启动无需再次扫码。

无端内绑定页的环境（如纯 CLI）可设置 `QQBOT_BIND_OPEN_BROWSER=1`，额外拉起系统浏览器扫码页作为降级通道。

<img src="./assets/docs/qrcode.png" alt="二维码扫码示意图" width="280" />

> **提示**：建议升级至 `0.4.0` 以上版本扫码，支持点击链接在浏览器打开，避免部分终端二维码渲染错位的问题。

### 方式三：本地路径安装

```bash
# 构建
cd /path/to/dsh-qqbot
pnpm install && pnpm build

# 安装到 profile（本地路径）
npx @deepseek-ai/dsh plugin --profile qqbot add /path/to/dsh-qqbot

# 启动
export QQBOT_APPID="你的AppID" QQBOT_SECRET="你的AppSecret"
npx @deepseek-ai/dsh --profile qqbot
```

### 方式四：--patch 开发模式

```bash
export QQBOT_APPID="你的AppID" QQBOT_SECRET="你的AppSecret"
npx @deepseek-ai/dsh web --patch /path/to/dsh-qqbot/cordis.dev.yml
```

### 方式五：从本仓库（fork）安装

本仓库是 `@tencent-connect/dsh-qqbot` 的二次开发分支，构建产物 `lib/` 已入库，直接从 GitHub 安装即可，无需本地构建：

- **桌面版**：左侧栏「插件」→「添加插件」→ 填入仓库地址 `https://github.com/xiong-universe/qqbot`
- **命令行（tarball）**：
  ```bash
  npm pack   # 产出 tencent-connect-dsh-qqbot-0.7.0.tgz
  npx @deepseek-ai/dsh plugin --profile qqbot add ./tencent-connect-dsh-qqbot-0.7.0.tgz
  ```

> 安装 fork 版前请先卸载官方 `@tencent-connect/dsh-qqbot`，避免同一 profile 内出现两份实例。

## 检测与更新

安装后升级不需要卸载重装：设置面板新增了「插件更新」页签（左下角头像 → 设置 →「QQ 机器人」→「插件更新」）。

- **检查更新**：插件读取 profile 里的依赖写法与 `pnpm-lock.yaml` 中的已装引用，再对比远端——git 安装对比远端最新 commit（`git ls-remote`），npm 安装对比 registry 的 `latest` 版本。
- **一键更新**：桌面版通过宿主 `desktopPnpm` 执行 `dsh plugin --profile <name> update @tencent-connect/dsh-qqbot`（内部即 `pnpm update`，会重新解析 git 远端 commit 并改写 lockfile），完成后自动触发 HMR 重载，新版本立即生效。
- **手动更新**（CLI 或宿主未提供 pnpm 服务时）：
  ```bash
  npx @deepseek-ai/dsh plugin --profile qqbot update @tencent-connect/dsh-qqbot
  ```
- **不支持自更新的安装方式**：`file:` / `link:` 本地路径安装、`--patch` 源码直载会提示「更新源码后重启」；依赖写法固定到具体 commit（`#<sha>`）时不会跟随远端更新，需要先把 ref 改回分支名。
- 更新依赖 `pnpm update` 成功返回；若新版本与当前 DSH 运行时版本不兼容，宿主会回滚 `package.json` / `pnpm-lock.yaml` 并在页签里显示原因（可按提示执行 `dsh plugin --profile <name> allow-version ...` 后重试）。

## 配置项

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `appId` | string | **必填** | QQ Bot AppID（或通过 `QQBOT_APPID` 环境变量） |
| `appSecret` | string | **必填** | QQ Bot AppSecret（或通过 `QQBOT_SECRET` 环境变量） |
| `provider` | string | `deepseek-official` | LLM 提供商名称 |
| `model` | string | `deepseek-chat` | 模型名称 |
| `preset` | string | - | Agent preset id |
| `cwd` | string | `process.cwd()` | Agent 工作目录 |
| `requireMention` | boolean | `true` | 群聊是否需要 @bot 才触发 |
| `globalPrompt` | string | `''` | 全局 system prompt：对所有群聊/私聊生效（多条消息拆分规则建议写在这里） |
| `personas` | array | `[]` | 人格预设列表（QQ 端 `/persona` 切换，可配置 `tools` 工具白名单），见下文 |
| `defaultPersona` | string | `''` | 默认人格 id，留空表示不启用人格 |
| `voice` | object | 见下文 | 出站语音（TTS）：**`enabled` 关闭或 `apiKey` 留空即关闭语音功能**，见下文 |
| `personaAnalysis` | object | 见下文 | 群友人格档案：按会话记录消息，达阈值自动分析并可手动调用 `qqbot_analyze_persona`，只存本机，见下文 |
| `textChunkLimit` | number | `4500` | 单条消息最大字符数 |
| `streaming` | boolean | `true` | 是否启用流式输出（群聊始终不启用） |
| `replySplitMode` | `none`/`delimiter`/`line`/`paragraph` | `none` | 回复拆分方式：`delimiter` 按固定分隔符 `|||` 拆（推荐；只要出现分隔符，段内剩余换行也按分条处理），`none` 只按长度切分，`line` 每个换行发一条，`paragraph` 按空行分段。开启后自动关闭流式输出 |
| `replySplitIntervalMs` | number | `0` | 拆分后相邻消息的间隔(ms)，`0` 表示立即顺序发送；遇到平台限流可调大 |
| `sessionIdleTimeout` | number | `1800000` | 会话闲置超时(ms)，默认 30 分钟 |
| `processingTimeoutMs` | number | `1800000` | 处理超时(ms)，超时中断当前 LLM 调用 |
| `maxQueue` | number | `20` | 并发队列最大长度 |
| `historyLimit` | number | `10` | 群历史缓冲条数 |
| `askTimeoutMs` | number | `300000` | 待答问题超时(ms)，默认 5 分钟（ask_user_question） |
| `showToolResults` | boolean | `false` | 是否展示工具调用成功结果（错误始终展示） |
| `debug` | boolean | `false` | 调试模式 |

> 拆分说明：推荐 `replySplitMode: delimiter`，分隔符固定为 `|||`（不可配置）。没有分隔符时正文换行不会触发多条消息；一旦出现分隔符，段内剩余的换行也会按分条处理（模型偶尔把 `|||` 敲成换行，留着会在气泡里夹断行）。代码块与连续表格行不拆，整体一条。同一 `msg_id` 最多支持 4 次被动回复，超出部分自动降级为主动推送。

### 全局提示词（globalPrompt）

`globalPrompt` 对所有群聊/私聊生效，适合放通用约束（如多条消息拆条规则、语气底线）：

```yaml
- id: im-qqbot
  config:
    replySplitMode: delimiter
    globalPrompt: |
      【多条消息规则】
      - 想把一句话拆成多条气泡时，用固定分隔符 ||| 分隔，例如：真的假的|||你别骗我
      - 只有情绪转折、补充吐槽或停顿时才拆；普通回答不要拆，一次最多 3 条
      - 绝对不要用换行符来分条；一条消息内部可以正常换行
```

### 人格预设（personas）

把原来的单一 prompt 拆成多套人格，可在 QQ 聊天里随时切换：

```yaml
- id: im-qqbot
  config:
    defaultPersona: assistant
    personas:
      - id: assistant
        name: 严谨助手
        prompt: 你是严谨、简洁的助手，回答先给结论。
      - id: catgirl
        name: 猫娘
        prompt: 你是一只可爱的猫娘，句尾带「喵」。
        tools: []          # 纯聊天人格：不绑定任何工具
        expressions:
          kaomoji:
            enabled: true  # 必须显式开启
            style: cat     # 颜文字风格：daily/genki/chuuni/cat/tsundere/soft/cool/maid
      - id: media
        name: 看图助手
        prompt: 你擅长看图和发文件。
        tools:
          - qqbot_describe_image
          - qqbot_send_file
```

- `id`：字母/数字/`-`/`_`，1–64 位，列表内唯一；`name` 是 QQ 菜单展示名；`prompt` 是该人格的 system prompt；`tools` 是该人格可用的工具白名单。
- `expressions.kaomoji`：**颜文字**（可选，必须显式 `enabled: true` 才启用）。按气质选一套风格（`daily` 日常 / `genki` 元气 / `chuuni` 中二 / `cat` 猫系 / `tsundere` 傲娇 / `soft` 温柔 / `cool` 清冷 / `maid` 女仆，缺省 `daily`）；运行时把该风格的颜文字清单与使用规则（可加语气、一条回复最多 1 个）并入人格 prompt，**不需要工具调用**。
  - `enabled`：是否启用（缺省 `false`）。之所以要求显式开启，是因为配置 Schema 会为每个人格物化默认子对象，只看「有没有 `kaomoji`」会让所有人格都被误开。
  - `maxPerReply`：一条回复最多用几个颜文字（1–3，缺省 1）。
  - `custom`：自定义补充颜文字（最多 20 条，每条 ≤32 字），排在预设清单之后供模型挑选。
  - 颜文字库在 `src/expressions/kaomoji.ts`，按情绪分组；后续表情包（图片）会在同一 `expressions` 容器下新增 `sticker`，人格配置形态不变。
- `expressions.voice`：**该人格的语音音色**（可选）。`voice` 覆盖全局音色，`rate`（0.5–2）与 `volume`（0–100）可选，`instruction` 覆盖全局情感/语气指令（留空继承全局）；语音功能本身由全局 `voice.enabled` 与 `voice.apiKey` 控制，留空时这里配置也不生效。示例：`expressions: { voice: { voice: longanfengyue_v3.1, rate: 1.1, instruction: 请用清冷克制的语气 } }`。
- **工具权限是硬约束，不是提示词**：QQ 会话在运行时通过 `tools.restrict({ allow })` 限制模型可见的工具，白名单之外的工具模型根本看不到、调不到（宿主 preset 里的文件读写、命令执行、子 agent、定时任务等一律被挡掉）。
  - 不写 `tools`（缺省）：使用**默认放行清单**——8 个插件内置工具（`qqbot_solve`、`qqbot_describe_image`、`qqbot_send_file`、`qqbot_translate`、`qqbot_summarize`、`qqbot_explain`、`qqbot_rewrite`、`qqbot_analyze_persona`）+ `ask_user_question` + 只读的 `web_search` / `web_fetch`。
  - `tools: []`：该人格没有任何工具能力（不能做题、看图、发文件、翻译/总结，也不能联网）。
  - 人格写的 `tools` 与默认清单**求交**：默认清单之外的名字（如 `read`、`write`、`pwsh`、`bash`）不会生效，日志会告警「配置了默认不开放的工具（已禁用）」；未注册的名字会被忽略。
  - 例外：语音启用时 `qqbot_voice` 始终放行（语音是投递方式而不是一项能力），即使人格写了 `tools: []` 也能用语音回复。
  - 切换人格后工具权限**立即重新绑定**，无需 `/new`；`/tools` 可查看当前人格的绑定（仅管理员，诊断用，不在命令菜单中展示）。
  - 日常绑定建议在设置面板里做：展开人格卡片 → 开启「限制可用工具」→ 从下拉里逐个选择（候选只有插件内置工具，已选的显示为可删除的标签）。
- **人格按会话隔离**：群聊按群 ID、私聊按用户 ID 分别记录，同一个群里切人格不会影响其他群或其他私聊。
- 生效优先级：本会话 `/persona <id>` 选择 > `defaultPersona`；都没有则不启用人格（仅保留 `globalPrompt`）。
- 注入顺序：`globalPrompt`（order 80）→ 身份说明（order 82，配置了 `identity` 时）→ 人格 prompt（order 85）→ 工具权限说明（order 86，配置了 `tools` 时）→ 记忆与关系（order 87，开启 `memory` 时）→ 语音回复说明（order 88，开启语音时）；人格只描述「是谁」，拆条等通用规则统一写在 `globalPrompt`。
- 人格在每次构建 system prompt 时注入，切换后**下一条消息**即生效，无需 `/new`。
- 多条消息统一用固定分隔符 `|||`，并配合 `replySplitMode: delimiter`；人格 prompt 里无需重复约定。
- 也可以在 dsh 设置面板的「人格预设」页签里增删改（卡片默认收起，点击展开编辑），保存后自动重载。

### 语音回复（voice）

把回复「说给用户听」：基于 DashScope 实时语音合成（WebSocket）。**是否需要发语音由上层模型判断**——模型需要时会调用 `qqbot_voice` 工具，本轮回复正文直接合成为 QQ 语音，**不再重复发一条相同的文字**；合成失败或内容不适合朗读时自动退回文字。语音总开关 `voice.enabled` 关闭**或** `voice.apiKey` 为空时，语音功能完全关闭——不注册工具、不合成、不发语音，也不消耗任何额度。想暂停语音时直接关开关即可，Key 会保留。

```yaml
- id: im-qqbot
  config:
    voice:
      enabled: true                     # 语音总开关；关闭后即使有 Key 也不启用
      apiKey: ''                        # 留空 = 无法启用语音；填入百炼 API Key 后生效
      model: qwen-audio-3.1-tts-flash   # 语音合成模型（面板里是下拉；3.0 旧模型仍可用）
      voice: longanfengyue_v3.1         # 默认音色（需与模型同一代际）
      instruction: 场景：夜里她叫住学长，楼道很静；第1句：声音很轻、带一点迟疑，语速偏慢；第2句：吞吐、句尾落地   # 情感/语气指令（自然语言，可选）
      presets:                          # 自定义音色（下拉里排在内置系统音色之前）
        - name: 元气少女
          voice: qwen-audio-3.1-tts-plus-vd-bailian-<哈希>
      maxChars: 300                     # 单次朗读字数上限（20–1000）
      timeoutMs: 30000                  # 合成超时(ms)（5000–120000）
      # baseUrl: wss://xxx/api-ws/v1/inference   # 自定义 MaaS 网关（可选）
      # workspace: xxx                          # 百炼业务空间 id（可选）
```

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `voice.enabled` | boolean | `true` | 语音总开关；关闭后即使已保存 API Key 也不注册工具、不合成、不发语音（默认开启，兼容旧配置） |
| `voice.apiKey` | string | `''` | DashScope API Key；**留空 = 无法启用语音**（面板保存时留空表示保持已保存的 Key；要停用语音请用 `enabled` 开关，不需要清除 Key） |
| `voice.model` | string | `qwen-audio-3.1-tts-flash` | 语音合成模型 id，需在百炼控制台开通对应模型**并给 API Key 勾选该模型的权限点**；面板为下拉（3.1 / 3.0 的 flash、plus），其他模型手动填 id |
| `voice.voice` | string | `longanfengyue_v3.1` | 默认音色 id；音色 id 与模型代际绑定，人格可用 `expressions.voice.voice` 覆盖 |
| `voice.instruction` | string | `''` | 情感/语气指令（自然语言，≤400 字）：可写成「场景 + 逐句走向」，见下文；人格可用 `expressions.voice.instruction` 覆盖。**人格/全局语气与本轮 `qqbot_voice` 的 instruction 叠加下发**，不会被单轮指令顶掉 |
| `voice.presets` | array | `[]` | 自定义音色清单（`{ name, voice }`，≤20 条）；面板下拉里**排在内置系统音色之前**，后加的排在更上方 |
| `voice.baseUrl` | string | `''` | 自定义 WebSocket 地址（`ws://` / `wss://`）；留空按 workspace 或官方网关连接 |
| `voice.workspace` | string | `''` | 百炼业务空间 id（拼 MaaS 地址并在请求头带 `X-DashScope-WorkSpace`） |
| `voice.maxChars` | number | `300` | 单次朗读的最大字数，超出截断 |
| `voice.timeoutMs` | number | `30000` | 合成超时，超时放弃语音、改为发送文字回复 |

- **模型决定、语音替换文字**：语音启用时会给模型注入一段「语音回复」说明（order 88），模型判断需要语音（「说句话」「发条语音」「想听你说话」「唱首歌」、晚安安慰撒娇这类短句）就调用 `qqbot_voice`，随后写的回复正文只用于合成，不再作为文字消息发送——不会出现「先发文字又发一遍语音」。
- **失败自动退回文字**：鉴权失败、模型未开通、网络超时或清洗后没有可朗读内容时，本轮改发原来的文字，消息不会丢；临时音频写入 `~/.dsh-qqbot/media` 并在发送后删除。
- **API Key 要勾选模型权限点**：百炼的 Key 只带「已选权限点」里列出的模型。给 Key 勾选 3.1-TTS 之前，`qwen-audio-3.1-tts-*` 会返回 `AccessDenied`，QQ 端表现就是「明明调了 `qqbot_voice` 却收到文字」。日志里会写明原因（`语音合成失败…AccessDenied（请到阿里云百炼控制台，给这个 API Key 勾选该语音模型的权限点）`），去百炼「API Key → 已选权限点」勾上对应模型即可。
- **音色与模型不匹配时自动兜底**：人格或全局写了当前模型不支持的内置系统音色（如 3.1-plus 配 `longwan_v3.1`），合成前会换成该模型的缺省音色并打一条 warn，而不是让整轮退回文字；克隆/设计音色不做替换。
- **按人格音色**：`personas[].expressions.voice` 可覆盖全局音色、语速/音量与情感指令，切换人格后下一条语音即生效；模型还可在单轮调用里写「场景 + 逐句走向」（如「场景：夜里她叫住学长，楼道很静；第1句：声音很轻、带一点迟疑…」），与本轮的人格语气叠加、仅本轮生效。语音提示词要求模型**每次调用都写场景与逐句走向**，避免所有语音都是同一种默认腔调。
- **语气指令是叠加而不是替换**：最终下发给 TTS 的是「本轮走向 + 人格/全局语气 + 像发微信语音随口说」三段拼接（≤400 字，超长优先保留本轮走向）。所以人格里写好的音色习惯（中低音、句尾落下、关键词拖长…）不会因为模型只写一句「语气自然」而丢掉——早先的实现是整段替换，听感会明显变平。
- **听着太平时怎么调**：① 人格/全局 `instruction` 别堆形容词（「成熟、慵懒、温柔」几乎没有指向），改写成可执行的走向：音量高低、语速快慢、逗号处停半拍、关键词拖长加重、句尾落不落、开头要不要带轻笑或叹气；② 单轮调用时让模型按上面的模板写逐句走向；③ 克隆音色本身就平的话，先换系统音色（如 `longanlingxin_v3.1`）对比；④ 需要更慢的语感可加 `expressions.voice.rate`（如 `0.9`）。
- **自动清洗**：代码块、URL、Markdown 符号、`|||` 分隔符与颜文字不会念出来；`|||` 与换行都按句号断句，句末自动补标点，朗读才有正常换气和收尾。
- **运行时要求**：使用 Node 22+ 内置 WebSocket；Node 20 环境即使填了 Key 也会在启动日志里告警并关闭语音。
- 设置面板「语音回复」页签可编辑以上字段；顶部「启用语音回复」开关可随时暂停/恢复语音（Key 保留），已保存的 API Key **永不回显**，只显示「已保存」状态。

#### 内置音色预设（按模型代际标注）

设置面板的**「语音模型」和「默认音色」都是下拉框**，且两者联动：

- **语音模型**只列插件内置验证过的 Qwen 模型：`qwen-audio-3.1-tts-flash`（缺省推荐，全部 26 个系统音色）、`qwen-audio-3.1-tts-plus`（高音质，仅 4 个旗舰音色）、`qwen-audio-3.0-tts-flash` / `qwen-audio-3.0-tts-plus`（兼容旧配置）。其他模型（如 `cosyvoice-v2`）走下拉里的「其他模型 id（手动输入）」，音色需自行加到「自定义音色」。
- **切模型会同步修正音色**：内置同名音色跨代改写（`longanfengyue` ↔ `longanfengyue_v3.1`），目标模型不支持的内置音色回落到该模型的缺省音色，人格里的覆盖音色也一起改；克隆/设计音色不会自动改（会提示需要重新克隆）。
- **选音色会同步模型**：在「默认音色」里选到标注「需 xxx 模型」的音色时，面板会自动把「语音模型」切到该模型，避免选完必然合成失败。

音色 id 与模型**代际**绑定：3.1 的**系统音色**一律带 `_v3.1` 后缀，3.0 的系统音色 id 不能用在 3.1 上（会报 `InvalidParameter` / `Engine error [411]`），反之亦然。


**3.1 系统音色（默认模型 `qwen-audio-3.1-tts-flash`）**

| 名称 | 音色 id | 特质 |
|------|---------|------|
| 龙安风悦 | `longanfengyue_v3.1` | 自然亲切音（女，plus 旗舰音色） |
| 龙安灵心 | `longanlingxin_v3.1` | 温柔女声（plus 旗舰音色，3.1-plus 缺省音色） |
| 龙安欢 | `longanhuan_v3.1` | 活泼女声（plus 旗舰音色） |
| 许南川 | `xunanchuan_v3.1` | 男声（plus 旗舰音色） |
| 龙安元妃 | `longanyuanfei_v3.1` | 高傲妃子音（女） |
| 龙安灵希 | `longanlingxi_v3.1` | 可爱甜美音（女） |
| 龙杰力豆 | `longjielidou_v3.1` | 天真男童音（男） |
| 龙火火 | `longhuohuo_v3.1` | 顽皮少年音（男） |
| 龙泡泡 | `longpaopao_v3.1` | 飞天泡泡音（女） |
| 龙华 | `longhua_v3.1` | 元气甜美女 |
| 龙婉 | `longwan_v3.1` | 细腻柔声女 |
| 龙星 | `longxing_v3.1` | 温婉邻家女 |
| 龙悦 | `longyue_v3.1` | 温暖、磁性（女） |
| 龙颜 | `longyan_v3.1` | 温暖、自然、亲切（女） |
| 龙媛 | `longyuan_v3.1` | 温暖治愈女 |
| 龙妙 | `longmiao_v3.1` | 抑扬顿挫女 |
| 龙寒 | `longhan_v3.1` | 温暖痴情男 |
| 龙安洋 | `longanyang_v3.1` | 阳光大男孩 |
| 龙安智 | `longanzhi_v3.1` | 睿智轻熟男 |
| 龙哲 | `longzhe_v3.1` | 呆板大暖男 |
| Bella | `loongbella_v3.1` | 干练、磁性、知性（女） |
| Stella | `loongstella_v3.1` | 飒爽利落女 |
| 龙小白 | `longxiaobai_v3.1` | 磁性、质感（女） |
| 龙书 | `longshu_v3.1` | 沉稳、磁性（男） |
| 龙橙 | `longcheng_v3.1` | 智慧、磁性（男） |
| 龙天 | `longtian_v3.1` | 磁性、理智（男） |

**3.0 旧音色（兼容保留：已有 3.0 克隆音色的配置可以继续用 3.0 模型）**

| 名称 | 音色 id | 特质 |
|------|---------|------|
| 龙安风悦 | `longanfengyue` | 自然亲切音（女·30岁） |
| 龙安元妃 | `longanyuanfei` | 高傲妃子音（女·30岁） |
| 龙安灵希 | `longanlingxi` | 可爱甜美音（女·25岁） |
| 龙安小昕 | `longanxiaoxin` | 亲切活泼音（女·22岁） |
| 龙安欢 | `longanhuan_v3.6` | 活泼女声（女·25岁） |
| 龙杰力豆 | `longjielidou_v3.6` | 天真男童（男·5岁） |
| 龙泡泡 | `longpaopao_v3.6` | 软糯可爱音（女·5岁） |
| 龙火火 | `longhuohuo_v3.6` | 顽皮少年音（男·8岁） |
| 龙川叔 | `longchuanshu_v3.6` | 川普大叔音（男·40岁） |
| Loong Mary | `loongmary` | 温暖英音（女·20岁，英文） |
| Loong John | `loongjohn` | 沉稳亲切美音（男·28岁，英文） |
| Loong Eva | `loongeva_v3.6` | 高智美音（女·28岁，英文） |

- **模型与音色的代际必须一致**（2026-11 官方音色表）：`qwen-audio-3.1-tts-flash` 支持上表全部 26 个 3.1 音色；`qwen-audio-3.1-tts-plus` 只支持 4 个旗舰音色（`longanfengyue_v3.1` / `longanlingxin_v3.1` / `longanhuan_v3.1` / `xunanchuan_v3.1`）以及 3.1 的复刻/设计音色；`qwen-audio-3.0-tts-plus` 只支持 `longanlingxi`、`longanhuan_v3.6`。下拉里**仍会列出全部内置音色**，当前模型不支持的项目标注「需 xxx 模型」；选中后「语音模型」会自动切到该模型。
- **切换代际时内置音色的同名自动映射**：把模型从 3.0 改到 3.1（或反过来）时，`longanfengyue` ↔ `longanfengyue_v3.1` 这类同名内置音色会自动换成当前代际的 id；目标模型不支持的内置音色（如 3.1-plus 只有 4 个旗舰、`longwan_v3.1` 切回 3.0）回落到该模型的缺省音色。复刻/设计音色**不会**自动改 id。
- **克隆/设计音色可跨代使用，但不保证**：实测 `qwen-audio-3.0-tts-plus-vd-bailian-<哈希>` 在 `qwen-audio-3.1-tts-flash` / `3.1-plus` 上仍能合成成功（2026-11），所以插件不会强行改写这类 id；官方未承诺跨代兼容，升级代际后建议先发一条试听，音色走样再回 3.1 模型下重新克隆，或直接改用上面的 3.1 系统音色。
- 其他 MaaS 模型（`cosyvoice-v2` 等）通过「语音模型」下拉里的「其他模型 id（手动输入）」填写；这类模型没有可确认的兼容矩阵，内置系统音色不会列出，只能使用「自定义音色」，需要自行确认该模型支持的音色 id。
- 声音复刻/声音设计的专属音色 id 通过「自定义音色」添加（名称 + 音色 id），不要求出现在内置预设里；同一后缀在 plus / flash 间共享，但**不跨代际共享**。

#### 自定义音色与情感控制

- **手动新增音色**：设置面板「语音回复」页签 →「自定义音色」点「＋ 添加音色」，填名称 + 音色 id 即可（也可直接写进 `voice.presets`）。**新增项插在清单最上方**，所以音色下拉里最新添加的排在最前、内置系统音色排在最后；名称留空时用 id 兜底，音色 id 留空的行保存时丢弃（最多 20 条）。
- **情感/语气（instruction）**：`voice.instruction` 用自然语言描述「这一轮的场景 + 每一句怎么走」（≤400 字），合成时随 `run-task` 的 `parameters.instruction` 下发，**不会被念出来**；人格可用 `personas[].expressions.voice.instruction` 单独覆盖，留空继承全局。换行会被规范成「；」，所以可以直接分行写「场景 / 第1句 / 第2句」；超长时按分句边界裁剪。合成时还会在这段语气后自动追加一句「像发微信语音一样随口说，不要播音腔」的口语提示。示例：
  - 场景 + 逐句：`场景：夜里她叫住学长，楼道很静，她有点紧张；第1句：声音很轻、带一点迟疑，语速偏慢；第2句：吞吐、有自然停顿，句尾不要往上飘；第3句：柔和、带一点温暖的笑意，语速平稳`
  - 单句回复：`场景：深夜私聊，她困得不行；这一句：声音轻而软，慢一点，句尾落地`
  - 清冷学姐：`场景：安静的图书馆，她说话很克制；每一句都平淡、语速稍慢，句尾不上扬`
  - 元气少女：`场景：放学路上阳光很好；每一句都轻快、带笑意，语速稍快`
  - 女仆：`场景：主人刚回家，她在门口迎接；每一句都恭敬、轻柔，带一点体贴的笑意`
  - 御姐：`场景：深夜酒吧，她半靠在吧台上；每一句都成熟、慵懒，气息柔和，语速稍慢`
- **文本内情感标签**（服务端能力，`qwen-audio-3.1 / 3.0-tts-plus / flash` 支持）：`[excited]` 兴奋、`[sad]` 悲伤、`[serious]` 严肃、`[laughing]` 笑声、`[sighing]` 叹息、`[whispers]` 耳语、`[very slowly]` / `[very fast]` 放慢/加快。**只有白名单里的这几种标签会被原样送进 TTS**（其它方括号内容一律当注释丢掉，避免把 `[pause:1s]` 这类东西念出来）；日常情感控制仍建议优先用 `instruction`（或让模型在单轮调用里指定语气），标签用在“一句话里逐句变情绪”的场合。
- **正文按「台词本」处理**：合成前会清洗回复正文——`|||` 与换行都当句子边界（换成句号，不再连成一句），合并重复标点、去掉标点旁的空格、句末自动补标点；括号/方尖括号/星号里的舞台指示（`（小声）`、`【突然】`、`*叹气*`）整段丢弃，代码块、URL、Markdown、颜文字一并去掉，再按 `maxChars` 截断（优先停在句末，且不会切坏情感标签）。

### 身份与权限（identity）

按 openid 判定「这条消息是谁发的」，并在消息前注入身份标签，人格据此决定称呼与亲疏：

```yaml
- id: im-qqbot
  config:
    identity:
      enabled: true
      ownerOpenIds:
        - 8E4BF9DF3A321BC03F55845EE32C623D   # 主人（私聊 user_openid）
      adminOpenIds: []                        # 管理员
      friendOpenIds: []                       # 朋友
```

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `identity.enabled` | boolean | `true` | 是否启用身份识别；三份名单都为空时不注入标签 |
| `identity.ownerOpenIds` | string[] | `[]` | 主人 openid，人格里的专属称呼只对这些人生效 |
| `identity.adminOpenIds` | string[] | `[]` | 管理员 openid |
| `identity.friendOpenIds` | string[] | `[]` | 朋友 openid；未命中任何名单的人都是「陌生人」 |

- 注入形式：消息开头加 `[身份: 主人] ` 这样的标签（私聊也会带，旧版本私聊完全不注入发送者信息）。群聊历史里的每条记录同样带标签。
- 人格提示词只写「身份: 主人」这类标签，**不要写死 openid**——换 AppID、私聊/群聊都会让 openid 变化。
- **私聊与群聊的 openid 不同**（`user_openid` / `member_openid`），同一个账号需要分别添加；在 QQ 里发送 `/whoami` 可查看当前场景的 openid。
- 也可以在设置面板「身份与权限」页签里编辑三份名单，保存后自动重载。
- 身份标签只影响模型的称呼与语气，不放宽 `access` 访问控制（白名单仍然生效）。

### 长期记忆与关系状态（memory）

按会话独立保存「聊过什么 + 关系进展」，与会话历史解耦：`/new` 只重置上下文，记忆仍在；重启后同样保留（`~/.dsh-qqbot/memory.json`）。

```yaml
- id: im-qqbot
  config:
    memory:
      enabled: true       # 关闭后不写盘、不注入
      autoCapture: true   # 从用户自述里自动提取要点
      maxNotes: 20        # 每个会话最多保留的要点条数（超出淘汰最旧）
```

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `memory.enabled` | boolean | `true` | 是否启用记忆与关系状态；关闭后不写盘、不注入 |
| `memory.autoCapture` | boolean | `true` | 是否自动捕获「我叫… / 我喜欢… / 我住在…」这类自述；不额外调用模型 |
| `memory.maxNotes` | number | `20` | 每个会话最多保留的要点条数（1–100），超出淘汰最旧 |

- **关系阶段**由累计互动次数推导：初识（<5）→ 眼熟（<20）→ 熟悉（<60）→ 亲近（<200）→ 很亲近；只影响亲近程度，不改变身份设定。
- **自动捕获是保守启发式**：只匹配明确的自述句式，跳过疑问句与「他说/听说」这类转述；宁可少记也不乱记。
- **群聊按群记录**：同一群里不同说话人的要点会带 `[昵称]` 前缀，避免把 A 的自述算到 B 头上。
- **注入内容**：认识天数、互动次数、关系阶段与要点清单，并要求模型只在相关话题时自然提起、不复述清单、不编造未记录的内容。
- 可在 QQ 端用 `/memory` 查看和管理（仅管理员）；设置面板已不再提供该页签（人格配置独立为「群友人格」），开关与条数请在配置文件的 `memory` 段调整。

### 群聊人格档案与群友分析（personaAnalysis）

按会话滚动保存群聊/私聊消息，既能自动为累计发言达到阈值的群友生成人格档案，也能在群里用 `/人格分析`（@ 指定群友）或 `qqbot_analyze_persona` 手动分析；同一个人在不同群/私聊的发言会合并成一份档案。

```yaml
- id: im-qqbot
  config:
    personaAnalysis:
      enabled: true          # 关闭后不再记录新消息，工具调用时返回「未启用」提示
      maxMessages: 300       # 每个会话最多保留的消息条数（20–1000）
      retentionDays: 30      # 消息保留天数（1–365），超期记录在加载/写入时清理
      autoAnalyze: true      # 累计发言达到阈值后自动分析（关闭则只保留手动工具）
      autoAnalyzeThreshold: 20  # 自动分析触发条数（5–200）
```

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `personaAnalysis.enabled` | boolean | `true` | 是否记录群聊/私聊消息；关闭后停止写入（已有档案保留） |
| `personaAnalysis.maxMessages` | number | `300` | 每个会话最多保留的消息条数（20–1000），超出淘汰最旧 |
| `personaAnalysis.retentionDays` | number | `30` | 消息保留天数（1–365），超期记录在加载与写入时清理 |
| `personaAnalysis.autoAnalyze` | boolean | `true` | 是否自动分析（累计发言 ≥ 阈值时触发） |
| `personaAnalysis.autoAnalyzeThreshold` | number | `20` | 自动分析触发条数（5–200）；已有档案时，新增条数 ≥ 阈值才会更新 |

- **数据只在本机**：发言档案写在 `~/.dsh-qqbot/persona-archive.json`，分析结果写在 `~/.dsh-qqbot/persona-profiles.json`，都不会上传到任何地方；删除这两个文件即可清空全部记录。
- **为什么需要本地档案**：QQ 官方没有「拉取任意群历史消息」的接口，入站历史缓冲也只保留最近 `historyLimit` 条且在每次回复后清空，无法支撑长期总结。所以只能记录机器人运行期间、功能开启之后的消息，无法回溯上线前的历史。
- **跨群合并**：只按平台下发的 openid 聚合（实测同一个人在私聊与群聊拿到的 openid 相同），因此不同群、群聊与私聊的发言会合并成一份档案；若某个会话下发的 openid 不同则单独成档。不同 openid 即使昵称相同也不会合并（不按昵称猜测身份）。
- **记录时机**：访问控制之后、@ 门控之前，中间件本身**不做 @ 过滤**——只要消息到达就写档；被访问控制拒绝的群/用户、机器人自己的消息、斜杠命令与空内容不会写入。
- **采集边界（重要）**：QQ 官方对**普通群机器人**只下发 `GROUP_AT_MESSAGE_CREATE`（被 @ 的群消息），群友没 @ 机器人的发言平台根本不会推给插件；只有**私域 / 开通「全量群消息」权限**的机器人还会收到 `GROUP_MESSAGE_CREATE`（群内每条消息），此时档案会自动记录全部发言。设置面板「群友人格」页签上方的采集状态条会显示已归档条数、平台实际下发过的事件类型（如 `GROUP_AT_MESSAGE_CREATE ×12`），并明确标出「仅 @ 消息」或「全量群消息」；`/人格分析` 的用法提示也会带上同样的说明。这些统计随档案一起落盘，重启后仍可查看。
- **自动分析**：某人累计发言首次达到 `autoAnalyzeThreshold` 时自动生成档案，之后每新增「阈值」条再更新一次；任务串行执行（同一人不会重复排队），失败后冷却 10 分钟重试，超时 120 秒中断。自动分析不会阻塞消息回复。
- **手动分析口径**：不指定群友时分析当前会话消息量最高的一位；指定昵称或 openid 时精确匹配（再按 openid 前缀、昵称包含兜底），匹配到多人会要求补充 openid。system prompt 强制只依据记录说话、区分事实与推测、样本 <30 条标注「样本偏少」、<5 条不做性格判断，不猜隐私、不做心理/医学诊断。
- **结构化结果**：模型输出一句话印象（summary）、性格特点（traits）、说话风格（style）、口头禅（catchphrases）、兴趣（interests）、群内角色（role）、相处建议（advice）与置信度（confidence），既用于展示，也可作为后续新增人格预设的素材。
- **手动触发（推荐）**：群里先 @ 要分析的人，再发 `/人格分析` —— 即 `@机器人 /人格分析 @小明`。命令按消息里的 @ 列表取 `member_openid`，昵称重名也不会认错；机器人必须被 @ 才会收到群消息（`requireMention`）。不想 @ 时可用 `/人格分析 <昵称或 openid>`；私聊里直接 `/人格分析` 分析对面的人；不带对象时会提示用法并列出当前群活跃群友的快捷入口。命令仅管理员可用（`identity` 名单未配置时视为不限制）。
- 也可以让模型自己调工具：@机器人 说「分析一下某某的性格」或「分析群里最活跃的人」。
- 设置面板「群友人格」页签可调整开关、条数、保留天数、自动分析阈值，并查看人格表格；表格支持按**昵称 / openid / 人格特点**筛选，点击昵称可展开完整档案。

### 访问控制（access）

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `access.c2cMode` | `open`/`allowlist`/`disabled` | `open` | 私聊访问模式 |
| `access.c2cAllow` | string[] | `[]` | 私聊白名单（user openid） |
| `access.groupMode` | `open`/`allowlist`/`disabled` | `open` | 群聊访问模式 |
| `access.groupAllow` | string[] | `[]` | 群聊白名单（group openid） |

### 富媒体理解（media）

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `media.enabled` | boolean | `true` | 是否启用富媒体理解（图片/视频下载 + 工具分析） |
| `media.maxMB` | number | `200` | 富媒体下载大小上限(MB) |
| `media.ttlHours` | number | `24` | 富媒体存活时长(小时)，0=永不过期 |

### 视觉理解（vision）

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `vision.enabled` | boolean | `false` | 是否启用视觉理解（qqbot_describe_image 工具） |
| `vision.provider` | string | - | 视觉模型 provider（如 pi-ai） |
| `vision.model` | string | - | 视觉模型 id（如 qwen-vl-max） |
| `vision.maxBytes` | number | `10MB` | 图片字节上限 |
| `vision.maxTokens` | number | `1024` | 输出 token 上限 |
| `vision.timeoutMs` | number | `120000` | 视觉调用超时(ms) |

### 附件发送（sendFile）

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `sendFile.restrictPaths` | boolean | `true` | 是否启用路径白名单（仅 media + cwd + extraRoots） |
| `sendFile.extraRoots` | string[] | `[]` | 额外允许访问的根目录 |

## 内置命令

| 命令 | 说明 |
|------|------|
| `/new`（别名 `/reset` `/clear`） | 开始新会话（清空上下文，仅管理员） |
| `/compact` | 压缩会话历史（摘要替换旧记录，保留上下文，仅管理员） |
| `/model` | 查看或切换模型（仅管理员） |
| `/preset` | 查看或切换 agent preset（新会话生效，仅管理员） |
| `/persona`（别名 `/人格`） | 查看人格菜单并切换人格（下一条消息生效，仅管理员）；`/persona default` 跟随默认，`/persona off` 关闭本会话人格 |
| `/人格分析`（别名 `/persona-analysis`） | 现场分析被 @ 的群友并返回人格档案（仅管理员）：`@机器人 /人格分析 @某人`；也可用 `<昵称或 openid>` 指定，私聊里直接分析对方 |
| `/tools`（别名 `/工具`） | 诊断用：查看当前人格的工具绑定与宿主可用工具清单（仅管理员，不在命令菜单中展示）；日常在设置面板用下拉绑定工具 |
| `/memory`（别名 `/记忆`） | 查看本会话的长期记忆与关系阶段（仅管理员）；`/memory add <内容>` 手动记一条，`/memory del <序号>` 删除，`/memory clear` 清空要点 |
| `/whoami`（别名 `/我是谁`） | 查看当前场景下的 openid 与被判定的身份（配置主人/管理员名单用） |
| `/stop` | 中止当前生成（仅管理员，不在菜单中展示） |
| `/bot-ping` | 网络延迟检测（返回传输与处理耗时） |
| `/bot-version` | 查看版本信息（模型信息仅管理员可见） |
| `/bot-status` | 查看当前会话状态（含模型/Preset，仅管理员） |
| `/bot-help` | 查看当前身份可用的指令（非管理员看不到管理类指令） |

> 权限与 `identity` 名单一致：主人/管理员可用管理类指令，朋友/陌生人只能看到并使用 `/whoami`、`/bot-ping`、`/bot-version`、`/bot-help`。
> **身份名单为空时视为未启用权限控制**，所有人仍可使用全部指令（避免新配置把自己锁在外面）。

## 核心模块

```
src/
├── index.ts                    # Cordis 插件入口（async apply）
├── config.ts                   # 配置 Schema
├── types.ts                    # 全局类型定义
├── setup/                      # 凭据绑定（扫码）
│   ├── index.ts                # 绑定编排（ensureCredentials）
│   ├── binding-service.ts      # 扫码状态机（宿主内唯一事实源）
│   ├── bind-routes.ts          # 端内绑定页路由（/qqbot/im-qqbot/bind）
│   ├── presenters.ts           # 呈现策略（终端/浏览器降级）
│   ├── qr-svg.ts               # 二维码 SVG 渲染（宿主侧）
│   └── persist.ts              # 凭据写入 cordis.patch.yml
├── client/                     # 浏览器半边（dsh.client Web Bundle）
│   ├── index.ts                # 侧栏 Tab 注册 + 待绑定自动引导
│   └── bind-page.ts             # 端内绑定页（二维码 + 状态轮询）
├── gateway/                    # 网关装配
│   ├── bootstrap.ts            # 启动装配（监听 session/event 等）
│   └── middleware-setup.ts     # 中间件链配置
├── transport/                  # 传输层
│   ├── inbound.ts              # QQ 入站消息 → agent.followup()
│   ├── outbound.ts             # session/event → QQ sendMarkdown
│   ├── outbound-buffer.ts      # 流式缓冲
│   ├── streaming-writer.ts     # 流式写入
│   ├── reply-target.ts         # 回复目标解析
│   ├── msgid-cache.ts          # 被动回复 msgid 缓存
│   ├── reply-limiter.ts        # 被动回复限流
│   ├── tool-presenter.ts       # 工具调用展示
│   └── chunker.ts              # Markdown 文本切分
├── session/                    # 会话管理层
│   ├── session-manager.ts      # QQ peer → Agent 映射
│   └── idle-evictor.ts         # 闲置回收
├── model/                      # 模型路由层
│   ├── model-resolver.ts       # 路由解析
│   ├── prefs-store.ts          # per-peer 偏好持久化（模型/preset/人格）
│   └── settings-reader.ts      # settings.yaml 只读
├── personas/                   # 人格预设
│   ├── persona-utils.ts        # 人格解析 + system prompt section 构造
│   └── persona-tools.ts        # 人格工具白名单 → tools.restrict 硬约束
├── identity/                   # 身份识别
│   └── role.ts                 # openid → 主人/管理员/朋友/陌生人 + 身份标签注入
├── memory/                     # 长期记忆与关系状态
│   ├── memory-store.ts         # ~/.dsh-qqbot/memory.json 持久化
│   └── memory-prompt.ts        # 关系阶段 / 自述捕获 / prompt section（order 87）
├── features/                   # 交互特性
│   ├── question-channel.ts     # ask_user_question 问答通道
│   ├── approval-channel.ts     # approval 审批确认通道
│   ├── answer-parser.ts        # 答案解析
│   ├── persona-archive.ts      # 群聊人格档案（~/.dsh-qqbot/persona-archive.json + 归档中间件）
│   ├── persona-profile-analysis.ts # 结构化人格 prompt / JSON 解析 / Markdown 渲染
│   ├── persona-analyzer.ts     # 单人分析编排（跨会话聚合 + 模型调用）
│   ├── persona-auto-analyzer.ts # 达到阈值后的自动分析队列（串行 / 冷却 / 超时）
│   ├── persona-profiles.ts     # 分析结果存储（persona-profiles.json）与面板筛选视图
│   └── persona-analysis-tool.ts # qqbot_analyze_persona 群友人格分析
├── media/                      # 多媒体
│   ├── vision-tool.ts          # 图片视觉理解
│   ├── send-file-tool.ts       # 发送本地文件
│   └── media-cleaner.ts        # 媒体 TTL 清理
├── middleware/                 # 中间件
│   ├── question-answer.ts      # 问答答案处理
│   └── attachment.ts           # 附件处理
├── shared/                     # 共享工具
│   ├── utils.ts                # 通用函数
│   ├── scope.ts                # scope/peer 提取
│   └── send-helper.ts          # 分块发送
└── commands/                   # 斜杠命令
```

## 会话路由

sessionKey: `qqbot:${appId}:${scope}:${peerId}`，新会话铸造 UUID 会话 id 并持久化到 `model-prefs.json`，重启后按持久化 id 恢复；0.5.x 老会话按原派生 id 沿用。

解析策略：进程内复用 → 持久化恢复 → 全新创建。

## 设计原则

- **纯 Cordis 插件** — 遵循 dsh "Plugins, not loop changes" 原则
- **声明式依赖** — `inject = ['agents']`，不直接耦合其他插件
- **会话隔离** — 每个 QQ 私聊用户/群聊各一个独立 Agent
- **Preset 支持** — 可通过 `agent-presets` 服务挂载预设（工具集、prompt 等）
- **长期记忆** — 按会话保存互动次数、关系阶段与要点（`memory.json`），`/new` 与重启都不清除
- **群友人格分析** — 按会话保存滚动聊天档案（`persona-archive.json`），累计发言达阈值自动生成/更新人格档案（`persona-profiles.json`），也可在群里 `/人格分析 @某人` 或调 `qqbot_analyze_persona` 手动分析；设置面板可按昵称/openid/特点筛选
- **闲置回收** — 超时自动 dispose Agent，防止内存泄漏
- **Markdown 输出** — 回复以 Markdown 格式发送，支持代码块/表格感知切分
- **图片理解** — 支持 `qqbot_describe_image` 视觉理解，可分析用户发送的图片
- **做题** — 支持 `qqbot_solve` 解题（题干文本 / 题目截图，走会话当前模型），固定输出「答案 + 过程」两段
- **文本小工具** — `qqbot_translate`（翻译）、`qqbot_summarize`（长文总结）、`qqbot_explain`（讲解概念/代码/报错）、`qqbot_rewrite`（改写润色），同样走会话当前模型，无需额外依赖
- **颜文字** — 人格可开启 `expressions.kaomoji`，按气质选风格（日常 / 元气 / 中二 / 猫系 / 傲娇 / 温柔 / 清冷 / 女仆），按情绪分组直接注入 prompt，不额外调用工具
- **附件发送** — 支持 `qqbot_send_file` 将本地文件发送给用户（默认启用路径白名单）
- **工具默认收敛** — QQ 会话默认只放行插件内置工具 + 只读联网/提问能力，宿主的文件读写与命令执行不对外开放
- **问答互动** — 支持 `ask_user_question`，单选生成内联按钮（点一个其余变灰）、多选回复编号，逐题推进 + 问题级超时
- **操作确认** — 支持 `approval/request`，关键操作通过「允许/拒绝」按钮请求用户确认

## 本地开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm build

# 开发模式（watch）
pnpm dev

# 用 --patch 方式调试
export QQBOT_APPID="xxx" QQBOT_SECRET="xxx"
npx @deepseek-ai/dsh web --patch /path/to/dsh-qqbot/cordis.dev.yml
```

## License

[MIT](./LICENSE)
