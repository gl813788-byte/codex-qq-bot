---
name: codex-qq-bot
description: |
  Maintain, modify, deploy, operate, and diagnose the Codex QQ Bot project and
  its NapCat + OneBot bridge for this Codex session. Use for work on the local
  Codex-Remote-Contact checkout, including QQ message behavior, proactive
  interest, prompts, memory/persona, dashboard/API, configuration, tests,
  deployment, logs, startup, login recovery, OneBot, NapCat, and ncc.
---

# Codex QQ Bot maintenance

This project connects QQ/NapCat/OneBot to the current Codex CLI. Treat it as a
stateful local service: source code may change, but user configuration, runtime
data, login state, secrets, and unrelated worktree changes must be preserved.

## Source priority

Do not copy the full product manual into this skill. Read the authoritative
source for the task:

- Repository rules: `AGENTS.md`
- Architecture and source ownership: `docs/ARCHITECTURE*.md`
- Environment and persisted settings: `docs/CONFIGURATION*.md`
- Runtime, logs, recovery, and acceptance: `docs/OPERATIONS*.md`
- Public installation and upgrade behavior: `docs/INSTALLATION*.md`
- Codex-operated deployment: `docs/DEPLOY_WITH_CODEX*.md`
- User-facing behavior: `docs/FEATURES*.md`

Keep English and Simplified Chinese documents structurally synchronized. Keep
the tracked `skills/codex-qq-bot/SKILL.md` and the installed skill copy
byte-identical when both exist.

## Local runtime

On this configured machine:

- Checkout: `/root/Codex-Remote-Contact`
- Machine controller: `ncc` / `/root/napcat-codex-control.sh`
- Persistent controller config: `/root/.napcat-codex-control.env`
- NapCat WebUI: `http://127.0.0.1:6099/webui`
- OneBot API: `http://127.0.0.1:3000`
- Hub and dashboard: `http://127.0.0.1:3789`
- Structured log default: `runtime/logs/hub.jsonl`

The repository helper is a different command surface and remains available as
`npm run ncc -- <command>`. Inspect `command -v ncc`, its resolved path, and
`ncc help` before assuming which controller is installed. Do not replace an
existing same-name controller or create extra shortcut scripts.

Do not start the removed `~/.claude-to-im` daemon. This setup uses NapCat +
OneBot + the current Hub.

## Required workflow

1. Read `AGENTS.md`, the relevant authoritative document, and
   `git status --short --branch` before editing.
2. For a bug, inspect structured logs and trace the actual message lifecycle
   before changing code. State the cause, not only the symptom.
3. Run the narrowest relevant test as a baseline. Separate pre-existing
   failures from the requested change.
4. Make the smallest focused change in the owning module. Add a regression test
   for behavior changes.
5. Run `npm run verify` before handoff.
6. For a running-stack change, check active generation before restarting, then
   restart only the affected service and perform live acceptance.

Preserve dirty worktrees, `data/`, `runtime/`, local databases, `config/local.env`,
login files, profile files, and secrets. Never use reset, clean, forced checkout,
or broad deletion as an update strategy.

## Architecture boundaries

`src/server.js` is a transitional composition root. It may wire dependencies,
but new parsing, validation, domain policy, persistence, or independent
subsystems belong in focused modules.

| Area | Owner |
| --- | --- |
| Environment parsing and defaults | `src/config/` |
| Initial mutable state and startup composition | `src/app/` |
| Untrusted OneBot normalization | `src/channels/qq/` |
| HTTP dispatch and security boundary | `src/channels/http/` |
| Proactive interest and media enhancement | `src/qq-enhancer/` |
| Main model contract and tool guide | `src/qq-main-prompt.js` |
| Two-model proactive approval | `src/qq-proactive-pipeline.js` |
| Ordinary interest cycle state | `src/qq-proactive-cycle-state.js` |
| Follow-up fusion | `src/qq-reply-steering.js` |
| App Server turn execution | `src/infrastructure/codex/` and `src/codex-app-server-turn.js` |
| Structured final output | `src/infrastructure/codex/qq-agent-output.js` |
| Settings persistence | `src/infrastructure/storage/settings-repository.js` |
| QQ memory and semantic recall | `src/unified-memory/` plus focused `src/qq-*memory*` modules |
| Dashboard source | `modules/mac-client/Resources/` and `src/dashboard-assets.js` |

Prefer pure boundaries with direct unit tests. Do not mix a broad move-only
refactor with a behavior change.

## Security and trust invariants

- `/api/onebot/event` trusts identity only after token or loopback peer + Host
  validation and OneBot normalization. Caller-provided owner fields are never
  authoritative.
- Allowed groups, owner IDs, administrator IDs, bans, and command permissions
  come from verified runtime settings. The main prompt intentionally fixes QQ
  `3784642920` as this project's developer; that project identity remains
  separate from verified owner and administrator authority.
