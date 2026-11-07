# 配置参考

简体中文 | [English](CONFIGURATION.md)

项目把“可持久修改的用户设置”和“密钥/进程启动参数”分开保存。部署或修改配置时，优先让 Codex 检查当前机器并做字段级合并，避免整文件覆盖。

## 配置来源与优先级

```text
进程环境变量
    -> src/config/environment.js 归一化为启动默认值
    -> data/settings.json 覆盖可持久字段
    -> 运行时通过仪表盘或 QQ 命令修改并原子保存
```

- `npm run ncc -- start` 会先加载 `config/local.env`。
- 直接执行 `npm start` 不会自动加载 `config/local.env`，只继承当前 shell 的环境。
- 本机定制的全局 `ncc` 可能改用 `/root/.napcat-codex-control.env` 与 `/root/.codex/ncc-profiles/active.env`；先运行 `ncc help` 判断命令来源。
- `data/settings.json` 加载后会覆盖对应的环境默认值，例如模型、群白名单和主动兴趣开关。
- OneBot、管理 API、OpenRouter 和 Tavily 密钥应保留在未跟踪环境文件中。

## 配置文件

| 文件 | 用途 | 是否提交 |
| --- | --- | --- |
| `config/settings.example.json` | 持久配置 schema 与示例 | 是 |
| `data/settings.json` | 当前机器的用户设置、权限和网络状态 | 否 |
| `config/local.env` | 仓库 `ncc start` 使用的本地环境变量与密钥 | 否；权限建议 `600` |
| `src/config/environment.js` | 环境变量名称、默认值、范围和归一化的权威实现 | 是 |
| `runtime/logs/hub.jsonl` | 结构化运行日志，不是配置 | 否 |
| `data/qq-human-actions.json` | 各会话群友互动频率的匿名统计（贴表情、拍一拍、撤回、分享等） | 否 |
| `runtime/media-tools/` | 可选媒体组件（分镜、语音识别模型、yt-dlp） | 否 |
| `data/qq-bot-drawings/` | Bot 自己画的画（按内容哈希存放，索引在 `data/qq-bot-life.json`） | 否 |

首次配置：

```bash
cp config/settings.example.json data/settings.json
chmod 600 data/settings.json
npm run ncc -- setup
```

已有 `data/settings.json` 时不要再次复制示例文件。

## `data/settings.json`

最小可用配置：

```json
{
  "version": 3,
  "qq": {
    "allowedGroups": ["QQ群号"],
    "ownerUserIds": ["主人QQ号"],
    "adminUserIds": ["Bot管理员QQ号"],
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
        "QQ群号": "persistent",
        "private:QQ号": "temporary"
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
    "ownerLabel": "主人",
    "assistantMentions": ["@assistant"]
  }
}
```

主要字段：

| 路径 | 含义 |
| --- | --- |
| `qq.allowedGroups` | 允许处理的 QQ 群号；群号按字符串保存 |
| `qq.ownerUserIds` | 拥有绝对管理权限的 QQ 号 |
| `qq.adminUserIds` | 由主人授予的 Bot 管理员；可用完整菜单、Agent 与跨会话，但不能授予/撤销管理员或冒充主人 |
| `qq.bannedUserIds` / `bannedUntilByUserId` | 永久与临时 ban |
| `qq.enhancer.enabled` | 图片、风格、兴趣等 QQ 增强总开关 |
| `qq.webLookup.enabled` | QQ 联网查询运行时开关；可由网页端持久化修改 |
| `qq.proactive.*` | 普通消息/分钟兴趣触发与 judge 配置 |
| `qq.commandPermissions` | 非主人可见且可执行的公共/用户级指令 |
| `qq.codexSession.defaultMode` | 未单独覆盖 scope 的 `auto` / `persistent` / `temporary` 默认模式 |
| `qq.codexSession.scopes` | 按群号或 `private:QQ号` 覆盖会话模式；线程 ID 不写入设置文件 |
| `ai.*` | QQ 使用的模型、思考强度、推理摘要、Codex 人格与模型公布的服务档位 |
| `unifiedMemory.*` | 自动写入与手动交接策略 |
| `branding.*` | 助手名称、主人称呼和 @ 别名 |
| `network.allowLanAccess` | 仪表盘持久化的局域网开关 |
| `network.publicTunnelEnabled` | Cloudflare 临时 Quick Tunnel 的持久期望状态；默认 `false` |
| `network.apiToken` | 自动生成的远程管理 token；真实值只能保留在未跟踪本机设置或环境中 |

