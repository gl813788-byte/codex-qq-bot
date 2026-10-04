<div align="center">

# Codex QQ Bot

把 QQ 接到你电脑上的 Codex 或 Claude Code，做一个能聊天、也能干活的 QQ 机器人。

简体中文 | [English](README.md)

![Node.js](https://img.shields.io/badge/Node.js-20+-339933)
![Linux](https://img.shields.io/badge/Linux-supported-blue)
![macOS](https://img.shields.io/badge/macOS-supported-blue)
![Windows / WSL](https://img.shields.io/badge/Windows-WSL%20recommended-blue)

</div>

---

## 它是什么

QQ 这边通过 NapCat（或其他 OneBot 实现）收发消息，模型这边调用你本机已经登录好的 Codex CLI 或 Claude Code。中间是一个跑在本机的 Node.js 服务（下面叫 Hub），负责：

- 决定哪些消息该回、回给谁；
- 把聊天记录、记忆、群里的说话习惯整理好交给模型；
- 给模型提供一组 QQ 工具（翻历史、查记忆、发文件、群管理等），并按发消息的人的权限执行；
- 把模型的回复拆成气泡发回 QQ，并记下哪些真正发出去了。

```text
QQ / NapCat / OneBot
        │
        ▼
   Hub（本机，:3789）──── 仪表盘
        │
        ├── Codex CLI  或  Claude Code
        ├── 记忆、人设、群聊习惯
        └── 联网搜索、日志、维护状态
```

它是跑在自己机器上的工具，不是托管服务。账号、聊天数据和密钥都留在本机。

## 安装

已经有 Node.js 的话，一行就够：

```bash
npx -y "codex-qq-bot@$(npm view codex-qq-bot@latest version --prefer-online)"
# 或者
pnpm dlx "codex-qq-bot@$(npm view codex-qq-bot@latest version --prefer-online)"
```

没有 Node.js 就用引导脚本，它会自己补齐：

```bash
installer="$(mktemp "${TMPDIR:-$HOME}/codex-qq-bot-install.XXXXXX")" &&
curl --disable -fSL --retry 3 --connect-timeout 15 --max-time 180 \
  https://raw.githubusercontent.com/gl813788-byte/codex-qq-bot/main/install.sh -o "$installer" &&
bash "$installer" --prepare
```

安装器会下载或升级源码，装好 Node.js 20+ 和 Codex CLI，装依赖，然后跑一遍 `npm run verify`。中途断了就重新运行同一条命令，已经完成的步骤会跳过。已有的 Git 工作区、本地改动、`data/`、`config/local.env` 和机器上别的 `ncc` 都不会被覆盖。

引导脚本完整下载成功后才会执行，避免网络中断时运行半截脚本。只有 wget 时，可用 `wget -T 15 -t 3 -O "$installer" <同一下载地址>` 替换 curl 命令。Termux 会自动进入受管 PRoot；网络重试、代理/证书传递和兼容性限制见安装说明。

各平台的处理方式不一样：原生 Linux（apt-get / dnf，glibc）会自动装 NapCat；Termux、PRoot、WSL 和容器需要你自己准备 OneBot。细节见[安装说明](docs/INSTALLATION_CN.md)。

已经下载了源码的话，运行根目录的 `一键部署.command` 也可以（macOS 双击，Linux / WSL 在终端里 `./一键部署.command`）。

想让 AI 帮你装，可以把[部署指南](docs/DEPLOY_WITH_CODEX_CN.md)里的提示词整段交给 Codex 或 Claude Code，它会检查环境、安装、启动，并在需要扫码或填密钥时停下来问你。

## 选择 Codex 还是 Claude Code

两个都能用，启动时选。

| | Codex | Claude Code |
| --- | --- | --- |
| 安装 | 安装器自动装 | 自己装：`curl -fsSL https://claude.ai/install.sh \| bash` |
| 登录 | `codex login` | `claude auth login`，或在 `~/.claude/ncc-profiles/active.env` 里配中转地址和 key |
| 模型 | 仪表盘或 QQ 命令里切换 | `CODEX_REMOTE_CONTACT_CLAUDE_MODEL`，默认 `opus` |
| 思考强度 | 仪表盘或 QQ 命令里切换 | 默认跟 Bot 的设置走，也可以用 `CODEX_REMOTE_CONTACT_CLAUDE_EFFORT` 单独指定 |
| 生成图片 | 支持 | 不支持 |
| 额度显示 | 仪表盘里能看到 | 不显示，用 `claude` 里的 `/usage` 查 |

切换方法：

```bash
npm run ncc -- engine claude   # 或 codex
npm run ncc -- start           # 在终端里启动时也会问一次，直接回车沿用上次的选择
```

用 Claude Code 时，每一轮回复都会单独起一个 `claude -p` 进程，因此比 Codex 多几秒启动时间，在性能较弱的 PRoot 环境里可能要十几秒。权限方面的处理是：

- 所有轮次都用 `--restricted` 模式运行，读写文件只能在本轮的任务目录里；
- 只有主人和 Bot 管理员的文件任务能用 Shell，普通群友触发的回复拿不到 Shell；
- 不开放 WebFetch，免得模型去访问本机的 OneBot 和 Hub 接口；联网搜索只在开启联网时提供；
- 不读取你个人的 Claude Code 设置、hooks 和 MCP 连接器，所以 Gmail、网盘这类连接器不会暴露给 QQ 用户。

两个引擎都支持[按命令申请本机权限](docs/OPERATIONS_CN.md#按命令申请本机权限)：主人提出本机操作时，Bot 可以向 Hub 申请执行具体命令，由 Hub 核验原始发送者身份；是否先向人确认由 Bot 根据风险和已有授权判断。管理员和普通群友不能借此获得主人权限。

## 需要准备什么

| 东西 | 说明 |
| --- | --- |
| Codex 或 Claude Code | 至少一个，并且已经登录。 |
| QQ 小号和 OneBot | NapCat、LLBot 都可以。首次扫码登录要你自己来。 |
| 主人 QQ 号、群号 | 用来设置权限和群白名单，安装到那一步再填。 |
| 大约 3GB 空闲内存 | QQ、OneBot、Hub 和模型进程一起跑时比较稳。 |
| Windows 用户 | 建议在 WSL 里装。 |

## 主要功能

- **群聊和私聊**：群里默认要 @ 或回复才会说话；也能被兴趣模型判断为值得接话时主动开口。支持图片、文件、合并转发、卡片、拍一拍，回复里的 `@昵称` 会变成真的艾特。
- **回复过程中的追问**：模型还在写的时候又有人问，会先等 5 秒看还有没有下文，然后把新消息塞进当前这一轮；塞不进去才中断重写，最后只发一份回复。
- **会话模式**：每个群或私聊可以选临时对话、长期对话，或者自动判断。长期对话会续用同一个模型会话，只补发新消息。
- **记忆**：分短期笔记、长期知识库、对群和对人的印象，以及跨群的统一记忆。人按 QQ 号识别，群名片改了也认得。检索用本地 SQLite 全文索引加一套简单的中文特征向量（不是神经网络模型）。
- **学说话方式**：统计群里的节奏、回复长短、表情和标点习惯；定期让主模型对比真人和 Bot 的说话方式，调整规则。
- **QQ 里直接管理**：切模型、改思考强度、白名单、权限、禁言、群管理、处理好友和入群申请、发 QQ 空间。主人可以设 Bot 管理员，管理员不能再授权别人，也不能让模型做破坏性的文件操作。
- **手动任务**：在 QQ 里发 `/AI任务`，或用 `ncc ai-run`，可以立刻跑聊天总结、风格复盘、人设刷新、知识库审核。
- **仪表盘**：浏览器打开 `http://127.0.0.1:3789/`，能看运行状态、通道、记忆、知识库和日志。macOS 另有一个原生壳。

更完整的说明见[功能说明](docs/FEATURES_CN.md)。

## 常用命令

仓库自带的控制器用 npm 调，免得和机器上别的 `ncc` 撞名：

```bash
npm run ncc -- status          # 看状态
npm run ncc -- setup           # 配置菜单
npm run ncc -- start           # 启动 Hub
npm run ncc -- engine          # 查看当前 AI 引擎；后面跟 codex / claude 可切换
npm run ncc -- claude-login    # Claude Code 登录和测试
npm run ncc -- session-mode persistent 群号
npm run ncc -- ai-run style-review 群号 --force
npm run ncc -- logs --errors --since 30m --summary
```

如果机器上已经有别的 NapCat 控制脚本也叫 `ncc`，先 `ncc help` 看清楚它支持什么再用。

默认地址：

- 仪表盘：`http://127.0.0.1:3789/`
- Hub 状态：`http://127.0.0.1:3789/api/state`
- 维护信息：`http://127.0.0.1:3789/api/maintenance`
- OneBot：`http://127.0.0.1:3000`

## 最少要配的东西

`data/settings.json` 不存在时会从 `config/settings.example.json` 复制一份。至少改这几项：

```json
{
  "qq": {
    "allowedGroups": ["你的QQ群号"],
    "ownerUserIds": ["你的QQ号"]
  },
  "branding": {
    "assistantName": "assistant",
    "ownerLabel": "主人",
    "assistantMentions": ["@assistant"]
  }
}
```

OneBot token、OpenRouter / DeepSeek / Tavily 的 key 这类东西放在 `config/local.env` 或进程环境变量里，别提交进仓库。所有配置项见[配置参考](docs/CONFIGURATION_CN.md)。

## 目录

```text
src/
  app/                   启动时的状态和组装
  channels/              QQ / HTTP 输入的校验和归一化
  config/                环境变量解析和默认值
  infrastructure/codex/  Codex 调用、QQ 工具、结构化输出
  infrastructure/claude/ Claude Code 调用和 QQ 工具桥
  infrastructure/agent/  两个引擎共用的底层
  qq-enhancer/           图片处理、主动接话
  unified-memory/        统一记忆
  server.js              组装入口（还在逐步拆分）
modules/                 客户端、启动器、NapCat 插件
scripts/                 部署、ncc、日志查看、静态检查
skills/                  给 Codex / Claude Code 用的维护 Skill
docs/                    文档
data/  runtime/          本地数据和运行时文件，不进 Git
```

改代码前先看[架构说明](docs/ARCHITECTURE_CN.md)和根目录的 [AGENTS.md](AGENTS.md)。

## 开发

```bash
npm install
npm run verify   # 语法检查 + 全部测试，提交前必跑
```

新功能尽量写成可以单独测试的小模块，别再往 `src/server.js` 里堆。

## 文档

- [安装说明](docs/INSTALLATION_CN.md)
- [让 AI 帮你部署](docs/DEPLOY_WITH_CODEX_CN.md)
- [架构说明](docs/ARCHITECTURE_CN.md)
- [配置参考](docs/CONFIGURATION_CN.md)
- [功能说明](docs/FEATURES_CN.md)
- [运行、日志和排障](docs/OPERATIONS_CN.md)

## 安全

- Hub 默认只监听 `127.0.0.1`。要从局域网访问，得显式打开，并配好管理 token。
- `data/settings.json`、`config/local.env`、token、Cookie、二维码、日志和数据库都不要提交。
- OneBot 回调、主人权限、文件路径都有校验，不要为了省事绕过去。
