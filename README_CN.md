<div align="center">

# Codex QQ Bot

### 让 Codex 把本机能力接入 QQ

**QQ / OneBot + Codex CLI 的本地助手中枢**

简体中文 | [English](README.md)

![Node.js](https://img.shields.io/badge/Node.js-20+-339933)
![Linux](https://img.shields.io/badge/Linux-supported-blue)
![macOS](https://img.shields.io/badge/macOS-supported-blue)
![Windows / WSL](https://img.shields.io/badge/Windows-WSL%20recommended-blue)
![Codex](https://img.shields.io/badge/deploy%20with-Codex-111111)

</div>

---

## 最简单安装：终端粘贴一行

已安装 Node.js 时，直接运行下面任意一条；不需要打开 GitHub、手动下载或解压：

```bash
npx -y "codex-qq-bot@$(npm view codex-qq-bot@latest version --prefer-online)"
# 或者
pnpm dlx "codex-qq-bot@$(npm view codex-qq-bot@latest version --prefer-online)"
```

如果还没有 Node.js，可以使用轻量引导命令：

```bash
curl -fsSL https://raw.githubusercontent.com/gl813788-byte/codex-qq-bot/main/install.sh | bash
# 只有 wget 时也可以：
wget -qO- https://raw.githubusercontent.com/gl813788-byte/codex-qq-bot/main/install.sh | bash
```

npm/pnpm 入口是完整安装路径：下载或升级源码后，识别当前环境，补齐 Node.js 20+ 与官方 Codex CLI，安装项目依赖并运行 `npm run verify`。curl/wget 入口不要求预装 Node、Git 或 zsh，完成后提供可用的 `ncc`；如希望立刻把依赖也装完，可追加 `--prepare`。源码、PRoot、Node/Codex、npm 和验证阶段都有校验与续跑标记，重新运行同一个命令会从第一个未完成阶段继续。Git 工作区、本地修改、运行数据和其他同名全局 `ncc` 都会保留。

探测器覆盖 macOS、原生 Linux、WSL、容器、原生 Termux、已有 Termux PRoot、权限类型、架构和 libc。原生 Termux 的 Android 层只准备 `proot-distro`，Node、Codex、依赖、验证和日常 `ncc` 全部进入受管 Debian；已经位于 PRoot 时直接使用，不再嵌套。Termux/PRoot、WSL 和容器使用外部 OneBot，受支持的原生 apt-get/dnf glibc Linux 才会自动安装 NapCat。完整决策表、参数、缓存、root 规则和恢复方法见[一键安装与环境方案](docs/INSTALLATION_CN.md)。

## 也可以直接让 Codex 部署

如果你希望 Codex 同时负责启动 OneBot、扫码后的连接和最终验收，可以把下面的提示词直接交给它。Codex 会检查系统、保护已有配置、安装依赖、验证项目、启动 Hub，并把扫码登录或缺失凭据等必须由你完成的步骤单独指出。

把整段复制到 Codex：

```text
请帮我在当前机器部署 Codex QQ Bot：
https://github.com/gl813788-byte/codex-qq-bot.git

目标：让 QQ / OneBot 接入当前 Codex CLI，并在本机启动可访问的 Hub 与仪表盘。

请直接执行部署，不要只给我命令清单。按以下要求持续推进到可验证的最终状态：
1. 先检查操作系统、CPU 架构、Git、Node.js、npm、zsh、curl、Codex CLI、现有 OneBot/NapCat 和现有 ncc；Node.js 必须为 20 或更高。
2. 如果项目不存在，克隆到稳定目录；Linux root 环境默认用 /root/Codex-QQ-Bot，其他环境选合适的用户目录。如果已存在旧版 /root/Codex-Remote-Contact，继续复用而不要强制迁移。先检查 Git remote、分支和工作区，绝不覆盖本地改动、配置、data 或 runtime。
3. 阅读仓库 README_CN.md、docs/INSTALLATION_CN.md、docs/DEPLOY_WITH_CODEX_CN.md、docs/ARCHITECTURE_CN.md，以及 skills/codex-qq-bot/SKILL.md（如果适用于当前环境）。
4. 安装依赖并运行 npm run verify；任何失败都要定位并修复，不能跳过验证。
5. 如果 data/settings.json 不存在，从 config/settings.example.json 创建；已有文件只做必要的合并，不重置。需要主人 QQ 号、群白名单、OneBot 地址或密钥时再向我询问，并避免在输出中泄露密钥。
6. 检查当前 ncc 到底是仓库自带快捷配置器还是独立 NapCat 控制器，先运行帮助再使用，不能覆盖一个正在使用的同名控制脚本。仓库自带入口始终可用 npm run ncc -- <command> 调用。
7. 检查 OneBot。如果 NapCat/LLBot 已安装就复用；如果未安装，按当前平台选择受支持的 OneBot 实现并说明来源。涉及下载、系统安装或提权时先请求授权。
8. 启动 Hub 和 OneBot。若 QQ 需要扫码，只在此时把二维码 URL、WebUI 地址和最短操作告诉我；我确认登录后，你继续完成连接与白名单配置。
9. 最后实际验证：npm run verify、Hub /api/state、仪表盘首页、OneBot get_login_info、QQ 通道状态和最近错误日志。分别报告每一项成功或失败，不要在必需组件仍不可用时声称部署完成。
10. 保持 Hub 默认仅监听回环地址；除非我明确要求局域网访问，否则不要开放远程监听。不要把 token 写进 Git 跟踪文件。
```

更完整的部署说明、升级提示词和验收表见 [Codex 部署指南](docs/DEPLOY_WITH_CODEX_CN.md)。

## 已下载源码时的一键部署文件

如果已下载并解压本项目，可以只运行根目录的 `一键部署.command`。macOS 可直接双击，Linux / WSL 可在终端执行：

```bash
chmod +x 一键部署.command
./一键部署.command
```

该入口会进入仓库版 `ncc`，显示环境决策，补齐缺失依赖，运行 `npm run verify`，再引导填写主人 QQ、群白名单、OneBot 地址、助手名称与联网配置。已有 `data/settings.json`、`config/local.env` 和其他同名全局 `ncc` 都会保留。仓库不重新分发 QQ/NapCat 二进制，首次 QQ 扫码仍需由你本人完成。

## 你只需要准备什么

| 项目 | 用途 |
| --- | --- |
| Codex | 负责部署、修改、排障和实际调用模型。可使用 Codex CLI、IDE 或桌面端打开项目。 |
| Bash + 可用包管理器 | 启动自举；缺失系统包时使用真实 root、sudo/doas，原生 Termux 使用普通应用用户与 `pkg`。Windows 推荐使用 WSL。 |
| Node.js 20+、zsh、Codex CLI | 一键部署会自动补齐，不需要预装。 |
| QQ + OneBot 实现 | 受支持的原生 apt-get/dnf Linux 默认自动安装官方 NapCat/LinuxQQ；Termux/PRoot、WSL、容器等复用外部 OneBot。 |
| 主人 QQ 号与群号 | 用于权限和群白名单；部署到相应步骤时再提供。 |
| 约 3GB 可用内存 | 同时运行 QQ、OneBot、Hub 和 Codex 时建议保留。 |

Codex CLI 的官方登录方式是运行 `codex login` 完成浏览器登录；也支持 API key 登录。参考 [OpenAI Codex 身份验证文档](https://learn.chatgpt.com/docs/auth)。

## 项目解决什么问题

```text
QQ / NapCat / OneBot
          |
          v
       Codex QQ Bot Hub --------> 本地仪表盘
          |
          +-----> Codex CLI / 当前登录模型
          +-----> QQ 记忆、人格、兴趣与表情系统
          +-----> 联网搜索、日志和维护状态
          +-----> 浏览器与 macOS 仪表盘客户端
```

主要能力：

- QQ 群聊与私聊：接收 @，并把回复中的 `@准确昵称 ` / `@QQ号 ` 转成真实 QQ 艾特；多人融合回复可由模型为任意候选人选择引用、艾特或普通回复，另支持拍一拍、图片、文件、合并转发、卡片和带投递回执的多气泡消息。
- Codex App Server 原生 Agent：多轮工具、计划、上下文压缩、Web Search 和文件/Shell 操作由 Codex 原生能力负责；Hub 以动态工具补充带可信角色权限的 QQ 历史、记忆、知识、中文搜索兜底、真实社交动作、特权运行时设置和跨会话焦点。最终回复使用严格结构化 Schema，不再依赖命令/进度/预算文字 marker。
- 融合追问与会话模式：生成期间的 @、回复、兴趣命中等触发先去重并补齐中间语境，静默满 5 秒后优先引导当前 turn，失败时才中断并开始替代回答；替代 turn 只有在完整的“任务类型 × 思考强度”协议静默时限内都无进展时才会隔离旧进程，并把原始完整上下文与融合输入放进新 app-server 线程重试一次。支持按群/私聊选择临时、长期或自动 Codex 线程，长期模式只补增量上下文。
- 自适应社交行为：学习群聊节奏、回复长度、表情/贴纸习惯和合适的主动发言时机；独立的主模型风格复盘会精准比较真人/Bot 语气并保存简述、详诊和覆盖式优化规则。兴趣模型只承担有界的轻量判定、分类和初筛；复杂后台审核采用“兴趣模型初筛 → 主模型终审”。
- AI 手动任务中心：QQ `/AI任务` 与 NCC 可统一触发聊天总结、范围记忆总结、群风格复盘、全局人设刷新、知识库审核或当前范围的全部适用任务；显式“强制执行”可跳过到期、冷却和常规样本门槛，但不会绕过权限、群白名单、并发锁、OneBot 身份或空数据保护。
- 分层记忆与聊天召回：普通聊天和融合追问都会完整发送连续的近期窗口，只对更早的人类/Bot 聊天片段按当前消息、引用和融合追问做语义筛选；同一查询同时召回短期记忆、长期知识、群/人物印象和跨端统一记忆。本地 SQLite + FTS 混合层使用确定性的中文短语/概念特征向量，并非 BERT 神经模型。人物以 QQ 号为稳定主键，并合并各群名片、私聊昵称及 Bot 维护别称；AI 判定完整的非敏感人物画像会提升到统一记忆，之后在其他群聊/私聊识别到此人时扩展召回其各会话 AI 画像。自动上下文只注入简述，详细画像使用本轮按人物动态开放的工具读取。
- QQ 管理：模型、思考强度、推理摘要、Agent 人格、服务档位、会话模式、白名单、权限、ban、群管理、可容错好友/入群申请、跨会话读写和 QQ 空间动态。主人可持久授予独立 Bot 管理员完整菜单与 Agent；管理员不能继续授权、冒充主人或让 Agent 执行关键破坏性文件操作。配置会在确认成功前原子持久化，schema v3 日志统一记录 Agent/工具、跨会话、管理员、社交和设置结果。
- 兴趣模型厂商：可在仪表盘或 QQ 命令中选择 OpenRouter、DeepSeek 和自定义 OpenAI 兼容服务，密钥仍只保存在环境中。
- 本地仪表盘：七个专注视图覆盖运行状态、通道、行为、短期记忆、可编辑长期知识库、结构化日志、主题和可选局域网访问。
- macOS 客户端与浏览器仪表盘共用同一条 QQ/OneBot Hub 链路，不需要 Messages 数据库或 iMessage 自动化权限。

完整功能边界见 [功能说明](docs/FEATURES_CN.md)。

## 部署完成后的常用入口

仓库自带控制器建议通过 npm 调用，避免与机器上已有的同名 `ncc` 冲突：

```bash
npm run ncc -- status
npm run ncc -- setup
npm run ncc -- start
npm run ncc -- session
npm run ncc -- session-mode persistent 群号
npm run ncc -- ai-tasks
npm run ncc -- ai-run style-review 群号 --force
npm run ncc -- logs --errors --since 30m --summary
```

如果 Codex 检测到机器已经安装独立的 NapCat 控制器，请先执行 `ncc help`，再按它显示的命令操作。本机定制控制器可能提供 `ncc all`、`ncc connect`、`ncc hub` 等额外命令，但这些不是公共仓库的通用前提。

默认地址：

- 仪表盘：`http://127.0.0.1:3789/`
- Hub 状态：`http://127.0.0.1:3789/api/state`
- 维护状态：`http://127.0.0.1:3789/api/maintenance`
- OneBot：`http://127.0.0.1:3000`

## 最小配置

首次部署时，Codex 会在缺失时从 `config/settings.example.json` 创建 `data/settings.json`。至少确认：

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

本地密钥、OneBot token、OpenRouter/DeepSeek/Tavily key 和网络绑定应放在未跟踪的环境文件或进程环境中，不要提交到仓库。详细字段和优先级见 [配置参考](docs/CONFIGURATION_CN.md)。

## 项目结构

```text
src/
  app/                 应用初始状态与组合边界
  channels/qq/         QQ / OneBot 不可信输入边界
  config/              环境变量默认值、校验与归一化
  qq-enhancer/         QQ 回复、图片与主动兴趣增强
  unified-memory/      统一记忆与最近 Codex 上下文
  server.js            组合根与仍在渐进拆分的运行时逻辑
modules/               共享客户端、启动器和 NapCat 扩展
scripts/               部署、ncc、日志与静态检查
data/                  本地持久状态；多数运行文件不跟踪
runtime/               日志、回复、临时任务与生成物；不跟踪
test/                  Node.js 回归测试
skills/                随仓库分发的 Codex Skill
docs/                  部署、架构、配置、功能和运维文档
```

后续修改前先读 [架构与目录职责](docs/ARCHITECTURE_CN.md)。Codex 会自动读取仓库根目录的 [AGENTS.md](AGENTS.md)，其中记录了测试命令、文档同步和安全边界。

## 开发与验证

```bash
npm install
npm run check
npm test
npm run test:coverage
npm run verify
```

任何行为调整都应至少运行 `npm run verify`。配置、应用状态和 OneBot 事件边界已有独立测试，新增功能应继续放在可单测模块中，避免扩大 `src/server.js`。

## 文档导航

- [一键安装与环境方案](docs/INSTALLATION_CN.md)
- [让 Codex 部署](docs/DEPLOY_WITH_CODEX_CN.md)
- [架构与目录职责](docs/ARCHITECTURE_CN.md)
- [配置参考](docs/CONFIGURATION_CN.md)
- [功能说明](docs/FEATURES_CN.md)
- [运行、日志与故障排查](docs/OPERATIONS_CN.md)
- [English README](README.md)

## 安全说明

- Hub 默认只监听回环地址。远程访问必须显式开启、配置管理 token，并建议放在带 TLS 与访问控制的反向代理后。
- 不要提交 `data/settings.json`、`config/local.env`、token、Cookie、二维码、日志或运行数据库。
- OneBot 回调、主人权限和本地文件 marker 都有额外校验；不要为了方便绕过这些边界。
- macOS 客户端只是同一仪表盘的原生外壳；项目不再包含 macOS 独有的代理、显示器、防休眠或桌面控制能力。
- 这是本地自动化工具，不是托管式公网 Bot 服务。