网页端“智能行为”页可持久化修改 `qq.enhancer.enabled`、`qq.webLookup.enabled`、主动兴趣开关、判定开关、消息/分钟间隔、判定模型、静默超时和最近上下文数量。显式 @ Bot 的正常回复不依赖主动兴趣开关。主人可用 `/思考强度`、`/推理摘要`、`/人格` 和 `/服务档位` 查看或修改原生轮次参数；服务档位从当前模型目录动态读取（例如 `fast`），不再硬编码。Hub 会在确认成功前原子落盘，并从下一轮 App Server turn 起应用。模型切换应使用当前 Codex 登录实际提供的模型列表。

主人可在 QQ 使用 `/会话模式` 和 `/会话模式 自动|长期|临时` 修改当前群/私聊。管理 API 为 `POST /api/qq/session-mode`，请求体为 `{"mode":"auto|persistent|temporary","scopeId":"可选群号或 private:QQ号"}`；scope 使用 `inherit` 可删除覆盖。仓库控制器使用 `npm run ncc -- session` 与 `npm run ncc -- session-mode MODE [SCOPE]`，支持该能力的全局控制器使用相同命令名。实际线程映射单独保存在 `data/qq-codex-sessions.json`，`/新对话` 只停止复用当前映射，不删除 Codex CLI 自身的历史文件。

## 一键部署环境变量

这些变量只控制安装阶段，不会成为 Hub 的运行配置：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CODEX_QQ_BOT_INSTALL_DIR` | root 为 `/root/Codex-QQ-Bot`，其他用户为 `~/Codex-QQ-Bot` | 源码安装目录；已有旧版 `Codex-Remote-Contact` 会继续复用 |
| `CODEX_QQ_BOT_INSTALL_STATE_DIR` | `<安装目录>.install-cache` | 源码阶段、损坏下载隔离和无 Git 升级备份 |
| `CODEX_QQ_BOT_SOURCE_BRANCH` | 仓库默认分支 | 显式指定源码分支 |
| `CODEX_QQ_BOT_NCC_BIN` | 第一个安全可写的 bin 目录 | 显式指定全局 `ncc` 包装器位置 |
| `CODEX_QQ_BOT_INSTALL_NAPCAT` | `auto` | `auto` 只在受支持的原生 apt-get/dnf glibc Linux 自动安装；Termux/PRoot、WSL、容器、macOS 和其他平台复用外部 OneBot；`required` 在不支持时提前失败 |
| `CODEX_QQ_BOT_NODE_MAJOR` | `22` | 兼容平台自动安装的 Node.js 官方主版本；原生 Termux 使用受管 PRoot，musl 使用发行版包；最终都必须满足 Node 20+ |
| `CODEX_QQ_BOT_USER_PREFIX` | `~/.local` | Node/Codex 的用户隔离命令前缀 |
| `CODEX_QQ_BOT_BOOTSTRAP_CACHE_DIR` | `~/.cache/codex-qq-bot/bootstrap` | Node/NapCat 自举下载与断点阶段缓存 |
| `CODEX_QQ_BOT_MANAGED_NODE_HOME` | `~/.local/share/codex-qq-bot/node` | 项目自管 Node.js 目录 |
| `CODEX_QQ_BOT_NAPCAT_HOME` | `~/Napcat` | NapCat 官方 Rootless Shell 安装目录 |
| `CODEX_QQ_BOT_TERMUX_DISTRO` | `debian` | 原生 Termux 自动安装/复用的 PRoot 发行版；已经位于 PRoot 时不会嵌套 |
| `CODEX_QQ_BOT_TERMUX_GUEST_PROJECT_DIR` | `/opt/codex-qq-bot` | 项目在受管 PRoot 中的绑定路径，真实文件仍保存在 Termux 用户目录 |
| `CODEX_QQ_BOT_TERMUX_STATE_DIR` | `~/.local/state/codex-qq-bot` | 受管 PRoot 准备状态 |
| `CODEX_QQ_BOT_PREPARE_AFTER_INSTALL` | npm 入口为 `1`，raw `install.sh` 为 `0` | 源码就位后是否继续完成平台依赖、Codex、npm 依赖与 `verify`；命令行 `--prepare` / `--download-only` 可覆盖 |
| `CODEX_QQ_BOT_CONNECT_TIMEOUT` | `15` | curl 连接超时秒数；wget 连接/读取超时 |
| `CODEX_QQ_BOT_DOWNLOAD_TIMEOUT` | `600` | 每次 curl 文件下载最长秒数 |
| `CODEX_QQ_BOT_METADATA_TIMEOUT` | `60` | 每次源码/Node 清单下载最长秒数 |
| `CODEX_QQ_BOT_DOWNLOAD_ATTEMPTS` | `3` | 单次下载最多尝试次数，范围 1–5 |
| `CODEX_QQ_BOT_NODE_DIST_URL` | `https://nodejs.org/dist` | Node 官方格式发行根地址，包含版本目录和校验清单 |
| `CODEX_QQ_BOT_NPM_REGISTRY` | `npm 配置` | 显式覆盖安装用 registry；不会自动切换到第三方源 |
| `CODEX_QQ_BOT_NPM_CACHE` | `~/.cache/codex-qq-bot/npm` | 独立 npm 缓存，默认遵循 XDG_CACHE_HOME |
| `CODEX_QQ_BOT_GIT_URL` | `https://github.com/<repository>.git` | API 失败时使用的 Git 远端；自定义 API 需要显式设置 |
| `CODEX_QQ_BOT_TERMUX_IMAGE` | `空` | 新 OCI proot-distro 的镜像/本地归档来源；已有容器仍优先复用 |

