# Features

[简体中文](FEATURES_CN.md) | English

Codex QQ Bot is a local message hub: OneBot provides QQ transport, the Hub owns permissions, context, tools, memory and delivery, and Codex CLI performs reasoning and tasks. QQ, NapCat and LLBot binaries are not distributed by this repository.

## QQ transport and triggers

- OneBot 11 HTTP API and reverse HTTP webhooks.
- Group traffic is limited to `qq.allowedGroups`; private and group chats have separate context.
- Ordinary group messages trigger on mention, reply to the Bot or a poke targeting the Bot.
- Recognized slash commands do not require a mention inside allowlisted groups. Proactive interest uses a separate constrained path.
- Message, user and group IDs are normalized, and duplicate OneBot events are dropped before domain policy.
- Current-scope reply context identifies human speakers as `current group card/nickname + QQ number`. Mention targets retain their QQ numbers and are enriched from the current group's member profile when an inline name is unavailable. One QQ number remains the stable person identity across groups, while different group cards remain group-scoped.
- JSON/XML share cards and nested merged-forward records become bounded, readable, untrusted context.

## Codex Agent reply path

Every normal QQ reply uses the same Agent pipeline:

```text
trigger policy
  -> recent and related chat, images and memory
  -> first Codex round
  -> optional bounded internal tool rounds
  -> visible final response
  -> text/image/file/sticker/multi-bubble delivery
```

A simple conversation can finish in one round. Missing history, web facts, memory or management actions can enter the internal tool loop. Tools retain the original sender's permissions and cannot elevate the model to owner. Hidden markers such as `[[qq_done]]`, `[[qq_command:...]]` and memory patches are validated and stripped before delivery.

Codex defaults to two active child processes and 32 pending jobs. Each group or private scope has one complete reply lifecycle; later messages queue into a combined follow-up. `/stop` and `/新对话` cancel active work and clear that scope's queue.

Codex deadlines are selected by task type instead of sharing one constant. Defaults are two minutes for ordinary replies, three minutes for vision replies, 90 seconds for context summaries, 90 seconds for self-persona work, five minutes for owner file tasks, and ten minutes for image generation. Each class has an independent environment override. Runtime state and logs report the selected task type and deadline, while `/stop` can still terminate work early.

## Context and memory

| Layer | Content | Storage |
| --- | --- | --- |
| Rolling context | Recent human and Bot messages per scope | `data/qq-memory.json` |
| Conversation transcript | Bounded messages and image references since `/新对话` | Runtime state and local persistence |
| Social memory | Group-scoped impressions plus bounded cross-group person impressions keyed by QQ number | `data/qq-conversation-memory.json` |
| Public long-term memory | Stable, reusable, non-sensitive facts | `data/qq-public-memory.json` |
| Adaptive statistics | Group rhythm, structural style and interaction counts | `data/qq-personas.json` |
| Global self-persona | Privacy-filtered summaries from individual scopes | `data/qq-self-persona.json` |
| Unified memory | QQ and durable local context | Data owned by `src/unified-memory/` |

`/新对话` clears short context but preserves long-lived social impressions. Group impressions stay inside their group. A person's stable, non-sensitive impression can follow the same QQ number across shared groups, but raw group conversation and group-private facts are not copied into that person layer. Existing version-1 per-group person impressions migrate into the version-2 identity layer. Explicit memory-clear APIs remove the selected longer-lived layer. Writes are bounded, privacy-filtered, serialized and atomically replaced.

Recurring QQ behavior uses persisted wall-clock timestamps instead of process uptime. The scheduler checks immediately at Hub startup, again when the QQ channel is enabled, and then at the configured poll cadence. If the device or Hub was stopped past a due time, it performs one catch-up check; it never replays every missed interval in a burst. After a catch-up action completes, its next interval starts from completion time. Ordinary group-interest cycles persist their pending count, cycle start and bounded latest candidate in `data/qq-memory.json`; adaptive reviews, cold/private interest and self-persona summaries/generation use the timestamps in their existing persona stores. Manual `/总结聊天记录` and unified-memory read/write remain event-driven rather than being turned into artificial recurring jobs.

## Adaptive social behavior

- `qq-human-behavior` derives anonymous short-window message length, rate, bursts, media/emoji, reply/mention, question and punctuation signals without copying a member's wording.
- `qq-adaptive-learning` persists activity, structure, interaction distance and post-Bot feedback to weakly tune length, sticker probability, bubble rhythm and delay. It also treats consecutive human messages no more than two minutes apart as active transitions and records the share whose sender changes as the group-level interjection rate.
- A persisted 24-hour review clock can produce at most five compact style improvements and replaces the previous set to keep prompts bounded.
- The global self-persona is generated only from privacy-filtered scope summaries. Raw private content must not cross scopes.
- Adaptive data changes style and cadence; it never bypasses allowlists, permissions or the interest judge.

## Proactive interest

Three constrained paths exist:

1. **Ordinary group interest:** unmentioned messages enter a persisted per-group pending cycle. The first completed message or non-empty wall-clock minute threshold invokes an OpenRouter semantic judge. Empty cycles do not call a model, and a restart immediately checks an overdue non-empty cycle. A cycle restored from disk bypasses the normal online stale-topic discard exactly for that catch-up judge, so a long shutdown cannot silently consume the overdue work; new activity during the judge can still supersede its result.
2. **Cold-group interest:** learned activity, latest human/Bot traffic, unanswered output and activity windows gate a single short outreach message after a long quiet period. Silence is a valid outcome.
3. **Private interest:** interaction frequency, time since activity and unanswered Bot output dynamically tune probability and cooldown.