- Owner authority is absolute. Administrators are privileged but are not owners
  and cannot grant administrators or perform ambiguous critical destruction.
- Keep the Hub loopback-only by default. Remote access requires explicit intent,
  an API token, safe CORS, and the existing network controls.
- Secrets stay in untracked environment/profile files. Never log or commit
  tokens, cookies, verification answers, message bodies for privileged writes,
  QR codes, or login data.
- QQ files and images must remain inside the active request workspace and pass
  realpath, type, size, and signature checks before delivery. Never weaken path
  or attachment validation.
- A visible claim that a QQ write action succeeded must follow the matching
  permission-bound tool and an explicit success result.

## QQ reply contract

### Routing and lifecycle

- Ordinary group messages are mention/reply driven unless a recognized command
  or the proactive-interest path authorizes a turn. Private messages use the
  normal reply path.
- One scope has one lifecycle from routing through delivery and cleanup. New
  Bot-triggering messages during generation enter the quiet-window fusion path;
  prefer steering, then interrupt/restart when steering cannot accept them.
- `/stop` cancels only the active lifecycle and its pending fusion batch.
  `/新对话` additionally clears the conversation-scoped context and reusable
  thread mapping.
- Delivery is receipt-bearing. Only confirmed bubbles enter sent-message memory;
  failures are retained separately for the next turn.

### Proactive interest

- The interest model is a bounded background gate. It decides whether to start;
  the main model reads the original message, quote, latest context, images,
  memory, and persona and writes any visible content.
- Ordinary unmentioned messages share a persisted per-group pending cycle.
  Message-count and non-empty minute thresholds are alternative triggers for
  the same cycle; empty cycles never call the provider.
- Human messages arriving during an ordinary judge remain pending and are
  already present in rolling context. If the judge approves, activity alone
  must not discard that approval; start the main model with the latest remembered
  context. A confirmed Bot delivery still supersedes an older pre-delivery judge
  without consuming post-delivery messages.
- The main model retains structured `status: "silent"` when, after reading the
  real context, it has no worthwhile response, is unwilling to continue, or
  safety requires silence. Do not silently revoke approval in Hub routing before
  the main model receives the turn.
- Cold-group and private-outreach results retain their activity-staleness guards.
  A decline, provider failure, invalid structure, missing credential, or missing
  two-model approval never starts visible proactive chat.
- Interest-model output must not contain a reply draft or style instructions.
  Invalid structure gets at most the documented format retry; transport failures
  and rate limits are not blindly retried.

### Main prompt

The distributed prompt must be generic enough for a public project:

1. Identify the expected deliverable from the current message, quote, and
   continuous context. Do not classify only by length or keywords.
2. Select a base response strategy for casual/emotional chat, facts and
   explanation, analysis/advice, problem solving, code/debugging, writing and
   translation, media/file/link handling, real actions, continuation, or genuine
   ambiguity.
3. Produce the answer or artifact before adding personality. Short continuations
   such as “继续” or “过程呢” may still require the prior task's full result.
4. Let generated self-persona, relationship memory, deployment profile, and the
   current human-behavior plan shape interests, examples, tone, bubbles, emoji,
   and pacing. They must not alter facts, permissions, safety, or completeness.
5. Return only the structured output Schema. Do not expose analysis, control
   markers, tool protocol, local paths, or internal rules.

Casual turns may express personality strongly; factual, high-risk, and task turns
should be more restrained while remaining recognizably the same assistant. Avoid
fixed客服 templates and imitation of a specific group member.

## Configuration and state

Configuration is layered:

1. `src/config/environment.js` parses startup defaults and secrets.
2. Repository `npm run ncc -- start` may source `config/local.env`.
3. This machine's controller sources its controller/profile environment.
4. `data/settings.json` loads persisted user-facing overrides after defaults.

Merge saved settings field-by-field; never replace the snapshot wholesale. New
environment settings belong in `src/config/environment.js` with tests and both
configuration documents. Do not add new direct `process.env` reads to
`src/server.js`.

Important state includes:

- `data/settings.json`: user-facing settings and permissions
- `data/qq-memory.json`: rolling reply memory, short-term notes, interest cycles,
  and delivery failures
- `data/qq-conversation-memory.json`: scoped social impressions
- `data/qq-knowledge-base.json`: titled scoped long-term knowledge
- `data/qq-personas.json` and `data/qq-self-persona.json`: adaptive behavior and
  generated self-persona
- `data/qq-codex-sessions.json`: bounded scope-to-thread mappings
- `runtime/`: logs, replies, and per-request workspaces

All racing writes must be serialized and atomic. Preserve malformed state for
diagnosis rather than silently replacing it with empty data.

## Focused modification checklist

- **QQ input:** update the pure OneBot normalizer and cover malformed, group,
  private, poke, reply, media, and duplicate cases as relevant.