具体行为与决策矩阵见[一键安装与环境方案](INSTALLATION_CN.md)。测试专用的 `CODEX_QQ_BOT_BOOTSTRAP_FORCE_*` 变量不属于用户配置接口。

## 核心环境变量

### Hub 与安全

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CODEX_REMOTE_CONTACT_HOST` | 回环地址 | 显式监听地址 |
| `CODEX_REMOTE_CONTACT_PORT` | `3789` | Hub 端口，必须为有效端口 |
| `CODEX_REMOTE_CONTACT_ALLOW_REMOTE` | `0` | 设为 `1` 才允许显式非回环绑定 |
| `CODEX_REMOTE_CONTACT_CORS_ORIGINS` | 本机三个默认 Origin | 允许的 Origin 列表 |
| `CODEX_REMOTE_CONTACT_API_TOKEN` | 空 | 非回环管理 API 认证 token |

非回环监听必须同时满足远程绑定开关和 API token；通配符 CORS 没有 token 时会拒绝启动。

### Codex

启动时按 `CODEX_REMOTE_CONTACT_RESOURCE_PROFILE`（或 `NCC_RESOURCE_PROFILE`）自动分配资源，支持 `auto`（默认）、`standard`、`balanced`、`low`。自动档至少预留 256 MiB，至多取 2 GiB、有效总内存 15%、可用内存 25% 中的最小值。估算 QQ/Hub 共用开销后，按每个模型进程约 512 MiB、每两个可用 CPU 至多一个进程分配并发（内存允许时至少一个）。下表中的明确配置覆盖自动默认值；已指定的 Node `--max-old-space-size` 会保留。`NCC_MEMORY_STANDARD_MB`、`NCC_MEMORY_BALANCED_MB`、`NCC_MEMORY_MINIMUM_MB` 默认分别为 `3600`、`1800`、`1024`；自动预算不足会拒绝启动。可用 `npm run ncc -- resources --json` 预览。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CODEX_CLI_PATH` | macOS App 内置路径 | Codex 可执行文件；Linux/Windows 部署应设置或保证 `codex` 可发现 |
| `CODEX_REMOTE_CONTACT_CODEX_MODEL` | `gpt-5.4-mini` | QQ 默认模型 |
| `CODEX_REMOTE_CONTACT_REASONING_EFFORT` | `low` | QQ 默认思考强度 |
| `CODEX_REMOTE_CONTACT_REASONING_SUMMARY` | `auto` | App Server 可展示推理摘要的详细度：`auto`、`concise`、`detailed` 或 `none`；它不是完整内部思维，也不改变思考强度 |
| `CODEX_REMOTE_CONTACT_CODEX_PERSONALITY` | `none` | App Server 人格：`none`、`friendly` 或 `pragmatic` |
| `CODEX_REMOTE_CONTACT_CODEX_SERVICE_TIER` | 空 | 模型公布的服务档位 ID，例如 `fast`；无效值会按实时模型目录清除 |
| `CODEX_REMOTE_CONTACT_CODEX_MAX_CONCURRENCY` | `2` | Codex 同时运行数，范围 1–8 |
| `CODEX_REMOTE_CONTACT_CODEX_MAX_PENDING` | `32` | 等待队列，范围 0–256 |
| `CODEX_REMOTE_CONTACT_QUOTA_CACHE_TTL_MS` | `30000` | 额度信息缓存时间 |
| `CODEX_REMOTE_CONTACT_CODEX_REPLY_TIMEOUT_MS` | `120000` | 普通文字回复在 `low` 档的单轮基础时限 |
| `CODEX_REMOTE_CONTACT_CODEX_VISION_REPLY_TIMEOUT_MS` | `180000` | 带图片理解的回复在 `low` 档的单轮基础时限 |
| `CODEX_REMOTE_CONTACT_CODEX_CONTEXT_SUMMARY_TIMEOUT_MS` | `90000` | `/总结聊天记录` 时限 |
| `CODEX_REMOTE_CONTACT_CODEX_SELF_PERSONA_TIMEOUT_MS` | `90000` | 自我人格摘要/刷新时限 |
| `CODEX_REMOTE_CONTACT_CODEX_FILE_TASK_TIMEOUT_MS` | `300000` | 主人本机文件任务时限 |
| `CODEX_REMOTE_CONTACT_CODEX_IMAGE_GENERATION_TIMEOUT_MS` | `600000` | 图片生成时限；允许配置到 60 分钟 |

