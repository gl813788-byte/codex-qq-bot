# Operations and Troubleshooting

[简体中文](OPERATIONS_CN.md) | English

This page starts after deployment. For installation, platform selection, Termux/PRoot, root rules, and interrupted-run recovery, use [One-click installation and environment plans](INSTALLATION.md). To have Codex execute and validate the work, use [Deploy with Codex](DEPLOY_WITH_CODEX.md).

```bash
./一键部署.command
```

## Distinguish the two `ncc` commands

| Entry | Purpose | Common commands |
| --- | --- | --- |
| `npm run ncc -- <command>` | Public repository setup/status helper | `setup`, `status`, `qq`, `groups`, `session`, `session-mode`, `start`, `logs`, and others |
| Global `ncc` | A machine-specific NapCat + Hub lifecycle controller | Run `ncc help` first; this machine may offer `all`, `connect`, `session`, `session-mode`, and `stop-hub` |

Public instructions use `npm run ncc -- ...` so deployment does not overwrite an existing global controller with the same name.

## Preflight

```bash
cd /root/Codex-QQ-Bot
node --version
codex --version
git status --short --branch
npm run verify
npm run ncc -- status
```

Require Node.js 20+, a zero verification exit code and readable configuration. A running process alone does not prove that Hub or OneBot is usable.

## Starting

### Let Codex start it

```text
Inspect and start Codex QQ Bot using docs/OPERATIONS.md. Distinguish the global ncc from the repository helper, preserve existing data/runtime/config and Git changes, and do not reset the worktree. After startup, verify the Hub, dashboard, OneBot get_login_info, QQ channel and error logs. Pause only if I must scan a QR code, then continue connection and acceptance testing.
```

### Repository entry

```bash
npm run ncc -- setup
npm run ncc -- start
```

- Linux: loads `config/local.env`, then runs `npm start` in the foreground. Stop with `Ctrl+C`.
- macOS: may use the project's launchd launcher.
- Direct `npm start`: does not source `config/local.env`; export variables in the current shell first.

For a long-running service, let Codex reuse the machine's established systemd, screen, launchd or container setup. Before adding a manager, document its working directory, environment source, logs and restart policy, then test a restart.

### Machine-specific full stack

If `ncc help` identifies the local NapCat controller:

```bash
ncc status
ncc all
ncc connect
```

`ncc all` starts NapCat and Hub. After the user scans QQ, Codex runs `ncc connect`. Do not mix arguments between the global and repository controllers.

On this configured machine the global controller starts QQ from the stable `NAPCAT_WORK_DIR` (default `/root/.local/share/napcat`). Relative QQ cache databases therefore stay outside whichever repository or shell directory invoked `ncc`; an explicit environment override may select another persistent directory.

Before startup, the machine controller reads `/proc/meminfo` `MemAvailable` once and selects a standard, balanced, or low-memory profile; it does not run a resident memory monitor. The profile constrains both QQ's V8 heap/renderer count and Hub's Node heap/Codex concurrency and queues. Use `ncc resources` to preview the selection. `ncc all` always starts both components in receiver-first order, and removes a newly started Hub if QQ startup fails. QQ and Xvfb run directly in separate `screen` sessions, with no background shell `wait` supervisor that can spin under Termux/PRoot.

Session mode can be managed from the QQ menu or `ncc`:

```bash
npm run ncc -- session
npm run ncc -- session-mode auto
npm run ncc -- session-mode persistent GROUP_ID
npm run ncc -- session-mode temporary private:QQ_ID
npm run ncc -- session-mode inherit GROUP_ID
```

On supporting machine-specific controllers, use `ncc session` and `ncc session-mode ...`. Omitting scope changes the default; a group ID or `private:QQ_ID` changes an override. A running Hub persists through `/api/qq/session-mode`; offline control safely updates `data/settings.json` for the next start.

Owners and Bot administrators can use cross-session operations directly in QQ:

```text
/跨会话 列表 [filter]
/跨会话 查看 group:GROUP_ID 最近30
/跨会话 发送 private:QQ_ID | message
```

