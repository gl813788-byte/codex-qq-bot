<div align="center">

# Codex QQ Bot

Connect QQ to the Codex or Claude Code install on your own machine, and get a QQ bot that can chat and actually do things.

[简体中文](README_CN.md) | English

![Node.js](https://img.shields.io/badge/Node.js-20+-339933)
![Linux](https://img.shields.io/badge/Linux-supported-blue)
![macOS](https://img.shields.io/badge/macOS-supported-blue)
![Windows / WSL](https://img.shields.io/badge/Windows-WSL%20recommended-blue)

</div>

---

## What it is

On the QQ side, messages come and go through NapCat (or any other OneBot implementation). On the model side, it calls the Codex CLI or Claude Code you have already signed in to. In between is a small Node.js service running on your machine (the Hub). It:

- decides which messages deserve a reply and who the reply is for;
- gathers chat history, memory and the group's way of talking and hands them to the model;
- gives the model a set of QQ tools (read history, look up memory, send files, manage the group, and so on) and runs each one with the permissions of the person who sent the message;
- splits the reply into chat bubbles, sends them, and records which ones were actually delivered.

```text
QQ / NapCat / OneBot
        │
        ▼
   Hub (local, :3789) ──── dashboard
        │
        ├── Codex CLI  or  Claude Code
        ├── memory, persona, group habits
        └── web search, logs, maintenance status
```

It is a tool you run yourself, not a hosted service. Accounts, chat data and keys stay on your machine.

## Install

If Node.js is already installed, one line is enough:

```bash
npx -y "codex-qq-bot@$(npm view codex-qq-bot@latest version --prefer-online)"
# or
pnpm dlx "codex-qq-bot@$(npm view codex-qq-bot@latest version --prefer-online)"
```

Without Node.js, use the bootstrap script. It installs what is missing:

```bash
curl -fsSL https://raw.githubusercontent.com/gl813788-byte/codex-qq-bot/main/install.sh | bash
# wget only:
wget -qO- https://raw.githubusercontent.com/gl813788-byte/codex-qq-bot/main/install.sh | bash
```

The installer downloads or upgrades the source, installs Node.js 20+ and the Codex CLI, installs dependencies, and runs `npm run verify`. If it stops halfway, run the same command again and finished steps are skipped. Existing Git worktrees, local changes, `data/`, `config/local.env` and any other `ncc` on the machine are left alone.

Platforms are handled differently: native Linux (apt-get / dnf, glibc) gets NapCat installed automatically; on Termux, PRoot, WSL and containers you bring your own OneBot. Details are in the [installation guide](docs/INSTALLATION.md).

If you already have the source, you can run `一键部署.command` from the repository root instead (double-click on macOS, `./一键部署.command` in a Linux / WSL terminal).

To have an AI do the install, paste the prompt from the [deployment guide](docs/DEPLOY_WITH_CODEX.md) into Codex or Claude Code. It checks the environment, installs, starts everything, and stops to ask you when a QR scan or a key is needed.

## Codex or Claude Code

Both work. You pick one when you start the bot.

| | Codex | Claude Code |
| --- | --- | --- |
| Install | done by the installer | `curl -fsSL https://claude.ai/install.sh \| bash` |
| Sign-in | `codex login` | `claude auth login`, or put a relay URL and key in `~/.claude/ncc-profiles/active.env` |
| Model | switch from the dashboard or QQ commands | `CODEX_REMOTE_CONTACT_CLAUDE_MODEL`, default `opus` |
| Reasoning effort | switch from the dashboard or QQ commands | follows the bot setting unless `CODEX_REMOTE_CONTACT_CLAUDE_EFFORT` is set |
| Image generation | yes | no |
| Quota display | shown in the dashboard | not shown; use `/usage` inside `claude` |

To switch:

```bash
npm run ncc -- engine claude   # or codex
npm run ncc -- start           # an interactive start also asks; press Enter to keep the last choice
```

With Claude Code every reply starts its own `claude -p` process, so replies take a few seconds longer than with Codex, and can take over ten seconds on a slow PRoot host. Permissions are handled like this:

- every turn runs in `--restricted` mode, so file tools only reach the turn's task directory;
- only file tasks from the owner or a bot administrator get a shell; replies triggered by ordinary group members never do;
- WebFetch is off so the model cannot call the local OneBot or Hub APIs; web search is offered only when web lookup is enabled;
- your personal Claude Code settings, hooks and MCP connectors are not loaded, so connectors such as Gmail or Drive are never exposed to QQ users.

Both engines support [host access requests per command](docs/OPERATIONS.md#requesting-host-access-for-a-command). For an owner's local task, the Bot can ask the Hub to execute a specific command; the Hub verifies the original sender. The Bot decides whether human confirmation is needed from the risk and existing authorization. Administrators and ordinary users cannot gain owner access this way.

## What you need

| Item | Notes |
| --- | --- |
| Codex or Claude Code | At least one, signed in. |
| A QQ account and OneBot | NapCat or LLBot. You do the first QR login yourself. |
| Owner QQ number and group numbers | For permissions and the group allowlist; asked for during setup. |
| About 3 GB of free memory | Comfortable for QQ, OneBot, the Hub and model processes together. |
| Windows | Install inside WSL. |

## Features

- **Group and private chat**: in groups it speaks when @-mentioned or replied to, and can join in on its own when the interest model thinks it is worth it. Images, files, forwarded chats, cards and pokes are supported, and `@nickname` in a reply becomes a real mention.
- **Follow-ups while it is still writing**: if someone adds a message mid-reply, it waits five seconds for more, then feeds the new messages into the current turn; only if that fails does it interrupt and rewrite. One reply goes out at the end.
- **Session modes**: each group or private chat can use temporary sessions, long-lived sessions, or automatic selection. Long-lived sessions reuse the same model conversation and only send what is new.
- **Memory**: short-term notes, a long-term knowledge base, impressions of groups and people, and a cross-group unified memory. People are keyed by QQ number, so a changed group card does not lose them. Retrieval uses a local SQLite full-text index plus simple Chinese feature vectors (not a neural model).
- **Learning how people talk**: it tracks pacing, reply length, emoji and punctuation habits, and periodically has the main model compare the bot's style with real members and adjust its rules.
- **Management from QQ**: switch models, change reasoning effort, edit the allowlist and permissions, mute, manage groups, handle friend and join requests, post to Qzone. The owner can appoint bot administrators, who cannot appoint others or make the model run destructive file operations.
- **Manual tasks**: send `/AI任务` in QQ or run `ncc ai-run` to run a chat summary, style review, persona refresh or knowledge review right away.
- **Dashboard**: open `http://127.0.0.1:3789/` for status, channels, memory, the knowledge base and logs. There is also a native macOS wrapper.

See [features](docs/FEATURES.md) for the full description.

## Common commands

Call the repository controller through npm so it cannot clash with another `ncc` on the machine:

```bash
npm run ncc -- status          # status
npm run ncc -- setup           # settings menu
npm run ncc -- start           # start the Hub
npm run ncc -- engine          # show the AI engine; add codex / claude to switch
npm run ncc -- claude-login    # Claude Code sign-in and test
npm run ncc -- session-mode persistent GROUP_ID
npm run ncc -- ai-run style-review GROUP_ID --force
npm run ncc -- logs --errors --since 30m --summary
```

If the machine already has a different NapCat controller named `ncc`, run `ncc help` first to see what it supports.

Default addresses:

- Dashboard: `http://127.0.0.1:3789/`
- Hub state: `http://127.0.0.1:3789/api/state`
- Maintenance: `http://127.0.0.1:3789/api/maintenance`
- OneBot: `http://127.0.0.1:3000`

## Minimum configuration

If `data/settings.json` does not exist it is copied from `config/settings.example.json`. Change at least:

```json
{
  "qq": {
    "allowedGroups": ["YOUR_GROUP_ID"],
    "ownerUserIds": ["YOUR_QQ_ID"]
  },
  "branding": {
    "assistantName": "assistant",
    "ownerLabel": "Owner",
    "assistantMentions": ["@assistant"]
  }
}
```

Keep the OneBot token and OpenRouter / DeepSeek / Tavily keys in `config/local.env` or the process environment, never in the repository. Every option is listed in the [configuration reference](docs/CONFIGURATION.md).

## Layout

```text
src/
  app/                   startup state and composition
  channels/              validation and normalization of QQ / HTTP input
  config/                environment parsing and defaults
  infrastructure/codex/  Codex calls, QQ tools, structured output
  infrastructure/claude/ Claude Code calls and the QQ tool bridge
  infrastructure/agent/  plumbing shared by both engines
  qq-enhancer/           image handling, proactive replies
  unified-memory/        unified memory
  server.js              composition root (still being split up)
modules/                 clients, launchers, NapCat plugin
scripts/                 deployment, ncc, log viewer, static checks
skills/                  maintenance skill for Codex / Claude Code
docs/                    documentation
data/  runtime/          local data and runtime files, not in Git
```

Read the [architecture notes](docs/ARCHITECTURE.md) and [AGENTS.md](AGENTS.md) before changing code.

## Development

```bash
npm install
npm run verify   # syntax check + all tests; run before every commit
```

Put new features in small modules that can be tested on their own instead of growing `src/server.js`.

## Documentation

- [Installation](docs/INSTALLATION.md)
- [Deploying with an AI agent](docs/DEPLOY_WITH_CODEX.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Configuration](docs/CONFIGURATION.md)
- [Features](docs/FEATURES.md)
- [Operations, logs and troubleshooting](docs/OPERATIONS.md)

## Security

- The Hub listens on `127.0.0.1` only by default. LAN access has to be turned on explicitly and needs a management token.
- Never commit `data/settings.json`, `config/local.env`, tokens, cookies, QR codes, logs or databases.
- OneBot callbacks, owner permissions and file paths are all validated. Do not bypass those checks for convenience.