Hub 会先识别 Codex 任务类型，再把上表的任务基础时限按当前思考强度放大：`low ×1`、`medium ×1.5`、`high ×2`、`xhigh ×3`、`max ×4`、`ultra ×5`。因此普通文字回复默认从 `low` 的 2 分钟逐档增加；看图、总结、文件与画图任务保留各自的基础时限。以上值单位为毫秒，普通任务最终不超过 30 分钟，图片生成不超过 60 分钟。多轮工具与上下文压缩由 App Server 原生负责；已删除的文字预算/续轮协议不再改变时限。运行中的 QQ turn 接受追问引导或融合追问启动替代 turn 后，会重新获得一整段对应任务时限。融合替代 turn 也必须在这一整段实际时限内持续没有协议活动，Hub 才会隔离它并执行唯一一次新线程重试；这取代了原先固定 1 分钟的截断。`/详细配置`、`/api/state`、`/api/maintenance` 和 Codex 结构化日志会显示当前原生参数与任务时限。协议输出预算（Codex 8 MiB、Claude Code 64 MiB）不是环境变量：一轮同时回答多条叠加消息时，第一条之后每多一条加基础值的四分之一，最多 3 倍；原生生图画出的每张图（每轮最多 6 张、每张 24 MiB 以内）另有有限的回显额度。

### 手动 AI 任务执行参数

`--force` 跳过冷却/样本门槛；新增 `--background` 立即返回任务编号，交给原模型队列执行；`--full` 使用完整历史上限。三者独立，可组合为 `ncc ai-run all 群号 --force --background --full`，QQ 对应 `/AI任务 强制 后台 全部 完整历史`。管理 API 使用布尔字段 `force`、`background`、`fullHistory`。`avatar-features` 的范围可省略，`fullHistory`/`--full` 表示最多连续 20 批，可选的 `userIds` 列表（或 `ncc avatars describe --qq`）指定个人。Agent 工具发起 AI 任务时始终后台提交；该防死锁规则不需要额外环境配置。

### AI 引擎（Codex / Claude Code）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CODEX_REMOTE_CONTACT_AGENT_ENGINE` | `codex` | 驱动 Bot 的引擎：`codex` 或 `claude`。仓库 `ncc engine` 和交互式 `ncc start` 会把它写进 `config/local.env` |
| `CLAUDE_CLI_PATH` | `claude` | Claude Code 可执行文件，默认从 `PATH` 查找 |
| `CODEX_REMOTE_CONTACT_CLAUDE_MODEL` | `opus` | Claude Code 使用的模型，可以是别名（`opus`、`sonnet`、`haiku`）或完整模型名 |
| `CODEX_REMOTE_CONTACT_CLAUDE_EFFORT` | 空 | Claude Code 思考强度：`low`、`medium`、`high`、`xhigh` 或 `max`。留空时沿用 Bot 的 `ai.reasoningEffort`（`minimal` 按 `low`，`ultra` 按 `max`） |
| `CLAUDE_ENV_FILE` | `~/.claude/ncc-profiles/active.env` | 可选的 Claude 连接 profile。文件存在时，其中的 `ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN`、`ANTHROPIC_API_KEY`、`ANTHROPIC_MODEL` 等连接变量会替换继承值，每轮重新读取；不存在时使用本机 `claude` 的官方登录 |

用 Claude Code 时，`ai.model`、推理摘要、Codex 人格和服务档位不生效，额度信息也只对 Codex 有效。任务时限表同样适用，但每轮都会新起一个 `claude -p` 进程，冷启动时间计入时限。Claude 子进程只继承运行必需的变量和 `CODEX_REMOTE_CONTACT_*` 标记（名称里带 KEY、TOKEN、SECRET、PASSWORD、COOKIE 的除外），Hub 的其他密钥不会传进去。