The native Agent may also select a session focus for one turn; compatible history, memory, knowledge and QQ tools then operate on that target until focus changes or clears. Only Hub-known sessions resolve, ambiguous bare numbers are rejected, and a real send requires an explicit owner/administrator request.

Only the owner manages administrators:

```text
/Bot管理员
/Bot管理员 添加 QQ_ID
/Bot管理员 删除 QQ_ID
```

Administrators receive the full menu and Agent but cannot change the administrator list. Their file requests are judged and refused when they delete important files, overwrite critical source/config/data/credentials, damage `.git`, dependencies or runtime state, or request another ambiguous unrecoverable destructive action.

## Manual AI task center

QQ `/AI任务` and both NCC surfaces read the same task catalog and execute through a loopback-only management API:

```bash
npm run ncc -- ai-tasks
npm run ncc -- ai-run chat-summary GROUP_ID
npm run ncc -- ai-run scope-summary private:QQ_ID
npm run ncc -- ai-run style-review GROUP_ID --force
npm run ncc -- ai-run global-persona
npm run ncc -- ai-run knowledge-review --force
npm run ncc -- ai-run all GROUP_ID --full
```

Tasks are `chat-summary` (chat summary plus knowledge extraction), `scope-summary` (scope persona-evidence/memory summary), `style-review` (group style review), `global-persona` (global persona refresh), `knowledge-review` (two-model review of a due low-frequency slang item), and `all`. In QQ, send `/AI任务 TASK`; `/AI任务 强制 TASK` explicitly selects force mode.

A normal manual run bypasses the automatic schedule's due-time gate while retaining normal task data thresholds. `--force` additionally bypasses cooldown and normal sample thresholds. It never bypasses QQ owner/menu permissions, group allowlists, the loopback API restriction, concurrency locks, OneBot identity, or the requirement for actual data. A forced knowledge review only broadens candidate selection and still follows interest-model triage, main-model final review, and stale-change guards; it never deletes directly. These tasks use the current QQ model and existing task deadlines, and require a running Hub.

## Restart catch-up for recurring behavior

Recurring QQ domain work is based on timestamps saved in local state, not on how long the Node.js process has stayed alive. Hub startup immediately checks adaptive style reviews and self-persona summary/generation. Enabling the QQ channel immediately checks restored ordinary-interest cycles plus cold-group and private-interest due times. The normal poll then continues as a wake-up mechanism.

If the machine was off past a deadline, only one overdue run is performed. A restored ordinary-interest cycle is allowed to reach its catch-up judge even when the saved candidate is older than the normal online stale-topic limit; this one-time exception prevents a long shutdown from silently consuming the overdue check. Human activity arriving during an ordinary judge remains pending and enters rolling context; an approval still starts the main model against that latest context. When a cold group becomes due, the interest model chooses `silent`, `topic`, or `chatter`. A private candidate likewise sends its frequency prior and random variation roll to the interest model for the final start decision. Ordinary interjection, cold topic/chatter, and private outreach must all pass the enforced `interest approval -> main content` contract; a missing stage prevents delivery. Ordinary proactive judgment uses temperature `0.65`, and cold/private start judgment uses `0.8`. Low-frequency slang deletion is a long-evidence task: the interest model performs bounded triage at `0.15`, the main model reviews the full evidence, and failure in either stage keeps the entry. Conversation, impression and persona summaries plus knowledge extraction remain main-model work. A successful, silent, declined or failed completed check writes its completion timestamp according to that feature's retry policy, and the next interval starts there. Missed intervals are not replayed one by one, so recovery cannot produce a message burst. `/api/state` exposes the safe scheduler snapshot at `qq.periodic`; ordinary pending-cycle state is persisted inside `data/qq-memory.json`. Unified-memory reads/writes and manual chat summaries are event-driven and have no periodic deadline to catch up.

A confirmed delivered Bot bubble clears the group's pre-delivery ordinary-interest pending cycle, so cadence and minute timing restart only from later human messages. An in-flight old judge is superseded without consuming those later messages; human activity alone does not supersede an already-approved ordinary judge.

## Acceptance checks

