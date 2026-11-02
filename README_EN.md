<div align="center">

<img width="120" src="https://img.shields.io/badge/🤖-QQ_Bot-blue?style=for-the-badge" alt="QQ Bot" />

**A QQ Bot plugin for [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (dsh), connecting DeepSeek AI assistants to QQ private and group chats.**

**⚠️ This repository is a community fork (secondary development) of [`@tencent-connect/dsh-qqbot`](https://github.com/tencent-connect/dsh-qqbot), not the official repository.**

[![Fork](https://img.shields.io/badge/fork-tencent--connect%2Fdsh--qqbot-blue)](https://github.com/tencent-connect/dsh-qqbot)
[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![GitHub stars](https://img.shields.io/github/stars/xiong-universe/qqbot)](https://github.com/xiong-universe/qqbot)
[![QQ Bot](https://img.shields.io/badge/QQ_Bot-API_v2-red)](https://bot.q.qq.com/wiki/)

<br/>

**[简体中文](./README.md) | English**

Scan to join the QQ group / channel

<table>
<tr>
<td align="center" width="50%"><img src="./assets/docs/qqgroup.jpg" height="360" alt="QQ Group QR Code" /><br /><b>QQ Developer Group</b><br /><sub>Group 1: 1032635674 · Group 2: 1056948758</sub></td>
<td align="center" width="50%"><img src="./assets/docs/qqchannel.jpg" height="360" alt="QQ Channel QR Code" /><br /><b>QQ Developer Channel</b><br /><sub>Channel ID: 20dnumts4z</sub></td>
</tr>
</table>

</div>

## About this fork

This repository is a **community fork (secondary development)** of the official [`@tencent-connect/dsh-qqbot`](https://github.com/tencent-connect/dsh-qqbot): it keeps the upstream QQ gateway integration, SDK middleware, session management and settings panel, and continues to iterate on top of it. The package name stays `@tencent-connect/dsh-qqbot` so the DSH plugin system can recognise it, but **this fork is not published to npm** — install it from this repository (see [Method 1](#method-1-desktop-install-recommended) or Method 2) and never mix it with the official npm package in the same profile.

- **Upstream (official)**: <https://github.com/tencent-connect/dsh-qqbot> (npm: `@tencent-connect/dsh-qqbot`)
- **This fork**: GitHub <https://github.com/xiong-universe/qqbot> ｜ Gitee <https://gitee.com/x17598923823/qq-bot>

What this fork adds on top of upstream (see the [CHANGELOG](./CHANGELOG_EN.md) for the full list; whether upstream already has a given feature is decided by the official repository):

- **Member persona archive (the main focus)**: rolls per-chat group/direct messages, merges one person's messages across groups and DMs by openid, auto-generates/refreshes a persona profile at a message threshold, exposes them in the "Members" settings tab with filters, and supports `/人格分析` in a group to profile a mentioned member on demand. A capture strip shows which event types the platform actually delivers (mention-only vs full group messages), so it is clear whether missing data is a platform-permission or a plugin-config issue.
- **Voice replies (TTS)**: Alibaba Cloud Bailian Qwen-Audio realtime synthesis, with the model deciding when to speak; personas can override timbre, rate and delivery instruction, and synthesis failures fall back to text. Requires Node 22+.
- **Plugin update tab**: detects git / npm / local installs, compares against the remote and updates in one click with HMR reload — no uninstall/reinstall.
- **Others**: persona tool allowlist (hard constraint), identity & command permissions, long-term memory, kaomoji styles, plugin tools (solve / translate / summarize / explain / rewrite), tabbed settings panel.
- **Build output committed**: `lib/` is tracked, so installing straight from this repository needs no local build.

> **Regarding sync**: upstream fixes are merged periodically; new upstream features are not guaranteed to exist here — trust this repository's code and [CHANGELOG](./CHANGELOG_EN.md). When reporting an issue, mention that you run the fork and include the version (`/bot-version` in QQ).

## Architecture

```
QQ User → QQ WebSocket → dsh-qqbot → ctx.agents → dsh agent loop → LLM
                                 ↑                           │
                                 └── session/event ──────────┘
                                       (assistant reply → QQ sendMarkdown)
```

## Installation

> **This repository is the fork: methods 1 and 2 install this fork; method 4 is the official npm package (no persona archive, voice replies or other fork additions).**

### Method 1: Desktop install (recommended)

No command line needed — everything happens inside the app. If the official package was installed before, remove `@tencent-connect/dsh-qqbot` under "Plugins" first so one profile never holds two instances.

1. **Install**: click "Plugins" in the left sidebar → "Add plugin" → enter this repository's URL → install and start now
   - Gitee (faster in China): `https://gitee.com/x17598923823/qq-bot`
   - GitHub: `https://github.com/xiong-universe/qqbot`

<img src="./assets/docs/install.png" alt="In-app plugin install" width="560" />

2. **Connect**: avatar at the bottom-left → Settings → "QQ Bots" → scan the QR code with mobile QQ

<img src="./assets/docs/setting.png" alt="Settings QR binding" width="560" />

Credentials are saved automatically after the scan; later launches need no re-scan.

### Method 2: CLI install

```bash
# From this repository (recommended; updates follow this repository)
npx @deepseek-ai/dsh plugin --profile qqbot add https://gitee.com/x17598923823/qq-bot.git

# Or from a local tarball (npm pack produces tencent-connect-dsh-qqbot-0.11.0.tgz)
npx @deepseek-ai/dsh plugin --profile qqbot add ./tencent-connect-dsh-qqbot-0.11.0.tgz

# Start
npx @deepseek-ai/dsh --profile qqbot
```

On first launch, the plugin detects missing credentials and automatically starts the QR flow: a QR code is printed in the terminal → scan it with the QQ mobile app → credentials are saved to the profile, so subsequent launches require no re-scan.

In environments without the in-app binding page (pure CLI), set `QQBOT_BIND_OPEN_BROWSER=1` to additionally open a browser QR page as a fallback.

<img src="./assets/docs/qrcode.png" alt="QR code scan example" width="280" />

> **Note**: Upgrade to `0.4.0` or later for browser-link scanning, which avoids QR code misalignment in some terminals.

### Method 3: Local source / --patch dev mode

For code changes. Clone this repository first (`lib/` is committed, so installing straight from the repository needs no build; after editing sources run `pnpm build`):

```bash
git clone https://github.com/xiong-universe/qqbot
cd qqbot
pnpm install && pnpm build

# Add to a profile (local path)
npx @deepseek-ai/dsh plugin --profile qqbot add /path/to/qqbot

# Start
export QQBOT_APPID="yourAppID" QQBOT_SECRET="yourAppSecret"
npx @deepseek-ai/dsh --profile qqbot
```

Run from source without installing:

```bash
export QQBOT_APPID="yourAppID" QQBOT_SECRET="yourAppSecret"
npx @deepseek-ai/dsh web --patch /path/to/qqbot/cordis.dev.yml
```

### Method 4: Install the official package (no fork features)

Only needed to compare against upstream behaviour:

- **Desktop**: "Plugins" → "Add plugin" → enter `@tencent-connect/dsh-qqbot@latest`
- **CLI**:
  ```bash
  npx @deepseek-ai/dsh plugin --profile qqbot add @tencent-connect/dsh-qqbot
  ```

> The official package shares the same name (`@tencent-connect/dsh-qqbot`) — never install both; uninstall the other one first. After installing this fork, run `/bot-version` in QQ to confirm.

## Checking for updates

Upgrading no longer means uninstalling and reinstalling: the settings panel has a new "Plugin update" tab (avatar → Settings → "QQ Bot" → "Plugin update").

> Fork updates follow **this repository's remote** (GitHub `xiong-universe/qqbot` / Gitee `x17598923823/qq-bot`), never the official npm package; when installed from the repository, "check for updates" compares against this fork's commits.

- **Check**: the plugin reads the dependency spec from the profile and the installed reference from `pnpm-lock.yaml`, then compares against the remote — git installs compare the remote HEAD commit (`git ls-remote`), npm installs compare the registry `latest` version.
- **One-click update**: on Desktop the host's `desktopPnpm` runs `dsh plugin --profile <name> update @tencent-connect/dsh-qqbot` (that is `pnpm update`, which re-resolves the git remote commit and rewrites the lockfile), then triggers an HMR reload so the new version takes effect immediately.
- **Manual update** (CLI or when the host exposes no pnpm service):
  ```bash
  npx @deepseek-ai/dsh plugin --profile qqbot update @tencent-connect/dsh-qqbot
  ```
- **Install kinds that cannot self-update**: `file:` / `link:` local installs and `--patch` source loading show "update the source and restart"; a dependency pinned to an exact commit (`#<sha>`) does not follow the remote until the ref is changed back to a branch name.
- The update relies on `pnpm update` succeeding. If the new version is incompatible with the current DSH runtime, the host restores `package.json` / `pnpm-lock.yaml` and the tab shows the reason (you can follow its hint to run `dsh plugin --profile <name> allow-version ...` and retry).

## Configuration

| Config | Type | Default | Description |
|------|------|--------|------|
| `appId` | string | **required** | QQ Bot AppID (or via `QQBOT_APPID` env var) |
| `appSecret` | string | **required** | QQ Bot AppSecret (or via `QQBOT_SECRET` env var) |
| `provider` | string | `deepseek-official` | LLM provider name |
| `model` | string | `deepseek-chat` | Model name |
| `preset` | string | - | Agent preset id |
| `cwd` | string | `process.cwd()` | Agent working directory |
| `requireMention` | boolean | `true` | Whether group messages require @bot to trigger |
| `globalPrompt` | string | `''` | Global system prompt applied to all group/direct chats (put split rules here) |
| `personas` | array | `[]` | Persona presets (switchable via `/persona` in QQ, each with an optional `tools` whitelist) |
| `defaultPersona` | string | `''` | Default persona id; empty disables personas |
| `voice` | object | see below | Outbound voice (TTS): **voice is disabled when `enabled` is off or `apiKey` is empty**, see below |
| `memory` | object | see below | Long-term memory & relationship state: per-chat interaction count, stage and self-described notes, local only; no settings-panel tab, see below |
| `personaAnalysis` | object | see below | Member persona archive: stores per-chat messages, auto-analyzes at a threshold and supports `qqbot_analyze_persona`; local only, see below |
| `textChunkLimit` | number | `4500` | Max chars per message |
| `streaming` | boolean | `true` | Enable streaming output (always disabled in groups) |
| `replySplitMode` | `none`/`delimiter`/`line`/`paragraph` | `none` | Reply split mode: `delimiter` splits at the fixed `|||` delimiter (recommended; once a delimiter appears, leftover newlines in a segment also split); splitting disables streaming |
| `replySplitIntervalMs` | number | `0` | Delay between split messages (ms), `0` = send immediately |
| `sessionIdleTimeout` | number | `1800000` | Session idle timeout (ms), default 30 min |
| `processingTimeoutMs` | number | `1800000` | Processing timeout (ms), aborts the current LLM call |
| `maxQueue` | number | `20` | Max concurrent queue length |
| `historyLimit` | number | `10` | Group history buffer size |
| `askTimeoutMs` | number | `300000` | Question timeout (ms), default 5 min (ask_user_question) |
| `showToolResults` | boolean | `false` | Show successful tool-call results (errors always shown) |
| `debug` | boolean | `false` | Debug mode |

### Personas (personas)

Split the single prompt into several switchable personas, each with its own tool whitelist:

```yaml
- id: im-qqbot
  config:
    defaultPersona: assistant
    personas:
      - id: assistant
        name: Assistant
        prompt: You are a rigorous, concise assistant.
      - id: chat
        name: Chat
        prompt: You are a casual chat partner.
        tools: []          # pure-chat persona: no tools at all
        expressions:
          kaomoji:
            enabled: true  # must be explicitly enabled
            style: genki   # daily/genki/chuuni/cat/tsundere/soft/cool/maid
      - id: media
        name: Media helper
        prompt: You are good at reading images and sending files.
        tools:
          - qqbot_describe_image
          - qqbot_send_file
```

- `expressions.kaomoji`: **kaomoji** (optional; requires an explicit `enabled: true`). Choose a style that matches the persona (`daily`, `genki`, `chuuni`, `cat`, `tsundere`, `soft`, `cool`, `maid`; default `daily`). The style's kaomoji list and usage rules (at most one per reply by default) are merged into the persona prompt — **no tool call needed**.
  - `enabled`: whether to enable it (default `false`). Explicit opt-in is required because the config schema materializes a default sub-object for every persona — testing for the mere presence of `kaomoji` would silently enable it everywhere.
  - `maxPerReply`: max kaomoji per reply (1–3, default 1).
  - `custom`: extra kaomoji (up to 20 entries, ≤32 chars each), appended after the preset list.
  - The library lives in `src/expressions/kaomoji.ts`; future sticker (image) support will add a `sticker` field to the same `expressions` container without changing the persona shape.
- `expressions.voice`: **the persona's voice timbre** (optional). `voice` overrides the global timbre, `rate` (0.5–2) / `volume` (0–100) are optional, and `instruction` overrides the global emotion/tone instruction (empty inherits the global value). Voice replies themselves are gated by the global `voice.enabled` switch and `voice.apiKey`; nothing here takes effect unless both are set. Example: `expressions: { voice: { voice: longanfengyue_v3.1, rate: 1.1, instruction: 请用清冷克制的语气 } }`.
- `tools` is a **hard** runtime constraint: the persona's agent calls `tools.restrict({ allow })`, so tools outside the whitelist are not even visible to the model (not just discouraged by the prompt).
  - Omit `tools` to use the **default allowlist**: the 8 plugin tools (`qqbot_solve`, `qqbot_describe_image`, `qqbot_send_file`, `qqbot_translate`, `qqbot_summarize`, `qqbot_explain`, `qqbot_rewrite`, `qqbot_analyze_persona`) plus `ask_user_question` and read-only `web_search` / `web_fetch`.
  - `tools: []` disables all tools for that persona.
  - Persona tool names are intersected with the default allowlist: host tools such as `read`, `write`, `pwsh`, `bash` are never granted (a warning is logged), and unknown names are ignored.
  - Exception: while voice is enabled `qqbot_voice` is always allowed (voice is a delivery mode, not a capability), so even a persona with `tools: []` can reply with voice.
  - Switching personas re-applies the binding immediately; `/tools` shows the current binding (admins only, diagnostic — hidden from the command menu).
  - Bind tools in the settings panel: expand a persona card, turn on "limit available tools", then pick from the dropdown (candidates are plugin tools only; chosen ones render as removable chips).
- Personas are per-chat (group id / direct-chat user id); `/persona <id>` override > `defaultPersona`.
- Prompt order: `globalPrompt` (80) → identity (82) → persona prompt (85) → tool-permission note (86, when `tools` is set) → memory (87) → voice note (88, when voice is enabled).

### Voice replies (voice)

Speak replies instead of typing them: built on DashScope real-time speech synthesis (WebSocket). **Whether to use voice is decided by the model** — when voice fits, it calls the `qqbot_voice` tool and the reply body of that turn is synthesized into a QQ voice message and is **no longer sent as duplicate text**; if synthesis fails or the content is unsuitable for speech, the plugin falls back to the text reply. Voice is fully disabled when the `voice.enabled` master switch is off **or** `voice.apiKey` is empty — no tool registration, no synthesis, no voice message, no quota consumed. Turn the switch off to pause voice and keep the key.

```yaml
- id: im-qqbot
  config:
    voice:
      enabled: true                     # master switch; even with a key, voice stays off when false
      apiKey: ''                        # empty = cannot enable voice; fill in a Bailian API key to enable
      model: qwen-audio-3.1-tts-flash   # TTS model (a dropdown in the panel; 3.0 legacy models still work)
      voice: longanfengyue_v3.1         # default timbre (must match the model generation)
      instruction: 场景：夜里她叫住学长，楼道很静；第1句：声音很轻、带一点迟疑，语速偏慢；第2句：吞吐、句尾落地   # emotion/tone instruction (natural language, optional)
      presets:                          # custom timbres (listed above the built-in presets)
        - name: 元气少女
          voice: qwen-audio-3.1-tts-plus-vd-bailian-<hash>
      maxChars: 300                     # max spoken characters per reply (20–1000)
      timeoutMs: 30000                  # synthesis timeout in ms (5000–120000)
      # baseUrl: wss://xxx/api-ws/v1/inference   # custom MaaS gateway (optional)
      # workspace: xxx                          # Bailian workspace id (optional)
```

| Config | Type | Default | Description |
|------|------|--------|------|
| `voice.enabled` | boolean | `true` | Master switch; when off no tool is registered, nothing is synthesized and no voice is sent even with a saved API key (default on for backward compatibility) |
| `voice.apiKey` | string | `''` | DashScope API key; **empty = voice cannot be enabled** (in the settings panel, leaving it empty keeps the saved key; use the `enabled` switch to pause voice, no need to clear the key) |
| `voice.model` | string | `qwen-audio-3.1-tts-flash` | TTS model id; the model must be activated in the Bailian console **and granted to the API key as a permission point**. The panel shows a dropdown (3.1 / 3.0 flash and plus); other models are entered manually |
| `voice.voice` | string | `longanfengyue_v3.1` | Default timbre id; timbre ids are bound to the model generation, personas can override it via `expressions.voice.voice` |
| `voice.instruction` | string | `''` | Emotion/tone instruction (natural language, ≤400 chars): can be written as "scene + per-sentence delivery" (see below); personas can override it via `expressions.voice.instruction`. **The persona/global delivery is sent together with the per-turn `qqbot_voice` instruction**, never replaced by it |
| `voice.presets` | array | `[]` | Custom timbre list (`{ name, voice }`, ≤20); **listed before the built-in presets** in the dropdown, newest first |
| `voice.baseUrl` | string | `''` | Custom WebSocket URL (`ws://` / `wss://`); empty falls back to workspace or the official gateway |
| `voice.workspace` | string | `''` | Bailian workspace id (builds the MaaS URL and sends `X-DashScope-WorkSpace`) |
| `voice.maxChars` | number | `300` | Max characters spoken per reply; longer text is truncated |
| `voice.timeoutMs` | number | `30000` | Synthesis timeout; on timeout the voice reply degrades to text |

- **Model decides, voice replaces text**: when voice is enabled the model gets a "voice reply" note (order 88). If voice fits ("say something", "send a voice message", "let me hear your voice", "sing a song", short goodnight/comforting lines) it calls `qqbot_voice`, and the reply body of that turn is only used for synthesis — it is not sent as a text message, so there is no "text first, then the same voice again".
- **Automatic fallback**: auth errors, unactivated models, network timeouts or unspeakable content degrade to the original text reply, so the message is never lost; temporary audio is written to `~/.dsh-qqbot/media` and deleted after sending.
- **The API key needs the model permission point**: a Bailian key only carries the models listed under "selected permission points". Before granting the 3.1-TTS models, `qwen-audio-3.1-tts-*` returns `AccessDenied`, which on the QQ side looks like "`qqbot_voice` was called but a text message arrived". The log now spells it out (`语音合成失败…AccessDenied（请到阿里云百炼控制台，给这个 API Key 勾选该语音模型的权限点）`); tick the model under "API Key → permission points" in Bailian.
- **Timbre/model mismatch falls back instead of failing**: when a persona or global setting uses a built-in system timbre the current model does not support (e.g. 3.1-plus with `longwan_v3.1`), it is swapped for that model's default timbre with a warning, instead of degrading the whole turn to text. Clone/design ids are never swapped.
- **Per-persona timbre**: `personas[].expressions.voice` overrides the global timbre, rate, volume and emotion instruction; the change applies to the next voice message after switching personas. The model may also write a one-off "scene + per-sentence delivery" instruction for the current turn (e.g. `场景：夜里她叫住学长，楼道很静；第1句：声音很轻、带一点迟疑…`), layered on top of the persona delivery and lasting only that turn. The voice prompt asks it to **write the scene and the delivery of each sentence on every call** so replies do not all share the same default delivery.
- **Instructions are layered, not replaced**: what is sent to TTS is "this turn's delivery + persona/global delivery + a 'speak it casually like a WeChat voice note' hint", clipped to 400 chars with the turn's delivery kept first. A persona's tuned habits (lower pitch, falling sentence ends, stretched keywords…) therefore survive even when the model only writes "natural tone" — the old implementation replaced the whole instruction, which is exactly what made speech sound flat.
- **If the voice sounds flat**: ① avoid adjective piles in `instruction` ("mature, lazy, gentle" points nowhere) and describe executable moves instead — volume, pace, a half-beat pause at commas, stretched or stressed keywords, whether sentence ends fall, whether to start with a light laugh or a sigh; ② let the model write per-sentence delivery using the template above; ③ if the cloned timbre itself is flat, compare with a system timbre such as `longanlingxin_v3.1`; ④ add `expressions.voice.rate` (e.g. `0.9`) when you want a slower feel.
- **Automatic cleanup**: code blocks, URLs, Markdown symbols, the `|||` delimiter and kaomoji are not read aloud; `|||` and line breaks both become sentence boundaries and a terminal mark is added, so the reading has natural pauses and a proper ending.
- **Runtime requirement**: uses the built-in WebSocket in Node 22+; on Node 20 voice is disabled at startup with a warning even if a key is filled in.
- The "Voice replies" tab in the settings panel edits these fields; the "Enable voice replies" switch at the top pauses/resumes voice at any time while keeping the key, and a saved API key is **never echoed back**, only a "saved" state is shown.

#### Built-in timbre presets (labelled by model generation)

The **"Voice model" and "Default timbre" fields are both dropdowns** and they are linked:

- **Voice model** lists only the Qwen models the plugin ships verified presets for: `qwen-audio-3.1-tts-flash` (recommended default, all 26 system timbres), `qwen-audio-3.1-tts-plus` (higher quality, 4 flagship timbres only) and `qwen-audio-3.0-tts-flash` / `qwen-audio-3.0-tts-plus` (legacy compatibility). Other models (e.g. `cosyvoice-v2`) go through "Other model id (manual input)"; their timbres must be added as "Custom timbres".
- **Switching the model adjusts the timbre**: same-name built-in timbres are rewritten across generations (`longanfengyue` ↔ `longanfengyue_v3.1`), built-in timbres the target model does not support fall back to that model's default timbre, and persona overrides are updated too. Clone/design ids are never rewritten (a warning tells you to re-clone).
- **Picking a timbre adjusts the model**: choosing a "requires xxx model" timbre in "Default timbre" automatically switches "Voice model" to that model, so a selection can never fail just because of a stale model.

Timbre ids are bound to the model **generation**: 3.1 timbres always carry the `_v3.1` suffix, and 3.0 ids cannot be used with 3.1 models (`InvalidParameter` / `Engine error [411]`), or vice versa.


**3.1 timbres (default model `qwen-audio-3.1-tts-flash`)**

| Name | Voice id | Character |
|------|----------|-----------|
| 龙安风悦 | `longanfengyue_v3.1` | natural, friendly (female; plus flagship) |
| 龙安灵心 | `longanlingxin_v3.1` | gentle female (plus flagship; default for 3.1-plus) |
| 龙安欢 | `longanhuan_v3.1` | lively female (plus flagship) |
| 许南川 | `xunanchuan_v3.1` | male (plus flagship) |
| 龙安元妃 | `longanyuanfei_v3.1` | aloof imperial consort (female) |
| 龙安灵希 | `longanlingxi_v3.1` | cute and sweet (female) |
| 龙杰力豆 | `longjielidou_v3.1` | innocent boy |
| 龙火火 | `longhuohuo_v3.1` | mischievous teen |
| 龙泡泡 | `longpaopao_v3.1` | playful, bubbly (female) |
| 龙华 | `longhua_v3.1` | energetic, sweet (female) |
| 龙婉 | `longwan_v3.1` | delicate, soft-spoken (female) |
| 龙星 | `longxing_v3.1` | gentle, girl-next-door (female) |
| 龙悦 | `longyue_v3.1` | warm, magnetic (female) |
| 龙颜 | `longyan_v3.1` | warm, natural, friendly (female) |
| 龙媛 | `longyuan_v3.1` | warm, healing (female) |
| 龙妙 | `longmiao_v3.1` | expressive, rhythmic (female) |
| 龙寒 | `longhan_v3.1` | warm, devoted (male) |
| 龙安洋 | `longanyang_v3.1` | sunny young man |
| 龙安智 | `longanzhi_v3.1` | wise, mature young man |
| 龙哲 | `longzhe_v3.1` | deadpan, warm-hearted man |
| Bella | `loongbella_v3.1` | polished, magnetic, intellectual |
| Stella | `loongstella_v3.1` | crisp, confident female |
| 龙小白 | `longxiaobai_v3.1` | magnetic, textured (female) |
| 龙书 | `longshu_v3.1` | calm, magnetic (male) |
| 龙橙 | `longcheng_v3.1` | smart, magnetic (male) |
| 龙天 | `longtian_v3.1` | magnetic, rational (male) |

**3.0 legacy timbres (kept for configs whose cloned voices are bound to 3.0)**

| Name | Voice id | Character |
|------|----------|-----------|
| 龙安风悦 | `longanfengyue` | natural, friendly (female, 30) |
| 龙安元妃 | `longanyuanfei` | aloof imperial consort (female, 30) |
| 龙安灵希 | `longanlingxi` | cute and sweet (female, 25) |
| 龙安小昕 | `longanxiaoxin` | warm and lively (female, 22) |
| 龙安欢 | `longanhuan_v3.6` | lively (female, 25) |
| 龙杰力豆 | `longjielidou_v3.6` | innocent boy (male, 5) |
| 龙泡泡 | `longpaopao_v3.6` | soft and cute (female, 5) |
| 龙火火 | `longhuohuo_v3.6` | mischievous teen (male, 8) |
| 龙川叔 | `longchuanshu_v3.6` | Sichuan-accented uncle (male, 40) |
| Loong Mary | `loongmary` | warm British English (female, 20) |
| Loong John | `loongjohn` | calm, friendly American English (male, 28) |
| Loong Eva | `loongeva_v3.6` | high-intelligence American English (female, 28) |

- **Model and timbre generations must match** (official voice list, 2026-11): `qwen-audio-3.1-tts-flash` supports all 26 3.1 timbres above; `qwen-audio-3.1-tts-plus` only supports the 4 flagship timbres (`longanfengyue_v3.1` / `longanlingxin_v3.1` / `longanhuan_v3.1` / `xunanchuan_v3.1`) plus 3.1 clone/design ids; `qwen-audio-3.0-tts-plus` only supports `longanlingxi` and `longanhuan_v3.6`. The dropdown **still lists every built-in timbre** and marks the ones the current model does not support as "requires xxx model"; picking one switches the voice model to it automatically.
- **Same-name built-in timbres are mapped automatically when switching generations**: changing the model from 3.0 to 3.1 (or back) maps `longanfengyue` ↔ `longanfengyue_v3.1` and similar pairs to the id of the current generation; built-in timbres the target model does not support (e.g. 3.1-plus has only 4 flagships, or `longwan_v3.1` going back to 3.0) fall back to that model's default timbre. Clone/design ids are **never** rewritten.
- **Clone/design ids work across generations, but it is not guaranteed**: `qwen-audio-3.0-tts-plus-vd-bailian-<hash>` was verified to still synthesize on `qwen-audio-3.1-tts-flash` / `3.1-plus` (2026-11), so the plugin never rewrites such ids; the vendor does not promise cross-generation compatibility, so send one test message after upgrading and re-clone under a 3.1 model (or pick a 3.1 system timbre) if the voice sounds off.
- Other MaaS models (`cosyvoice-v2`, …) are entered through "Other model id (manual input)" in the "Voice model" dropdown; they have no confirmed compatibility matrix, so no built-in timbres are listed and you must add ids as "Custom timbres" yourself.
- Custom ids from voice cloning / voice design are added via "Custom timbres" (name + id); they do not need to be in the built-in list, and the same suffix is shared between plus and flash — and, as tested above, also usable across generations.

#### Custom timbres and emotion control

- **Add a timbre manually**: in the settings panel → "Voice replies" → "Custom timbres", click "＋ Add timbre" and fill in a name + timbre id (or write them into `voice.presets`). New rows are inserted at the top of the list, so the dropdown shows the newest custom timbre first and the built-in presets last; an empty name falls back to the id, rows without an id are dropped on save (max 20).
- **Emotion / tone (`instruction`)**: `voice.instruction` is a natural-language description of "the scene for this turn + how each sentence should be delivered" (≤400 chars), sent as `parameters.instruction` in `run-task` and **never spoken aloud**; personas can override it via `personas[].expressions.voice.instruction` (empty inherits the global value). Line breaks are normalised to "；", so you can write scene / sentence 1 / sentence 2 on separate lines; over-long instructions are clipped at sentence boundaries. Before synthesis the plugin appends a short "say it like a WeChat voice message, no announcer or reading tone" hint. Examples:
  - scene + per sentence: `场景：夜里她叫住学长，楼道很静，她有点紧张；第1句：声音很轻、带一点迟疑，语速偏慢；第2句：吞吐、有自然停顿，句尾不要往上飘；第3句：柔和、带一点温暖的笑意，语速平稳`
  - one-liner reply: `场景：深夜私聊，她困得不行；这一句：声音轻而软，慢一点，句尾落地`
  - cool senpai: `场景：安静的图书馆，她说话很克制；每一句都平淡、语速稍慢，句尾不上扬`
  - energetic girl: `场景：放学路上阳光很好；每一句都轻快、带笑意，语速稍快`
  - maid: `场景：主人刚回家，她在门口迎接；每一句都恭敬、轻柔，带一点体贴的笑意`
  - mature lady: `场景：深夜酒吧，她半靠在吧台上；每一句都成熟、慵懒，气息柔和，语速稍慢`
- **Inline emotion tags** (service capability, supported by `qwen-audio-3.1 / 3.0-tts-plus / flash`): `[excited]`, `[sad]`, `[serious]`, `[laughing]`, `[sighing]`, `[whispers]`, `[very slowly]` / `[very fast]`, … **Only these whitelisted tags are forwarded to TTS as-is**; any other bracketed text is treated as a note and dropped (so `[pause:1s]` is never read aloud). Prefer `instruction` for everyday emotion control (or a one-off tone for the current turn) — use tags when the emotion changes sentence by sentence.
- **The reply text is cleaned as a script**: before synthesis, `|||` and line breaks both become sentence boundaries (periods, not one run-on utterance), repeated punctuation is merged, spaces around punctuation are removed and a terminal mark is added; stage directions in brackets/braces/asterisks (`（小声）`, `【突然】`, `*叹气*`) are dropped, and code blocks, URLs, Markdown, kaomoji are stripped before `maxChars` truncation (truncation prefers a sentence end and never cuts a tag in half).

### Identity (identity)

Resolves who sent each message by openid and injects an identity tag so personas can decide how close to be:

```yaml
- id: im-qqbot
  config:
    identity:
      enabled: true
      ownerOpenIds:
        - 8E4BF9DF3A321BC03F55845EE32C623D   # owner (direct chat user_openid)
      adminOpenIds: []
      friendOpenIds: []
```

| Config | Type | Default | Description |
|------|------|--------|------|
| `identity.enabled` | boolean | `true` | Enable identity resolution; no tags are injected while all lists are empty |
| `identity.ownerOpenIds` | string[] | `[]` | Owner openids; persona-specific forms of address only apply to them |
| `identity.adminOpenIds` | string[] | `[]` | Admin openids |
| `identity.friendOpenIds` | string[] | `[]` | Friend openids; anyone else is a stranger |

- Each message is prefixed with `[身份: 主人]` (`[Identity: owner]`-style tag), direct chats included. Group history entries carry the tag too.
- Persona prompts should reference the tag instead of hardcoding an openid — openids change with AppID and differ between direct chats (`user_openid`) and groups (`member_openid`).
- Send `/whoami` in QQ to read the openid for the current chat; add the direct-chat and group values separately.
- Identity tags only affect tone and forms of address; they do not bypass `access` allowlists.

### Long-term memory (memory)

> **The settings panel no longer has a "Memory & relationship" tab**: this feature is on by default; adjust the switches and note limit in the `memory` section of the config file only, and use `/memory` in QQ (admins only) for day-to-day viewing/management.

Per-chat memory of what was said and how the relationship has progressed, stored separately from session history: `/new` only resets context, memory survives `/new` and restarts (`~/.dsh-qqbot/memory.json`).

```yaml
- id: im-qqbot
  config:
    memory:
      enabled: true       # disable = no writes, no prompt injection
      autoCapture: true   # extract facts from user self-descriptions
      maxNotes: 20        # max notes per chat (oldest evicted)
```

| Config | Type | Default | Description |
|------|------|--------|------|
| `memory.enabled` | boolean | `true` | Enable memory and relationship state; when off, nothing is written or injected |
| `memory.autoCapture` | boolean | `true` | Auto-capture self-descriptions such as "my name is… / I like…"; no extra model calls |
| `memory.maxNotes` | number | `20` | Max notes per chat (1–100); oldest notes are evicted |

- Relationship stage is derived from cumulative interactions: 初识 (<5) → 眼熟 (<20) → 熟悉 (<60) → 亲近 (<200) → 很亲近. It only affects familiarity, never the identity rules.
- Auto-capture is a conservative heuristic: explicit self-descriptions only, skipping questions and hearsay ("he said…").
- Group notes are prefixed with the speaker's name to avoid attributing one member's facts to another.
- The injected section contains days known, interaction count, relationship stage and the notes, with instructions to mention them naturally, never recite the list, and never invent unrecorded facts.
- **How it differs from the persona archive**: memory stores "relationship state + self-described facts", isolated per chat, to make conversations feel continuous; `personaAnalysis` stores raw messages merged across chats by openid, to build persona profiles. They have independent switches and do not affect each other.
- Manage it with `/memory` in QQ (admins only): `/memory` to view, `/memory add <text>`, `/memory del <n>`, `/memory clear`.

### Group persona archive & member analysis (personaAnalysis)

Rolling per-chat archive of group/direct messages. It automatically builds a persona profile once a member's message count reaches the threshold, and `/人格分析` (with an @-mention) or `qqbot_analyze_persona` can profile a specific member on demand. Everything the same openid said across groups and direct chats is merged into one profile.

```yaml
- id: im-qqbot
  config:
    personaAnalysis:
      enabled: true          # keep recording messages; when off, tool calls report "not enabled"
      maxMessages: 300       # max retained messages per chat (20–1000)
      retentionDays: 30      # retention window in days (1–365), pruned on load/write
      autoAnalyze: true      # analyze automatically once the threshold is reached
      autoAnalyzeThreshold: 20  # trigger after this many messages (5–200)
```

| Config | Type | Default | Description |
|------|------|--------|------|
| `personaAnalysis.enabled` | boolean | `true` | Whether to record group/direct messages; turning it off stops new writes (existing archive is kept) |
| `personaAnalysis.maxMessages` | number | `300` | Max retained messages per chat (20–1000); oldest are evicted |
| `personaAnalysis.retentionDays` | number | `30` | Retention window in days (1–365); expired entries are pruned on load and write |
| `personaAnalysis.autoAnalyze` | boolean | `true` | Enable automatic analysis when the member reaches the threshold |
| `personaAnalysis.autoAnalyzeThreshold` | number | `20` | Trigger threshold (5–200); an existing profile is refreshed only after this many new messages |

- **Local only**: messages live in `~/.dsh-qqbot/persona-archive.json`, analysis results in `~/.dsh-qqbot/persona-profiles.json`; nothing is uploaded, delete both files to erase everything.
- **Why a local archive**: the QQ OpenAPI does not expose arbitrary group history, and the SDK's inbound history buffer is an in-memory ring that keeps only the last `historyLimit` messages (10 by default) and is lost on restart, so it cannot support long-term summaries. Only messages received while the bot is running (after enabling the feature) can be recorded.
- **Cross-chat merge**: grouped purely by the platform-issued openid (in practice the same person gets the same openid in direct chats and groups), so messages from different groups and DMs end up in a single profile; if some chat issues a different openid it becomes its own profile. Different openids are never merged even with identical nicknames.
- **When messages are recorded**: after access control and before the @ mention gate; the middleware itself **does not filter by mentions** — anything that arrives is archived. Rejected chats/users, the bot's own messages, slash commands and empty content are skipped.
- **What the platform actually delivers (important)**: the QQ OpenAPI only pushes `GROUP_AT_MESSAGE_CREATE` (messages that @ the bot) to a **standard group bot**, so group chatter without an @ never reaches the plugin; only **private-domain bots / bots with the full group-message permission** also receive `GROUP_MESSAGE_CREATE` (every group message), and then the archive records all of it. The capture strip above the profile table on the "Members" tab shows the archived volume, the event types the platform actually delivered (e.g. `GROUP_AT_MESSAGE_CREATE ×12`), and a "mention-only" / "full group messages" badge; `/人格分析` prints the same explanation. These counters are persisted with the archive, so they survive restarts.
- **Full messages affect recording only, never replies**: the archive runs before the mention gate, so with `GROUP_MESSAGE_CREATE` a non-mention group message is only archived (and added to the recent group history buffer for the next reply) and **never triggers a reply**. As long as "Only reply to @-mentions in groups" stays on (default `requireMention: true`), the bot still answers only when mentioned. Turning that switch off makes every group message trigger a model reply (cost and spam risk) — avoid it in groups with full-message permission.
- **Automatic analysis**: the first time a member reaches `autoAnalyzeThreshold` a profile is generated; afterwards it is refreshed each time another `threshold` messages arrive. Jobs run serially (one per member at a time), failures cool down for 10 minutes, and a run is aborted after 120 seconds. It never blocks replies.
- **Manual analysis policy**: without a member it profiles the most active member of the current chat; with a nickname or openid it matches exactly (then openid prefix, then nickname substring) and asks for an openid when the match is ambiguous. The system prompt requires evidence-based statements, separates facts from inferences, labels samples under 30 messages as "small sample", does not judge personality under 5 messages, and never guesses private facts or gives psychological/medical diagnoses.
- **Structured output**: one-line summary, traits, speaking style, catchphrases, interests, group role, advice and confidence — used for display today and as raw material for new persona presets later.
- **Deterministic trigger (recommended)**: in a group, @ the member first and send `/人格分析` — e.g. `@bot /人格分析 @Alice`. The command reads the member's `member_openid` from the message's mention list, so duplicate nicknames cannot pick the wrong person; the bot must still be @-mentioned to receive group messages (`requireMention`). Without a mention, `/人格分析 <nickname|openid>` is the fallback; in DMs `/人格分析` profiles the other person; without any target it replies with usage and a shortcut list of the chat's active members. Admins only (no restriction when the `identity` lists are empty).
- You can also let the model call the tool: mention the bot and ask "analyze X's personality" or "analyze the most active member here".
- The "Members" (群友人格) tab in the settings panel exposes the switches, message limit, retention days, auto-analysis threshold, and a profile table filterable by **nickname / openid / personality trait**; click a nickname to expand the full profile.

### Access control (access)

| Config | Type | Default | Description |
|------|------|--------|------|
| `access.c2cMode` | `open`/`allowlist`/`disabled` | `open` | Direct-chat access mode |
| `access.c2cAllow` | string[] | `[]` | Direct-chat allowlist (user openid) |
| `access.groupMode` | `open`/`allowlist`/`disabled` | `open` | Group access mode |
| `access.groupAllow` | string[] | `[]` | Group allowlist (group openid) |

### Rich media (media)

| Config | Type | Default | Description |
|------|------|--------|------|
| `media.enabled` | boolean | `true` | Enable rich media understanding (image/video download + tool analysis) |
| `media.maxMB` | number | `200` | Max download size (MB) |
| `media.ttlHours` | number | `24` | Media lifetime (hours), 0 = never expire |

### Vision (vision)

| Config | Type | Default | Description |
|------|------|--------|------|
| `vision.enabled` | boolean | `false` | Enable vision (qqbot_describe_image tool) |
| `vision.provider` | string | - | Vision model provider (e.g. pi-ai) |
| `vision.model` | string | - | Vision model id (e.g. qwen-vl-max) |
| `vision.maxBytes` | number | `10MB` | Max image bytes |
| `vision.maxTokens` | number | `1024` | Max output tokens |
| `vision.timeoutMs` | number | `120000` | Vision call timeout (ms) |

### File sending (sendFile)

| Config | Type | Default | Description |
|------|------|--------|------|
| `sendFile.restrictPaths` | boolean | `true` | Enable path allowlist (media + cwd + extraRoots only) |
| `sendFile.extraRoots` | string[] | `[]` | Extra allowed root directories |

## Built-in Commands

| Command | Description |
|------|------|
| `/new` (aliases `/reset` `/clear`) | Start a new session (admins only) |
| `/compact` | Compact session history (admins only) |
| `/model` | View or switch model (admins only) |
| `/preset` | View or switch agent preset (admins only) |
| `/persona` | List and switch personas per chat (admins only) |
| `/人格分析` (alias `/persona-analysis`) | Analyze the @-mentioned member and reply with their persona profile (admins only): `@bot /人格分析 @Alice`; accepts `<nickname\|openid>` as a fallback, and profiles the other person in DMs |
| `/tools` | Diagnostic: show the current persona's tool binding and host tool list (admins only, hidden from the command menu); bind tools from the settings panel dropdown instead |
| `/memory` | Show per-chat memory and relationship stage (admins only); `/memory add <text>`, `/memory del <n>`, `/memory clear` |
| `/whoami` | Show your openid and resolved identity for the current chat |
| `/stop` | Abort the current generation (admins only, hidden from help) |
| `/bot-ping` | Network latency test (transport & processing time) |
| `/bot-version` | View version info (model details are admin-only) |
| `/bot-status` | View current session status (admins only) |
| `/bot-help` | List commands available to your identity |

> Admin-only commands are hidden from `/bot-help` and rejected with a role message for friends/strangers.
> When the `identity` lists are empty, permission checks are disabled and everyone keeps full access.

## Core Modules

```
src/
├── index.ts                    # Cordis plugin entry (async apply)
├── config.ts                   # Config schema
├── types.ts                    # Global types
├── setup.ts                    # Credential binding (QR)
├── gateway/                    # Gateway assembly
│   ├── bootstrap.ts            # Startup wiring (session/event listeners, etc.)
│   └── middleware-setup.ts     # Middleware chain config
├── transport/                  # Transport layer
│   ├── inbound.ts              # QQ inbound message → agent.followup()
│   ├── outbound.ts             # session/event → QQ sendMarkdown
│   ├── outbound-buffer.ts      # Streaming buffer
│   ├── streaming-writer.ts     # Streaming writer
│   ├── reply-target.ts         # Reply target resolution
│   ├── msgid-cache.ts          # Passive reply msgid cache
│   ├── reply-limiter.ts        # Passive reply rate limiter
│   ├── tool-presenter.ts       # Tool-call presentation
│   └── chunker.ts              # Markdown chunking
├── session/                    # Session management
│   ├── session-manager.ts      # QQ peer → Agent mapping
│   └── idle-evictor.ts         # Idle eviction
├── model/                      # Model routing
│   ├── model-resolver.ts       # Route resolution
│   ├── prefs-store.ts          # Per-peer preference persistence
│   └── settings-reader.ts      # settings.yaml read-only
├── personas/                   # Persona presets
│   ├── persona-utils.ts        # Persona resolution + system prompt sections
│   └── persona-tools.ts        # Tool whitelist → tools.restrict hard constraint
├── memory/                     # Long-term memory & relationship state
│   ├── memory-store.ts         # ~/.dsh-qqbot/memory.json persistence
│   └── memory-prompt.ts        # Relationship stage / fact capture / prompt section (order 87)
├── features/                   # Interaction features
│   ├── question-channel.ts     # ask_user_question Q&A channel
│   ├── approval-channel.ts     # approval confirmation channel
│   ├── answer-parser.ts        # Answer parsing
│   ├── persona-archive.ts      # Group persona archive (~/.dsh-qqbot/persona-archive.json + middleware)
│   ├── persona-profile-analysis.ts # Structured prompt / JSON parsing / Markdown rendering
│   ├── persona-analyzer.ts     # Single-member analysis (cross-chat aggregation + model call)
│   ├── persona-auto-analyzer.ts # Threshold-triggered queue (serial / cooldown / timeout)
│   ├── persona-profiles.ts     # Analysis store (persona-profiles.json) + panel filter view
│   └── persona-analysis-tool.ts # qqbot_analyze_persona member analysis
├── media/                      # Media
│   ├── vision-tool.ts          # Image vision understanding
│   ├── send-file-tool.ts       # Send local files
│   └── media-cleaner.ts        # Media TTL cleanup
├── middleware/                 # Middleware
│   ├── question-answer.ts      # Q&A answer handling
│   └── attachment.ts           # Attachment handling
├── shared/                     # Shared utilities
│   ├── utils.ts                # Common helpers
│   ├── scope.ts                # scope/peer extraction
│   └── send-helper.ts          # Chunked send
└── commands/                   # Slash commands
```

## Session Routing

sessionKey: `qqbot:${appId}:${scope}:${peerId}`; a UUID session id is minted for new sessions and persisted to `model-prefs.json`, resuming by the persisted id after restarts; pre-0.6 sessions keep their originally derived ids.

Resolution strategy: in-process reuse → persisted resume → fresh create.

## Design Principles

- **Pure Cordis plugin** — follows the dsh "Plugins, not loop changes" principle
- **Declarative dependencies** — `inject = ['agents']`, no direct coupling to other plugins
- **Session isolation** — one independent Agent per QQ direct user / group
- **Preset support** — mount presets (toolkits, prompts, etc.) via the `agent-presets` service
- **Idle eviction** — auto-dispose Agents on timeout to prevent memory leaks
- **Member persona analysis** — a rolling per-chat archive (`persona-archive.json`) auto-builds/refreshes profiles (`persona-profiles.json`) once a member reaches the message threshold; `/人格分析 @member` or `qqbot_analyze_persona` profiles members on demand; the settings panel filters by nickname/openid/trait
- **Markdown output** — replies sent as Markdown with code-block/table-aware chunking
- **Image understanding** — supports `qqbot_describe_image` vision to analyze images sent by users
- **Problem solving** — supports `qqbot_solve` to solve exam/homework problems (question text or screenshot, using the session's current model) and returns a fixed answer + worked-steps layout
- **Text utilities** — `qqbot_translate`, `qqbot_summarize`, `qqbot_explain` (concepts/code/errors) and `qqbot_rewrite` polish, all using the session's current model with no extra dependencies
- **Kaomoji** — personas can enable `expressions.kaomoji` with a mood-grouped style (daily / genki / chuuni / cat / tsundere / soft / cool / maid); rules are injected into the prompt, no tool call required
- **File sending** — supports `qqbot_send_file` to send local files to users (path allowlist enabled by default)
- **Safe tool defaults** — QQ sessions only allow plugin tools plus read-only web access and question prompts; host file-system and shell tools stay off-limits
- **Question interaction** — supports `ask_user_question` with inline keyboard buttons (mutually exclusive) or numbered replies, one question at a time with timeout
- **Approval confirmation** — supports `approval/request` to ask for user confirmation on critical actions via allow/deny buttons

## Local Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Dev mode (watch)
pnpm dev

# Debug via --patch
export QQBOT_APPID="xxx" QQBOT_SECRET="xxx"
npx @deepseek-ai/dsh web --patch /path/to/dsh-qqbot/cordis.dev.yml
```

## License

[MIT](./LICENSE)
