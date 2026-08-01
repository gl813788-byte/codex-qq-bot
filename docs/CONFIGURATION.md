# Configuration Reference

[简体中文](CONFIGURATION_CN.md) | English

The project separates persistent user settings from secrets and process startup parameters. When deploying or editing configuration, let Codex inspect the machine and merge individual fields instead of replacing whole files.

## Sources and precedence

```text
process environment
    -> normalized startup defaults in src/config/environment.js
    -> persisted fields overridden by data/settings.json
    -> runtime changes saved atomically by the dashboard or QQ commands
```

- `npm run ncc -- start` sources `config/local.env` first.
- A direct `npm start` does not load that file; it only inherits the current process environment.
- A machine-specific global `ncc` may instead use `/root/.napcat-codex-control.env` and `/root/.codex/ncc-profiles/active.env`. Run `ncc help` before assuming its command surface.
- `data/settings.json` overrides corresponding startup defaults such as models, allowlists and proactive-reply switches.
- Keep OneBot, management API, OpenRouter and Tavily secrets in an untracked environment file.

## Files

| File | Purpose | Commit? |
| --- | --- | --- |
| `config/settings.example.json` | Persistent schema and example | Yes |
| `data/settings.json` | This machine's settings, permissions and network state | No |
| `config/local.env` | Environment and secrets used by repository `ncc start` | No; mode `600` recommended |
| `src/config/environment.js` | Authoritative environment names, defaults, bounds and normalization | Yes |
| `runtime/logs/hub.jsonl` | Structured runtime evidence, not configuration | No |

First-time setup:

```bash
cp config/settings.example.json data/settings.json
chmod 600 data/settings.json
npm run ncc -- setup
```

Do not copy the example over an existing settings file.

## Persistent settings

Minimal configuration:

```json
{
  "version": 3,
  "qq": {
    "allowedGroups": ["QQ-group-id"],
    "ownerUserIds": ["owner-QQ-id"],
    "adminUserIds": ["Bot-administrator-QQ-id"],
    "bannedUserIds": [],
    "bannedUntilByUserId": {},
    "enhancer": { "enabled": true },
    "webLookup": { "enabled": true },
    "proactive": {
      "enabled": true,
      "judgeEveryMessages": 20,
      "judgeEveryMinutes": 5,
      "judge": { "enabled": true }
    },
    "commandPermissions": {
      "publicCommands": {
        "menu": true,
        "newDialog": true,
        "stop": true,
        "summary": true
      },
      "userCommands": {}
    },
    "codexSession": {
      "defaultMode": "auto",
      "scopes": {
        "QQ-group-id": "persistent",
        "private:QQ-id": "temporary"
      }
    }
  },
  "ai": {
    "model": "gpt-5.4-mini",
    "reasoningEffort": "low",
    "reasoningSummary": "auto",
    "personality": "none",
    "serviceTier": ""
  },
  "branding": {
    "assistantName": "assistant",
    "ownerLabel": "owner",
    "assistantMentions": ["@assistant"]
  }
}
```

| Path | Meaning |
| --- | --- |
| `qq.allowedGroups` | QQ group allowlist, stored as string IDs |
| `qq.ownerUserIds` | QQ IDs with absolute owner authority |
| `qq.adminUserIds` | Owner-granted Bot administrators with full menu/Agent/cross-session access but no administrator delegation or owner impersonation |
| `qq.bannedUserIds` / `bannedUntilByUserId` | Permanent and temporary bans |
| `qq.enhancer.enabled` | QQ media, style and interest enhancements |
| `qq.webLookup.enabled` | Runtime QQ web-lookup switch, persistently editable from the dashboard |
| `qq.proactive.*` | Ordinary message/minute interest triggers and judge policy |
| `qq.commandPermissions` | Public and user-specific non-owner command access |
| `qq.codexSession.defaultMode` | Default `auto`, `persistent`, or `temporary` mode for scopes without an override |
| `qq.codexSession.scopes` | Per-group or `private:QQ-id` mode overrides; thread IDs are not stored in settings |
| `ai.*` | QQ model, reasoning effort/summary, Codex personality, and model-advertised service tier |
| `unifiedMemory.*` | Automatic writes and manual handoff behavior |
| `branding.*` | Assistant name, owner label and mention aliases |
| `network.allowLanAccess` | Persistent dashboard LAN switch |
| `network.publicTunnelEnabled` | Persistent desired state for the temporary Cloudflare Quick Tunnel; defaults to `false` |
| `network.apiToken` | Generated remote-management token; keep the real value only in untracked local settings or the environment |