```bash
curl -fsS --max-time 3 http://127.0.0.1:3789/api/state | jq .
curl -fsS --max-time 3 http://127.0.0.1:3789/api/maintenance | jq .
curl -fsS --max-time 3 -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:3789/
curl -fsS --max-time 3 http://127.0.0.1:3000/get_login_info | jq .
```

| Check | Pass condition |
| --- | --- |
| Hub | `/api/state` returns HTTP 200 JSON |
| Maintenance | `/api/maintenance` exposes valid Codex, OneBot and lookup state |
| Dashboard | `/` returns HTTP 200 HTML |
| OneBot | `/get_login_info` returns the logged-in QQ account |
| QQ channel | `channels.qq` is enabled with correct owner and allowlist |
| Logs | No unexplained fatal/error startup failure |

## OneBot connection

Defaults:

```text
OneBot API:          http://127.0.0.1:3000
Reverse HTTP target: http://127.0.0.1:3789/api/onebot/event
```

- Enable the OneBot HTTP API and reverse HTTP reporting in NapCat/LLBot.
- If an access token is configured, use the same value in Hub `ONEBOT_ACCESS_TOKEN` or `CODEX_REMOTE_CONTACT_ONEBOT_TOKEN`.
- Without a token, Hub accepts only actual loopback connections. Cross-namespace containers should use an explicit address and token, not disabled validation.
- After QR login, check `/get_login_info` again before enabling or connecting the QQ channel.

## Logs

The default JSONL file is `runtime/logs/hub.jsonl` with rotation.

Repository viewer:

```bash
npm run ncc -- logs --tail 80
npm run ncc -- logs --errors --since 30m --summary
npm run ncc -- logs --category interest --group GROUP_ID --tail 100
npm run ncc -- logs --category search --verbose --tail 100
npm run ncc -- logs --trace TRACE_ID --all
npm run ncc -- logs --scope private:QQ_ID --operation session
npm run ncc -- logs --operation agent.tool --slow 1000 --summary
npm run ncc -- logs -f
```

Use `ncc help` for filters supported by the machine-specific controller. API examples:

```bash
curl -fsS 'http://127.0.0.1:3789/api/logs?limit=100&level=error,warn' | jq .
curl -fsS 'http://127.0.0.1:3789/api/logs?category=interest&group=GROUP_ID' | jq .
curl -fsS 'http://127.0.0.1:3789/api/logs?scope=private:QQ_ID&operation=session' | jq .
```

Useful categories include `system`, `web`, `onebot`, `qq`, `codex`, `search`, `interest`, `learning`, `memory` and `lifecycle`. New schema-v3 entries remain readable alongside old logs. Agent turns/tools, cross-session sends, friend/group additions, administrator changes and settings writes share operation/outcome, actor, source/target session, tool, duration and error-code fields; tool arguments and cross-session message bodies are omitted. Start with a trace, then narrow cross-session or tool work with `--scope` and `--operation`; summaries also count operations and outcomes. Follow-up fusion uses the `qq` category and the same colored localized presentation for entry into the resettable five-second buffer, direct old-turn interruption and replacement, and replacement of an already-completed draft before delivery. Post-Bot continuation batching is separately traceable as `interest.follow_up_batch`, covering queue, adaptive-cap quiet-window renewal, freeze, the single interest decision, closure and failure. Punctuation/functional-phrase counters emit the low-noise `learning.language_statistics` operation only when a frequent candidate set changes or a scope/member reaches another 25-text-message checkpoint; these entries contain bounded counts and ratios but no copied message text or invented meaning. Model style reviews, scope summaries, slang-knowledge updates and unified-person promotion use `learning.style_review`, `memory.scope_summary`, `memory.knowledge_update` and `memory.person_promotion`, so one trace exposes the reviewed language-rule counts, slang patch count and promoted-person count. Native Agent commentary and plan updates remain bounded `codex` debug diagnostics; safe commentary additionally produces `QQ task progress delivered` or failure records under `qq`. If a `codex` commentary diagnostic contains a complete QQ Schema object, the Hub exactly validates it and extracts only visible `text`/`bubbles` from an attachment-free reply; the raw JSON never enters QQ, and the removed text progress/budget protocol never creates control rounds. Lifecycle details also expose delivered and failed bubble counts; a separate QQ warning confirms when a failed receipt was retained for the next model turn.