### Agent 工具与上下文

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CODEX_REMOTE_CONTACT_AGENT_TOOL_TRANSPORT` | `mcp` | Codex 获取 Hub QQ 工具的方式：`mcp` 由本轮 MCP 服务提供（每次续接都会重新列出），`dynamic` 继续使用 App Server 动态工具。Claude Code 始终使用 MCP。两种方式都在模型搜索工具之前不加载工具定义 |
| `CODEX_REMOTE_CONTACT_QQ_FOLLOW_UP_MODE` | `stack` | 回复生成期间新到的触发消息如何处理：`stack` 全部攒着，等当前草稿写完后带着整批消息重写一次（最多重写 2 轮，之后的消息作为下一条回复）；`steer` 沿用旧行为，每批静默 5 秒就引导进正在运行的 turn |
| `CODEX_REMOTE_CONTACT_AGENT_LEAN_CONTEXT` | `0` | 只聊天的部署可选开启：设为 `1` 时从 Codex QQ 轮次中去掉连接器、插件、浏览器/电脑操控、子 Agent、目标、技能目录和仓库 AGENTS.md（主人/管理员文件任务保留 AGENTS.md） |
| `CODEX_REMOTE_CONTACT_QQ_BASE_INSTRUCTIONS` | `engine` | `engine` 保留引擎自带系统提示词；`qq` 在 QQ 回复中换成精简的 QQ 基础提示 |

QQ Bot 同时也是能真正干活的 Agent，所以默认保留 Codex 的全部原生功能和引擎自带系统提示词；上下文只通过延迟加载 3–5 千 token 的 QQ 工具目录、不把表情包库放进提示词来缩减。在 Codex 0.163 上实测，一次完整的 QQ 回复请求在默认配置下约 2.15 万输入 token，两个可选开关都打开时约 1.03 万，但会去掉原生能力。

### OneBot

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `ONEBOT_API_BASE` | `http://127.0.0.1:3000` | OneBot HTTP API |
| `ONEBOT_ACCESS_TOKEN` | 空 | 首选 OneBot token |
| `CODEX_REMOTE_CONTACT_ONEBOT_TOKEN` | 空 | OneBot token 兼容名称 |
| `CODEX_REMOTE_CONTACT_ONEBOT_TIMEOUT_MS` | `10000` | 单次 API 超时，范围 1–30 秒 |
| `CODEX_REMOTE_CONTACT_ONEBOT_MAX_CONCURRENCY` | `8` | Webhook 并发，范围 1–32 |
| `CODEX_REMOTE_CONTACT_ONEBOT_MAX_PENDING` | `32` | Webhook 等待队列，范围 0–256 |

Hub 和 OneBot 两端 token 应一致。未配置 token 时，Webhook 仅信任 Host 和真实连接地址都为回环的请求。