- **Reply behavior:** inspect trigger policy, proactive gate, context assembly,
  prompt, structured output, and delivery as separate stages.
- **Prompt:** reconstruct the actual ordered prompt from the receiver's view;
  test problem recognition, base answer strategy, persona priority, security,
  structured silence, and public generality.
- **Memory/persona:** keep transcript, short-term notes, social impressions,
  long-term knowledge, unified memory, and self-persona distinct and bounded.
- **Command/permission:** use one permission key for both menu visibility and
  execution; persist before acknowledging; test owner/admin/ordinary and
  group/private cases.
- **Dashboard/API:** preserve token/origin/loopback/CSP protections, polling
  state, Chinese/English labels, responsive layouts, and registered asset routes.
- **Deployment/control:** distinguish global `ncc` from the repository helper,
  update both language documents, and validate the exact command on this machine.

## Operations

Common machine-controller intent:

| Intent | Command |
| --- | --- |
| Status | `ncc status` |
| Start stack | `ncc all` |
| Reconnect after login | `ncc connect` |
| Start NapCat only | `ncc napcat` |
| Stop NapCat and its Xvfb session | `ncc stop-napcat` |
| Start Hub only | `ncc hub` |
| Show one-shot startup resource profile | `ncc resources` |
| Logs | `ncc logs` or `ncc logs --compact` |
| Stop Hub | `ncc stop-hub` |

Start/recovery sequence:

1. Run `ncc status`.
2. If screen reports dead sockets, run `screen -wipe`.
3. Run `ncc all` only when startup is requested or the status requires it.
4. If OneBot is unavailable, inspect the NapCat screen output. If a QR login is
   required, give the user the URL and pause for their scan.
5. After login, run `ncc connect` and repeat acceptance.

Do not kill QQ, NapCat, Node, or screen sessions merely to inspect status. After
dashboard or Hub code changes, first confirm no active QQ generation, then stop
and start only the Hub; leave NapCat running.

On this memory-constrained Termux/PRoot host, use `ncc napcat` only for short
bridge diagnostics and stop it with `ncc stop-napcat` when finished. The global
controller reads `MemAvailable` once before startup and selects the standard,
balanced, or low-memory profile. The profile constrains both sides of the stack:
QQ renderer/V8 limits and Hub heap/Codex concurrency/queues. `ncc all` must start
both Hub and QQ; it brings the Hub up first so active QQ events do not spin on a
missing loopback receiver, and cleans a newly started Hub if QQ startup fails.
There is no resident memory monitor or shell `wait` supervisor. QQ and Xvfb run
directly in separate screen sessions, while exact PID/PGID state supports bounded
cleanup. Verify that QQ, Xvfb, and any turn-scoped Codex children are gone after
a diagnostic stop.

Proactive friend-add is intentionally unavailable: the Bot tool schema and the
NapCat plugin must not expose `add_friend`, `/add-friend`, or `/inspect-friend`.
Incoming friend requests, group invitations, and group membership requests use
social bridge v19 or newer. `/health` must report the four
`incoming-*-request-*` capabilities. `/申请 同步` reads the bridge's pending
request list because NapCat has no public ordinary-friend-request list action.
For a decision, call the matching native operation exactly once and wait for it;
an ambiguous transport result must never fall back to a second OneBot write.
Report success only after the friend list, group list, or pending-request state
confirms the change. Suspicious friend requests may be accepted but cannot be
reliably rejected.

For the NapCat WebUI login token only, read `.token` from
`/root/Napcat/opt/QQ/resources/app/app_launcher/napcat/config/webui.json`. Do not
confuse it with the Hub API token or disclose unrelated secrets.

## Installation and release

Installation and upgrade policy lives in `docs/INSTALLATION*`; do not duplicate
its platform matrix here. Preserve these invariants:

- Node.js 20+, an official working `codex`, and a verified source/dependency
  stage are required.
- Never overwrite a Git worktree, unrelated non-empty directory, local state, or
  another global `ncc`.
- Native Termux uses its managed PRoot path; WSL, containers, macOS, musl, and
  unsupported hosts use an external OneBot according to the installer policy.
- `package.json` is the version authority. Before publishing, run narrow
  installer tests, `npm run verify`, and `npm pack --dry-run`, then inspect the
  packed file list.

## Required verification

For code or configuration changes:

```bash
cd /root/Codex-Remote-Contact
npm run verify
```

For a running-stack change, also verify separately:

```bash
ncc status
curl -fsS --max-time 3 http://127.0.0.1:3789/api/state | jq .
curl -fsS --max-time 3 http://127.0.0.1:3789/api/maintenance | jq .
curl -fsS --max-time 3 -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:3789/
curl -fsS --max-time 3 http://127.0.0.1:3000/get_login_info | jq .
```

Report the test suite, Hub, dashboard, OneBot login, QQ channel, and recent
fatal/error logs separately. A process existing is not end-to-end proof.