The dashboard separates Overview, Channels, Intelligence, Memory, Live Logs and Settings instead of stacking every feature on one page. Channels only manages connections, allowlists and contacts. Intelligence displays and persistently controls the Bot enhancer, web lookup, proactive interest, model provider and judge tuning, with safe diagnostics for the selected provider key, search provider, safe-download mode, active generations and pending replies. Behavior state uses independent desktop columns so a tall persona card does not leave a large hole in the other column, then returns to a natural single-column order on narrow screens.

The polling renderer separates server state from local interaction state. It does not replace active switches, an in-flight group/memory/network operation, a dirty Bot-settings form, or the open/closed state of memory and adaptive-learning details with a stale poll response. Reload recovery is session-scoped to the same browser tab and covers Bot-setting and group-input drafts, memory browsing context, adaptive-learning expansion state, and log controls/position; it does not synchronize drafts between tabs. Failed Bot-setting saves retain the draft for retry, while successful saves clear it.

The browser Live Logs view fetches complete structured entries every second, keeps chronological order and follows the latest row by default. Level, category, trace, error, outcome and latency have distinct colors, and every `details` field is visible inline. Operators can pause live refresh, turn off follow mode, change the row limit, filter entries and click a row for raw JSON. Requests pause while the page is hidden.

Interactive terminal output uses stable, independent colors for level, category, trace, outcome/error and latency. Use `--color` to force ANSI outside a TTY, `--plain` to disable it and `--json` for raw machine-readable fields. The Chinese viewer and dashboard share Chinese event names for every fixed structured event and recursively localize nested details such as startup adaptive-learning snapshots and language candidates, while JSON retains the stable original English `message` and the API adds `messageZh` plus `detailsZh`. Human output folds multiline values onto one line. Concrete Codex and interest-model output is retained at `debug` level, bounded to 4,000 characters and passed through log secret redaction; full input prompts and deletion-application chat evidence are not duplicated into logs, and Codex child failures retain only extracted diagnostic lines.

## Safe Hub restart

1. Inspect `/api/state`, the dashboard and recent lifecycle logs for active work.
2. Stop only Hub; do not stop QQ/NapCat for a code or dashboard change.
3. Start Hub through the existing process manager.
4. Repeat Hub, dashboard, OneBot, QQ-channel and error-log checks.

When supported by the global controller:

```bash
ncc stop-hub
ncc hub
ncc status
```

For the public foreground Linux path, press `Ctrl+C` and run `npm run ncc -- start` again.

## Safe upgrade

```text
Safely upgrade the current Codex QQ Bot. Inspect the Git worktree, active replies, data/runtime, databases and local environment first. Do not reset, clean or overwrite local changes. Use only a fast-forward update when the worktree permits it. Install dependencies, run npm run verify, restart only Hub through the existing process manager, and verify /api/state, dashboard, OneBot, QQ channel and error logs. Preserve user data and report any recovery or blocker explicitly.
```

Manual inspection order:

```bash
git status --short --branch
git remote -v
git pull --ff-only
npm install
npm run verify
```

Do not pull directly over local changes; let Codex assess conflicts and update strategy.

## Common failures