The dashboard Intelligence view can persist the enhancer, web lookup, proactive-interest and judge switches plus message/minute cadence, judge model, idle timeout and recent-context size. Explicit @Bot replies do not depend on proactive interest. Switch models only to entries currently advertised by the active Codex login. Owners can inspect or change native turn parameters with `/思考强度`, `/推理摘要`, `/人格`, and `/服务档位`; service tiers are read from the selected model catalog (for example `fast`) instead of hard-coded. The Hub saves these changes atomically before acknowledging success, and App Server applies them on the next turn.

Owners can use `/会话模式` and `/会话模式 自动|长期|临时` in QQ for the current scope. The management endpoint is `POST /api/qq/session-mode` with `{"mode":"auto|persistent|temporary","scopeId":"optional group-id or private:QQ-id"}`; use `inherit` with a scope to remove its override. Repository control uses `npm run ncc -- session` and `npm run ncc -- session-mode MODE [SCOPE]`; a machine-specific global controller may expose the same commands. Actual mappings live separately in `data/qq-codex-sessions.json`. `/新对话` stops reuse of the current mapping without deleting Codex CLI's historical files.

## One-click deployment environment

These variables control installation only; they are not Hub runtime configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEX_QQ_BOT_INSTALL_DIR` | `/root/Codex-QQ-Bot` for root, otherwise `~/Codex-QQ-Bot` | Source installation directory; an existing legacy `Codex-Remote-Contact` is reused |
| `CODEX_QQ_BOT_INSTALL_STATE_DIR` | `<install-directory>.install-cache` | Source checkpoints, quarantined downloads, and archive-upgrade backups |
| `CODEX_QQ_BOT_SOURCE_BRANCH` | Repository default branch | Explicit source branch override |
| `CODEX_QQ_BOT_NCC_BIN` | First safe writable bin directory | Explicit global `ncc` wrapper destination |
| `CODEX_QQ_BOT_INSTALL_NAPCAT` | `auto` | `auto` installs only on supported native apt-get/dnf glibc Linux; Termux/PRoot, WSL, containers, macOS, and other hosts reuse an external OneBot; `required` fails early when unsupported |
| `CODEX_QQ_BOT_NODE_MAJOR` | `22` | Official Node.js major on compatible hosts; native Termux uses managed PRoot and musl uses distribution packages; every result must satisfy Node 20+ |
| `CODEX_QQ_BOT_USER_PREFIX` | `~/.local` | User-isolated Node/Codex command prefix |
| `CODEX_QQ_BOT_BOOTSTRAP_CACHE_DIR` | `~/.cache/codex-qq-bot/bootstrap` | Node/NapCat download and resumable-stage cache |
| `CODEX_QQ_BOT_MANAGED_NODE_HOME` | `~/.local/share/codex-qq-bot/node` | Project-managed Node.js directory |
| `CODEX_QQ_BOT_NAPCAT_HOME` | `~/Napcat` | NapCat official rootless Shell directory |
| `CODEX_QQ_BOT_TERMUX_DISTRO` | `debian` | PRoot distribution installed/reused from native Termux; an existing PRoot guest is never nested |
| `CODEX_QQ_BOT_TERMUX_GUEST_PROJECT_DIR` | `/opt/codex-qq-bot` | Bind path inside managed PRoot; real files remain under the Termux user's project directory |
| `CODEX_QQ_BOT_TERMUX_STATE_DIR` | `~/.local/state/codex-qq-bot` | Managed PRoot preparation state |
| `CODEX_QQ_BOT_PREPARE_AFTER_INSTALL` | `1` for npm, `0` for raw `install.sh` | Whether source installation continues through platform dependencies, Codex, npm dependencies, and `verify`; `--prepare` / `--download-only` override it |

The behavior and decision matrix live in [One-click installation and environment plans](INSTALLATION.md). Test-only `CODEX_QQ_BOT_BOOTSTRAP_FORCE_*` variables are not a user configuration interface.

## Core environment

### Hub and security

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEX_REMOTE_CONTACT_HOST` | loopback | Explicit bind address |
| `CODEX_REMOTE_CONTACT_PORT` | `3789` | Valid Hub port |
| `CODEX_REMOTE_CONTACT_ALLOW_REMOTE` | `0` | Must be `1` for an explicit non-loopback bind |
| `CODEX_REMOTE_CONTACT_CORS_ORIGINS` | local origins | Allowed Origin list |
| `CODEX_REMOTE_CONTACT_API_TOKEN` | empty | Non-loopback management API token |