### QQ 行为、兴趣与媒体

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CODEX_REMOTE_CONTACT_QQ_ENHANCER` | `1` | 设为 `0` 关闭增强启动默认值 |
| `CODEX_REMOTE_CONTACT_QQ_MEMORY_LIMIT` | `10` | 轻量会话记忆上限 |
| `CODEX_REMOTE_CONTACT_QQ_GROUP_MEMORY_LIMIT` | `200` | 群聊/私聊滚动记录条数目标，至少保留 20 条；额外保留完整的最近 5 分钟，以支持图片再次识别 |
| `CODEX_REMOTE_CONTACT_QQ_PROACTIVE` | `1` | 主动兴趣总开关默认值 |
| `CODEX_REMOTE_CONTACT_QQ_PROACTIVE_JUDGE` | `1` | 语义 judge 开关 |
| `..._JUDGE_EVERY_MESSAGES` | `20` | 普通未 @ 消息阈值，范围 1–1000 |
| `..._JUDGE_EVERY_MINUTES` | `5` | 非空周期的分钟阈值；`0` 关闭分钟分支 |
| `..._JUDGE_PROVIDER` | `openrouter` | 兴趣模型厂商：`openrouter`、`deepseek`、`custom`，或订阅厂商 `codex` / `claude`（用本机 CLI 登录的订阅额度跑一次无工具结构化轮次，不需要 key） |
| `..._JUDGE_MODEL` | 随厂商变化 | OpenRouter 默认 `openrouter/free`；DeepSeek 默认 `deepseek-v4-flash`；Codex 默认 `default`（账号默认模型，可填目录里的任一模型）；Claude 默认 `haiku` |
| `..._JUDGE_REASONING_EFFORT` | `low` | 订阅厂商的思考强度：`minimal`、`low`、`medium` 或 `high`（Codex 只接受所选模型公布的档位） |
| `..._JUDGE_AGENT_TIMEOUT_MS` | `90000` | 订阅厂商一次判断的整轮超时（含 CLI 冷启动），范围 15000–300000 |
| `..._JUDGE_AGENT_CONCURRENCY` | `1` | 订阅判断专用的并发槽位（1–4）；另有 3 个排队位，满了直接拒绝，绝不占用回复队列 |
| `..._JUDGE_API_KEY` | 空 | `custom` 厂商的 key |
| `..._JUDGE_BASE_URL` | 空 | `custom` 厂商的 OpenAI 兼容 API 根地址 |
| `..._JUDGE_TIMEOUT_MS` | `6500` | HTTP 厂商 judge 的流式空闲超时（订阅厂商使用整轮超时） |
| `..._JUDGE_VISION` | `auto` | 普通兴趣闸门是否也看被判断消息里的图片（最多 2 张、缩成小 JPEG 预览）：`auto` 对每个厂商/模型先试一次，厂商拒绝图片输入时改为纯文字并记住到重启，`on` 总是尝试，`off` 从不发送图片。图片会发给所配置的第三方兴趣模型服务 |
| `CODEX_REMOTE_CONTACT_QQ_IMAGE_MAX_BYTES` | `20971520` | QQ 图片上限，默认 20 MiB |
| `CODEX_REMOTE_CONTACT_QQ_COMPRESSED_IMAGE_MAX_EDGE` | `1600` | 压缩读取的最长边，范围 256–4096 像素；自动启动按 Hub 内存选择 1280/1600/2048 |
| `CODEX_REMOTE_CONTACT_QQ_FILE_MAX_BYTES` | `52428800` | 模型按需下载入站 QQ 文件的单文件上限，范围 1 MiB–1 GiB |
| `CODEX_REMOTE_CONTACT_SAFE_FETCH_MODE` | `strict` | 安全下载模式；`proxy-compatible` 仅额外允许域名解析到 `198.18.0.0/15` 代理 Fake-IP，仍拦截字面私网 IP 和其他保留地址。人物头像下载同样遵守该模式 |
| `CODEX_REMOTE_CONTACT_QQ_BUBBLE_SEPARATOR` | `|||` | 多气泡分隔符 |
| `..._BUBBLE_SEND_DELAY_MS` | `650` | 气泡间基础延迟 |
| `CODEX_REMOTE_CONTACT_QQ_TYPING_PACE` | `1` | 后续气泡按自身长度等待，像真人打字（最长 4.2 秒）；`0` 保持固定的学习间隔 |
| `CODEX_REMOTE_CONTACT_QQ_TYPING_INDICATOR` | `1` | 私聊生成回复期间通过 NapCat `set_input_status` 显示 QQ 的“正在输入…”；`0` 关闭 |
| `CODEX_REMOTE_CONTACT_QQ_DAILY_ROUTINE` | `1` | 每个作息日用一次无工具的小模型任务规划 Bot 的作息（05:00 后、且只在模型队列空闲时）；`0` 关闭 |
| `..._BUBBLE_MAX_CHARS` | `900` | 单条 QQ 消息的安全字符上限，范围 200–4000 |
| `..._BUBBLE_MAX_COUNT` | `24` | 一次回复最大气泡数，范围 1–64 |

模型自行判断回复是闲聊还是需要交付结果的实质任务。闲聊继续跟随群节奏；解题、证明、计算、代码、写作、翻译、总结及其短续答不套固定字数，按正确完成任务所需篇幅作答。投递层不再把正常模型回复硬裁到 900 字，闲聊字数建议也不会删掉回复中的任何句子；任何超过单条安全上限的气泡都会优先按段落和句子边界自动拆成多条有序 QQ 消息，只有无自然边界的连续长文本才硬切。超过本次最大气泡数时，最后一条会明确标注截断，而不会让 OneBot 用一条超限消息冒险发送。

自我人格刷新阈值使用 `CODEX_REMOTE_CONTACT_QQ_SELF_PERSONA_*`；账号贴纸使用 `CODEX_REMOTE_CONTACT_QQ_ACCOUNT_STICKER_*`。所有精确名称、范围和默认值以 `src/config/environment.js` 为准。

### 媒体、子代理与作息活动

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CODEX_REMOTE_CONTACT_MEDIA_TOOLS_DIR` | `runtime/media-tools` | 可选媒体组件目录（`npm run ncc -- media install` 安装到这里） |
| `CODEX_REMOTE_CONTACT_MEDIA_MAX_VIDEO_SECONDS` | `1200` | 单次看视频的时长预算；下载时允许到它的 3 倍，范围 30–7200 |
| `CODEX_REMOTE_CONTACT_MEDIA_MAX_DOWNLOAD_MB` | `200` | 视频下载上限（MB），范围 10–2048；`qq_media` 打开的 QQ 文件（`file-N`）和工作区文件（`path`）也受此限制 |
| `CODEX_REMOTE_CONTACT_MEDIA_ASR_LANGUAGE` | `auto` | SenseVoice 语言：`auto`、`zh`、`en`、`ja`、`ko`、`yue` |
| `CODEX_REMOTE_CONTACT_MEDIA_ASR_THREADS` | `2` | 语音识别线程数，范围 1–4 |
| `CODEX_REMOTE_CONTACT_MEDIA_JOB_TIMEOUT_MS` | `300000` | 单个媒体子进程（下载/转写/分镜）的超时，范围 30000–1800000 |
| `CODEX_REMOTE_CONTACT_MEDIA_COOKIES_FILE` | 空 | 可选的 yt-dlp cookies.txt（登录后 B站可取更高清晰度）；不会写入日志 |
| `CODEX_REMOTE_CONTACT_MEDIA_VOICE_AUTO` | `1` | 触发 Bot 的语音消息在路由前自动转写；`0` 关闭（语音消息恢复为忽略） |
| `CODEX_REMOTE_CONTACT_MEDIA_VOICE_AUTO_MAX_SECONDS` | `90` | 自动转写的单段最长秒数，范围 5–600 |
| `CODEX_REMOTE_CONTACT_MEDIA_MIN_AVAILABLE_MB` | `1200` | 媒体任务启动前要求的最少可用物理内存（MB）；`0` 关闭检查 |
| `CODEX_REMOTE_CONTACT_MEDIA_AUTO_UPDATE` | `compatible` | 媒体组件新版本：`compatible` 自动安装同一大版本（0.x 为同一小版本）的新版本和新增组件，`all` 连大版本也装，`check` 只检查，`off` 关闭检查 |
| `CODEX_REMOTE_CONTACT_MEDIA_UPDATE_CHECK_HOURS` | `12` | 两次检查新版本的间隔小时数，范围 1–336 |
| `CODEX_REMOTE_CONTACT_MEDIA_UPDATE_WINDOW` | `3-6` | 运行中的 Hub 可以安装更新的本地时段（可跨午夜，如 `23-5`）；留空表示任意时间。时段外的待装更新由控制器在下次启动 Hub 前安装 |
| `CODEX_REMOTE_CONTACT_MEDIA_UPDATE_MIN_MB` | `1500` | 运行中的 Hub 安装更新所需的最少可用内存（MB）；安装脚本本身也有同样的 1500 MB 门槛（`CODEX_REMOTE_CONTACT_MEDIA_INSTALL_MIN_MB`） |
| `CODEX_REMOTE_CONTACT_SUBAGENT_MAX_CONCURRENCY` | `1` | 后台子代理同时运行数，`0` 关闭子代理和作息活动，最大 4 |
| `CODEX_REMOTE_CONTACT_SUBAGENT_MAX_QUEUED` | `2` | 子代理排队数，满了直接拒绝，范围 0–8 |
| `CODEX_REMOTE_CONTACT_SUBAGENT_TIMEOUT_MS` | `1200000` | 单轮子代理的整轮超时，范围 60000–7200000 |
| `CODEX_REMOTE_CONTACT_SUBAGENT_MIN_AVAILABLE_MB` | `1000` | 子代理/作息活动启动前要求的最少可用内存（MB）；子代理最多等 10 分钟 |
| `CODEX_REMOTE_CONTACT_AGENT_PROCESS_LIMIT` | `auto` | 每次启动 Agent CLI（回复、后台模型任务、子代理、订阅兴趣判定）前检查的本机进程上限。`auto` 在 Android 上为 32（子进程超过 32 个时系统的幻影进程杀手会杀掉整个 Termux），其他系统关闭；`0` 关闭（例如已用 adb 关掉 Android 限制） |
| `CODEX_REMOTE_CONTACT_AGENT_PROCESS_RESERVE` | `2` | 回合启动后仍保留的空闲进程数，留给它自己短暂的子进程 |
| `CODEX_REMOTE_CONTACT_AGENT_MIN_AVAILABLE_MB` | `auto` | 启动 Agent CLI 前要求的最少可用内存（MB）；`auto` 在 Android 上为 500，其他系统关闭，`0` 关闭。15 秒内刚启动的回合每个按 300 MB 预扣 |
| `CODEX_REMOTE_CONTACT_AGENT_CAPACITY_WAIT_MS` | `90000` | QQ 回复等待余量的最长时间，超时则放弃本轮；后台模型任务等待其三分之一，子代理至少等 5 分钟，兴趣判定从不等待（没有余量即不批准） |
| `CODEX_REMOTE_CONTACT_LIFE_ACTIVITIES` | `1` | 按作息真的去做线上活动；`0` 关闭 |
| `CODEX_REMOTE_CONTACT_LIFE_ACTIVITY_DAILY_LIMIT` | `5` | 每天最多几次作息活动，范围 0–24 |
| `CODEX_REMOTE_CONTACT_LIFE_ACTIVITY_MIN_GAP_MINUTES` | `60` | 两次作息活动的最小间隔分钟，范围 10–720 |
| `CODEX_REMOTE_CONTACT_LIFE_CHATS_PER_DAY` | `2` | 每天最多几段“主动找人聊天”作息（作息里选定的联系人或群），范围 0–3；`0` 不安排。还需要主动聊天和兴趣模型处于开启状态 |
| `CODEX_REMOTE_CONTACT_LIFE_QZONE_POSTS_PER_DAY` | `1` | Bot 自主发说说的每日上限（主人/管理员要求不计入） |
| `CODEX_REMOTE_CONTACT_LIFE_QZONE_COMMENTS_PER_DAY` | `3` | Bot 自主评论空间的每日上限 |
| `CODEX_REMOTE_CONTACT_SOCIAL_FRIEND_REQUESTS_PER_DAY` | `3` | 普通对话里主动加好友的每日上限 |

