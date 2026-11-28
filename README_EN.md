<div align="center">

<img width="120" src="https://img.shields.io/badge/QQ_Bot-blue?style=for-the-badge" alt="QQ Bot" />

**A QQ bot plugin for [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (dsh), connecting a regular QQ account through OneBot 11.**

[![License](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![GitHub](https://img.shields.io/badge/github-xiong--universe%2Fqqbot-blue)](https://github.com/xiong-universe/qqbot)

**English | [简体中文](./README.md)**

</div>

## Contents

- [What It Is](#what-it-is)
- [Features](#features)
- [Core Concepts](#core-concepts)
- [Installation](#installation)
- [Connecting QQ](#connecting-qq)
- [Message Pipeline](#message-pipeline)
- [Configuration](#configuration)
- [Commands](#commands)
- [Tools](#tools)
- [Data Files](#data-files)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Further Reading](#further-reading)

## What It Is

dsh-qqbot is a Cordis plugin for deepseek-harness that turns QQ into a frontend channel for a dsh agent. Every private chat and every group gets its own dsh session: incoming messages run one agent turn, and the model output is sent back to QQ.

This project uses **OneBot 11** to connect a regular QQ account (NapCat, LLOneBot, or any compatible implementation). It does not depend on a bot platform account or review process.

- Repository: GitHub <https://github.com/xiong-universe/qqbot> | Gitee <https://gitee.com/x17598923823/qq-bot>
- Version: `0.12.0` (send `/bot-version` in QQ to check the running version)
- Runtime: Node.js >= 22.19 (voice replies use the built-in WebSocket)

> Connecting a regular QQ account through a third-party protocol carries account risk (rate limits, bans, etc.). Use a secondary account and follow the platform rules. This project does not provide accounts and is not responsible for account risk.

## Features

- **OneBot 11**: works with NapCat, LLOneBot, and other OneBot 11 implementations for private and group chats.
- **Session isolation**: one dsh agent per private user or group, with idle eviction.
- **Personas**: switch with `/persona`; each persona can bind a tool allowlist enforced at runtime.
- **Long-term memory**: per-session interaction count, relationship stage, notes, plus a cross-session person profile keyed by personId.
- **Group member profiles**: archive group/private messages and analyze a member after enough activity; also available via `/persona-analysis` or `qqbot_analyze_persona`.
- **Proactive group chat**: for non-mention messages, apply probability, cooldown, and quota gates, then let the model decide whether speaking would interrupt a conversation; the model may also output `[SILENT]`.
- **Voice replies**: after `qqbot_voice`, the turn is synthesized and sent as a QQ voice message; failures fall back to text.
- **Sticker evolution**: collect group images automatically, pick and send by context, and periodically recompute heat and evict stale stickers.
- **Rich media**: image/video download, vision understanding (`qqbot_describe_image`), and file sending (`qqbot_send_file`).
- **Settings panel**: connection, access control, identity, member profiles, conversation, voice, stickers, model, personas, and plugin updates.
- **Plugin updates**: detects git / npm / local installs, compares with the remote, and updates with HMR reload.

## Core Concepts

### 1. OneBot connection

The plugin talks to QQ through OneBot 11. Prepare an OneBot implementation and enable:

- **HTTP API**: used by the plugin to send messages and query information.
- **Forward WebSocket**: used by the plugin to receive message events.

Set the backend explicitly:

```yaml
backend: onebot
```

Then configure the connection:

```yaml
onebot:
  httpUrl: http://127.0.0.1:3000
  wsUrl: ws://127.0.0.1:3001
  accessToken: ''
  selfId: ''
```

- Leave `selfId` empty to let the plugin read the bot QQ number at startup.
- Keep `accessToken` identical to the OneBot implementation's token; leave it empty if none is configured.
- On Windows desktop, the settings panel can download/start/stop NapCat. On other platforms, deploy your own OneBot implementation.
- How many messages the plugin receives depends on the OneBot implementation, account permissions, and rate limiting. The same applies to non-mention group messages used for archiving and proactive chat.

### 2. Sessions

- `sessionKey`: `qqbot:${namespace}:${scope}:${peerId}`
  - Private chat: `scope=c2c`, `peerId=user QQ number`
  - Group chat: `scope=group`, `peerId=group number`
  - `namespace` is derived from the OneBot account (`onebot-<selfId>`); switching accounts switches the whole session/memory namespace.
- Each key maps to one dsh agent. The plugin reuses an in-process agent first, then restores from disk, then creates a new one.
- Idle sessions are evicted after 30 minutes (`sessionIdleTimeout`).

### 3. Personas

A persona describes "who the bot is and how it speaks"; shared rules belong in `globalPrompt`. Precedence:

```
per-session /persona > config.defaultPersona > no persona (globalPrompt only)
```

A persona can bind a tool allowlist. Omitting `tools` uses the default allowlist; `tools: []` means no tools. Tool permissions are hard constraints, not prompt suggestions.

### 4. Memory vs. member profiles

These are two independent stores:

| | Long-term memory (`memory`) | Member profiles (`personaAnalysis`) |
|---|---|---|
| Stores | Relationship stage, interaction count, self-described notes, person profile | Raw messages, analyzed profiles |
| Scope | Per session + per personId | Per personId, merged across groups and private chats |
| Purpose | Remember "what we talked about" | Understand "who this person is" |
| Storage | `memory.onebot.json` | `persona-archive.json` / `persona-profiles.json` |

Memory is isolated by OneBot account namespace. The same person can still be merged into one person profile across groups and private chats.

### 5. Proactive group chat

Only applies to messages the bot receives **without being mentioned**. It does not reply to every message:

```
observe → record memory → candidate batch (debounce 3s)
        → probability 6% + cooldown 180s + 3/hour, 15/day
        → model judges "two-person conversation / closed topic → stay silent"
        → model may also output [SILENT]
```

This requires your OneBot implementation to deliver non-mention group messages. If only mentions are delivered, proactive chat will never trigger.

## Installation

### Option 1: Desktop app (recommended)

1. Open **Plugins → Add plugin**, enter the repository URL, and install/start it:
   - Gitee (faster in China): `https://gitee.com/x17598923823/qq-bot`
   - GitHub: `https://github.com/xiong-universe/qqbot`
2. Open **Settings → QQ Bot**, choose **Regular QQ account** as the connection method.
3. Fill in `httpUrl`, `wsUrl`, `accessToken`, and `selfId`; save and the plugin reloads.
4. If you want the panel to manage NapCat, download and start it on the same page.

<img src="./assets/docs/install.png" alt="Add plugin" width="560" />

### Option 2: CLI

```bash
# Install from this repository (recommended; follows repository updates)
npx @deepseek-ai/dsh plugin --profile qqbot add https://gitee.com/x17598923823/qq-bot.git

# Start
npx @deepseek-ai/dsh --profile qqbot
```

After a CLI install, add the OneBot settings to the profile's `cordis.patch.yml`:

```yaml
backend: onebot
onebot:
  httpUrl: http://127.0.0.1:3000
  wsUrl: ws://127.0.0.1:3001
  accessToken: ''
  selfId: ''
```

### Option 3: Local source / `--patch`

```bash
git clone https://github.com/xiong-universe/qqbot
cd qqbot
pnpm install && pnpm build

# Install to a profile from a local path
npx @deepseek-ai/dsh plugin --profile qqbot add /path/to/qqbot

# Or point a running profile at the source (OneBot config still lives in the profile patch)
npx @deepseek-ai/dsh web --profile qqbot --patch /path/to/qqbot/cordis.dev.yml
```

`lib/` is committed, so installing the repository does not require a build. After changing `src/`, run `pnpm build` again.

## Connecting QQ

### 1. Prepare an OneBot implementation

Using NapCat as an example:

1. Install NapCat and log in with the bot QQ account (the desktop panel can manage it for you).
2. Open its WebUI/config and enable:
   - HTTP server (default `http://127.0.0.1:3000`)
   - Forward WebSocket server (default `ws://127.0.0.1:3001`)
3. If you set a token, put the same token in `onebot.accessToken`.
4. Confirm the bot QQ number. The plugin can read it automatically, or you can set `onebot.selfId`.

LLOneBot and other implementations work the same way as long as they support the OneBot 11 HTTP API and forward WebSocket.

### 2. Point the plugin at OneBot

```yaml
backend: onebot
onebot:
  httpUrl: http://127.0.0.1:3000
  wsUrl: ws://127.0.0.1:3001
  accessToken: ''
  selfId: ''
```

Watch the logs after saving: you should see a successful OneBot connection and a ready bot account. Send `/bot-ping` in QQ to verify the round trip.

### 3. Private and group chats

- Private chat: message the bot QQ account directly.
- Group chat: mentioning the bot is required by default (`requireMention: true`).
- To let the bot observe group chat and occasionally join in, the OneBot implementation must deliver non-mention group messages, and `proactive` must be enabled (see below).
- If a group never responds, first check whether OneBot receives events, then check access control and the mention gate.

## Message Pipeline

### Inbound

```
QQ client
   │
   ▼
OneBot implementation (NapCat / LLOneBot)
   │  HTTP API + forward WebSocket
   ▼
Plugin transport
   │
   ▼
SDK middleware chain (order below)
   │
   ▼
handleInbound → build agentBody → SessionManager.getOrCreate → agent.followup()
   │
   ▼
dsh agent loop → LLM
```

Middleware order (`src/gateway/middleware-setup.ts`):

1. `errorHandler` — error fallback
2. `messageFilter` — bot echoes / deduplication
3. `accessPolicy` — private/group access control
4. `historyBuffer` — group history buffer (before mention gate; non-mention messages count)
5. `personaArchive` — member profile archive (optional)
6. `quoteRef` — quote resolution/indexing
7. `attachmentProcessor` (current message) — media download
8. `historyMedia` — backfill media paths into history
9. `handleAmbientGroupMessage` — non-mention observation / proactive chat
10. `mentionGate` — group mention gate
11. `contentSanitizer` — strip mention markers / emoji tags
12. `rateLimiter` — three-level rate limiting
13. `slashCommand` — slash commands
14. `questionAnswer` / `approvalAnswer` — pending question/approval interception
15. `concurrencyGuard` — per-peer serialization + message merging
16. `typingIndicator` — typing state
17. `attachmentProcessor` (quoted message) — quoted media
18. `envelopeFormatter` — history + quote + sender assembly
19. `handleInbound` — final inbound handling

> Proactive handling must run **before** `mentionGate`: the SDK stops the chain on a non-mention group message, so later handlers would never see it.

### Outbound

```
agent session/event
   │
   ▼
outbound.routeSessionEvent()
   │  text / stream frames / tool display / deliverables
   ▼
chunker → OneBotSender.sendMarkdown
   │
   ▼
OneBot HTTP API
```

- Streaming uses `agent/assistant-stream`; group chats always disable streaming.
- When the model outputs `[SILENT]`, the outbound layer drops the message entirely.
- Voice turns: after `qqbot_voice`, the turn is synthesized and sent as voice; the same text is not sent again.

### System prompt layers

The plugin appends sections through `system-prompt/assemble`, merged by order:

| order | Content | Source |
|-------|---------|--------|
| 80 | Global prompt | `globalPrompt` |
| 82 | Identity | `identity` |
| 84 | Bot self-name / QQ nickname | `names.json` |
| 85 | Persona prompt + kaomoji | `personas[]` |
| 86 | Persona tool allowlist | `personas[].tools` |
| 86.5 | Vision instructions | `vision.enabled` |
| 87 | Session memory + person profile | `memory` |
| 88 | Voice reply instructions | `voice` |
| 89 | Sticker instructions | `sticker` |
| 90 | Management instructions | `qqbot_control` |

Assembly lives in [src/session/prompt-assembly.ts](./src/session/prompt-assembly.ts), separate from the session lifecycle.

## Configuration

Configuration normally lives in the profile's `cordis.patch.yml` (the desktop settings panel writes it). Minimal example:

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
      [Multi-message rule]
      - Use the fixed delimiter ||| to split one reply into multiple bubbles
      - Do not split normal answers; at most 3 bubbles per turn
```

> `name` is the plugin package name; install it from this repository as described above. The settings below go directly under `config`.

### Core

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `backend` | `onebot` | must be set explicitly | Transport backend |
| `provider` | string | host default | LLM provider |
| `model` | string | host default | Model name |
| `preset` | string | host default | Agent preset id |
| `cwd` | string | `~/.dsh-qqbot/workspace` | Agent working directory |
| `requireMention` | boolean | `true` | Require a mention in group chats |
| `globalPrompt` | string | `''` | Prompt shared by all sessions |
| `personas` | array | `[]` | Persona presets |
| `defaultPersona` | string | `''` | Default persona id |
| `textChunkLimit` | number | `4500` | Max characters per message |
| `streaming` | boolean | `true` | Enable streaming (group chats always disable it) |
| `replySplitMode` | `none` / `delimiter` / `line` / `paragraph` | `none` | Reply splitting mode |
| `replySplitIntervalMs` | number | `0` | Delay between split messages (ms) |
| `sessionIdleTimeout` | number | `1800000` | Idle session eviction (ms) |
| `maxQueue` | number | `20` | Concurrency queue limit |
| `processingTimeoutMs` | number | `1800000` | Per-turn processing timeout (ms) |
| `askTimeoutMs` | number | `300000` | Pending question timeout (ms) |
| `historyLimit` | number | `10` | Group history buffer size |
| `showToolResults` | boolean | `false` | Show successful tool results (errors are always shown) |
| `debug` | boolean | `false` | Debug logging |

`replySplitMode: delimiter` is recommended: the delimiter is `|||`; once it appears, remaining newlines in the same turn are also split. Code blocks and consecutive table rows are not split.

### OneBot

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `onebot.httpUrl` | string | `http://127.0.0.1:3000` | HTTP API URL |
| `onebot.wsUrl` | string | `ws://127.0.0.1:3001` | Forward WebSocket URL |
| `onebot.accessToken` | string | `''` | Access token |
| `onebot.selfId` | string | `''` | Bot QQ number; read automatically when empty |

### Personas and expression

```yaml
defaultPersona: assistant
personas:
  - id: assistant
    name: Assistant
    prompt: You are a precise, concise assistant. Lead with the conclusion.
  - id: catgirl
    name: Catgirl
    prompt: You are a cute catgirl. End sentences with "meow".
    tools: []
    expressions:
      kaomoji:
        enabled: true
        style: cat
  - id: media
    name: Media helper
    prompt: You are good at reading images and sending files.
    tools:
      - qqbot_describe_image
      - qqbot_send_file
```

- `id`: letters/digits/`-`/`_`, unique in the list; `name` is shown in menus; `prompt` is the persona system prompt.
- `tools`: omitted = default allowlist; `[]` = no tools; listed names are intersected with the default allowlist. Host tools outside the allowlist (`read`, `write`, `pwsh`, `bash`, etc.) do not become available.
- `expressions.kaomoji`: requires explicit `enabled: true`; styles: `daily` / `genki` / `chuuni` / `cat` / `tsundere` / `soft` / `cool` / `maid`; supports `custom` and `maxPerReply` (1–3).
- `expressions.voice`: overrides global voice id, rate (0.5–2), volume (0–100), and instruction.
- A persona switch applies to the next message, no `/new` required; tool bindings are rebound at the same time.

### Identity and permissions

```yaml
identity:
  enabled: true
  ownerOpenIds: []
  adminOpenIds: []
  friendOpenIds: []
```

- Put QQ numbers (OneBot sender ids) in these arrays. In most OneBot implementations the same account has the same id in private and group chats, so you usually do not need to add it twice.
- If all three lists are empty, permission control is considered disabled and everyone can use all commands (this prevents locking yourself out).
- Identity tags only affect wording and tone; they do not relax `access` control.
- Send `/whoami` in QQ to see the current QQ number / group number and the resolved identity.

### Access control

| Key | Default | Description |
|-----|---------|-------------|
| `access.c2cMode` | `open` | `open` / `allowlist` / `disabled` |
| `access.c2cAllow` | `[]` | Private allowlist (QQ numbers) |
| `access.groupMode` | `open` | `open` / `allowlist` / `disabled` |
| `access.groupAllow` | `[]` | Group allowlist (group numbers) |

### Long-term memory

```yaml
memory:
  enabled: true
  autoCapture: true
  maxNotes: 40
  llmExtract: true
  extractThreshold: 8
  aliases: []
```

- Data is stored in `~/.dsh-qqbot/memory.onebot.json`, independent of session history; `/new` and restarts do not clear it.
- `autoCapture`: rule-based extraction from explicit self-descriptions such as "my name is..." or "I like..."; no extra model call.
- `llmExtract`: asynchronous LLM extraction on top of the rule-based path; `extractThreshold` is how many new messages are batched before one extraction.
- `aliases`: manual alias groups inside the same account namespace, merged into one person profile at startup.
- Relationship stages are derived from interaction count: new (<5) → familiar face (<20) → familiar (<60) → close (<200) → very close.
- `/memory` is admin-only: view, `add`, `del`, `clear`.

### Member profiles

```yaml
personaAnalysis:
  enabled: true
  maxMessages: 300
  retentionDays: 30
  autoAnalyze: true
  autoAnalyzeThreshold: 20
```

- Data stays local: raw messages in `persona-archive.json`, analysis results in `persona-profiles.json`.
- Automatic analysis is queued per personId, with a 10-minute failure cooldown and a 120-second timeout; it never blocks replies.
- Recording happens after access control and before the mention gate, so non-mention group messages are archived without triggering a reply.
- Only messages delivered by OneBot can be archived. If your implementation only forwards mentions, other group chat will not appear.

### Proactive group chat

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

- Disabled by default so an upgrade does not suddenly make the bot speak in groups.
- With `modelJudge: true`, the model decides whether joining is appropriate after the probability gate; two-person conversations usually stay silent.
- The model may also output `[SILENT]` for the turn; the outbound layer drops it.
- Requires OneBot to deliver non-mention group messages; otherwise only mentioned messages can trigger a reply.

### Voice replies

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

- If `voice.enabled` is false **or** `apiKey` is empty, voice is fully disabled: `qqbot_voice` is not registered, nothing is synthesized, and no voice is sent.
- The model decides when to send voice. The turn text is used for synthesis and is not sent again as text. Synthesis failures fall back to text.
- A persona can override voice id, rate, volume, and instruction via `expressions.voice`.
- Instructions are layered, not replaced: turn direction + persona/global instruction + spoken-language hint, capped at 400 characters total.
- Runtime requires Node 22+ (built-in WebSocket); on Node 20 voice is disabled even with an API key.
- The DashScope API key must have the corresponding TTS model permission enabled, otherwise the API returns `AccessDenied`.

<details>
<summary>Built-in voices and model generations (3.1 / 3.0)</summary>

- `qwen-audio-3.1-tts-flash`: supports 26 built-in 3.1 voices.
- `qwen-audio-3.1-tts-plus`: only the 4 flagship voices `longanfengyue_v3.1` / `longanlingxin_v3.1` / `longanhuan_v3.1` / `xunanchuan_v3.1`, plus 3.1 cloned/designed voices.
- `qwen-audio-3.0-tts-flash` / `qwen-audio-3.0-tts-plus`: kept for older configs. 3.0 built-in voice ids cannot be used with 3.1 models, and vice versa.
- 3.1 built-in voices always carry the `_v3.1` suffix. When switching generations, built-in voices with the same name are mapped automatically; cloned/designed voice ids are not changed.
- Custom voices (voice cloning / voice design) can be added through `voice.presets` or the "Custom voices" section of the settings panel: name + voice id, up to 20 entries.

</details>

### Non-voice expression

- **Kaomoji**: persona `expressions.kaomoji`; merged into the persona prompt at runtime, no tool call needed.
- **Stickers**: `sticker.enabled: true` enables collection, selection, and evolution; metadata lives in `~/.dsh-qqbot/stickers.json`, and images reuse `media/` by default.
- **Vision**: `vision.enabled` + `vision.provider` + `vision.model` registers `qqbot_describe_image`.
- **File sending**: `sendFile.restrictPaths` enables a path allowlist (`media` + agent cwd + `extraRoots`) by default; `sendPresentedFiles` controls whether `present` deliverables are sent at the end of a turn.

## Commands

| Command | Description | Permission |
|---------|-------------|------------|
| `/new` (`/reset` `/clear`) | Start a new session and clear context | Admin |
| `/compact` | Compact session history while keeping context | Admin |
| `/model` | View or switch model | Admin |
| `/preset` | View or switch agent preset | Admin |
| `/persona` | View or switch persona; `default` follows the default, `off` disables it for this session | Admin |
| `/persona-analysis` | Analyze the mentioned group member; a nickname or QQ number also works | Admin |
| `/tools` | Diagnose persona tool bindings and host tool availability | Admin |
| `/memory` | View or manage long-term memory for this session | Admin |
| `/whoami` | Show the current QQ number / group number and identity | Everyone |
| `/stop` | Stop the current generation | Admin |
| `/bot-ping` | Network latency check | Everyone |
| `/bot-version` | Show version (model hidden for non-admins) | Everyone |
| `/bot-status` | Show current session status | Admin |
| `/bot-help` | List available commands by identity | Everyone |

## Tools

Default allowlist:

- Plugin tools: `qqbot_solve`, `qqbot_describe_image`, `qqbot_send_file`, `qqbot_translate`, `qqbot_summarize`, `qqbot_explain`, `qqbot_rewrite`, `qqbot_analyze_persona`, `qqbot_pick_sticker`, `qqbot_save_sticker`, `qqbot_send_sticker`, `qqbot_list_stickers`, `qqbot_update_sticker`
- Management tool: `qqbot_control` (owner/admin can change personas, memory, and sessions in natural language)
- Host read-only capabilities: `ask_user_question`, `web_search`, `web_fetch`

Host file access, command execution, sub-agents, scheduled tasks, and similar tools are **not** in the allowlist and are neither visible nor callable from QQ sessions. Voice and sticker tools are message-delivery capabilities and are always allowed, regardless of persona allowlists.

## Data Files

All under `~/.dsh-qqbot/` by default:

| File / directory | Content |
|------------------|---------|
| `memory.onebot.json` | Session memory and person profiles (keyed by QQ number) |
| `identities.json` | Identity aliases for one person across sender ids |
| `names.json` | Bot self-name / QQ nickname |
| `model-prefs.json` | Per-peer model / preset / persona / sessionId |
| `persona-archive.json` | Group/private message archive |
| `persona-profiles.json` | Analysis results |
| `stickers.json` | Sticker metadata |
| `workspace/` | Default agent working directory |
| `media/` | Temporary media (cleaned by TTL) |
| `napcat/` | NapCat installation managed by the panel |

OneBot connection settings such as `accessToken` live in the profile's `cordis.patch.yml`.

## Development

```bash
pnpm install       # install dependencies
pnpm build         # tsc + client bundle
pnpm dev           # tsc --watch
pnpm test          # vitest run
pnpm lint          # eslint src/
```

For source debugging, keep OneBot settings in the profile's `cordis.patch.yml` and point the profile at the source with `--patch`:

```bash
npx @deepseek-ai/dsh web --profile qqbot --patch /path/to/dsh-qqbot/cordis.dev.yml
```

Conventions:

- Source imports use the `.ts` suffix; tests live next to source (`*.test.ts`).
- `lib/` is a committed build artifact. After changing source, rebuild so users installing from the repository get the new code.
- Current test baseline: 754 tests, 750 passing; 4 pre-existing environment failures (3 Windows symlink `EPERM`, 1 NapCat non-Windows platform check), unrelated to business code.

## Troubleshooting

| Symptom | Check first |
|---------|-------------|
| No response in private or group chat | Is OneBot running? Do HTTP/WS ports and tokens match? Is `onebot.selfId` correct? Did the plugin connect in the logs? |
| Mentioned in a group but no reply | `requireMention`, access control, whether the bot was actually mentioned, and whether `mentionGate` blocked it in the logs |
| Member profiles are incomplete | Does OneBot deliver non-mention group messages? Check NapCat / LLOneBot group message reporting settings |
| Proactive chat never triggers | Are non-mention messages received? Is `proactive.enabled` true? Probability, cooldown, hourly/daily quotas may block it; the model may also choose silence |
| `/whoami` does not match the configured QQ number | Use the id printed by `/whoami`; in most implementations private and group sender ids are both QQ numbers |
| Memory looks mixed up or partially missing | Did `selfId` change? Different OneBot accounts use different namespaces and storage |
| `qqbot_voice` returns text instead of voice | Check the DashScope key's TTS permission, Node 22+, and the synthesis error in the logs |
| Settings panel changes do not apply | The panel writes to the profile's `cordis.patch.yml`; make sure the running plugin uses the same profile |
| Update says self-update is unsupported | `file:` / `link:` installs, `--patch` source loading, and fixed-commit dependencies do not follow the remote |
| Duplicate behavior / two copies installed | Keep only one plugin instance per profile; uninstall the old one and restart |

## Further Reading

- [ARCHITECTURE.md](./ARCHITECTURE.md) — code layers, directory map, module responsibilities, extension points, reading order
- [CHANGELOG.md](./CHANGELOG.md) — version history

## Feedback

- Issues: <https://github.com/xiong-universe/qqbot/issues> (include the `/bot-version` output and relevant logs)

## License

[MIT](./LICENSE)