A non-loopback listener requires explicit remote allowance and a token. Wildcard CORS without a token is rejected.

### Codex

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEX_CLI_PATH` | path inside the macOS app | Codex executable; set it or expose `codex` on other platforms |
| `CODEX_REMOTE_CONTACT_CODEX_MODEL` | `gpt-5.4-mini` | QQ startup model |
| `CODEX_REMOTE_CONTACT_REASONING_EFFORT` | `low` | QQ startup reasoning effort |
| `CODEX_REMOTE_CONTACT_REASONING_SUMMARY` | `auto` | Detail of the App Server's displayable reasoning summary: `auto`, `concise`, `detailed`, or `none`; it is not the model's full internal reasoning and does not change reasoning effort |
| `CODEX_REMOTE_CONTACT_CODEX_PERSONALITY` | `none` | App Server personality: `none`, `friendly`, or `pragmatic` |
| `CODEX_REMOTE_CONTACT_CODEX_SERVICE_TIER` | empty | Model-advertised service-tier id such as `fast`; invalid ids are cleared against the live catalog |
| `CODEX_REMOTE_CONTACT_CODEX_MAX_CONCURRENCY` | `2` | Active jobs, bounded 1–8 |
| `CODEX_REMOTE_CONTACT_CODEX_MAX_PENDING` | `32` | Pending jobs, bounded 0–256 |
| `CODEX_REMOTE_CONTACT_QUOTA_CACHE_TTL_MS` | `30000` | Quota cache lifetime |
| `CODEX_REMOTE_CONTACT_CODEX_REPLY_TIMEOUT_MS` | `120000` | Low-effort base per-round limit for ordinary text replies |
| `CODEX_REMOTE_CONTACT_CODEX_VISION_REPLY_TIMEOUT_MS` | `180000` | Low-effort base per-round limit for replies that inspect images |
| `CODEX_REMOTE_CONTACT_CODEX_CONTEXT_SUMMARY_TIMEOUT_MS` | `90000` | Limit for `/总结聊天记录` |
| `CODEX_REMOTE_CONTACT_CODEX_SELF_PERSONA_TIMEOUT_MS` | `90000` | Self-persona summary/regeneration limit |
| `CODEX_REMOTE_CONTACT_CODEX_FILE_TASK_TIMEOUT_MS` | `300000` | Owner local-file task limit |
| `CODEX_REMOTE_CONTACT_CODEX_IMAGE_GENERATION_TIMEOUT_MS` | `600000` | Image-generation limit; configurable up to 60 minutes |

The Hub classifies each Codex task and scales its base deadline by the current reasoning effort: `low ×1`, `medium ×1.5`, `high ×2`, `xhigh ×3`, `max ×4`, and `ultra ×5`. Ordinary text replies therefore start at two minutes for `low` and rise by effort, while vision, summary, file, and image tasks retain distinct bases. Values are milliseconds. Effective normal-task deadlines are capped at 30 minutes and image generation at 60 minutes. App Server owns native multi-turn tools and context compaction; the removed text budget/continue protocol no longer changes these limits. When an active QQ turn accepts steered follow-up input or a fused follow-up starts a replacement turn, it receives a fresh full task-specific window. `/详细配置`, `/api/state`, `/api/maintenance`, and structured Codex logs expose current native settings and task timing.

### OneBot

| Variable | Default | Purpose |
| --- | --- | --- |
| `ONEBOT_API_BASE` | `http://127.0.0.1:3000` | OneBot HTTP API |
| `ONEBOT_ACCESS_TOKEN` | empty | Preferred OneBot token |
| `CODEX_REMOTE_CONTACT_ONEBOT_TOKEN` | empty | Compatible token name |
| `CODEX_REMOTE_CONTACT_ONEBOT_TIMEOUT_MS` | `10000` | API timeout, bounded 1–30 seconds |
| `CODEX_REMOTE_CONTACT_ONEBOT_MAX_CONCURRENCY` | `8` | Active webhooks, bounded 1–32 |
| `CODEX_REMOTE_CONTACT_ONEBOT_MAX_PENDING` | `32` | Pending webhooks, bounded 0–256 |