The ordinary group judge streams through OpenRouter with a strict JSON Schema containing `analysis`, `semanticIntent`, `shouldReply`, `interest`, `reason` and `replyStyle`. `semanticIntent` is bounded, untrusted supporting context describing what the speaker may mean and what they appear to expect the Bot to say or do; it cannot bypass the interest threshold by itself. Hub performs at most one format retry for structurally invalid provider output. Timeouts, HTTP errors and rate limits are not blindly retried. The timeout measures idle time before the first token or between token chunks, so an active stream may continue to completion under a final token cap.

The interest judge receives the learned group interjection rate, its active-transition sample count and the measurement window. These are timing references only: a high rate never triggers a reply by itself, and a low rate is not a hard silence rule. The structured model decision and interest threshold remain authoritative.

Proactive work does not force itself behind active generation. New activity suppresses stale results. Cold/private paths cannot invoke management tools, multi-bubble delivery or fallback chatter. State and decisions use the `interest` log category.

## Images, files, stickers and bubbles

- QQ images, screenshots, quoted images, share cards and bounded forwarded images can enter context.
- Explicit drawing/generation requests and reference-edit wording such as edit, modify, replace the background, add/remove an element, change the style, or draw another image from this reference take the image-task path instead of the ordinary vision path. When the current or quoted message contains an image, a short instruction such as “change the background to blue” also passes that image to the drawing model as a reference; a plain “look at this image” remains a vision reply.
- The model can request local delivery through `[[qq_image:...]]`, `[[qq_file:...]]` and `[[qq_sticker:...]]`. Sticker delivery is selectable per reply: combine text and sticker in one QQ message, send only the sticker, or place the standalone multi-bubble separator between text and the sticker marker to send them as two ordered messages.
- File/image tasks use `runtime/qq-task-workspaces/<request>/input|output`. Only real paths inside the current request's `output/` pass delivery validation, preventing arbitrary file disclosure and symlink escapes.
- Local stickers, QQ account favorites and downloaded metadata form a bounded catalog. Animated items support bounded frame inspection, with labels stored separately.
- Sticker-favorite judgment runs only inside an already-triggered lifecycle; an ordinary untriggered sticker does not call a model by itself.
- A standalone `|||` splits consecutive bubbles. For separate sticker delivery, the text bubble is sent first and the sticker-only bubble follows as its own message. Separator, count and delay are configurable, and adaptation changes rhythm only for suitable social replies.

## Commands, permissions and social tools

Common public commands include `/菜单`, `/新对话`, `/stop` and `/总结聊天记录`.

Owner capabilities include status/configuration, model and reasoning selection, proactive policy, group allowlists, bans, command permissions, moderation, request handling and notifications. When the local NapCat social extension supports them, owner-only tools can also initiate friend/group requests and perform QQ Space reads or writes. On NapCat 4.18.9, active friend adds use the native two-argument `reqToAddFriends(QQ number, verification text)` signature; the bridge selects the verification message or question answer as appropriate and uses the structured-object form only when the runtime explicitly exposes a one-argument method. A `submitted` result means the corrected native call completed without a reported error, not that the peer has already accepted the request.

Non-owner menu visibility and execution come from the same permission keys. Owner IDs and the Bot itself cannot be demoted, banned, muted or kicked by delegated users.

## Web lookup

The Hub performs QQ web lookup independently of this chat interface. Configured provider order can include Tavily, Bing, Baidu, 360, Sogou and DuckDuckGo, with `balanced`, `china`, `global`, `tavily` and `privacy` presets. Results remain untrusted material and cannot override sender permissions or system policy.

Inspect the effective provider, attempts and recent errors through `/api/maintenance` and `search` logs.

## Dashboard, API and logs

The local dashboard exposes service/channel state, allowlists, models, memory, adaptive learning, proactive interest, maintenance, structured log filters, language, theme and responsive layouts. Its persistent LAN switch creates a management token; the token can only be retrieved from a loopback-loaded dashboard. A separate, default-off Cloudflare Quick Tunnel switch can create a temporary HTTPS address without rebinding the Hub away from loopback. Remote management APIs still require the same token, while tunnel start/stop and token-copy controls remain local-only.

Automatic polling keeps server-backed readouts current without overwriting a control that is being changed or unsaved Bot settings. The current browser tab keeps Bot-setting drafts, the group-ID draft, memory tab/search/expanded groups, and log filters/pause/follow/scroll context in session storage, then restores them after a full page reload. A successful save clears its draft and the returned server state remains authoritative.

Core read endpoints:

```text
GET /api/state
GET /api/maintenance
GET /api/logs
GET /api/memory
```

JSONL logs support level, category, trace, group, sender, query, time and latency filters. A QQ lifecycle shares one trace from inbound routing through judge, search, Codex and delivery.

## macOS client

The native macOS client is a WebKit wrapper around the same local dashboard and QQ/OneBot Hub used by the browser. It does not read the Messages database, poll iMessage, require Messages Automation and Full Disk Access, or expose macOS-only proxy, display, keep-awake or desktop-control features.

## Explicit boundaries

- This is not the official QQ Bot OpenAPI or a hosted public Bot service.
- QQ, NapCat and LLBot installers are not included.
- QQ risk controls, QR login, verification and OS permissions are not bypassed.
- LAN/public access and unauthenticated remote management are disabled by default.
- Adaptive behavior must not imitate or expose a specific member's private wording or facts.