| Symptom | Likely cause | Check and action |
| --- | --- | --- |
| Nothing listens on `3789` | Hub stopped, syntax/config failure or port conflict | Run `npm run verify`; inspect `system` logs and `ss -ltnp | rg ':3789'` |
| API works but dashboard is 404/stale | Asset not registered or old process cache | Check `src/dashboard-assets.js` and `modules/mac-client/Resources`; restart only Hub |
| NapCat WebUI works but `3000` does not | QQ not logged in or OneBot HTTP config not loaded | Inspect WebUI/QR and NapCat logs; run `ncc connect` after login |
| `get_login_info` returns 401/403 | Token mismatch | Align OneBot and Hub tokens without printing them |
| QQ channel is false | OneBot unavailable, channel disabled or state not saved | Inspect state, settings and `ncc connect` |
| Allowlisted group does not reply | Wrong group, no mention/reply, or sender banned | Inspect state plus `qq` and `onebot` logs |
| Codex generation fails | Login, CLI path, model access or queue pressure | Check CLI/version/login, maintenance and `codex` logs |
| Proactive interest stays silent | Empty cycle, disabled/failed judge, low interest or stale result | Inspect `interest` logs, the selected provider credential/model, judge policy and group activity |
| QQ images report `URL_PRIVATE_ADDRESS` and DNS returns `198.18/15` | Proxy software uses Fake-IP DNS and strict safe-download mode blocks the reserved address | Keep private-address protection and set `CODEX_REMOTE_CONTACT_SAFE_FETCH_MODE=proxy-compatible`, then restart only Hub; literal private IPs and other reserved ranges remain blocked |
| An unrelated text reply logs `image download returned HTTP 400` | A persisted incidental context image kept an expired Tencent download URL | Current/quoted images remain eligible, but context-image collection now excludes references older than two hours or without a timestamp; confirm the running Hub has the current source |
| `/申请` reports success but QQ does not change, or an ordinary friend request disappears after a Hub restart | NapCat's standard friend-request action returns before its native approval promise settles, and its public API cannot list ordinary friend requests | Deploy incoming-request bridge v19 and confirm `/health` reports the four `incoming-*-request-*` capabilities. `/申请 同步` then reads pending ordinary/suspicious friend and group requests through the loopback bridge. Friend approval awaits the native promise exactly once; success additionally requires the friend list, group list, or pending state to confirm the change. An ambiguous transport result is not retried through OneBot. Suspicious friend requests cannot be reliably rejected. |
| Web lookup fails | Credential, provider, network or timeout | Inspect maintenance provider attempts and `search` logs |
| `ncc` rejects a documented command | Wrong same-name controller | Inspect `command -v ncc`, `readlink -f`, `ncc help`; use `npm run ncc --` for repository commands |
| Dead screen socket | Previous abnormal exit | Confirm no live process, run `screen -wipe`, then restart |

## Temporary public access

The Settings page has a default-off **Temporary public access** switch backed by [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/). It keeps the Hub on `127.0.0.1` and starts a local `cloudflared` child process that forwards only to `http://127.0.0.1:3789`.

Before enabling it, install `cloudflared` using Cloudflare's platform instructions and make sure the executable is on the PATH inherited by the Hub. The dashboard never installs or downloads the dependency. If it is missing, fails to start, or does not return a URL within the startup timeout, the API returns an error and no public URL is retained.

When enabled:

1. The Hub creates a persistent management token if one does not already exist.
2. The dashboard displays the active random `https://*.trycloudflare.com` URL. The address can change after a restart or re-enable.
3. Send the address and token separately to a trusted visitor. The visitor enters the token in the dashboard prompt; it is stored only in that browser tab.
4. Every non-loopback management API request still requires the token. Same-origin CORS is admitted only for the exact active tunnel host.
5. Only a loopback-loaded dashboard can start or stop the tunnel or retrieve the token. Disabling the switch terminates the child process.

The desired switch state is persisted, so an enabled tunnel is recreated when the Hub restarts. Quick Tunnels are intended for temporary development/testing, not durable production exposure. For a stable public service, use a managed named tunnel or TLS reverse proxy with independent identity controls, rate limits and monitoring.

## LAN access

The default remains `127.0.0.1`. Enable LAN only on explicit request:

1. Use the loopback dashboard switch, or configure an explicit host, `ALLOW_REMOTE=1` and a random API token.
2. Restrict CORS; never use unauthenticated `*`.
3. Limit firewall access to required private subnets and bypass private addresses in proxy/VPN rules.
4. Test the page and token-authenticated API from another device, and confirm the token is absent from Git, logs and screenshots.
5. For durable public access, use a managed named tunnel or TLS reverse proxy with authentication and rate limits; do not bind Hub directly to the public internet.