Use the same token on both sides. Without one, the webhook trusts only requests whose Host and actual peer address are both loopback.

### QQ behavior, interest and media

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEX_REMOTE_CONTACT_QQ_ENHANCER` | `1` | Set `0` to disable the startup enhancement default |
| `CODEX_REMOTE_CONTACT_QQ_MEMORY_LIMIT` | `10` | Lightweight context limit |
| `CODEX_REMOTE_CONTACT_QQ_GROUP_MEMORY_LIMIT` | `200` | Rolling group transcript limit |
| `CODEX_REMOTE_CONTACT_QQ_PROACTIVE` | `1` | Proactive-interest startup default |
| `CODEX_REMOTE_CONTACT_QQ_PROACTIVE_JUDGE` | `1` | Semantic judge switch |
| `..._JUDGE_EVERY_MESSAGES` | `20` | Ordinary unmentioned message threshold, 1–1000 |
| `..._JUDGE_EVERY_MINUTES` | `5` | Minute threshold for a non-empty cycle; `0` disables this branch |
| `..._JUDGE_PROVIDER` | `openrouter` | Interest provider: `openrouter`, `deepseek`, or `custom` |
| `..._JUDGE_MODEL` | provider-specific | `openrouter/free` for OpenRouter; `deepseek-v4-flash` for DeepSeek |
| `..._JUDGE_API_KEY` | empty | Credential for the `custom` provider |
| `..._JUDGE_BASE_URL` | empty | OpenAI-compatible API root for the `custom` provider |
| `..._JUDGE_TIMEOUT_MS` | `6500` | Streaming idle timeout |
| `CODEX_REMOTE_CONTACT_QQ_IMAGE_MAX_BYTES` | `20971520` | QQ image limit, 20 MiB by default |
| `CODEX_REMOTE_CONTACT_SAFE_FETCH_MODE` | `strict` | Safe-download mode; `proxy-compatible` additionally permits DNS names mapped into proxy Fake-IP range `198.18.0.0/15`, while literal private IPs and other reserved ranges stay blocked |
| `CODEX_REMOTE_CONTACT_QQ_BUBBLE_SEPARATOR` | `|||` | Multi-bubble separator |
| `..._BUBBLE_SEND_DELAY_MS` | `650` | Base inter-bubble delay |
| `..._BUBBLE_MAX_CHARS` | `900` | Safe character limit per QQ message, bounded 200–4000 |
| `..._BUBBLE_MAX_COUNT` | `24` | Maximum bubbles per reply, bounded 1–64 |

The main model decides from the full context whether a turn is casual chat or a substantive deliverable. Casual replies still follow the learned group rhythm; problem solving, proofs, calculations, code, writing, translation, summaries, and short continuations of those tasks have no fixed response length and should be as long as correct completion requires. Delivery no longer hard-cuts normal model output at 900 characters. Any bubble above the per-message safety limit is split into ordered QQ messages at paragraph or sentence boundaries, with hard cuts used only for unbroken text. If the configured per-reply bubble ceiling is exceeded, the last sent bubble explicitly reports truncation instead of risking one oversized OneBot send.

Self-persona thresholds use `CODEX_REMOTE_CONTACT_QQ_SELF_PERSONA_*`; account sticker settings use `CODEX_REMOTE_CONTACT_QQ_ACCOUNT_STICKER_*`. Consult `src/config/environment.js` for every exact name, default and bound.

### Web lookup and judge provider

| Variable | Default | Purpose |
| --- | --- | --- |
| `CODEX_REMOTE_CONTACT_QQ_WEB_LOOKUP` | `1` | QQ web lookup |
| `CODEX_REMOTE_CONTACT_QQ_WEB_PROVIDER` | `auto` | Preferred provider |
| `CODEX_REMOTE_CONTACT_QQ_WEB_PRESET` | `balanced` | Provider preset |
| `CODEX_REMOTE_CONTACT_QQ_WEB_PROVIDERS` | empty | Explicit provider order |
| `CODEX_REMOTE_CONTACT_QQ_WEB_TIMEOUT_MS` | `12000` | Overall lookup timeout |
| `CODEX_REMOTE_CONTACT_QQ_WEB_ATTEMPT_TIMEOUT_MS` | derived | Per-provider timeout |
| `TAVILY_API_KEY` | empty | Tavily credential |
| `OPENROUTER_API_KEY` | empty | OpenRouter interest-model credential |
| `OPENROUTER_BASE_URL` | official endpoint | OpenRouter endpoint |
| `DEEPSEEK_API_KEY` | empty | DeepSeek interest-model credential |
| `DEEPSEEK_BASE_URL` | official endpoint | DeepSeek endpoint |

Switch providers from Intelligence in the dashboard or with the owner command `/兴趣厂商 openrouter|deepseek|custom`; `/兴趣模型 model-id` overrides the provider default. Credentials remain environment-only and are never persisted to `data/settings.json`. OpenRouter uses strict JSON Schema, while DeepSeek and custom compatible services use JSON Object mode. Run `npm run ncc -- search-config` to initialize the repository environment. Diagnose `/api/maintenance` and the `search` / `interest` logs before editing prompts.

### Logs

- The Hub has one QQ/OneBot message transport. Legacy `CODEX_REMOTE_CONTACT_IMESSAGE_*` and `CODEX_REMOTE_CONTACT_REMOTE_EXECUTION_*` variables are ignored.
- Logging uses `CODEX_REMOTE_CONTACT_LOG_LEVEL` (`debug` by default), `LOG_CONSOLE`, `LOG_CONSOLE_LEVELS`, `LOG_MAX_BYTES` and `LOG_MAX_FILES` with the same prefix.
- SQLite operations are bounded by `CODEX_REMOTE_CONTACT_SQLITE_TIMEOUT_MS` and `CODEX_REMOTE_CONTACT_SQLITE_MAX_OUTPUT_BYTES`.

## Local environment example

```bash
export CODEX_CLI_PATH=/usr/local/bin/codex
export ONEBOT_API_BASE=http://127.0.0.1:3000
export ONEBOT_ACCESS_TOKEN=use-a-real-random-value
export OPENROUTER_API_KEY=use-a-real-secret
export TAVILY_API_KEY=use-a-real-secret
export CODEX_REMOTE_CONTACT_SAFE_FETCH_MODE=proxy-compatible
export CODEX_REMOTE_CONTACT_LOG_LEVEL=debug
```

```bash
chmod 600 config/local.env
npm run ncc -- status
```

Never paste real secrets into issues, screenshots, chat transcripts or Git diffs.

## Changing configuration code

1. Parse, default and bound a new variable in `src/config/environment.js`.
2. Pass the normalized value to its consumer; do not add another direct `process.env` read to `server.js`.
3. Extend `test/environment-config.test.js`.
4. Update both languages and the maintenance skill.
5. Run `npm run verify`.