手机上内存突增会让系统杀掉整个会话，所以媒体任务、子代理和作息活动在启动前都检查 `/proc/meminfo` 的 MemAvailable；本机命令申请（`qq_runtime.host_command`）也按命令轻重检查（普通 500 MB、安装/解压/媒体类 1500 MB、并行测试 3500 MB），不够时在执行前拒绝。

### 联网搜索与 judge 服务

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `CODEX_REMOTE_CONTACT_QQ_WEB_LOOKUP` | `1` | QQ 联网搜索 |
| `CODEX_REMOTE_CONTACT_QQ_WEB_PROVIDER` | `auto` | 首选 provider |
| `CODEX_REMOTE_CONTACT_QQ_WEB_PRESET` | `balanced` | provider 预设 |
| `CODEX_REMOTE_CONTACT_QQ_WEB_PROVIDERS` | 空 | 自定义 provider 顺序 |
| `CODEX_REMOTE_CONTACT_QQ_WEB_TIMEOUT_MS` | `12000` | 整体搜索超时 |
| `CODEX_REMOTE_CONTACT_QQ_WEB_ATTEMPT_TIMEOUT_MS` | 自动 | 单 provider 超时 |
| `TAVILY_API_KEY` | 空 | Tavily key |
| `OPENROUTER_API_KEY` | 空 | OpenRouter 兴趣模型 key |
| `OPENROUTER_BASE_URL` | OpenRouter 官方 API | OpenRouter 端点 |
| `DEEPSEEK_API_KEY` | 空 | DeepSeek 兴趣模型 key |
| `DEEPSEEK_BASE_URL` | DeepSeek 官方 API | DeepSeek 端点 |

仪表盘“智能行为”页或 QQ 主人命令 `/兴趣厂商 openrouter|deepseek|custom` 可切换厂商，`/兴趣模型 模型ID` 可覆盖默认模型。密钥始终只从环境读取，不写入 `data/settings.json`。OpenRouter 使用严格 JSON Schema；DeepSeek 和自定义兼容服务使用 JSON Object 模式。可运行 `npm run ncc -- search-config` 初始化仓库环境文件。排障先看 `/api/maintenance` 和 `search` / `interest` 日志。

### 日志

- Hub 只保留一条 QQ/OneBot 消息链路。旧的 `CODEX_REMOTE_CONTACT_IMESSAGE_*` 与 `CODEX_REMOTE_CONTACT_REMOTE_EXECUTION_*` 变量会被忽略。
- `CODEX_REMOTE_CONTACT_LOG_LEVEL` 默认 `debug`；`LOG_CONSOLE`、`LOG_CONSOLE_LEVELS`、`LOG_MAX_BYTES` 和 `LOG_MAX_FILES` 控制控制台与轮转。
- `CODEX_REMOTE_CONTACT_SQLITE_TIMEOUT_MS` 和 `..._MAX_OUTPUT_BYTES` 限制本地 SQLite 查询。

## 本地环境文件示例

```bash
export CODEX_CLI_PATH=/usr/local/bin/codex
export ONEBOT_API_BASE=http://127.0.0.1:3000
export ONEBOT_ACCESS_TOKEN=请使用真实随机值
export OPENROUTER_API_KEY=请使用真实密钥
export TAVILY_API_KEY=请使用真实密钥
export CODEX_REMOTE_CONTACT_SAFE_FETCH_MODE=proxy-compatible
export CODEX_REMOTE_CONTACT_LOG_LEVEL=debug
```

```bash
chmod 600 config/local.env
npm run ncc -- status
```

不要把真实秘密值复制到 issue、聊天记录、截图或 Git diff 中。

## 修改与验证

新增环境变量时：

1. 在 `src/config/environment.js` 添加解析、默认值和范围限制。
2. 把归一化值传给消费者，不在 `server.js` 新增直接读取。
3. 补充 `test/environment-config.test.js`。
4. 同步本页中英文版本和维护 Skill。
5. 运行 `npm run verify`。
