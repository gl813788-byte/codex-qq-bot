# 运行、日志与故障排查

简体中文 | [English](OPERATIONS.md)

本页从部署完成后开始。首次安装、平台选择、Termux/PRoot、root 规则和中断续跑统一见[一键安装与环境方案](INSTALLATION_CN.md)；需要 Codex 代为执行并验收时见[使用 Codex 部署](DEPLOY_WITH_CODEX_CN.md)。

```bash
./一键部署.command
```

## 先区分两种 `ncc`

机器上可能存在两个同名但命令不同的控制器：

| 入口 | 用途 | 通用命令 |
| --- | --- | --- |
| `npm run ncc -- <command>` | 公共仓库自带的配置/状态辅助脚本 | `setup`、`status`、`qq`、`groups`、`session`、`session-mode`、`start`、`logs` 等 |
| 全局 `ncc` | 当前机器可能安装的 NapCat + Hub 生命周期控制器 | 先运行 `ncc help`；本机版本可能有 `all`、`connect`、`session`、`session-mode`、`stop-hub` |

公共文档中的命令优先写成 `npm run ncc -- ...`，防止部署脚本覆盖已有全局控制器。

## 启动前检查

```bash
cd /root/Codex-QQ-Bot
node --version
codex --version
git status --short --branch
npm run verify
npm run ncc -- status
```

通过标准：Node.js 20+、验证退出码 0、配置文件可读。`status` 显示 OneBot 或 Hub 不可连接时仍需继续检查，不能仅凭进程存在判断正常。

## 启动方式

### 让 Codex 启动

直接告诉 Codex：

```text
请按本项目 docs/OPERATIONS_CN.md 检查并启动 Codex QQ Bot。先识别全局 ncc 和仓库 ncc 的区别，保护现有 data/runtime/config，不重置 Git。启动后实际验证 Hub、仪表盘、OneBot get_login_info、QQ channel 和错误日志；需要扫码时只让我完成扫码，之后继续连接和验收。
```

### 仓库通用入口

```bash
npm run ncc -- setup
npm run ncc -- start
```

- Linux：仓库脚本加载 `config/local.env` 后以前台 `npm start` 运行，按 `Ctrl+C` 停止。
- macOS：仓库脚本可以使用项目 launchd 启动器。
- 直接 `npm start`：不自动加载 `config/local.env`，需先在当前 shell 导出配置。

长期运行时，让 Codex复用当前机器已有的 systemd、screen、launchd 或容器方式。新增进程管理器前要说明其配置、工作目录、环境来源、日志位置和重启策略，并验证重启后状态。

### 本机全栈入口

如果 `ncc help` 明确显示本机 NapCat 控制器：

```bash
ncc status
ncc all
ncc connect
```

`ncc all` 启动 NapCat 与 Hub；QQ 扫码完成后由 Codex执行 `ncc connect`。不要把仓库辅助脚本的参数传给这个全局控制器，反之亦然。

本机全局控制器会从固定的 `NAPCAT_WORK_DIR`（默认 `/root/.local/share/napcat`）启动 QQ。这样 QQ 的相对路径缓存数据库不会再落进调用 `ncc` 时所在的仓库或 shell 目录；需要时可用环境变量改成其他持久目录。

会话模式可从 QQ 菜单或 `ncc` 调整：

```bash
npm run ncc -- session
npm run ncc -- session-mode auto
npm run ncc -- session-mode persistent 群号
npm run ncc -- session-mode temporary private:QQ号
npm run ncc -- session-mode inherit 群号
```

支持该功能的全局控制器使用 `ncc session` / `ncc session-mode ...`。省略 scope 修改默认模式；指定群号或 `private:QQ号` 修改覆盖。运行中的 Hub 通过 `/api/qq/session-mode` 立即持久化，Hub 停止时则安全修改 `data/settings.json`，下次启动生效。

主人和 Bot 管理员可直接在 QQ 使用跨会话能力：

```text
/跨会话 列表 [筛选]
/跨会话 查看 group:群号 最近30
/跨会话 发送 private:QQ号 | 消息
```

原生 Agent 还可在一轮中选择会话焦点，之后兼容的聊天记录、记忆、知识和 QQ 工具都会作用于该目标，直到清除或切换。只允许选择 Hub 已知会话，裸数字歧义时会拒绝；真实发送要求主人/管理员明确提出。

只有主人能维护管理员：

```text
/Bot管理员
/Bot管理员 添加 QQ号
/Bot管理员 删除 QQ号
```

管理员拥有完整菜单和 Agent，但不能修改管理员列表。管理员文件请求若涉及删除重要文件、覆盖关键源码/配置/数据/凭据、损坏 `.git`、依赖或运行状态，或其他含糊且不可恢复的破坏性操作，Bot 会自行判断并拒绝。

## AI 手动任务中心

QQ 菜单中的 `/AI任务` 和两套 NCC 都读取同一个任务目录，并通过本机回环管理 API 执行：

```bash
npm run ncc -- ai-tasks
npm run ncc -- ai-run chat-summary 群号
npm run ncc -- ai-run scope-summary private:QQ号
npm run ncc -- ai-run style-review 群号 --force
npm run ncc -- ai-run global-persona
npm run ncc -- ai-run knowledge-review --force
npm run ncc -- ai-run all 群号 --full
```

支持 `chat-summary`（聊天总结与知识提取）、`scope-summary`（当前范围的人设证据/记忆总结）、`style-review`（群风格复盘）、`global-persona`（全局人设刷新）、`knowledge-review`（到期低频黑话的双模型审核）和 `all`。QQ 中使用 `/AI任务 任务名`；`/AI任务 强制 任务名` 显式开启强制执行。

普通手动运行会跳过自动周期的“尚未到期”，但仍遵守任务本身的常规数据门槛。`--force` / “强制”还会跳过冷却与常规样本门槛；它不会绕过 QQ 主人/菜单权限、群白名单、本机回环 API 限制、并发锁、OneBot 身份或完全没有数据的保护。知识强制审核只扩大候选范围，仍严格执行“兴趣模型初筛 → 主模型终审 → 活动/内容变更保护”，绝不直接删除。任务真实调用当前 QQ 模型并使用既有任务超时；Hub 必须正在运行。

## 周期行为的重启补做

周期性 QQ 业务按本地状态中持久化的时间戳判断，不依赖 Node.js 进程连续运行多久。Hub 启动时会立即检查自适应风格复盘和自我人格摘要/生成；QQ 通道启用时会立即检查恢复的普通兴趣周期、冷群兴趣与私聊兴趣，之后的普通轮询只负责唤醒这些墙上时间判断。

机器停机期间如果越过截止时间，恢复后只补做一轮。从磁盘恢复的普通兴趣周期即使候选消息超过正常在线的旧话题时限，也会获准执行这一次补做 judge，避免长时间停机把到期检查静默消费掉；judge 期间的新活动仍可让旧结果失效。冷群到期后由兴趣模型在 `silent/topic/chatter` 中决定，私聊候选也会把频率先验和随机波动值交给兴趣模型作最终开关；普通接话、冷群话题/水群和主动私聊都必须通过统一的“兴趣批准 → 主模型内容”校验，缺少任一阶段就不发送。普通主动温度为 `0.65`，冷群/私聊启动温度为 `0.8`。低频黑话删除是长证据任务：兴趣模型以 `0.15` 做有界初筛，主模型读取完整证据终审，任一阶段失败都保留。聊天总结、印象/人格总结和知识提取始终由主模型完成。成功、静默、拒绝或失败等已经完成的检查，会按对应功能的成功/重试策略写入完成时间，并从完成时刻重新开始下一周期。不会逐个回放停机期间错过的所有周期，因此恢复时不会集中刷消息。`/api/state` 在 `qq.periodic` 暴露安全的调度器状态；普通群兴趣 pending cycle 持久化在 `data/qq-memory.json`。统一记忆读写和手动聊天摘要属于事件触发，没有需要补做的周期截止时间。兴趣厂商可在仪表盘或用 `/兴趣厂商 openrouter|deepseek|custom` 切换；冷群、私聊和知识初筛共用当前厂商，诊断时应同时确认厂商、模型、对应环境 key 和 `interest` 日志。

Bot 只要有一个群气泡确认送达，就会清空该群送达前的普通兴趣 pending cycle，让消息数与分钟频率只从送达后的真人消息重新开始。执行中的旧 judge 会被作废，但不会消费之后的新消息。

## 验收

```bash
curl -fsS --max-time 3 http://127.0.0.1:3789/api/state | jq .
curl -fsS --max-time 3 http://127.0.0.1:3789/api/maintenance | jq .
curl -fsS --max-time 3 -o /dev/null -w '%{http_code} %{content_type}\n' http://127.0.0.1:3789/
curl -fsS --max-time 3 http://127.0.0.1:3000/get_login_info | jq .
```

| 检查项 | 正常标准 |
| --- | --- |
| Hub | `/api/state` 返回 HTTP 200 JSON |
| 维护状态 | `/api/maintenance` 返回 Codex、OneBot、搜索等有效状态 |
| 仪表盘 | `/` 返回 HTTP 200 HTML |
| OneBot | `/get_login_info` 返回当前 QQ 账号，不只是端口开放 |
| QQ 通道 | `channels.qq` 已启用，owner 与群白名单正确 |
| 日志 | 没有未解释的 fatal/error 启动失败 |

## OneBot 连接

默认地址：

```text
OneBot API:      http://127.0.0.1:3000
反向 HTTP 回调: http://127.0.0.1:3789/api/onebot/event
```

- 在 NapCat/LLBot 中启用 OneBot HTTP API 和反向 HTTP 上报。
- 若设置 access token，Hub 的 `ONEBOT_ACCESS_TOKEN` 或 `CODEX_REMOTE_CONTACT_ONEBOT_TOKEN` 必须使用相同值。
- Hub 没有 token 时只接受真实回环连接；容器跨网络命名空间时应配置 token 和明确地址，不能关闭校验。
- 扫码完成后必须重新检查 `/get_login_info`，再启用/连接 QQ 通道。

## 日志

默认文件：`runtime/logs/hub.jsonl`，自动轮转。

仓库日志查看器：

```bash
npm run ncc -- logs --tail 80
npm run ncc -- logs --errors --since 30m --summary
npm run ncc -- logs --category interest --group 群号 --tail 100
npm run ncc -- logs --category search --verbose --tail 100
npm run ncc -- logs --trace TRACE_ID --all
npm run ncc -- logs --scope private:QQ号 --operation session
npm run ncc -- logs --operation agent.tool --slow 1000 --summary
npm run ncc -- logs -f
```

全局本机控制器支持哪些过滤参数以 `ncc help` 为准。也可读取 API：

```bash
curl -fsS 'http://127.0.0.1:3789/api/logs?limit=100&level=error,warn' | jq .
curl -fsS 'http://127.0.0.1:3789/api/logs?category=interest&group=群号' | jq .
curl -fsS 'http://127.0.0.1:3789/api/logs?scope=private:QQ号&operation=session' | jq .
```

常用分类：`system`、`web`、`onebot`、`qq`、`codex`、`search`、`interest`、`learning`、`memory` 和 `lifecycle`。新日志使用兼容旧条目的 schema v3；Agent 轮次/工具、跨会话发送、好友/加群、管理员变更和设置落盘统一带 `operation`、`outcome`、操作者角色/QQ、来源/目标会话、工具名、耗时和错误代码。动态工具参数及跨会话消息正文不会写日志。优先按 trace 追踪一条完整回复，再用 `--scope` 或 `--operation` 缩小跨会话与工具范围；摘要会额外统计操作和结果。融合追问使用 `qq` 分类，中文彩色标题依次显示进入可重置的 5 秒缓冲、引导进活跃 turn、引导失败后截断并开始替代回答，以及旧草稿完成后在发送前直接开启替代轮次。原生 Agent commentary 与 plan 更新仍会以有界 `codex` debug 诊断记录；安全 commentary 还会在 `qq` 分类产生 `QQ task progress delivered` 或失败记录。若 `codex` 诊断里的 commentary 是完整 QQ Schema JSON，Hub 会先精确校验并只提取无附件回复的可见 `text`/`bubbles`，原始 JSON 本身不会进入 QQ；已删除的文字进度/预算协议也不会制造控制轮。生命周期还会显示成功/失败气泡数；失败回执为下一轮主模型保留时会另记一条 QQ 警告。

仪表盘不再把所有功能堆在同一页，而是分成总览、通道、智能行为、记忆、实时日志和设置六个视图。通道页只处理连接、白名单和联系人；智能行为页显示并持久化 Bot 增强、联网、主动兴趣、模型厂商与判定参数，同时提供当前厂商 key、搜索 provider、安全下载模式、活动生成和待回复数量等安全诊断信息。行为状态采用独立双列流，较长的人设卡不会在另一列制造大片空白；窄屏恢复为自然单列顺序。

轮询渲染会区分服务端状态与本地交互状态：旧的轮询结果不会覆盖正在操作的开关、进行中的群/记忆/网络操作、已经修改的 Bot 设置表单，以及记忆分组和自动适应详情的展开/收起状态。刷新恢复只在当前浏览器标签页的会话内生效，覆盖 Bot 设置与群 ID 草稿、记忆浏览上下文、自动适应详情展开状态和日志控件/位置，不会跨标签页同步草稿。Bot 设置保存失败会保留草稿供重试，保存成功则清除草稿。

网页日志视图每秒拉取一次完整结构化条目，按时间正序追加并默认跟随最新位置。级别、分类、trace、错误、结果和耗时分别着色，所有 `details` 字段直接显示；可暂停实时刷新、关闭自动跟随、调整显示条数、筛选并点击条目查看原始 JSON。页面隐藏时实时请求自动暂停。

交互终端同样按级别、分类、trace、结果/错误和耗时使用稳定的独立颜色；`--color` 可在非 TTY 输出中强制启用，`--plain` 关闭颜色，`--json` 保留机器可读原始字段。中文查看器和中文仪表盘统一显示中文事件名，并递归中文化启动自动学习快照等嵌套详情；原始英文事件名仍保留在 JSON 的 `message`，API 同时提供 `messageZh` 与 `detailsZh`。人类可读输出会把多行字段压成单行。Codex 和兴趣模型的具体输出以 `debug` 级别保存，最长 4000 字符并经过日志密钥脱敏；完整输入提示词和删除申请聊天证据不会被再次复制到日志中，Codex 子进程错误也只保留提炼后的诊断行。

## 安全重启 Hub

1. 查看 `/api/state`、仪表盘和最近 `lifecycle` 日志，确认没有需要保留的生成任务。
2. 只停止 Hub，不要为了前端或代码改动顺带结束 QQ/NapCat。
3. 使用当前机器原有的进程管理方式启动 Hub。
4. 重复执行 Hub、仪表盘、OneBot、QQ 通道与错误日志验收。

本机全局控制器支持时：

```bash
ncc stop-hub
ncc hub
ncc status
```

公共仓库 Linux 前台运行则按 `Ctrl+C`，再执行 `npm run ncc -- start`。

## 安全升级

让 Codex执行：

```text
请安全升级当前 Codex QQ Bot。先检查 Git 工作区、运行中的回复、data/runtime、数据库和本地环境文件；禁止 reset、clean 或覆盖本地改动。工作区允许时只做 fast-forward 更新。安装依赖并运行 npm run verify，使用现有进程管理方式只重启 Hub，然后验收 /api/state、仪表盘、OneBot、QQ channel 和错误日志。失败时保留用户数据并明确恢复或阻塞状态。
```

人工检查顺序：

```bash
git status --short --branch
git remote -v
git pull --ff-only
npm install
npm run verify
```

有本地改动时不要直接 `git pull`，先让 Codex评估冲突和更新方式。

## 常见故障

| 现象 | 常见原因 | 检查与处理 |
| --- | --- | --- |
| `3789` 不监听 | Hub 未启动、语法/配置错误、端口冲突 | `npm run verify`，看 `system` 日志和 `ss -ltnp | rg ':3789'` |
| 仪表盘 API 正常但页面 404/旧内容 | 资源未注册或运行进程仍缓存旧资源 | 检查 `src/dashboard-assets.js` 与 `modules/mac-client/Resources`，只重启 Hub |
| NapCat WebUI 可用但 `3000` 不通 | QQ 未登录或 OneBot HTTP 配置未加载 | 查看 WebUI/QQ 扫码状态和 NapCat 日志，登录后 `ncc connect` |
| `get_login_info` 401/403 | token 不一致 | 对齐 OneBot 与 Hub token，避免打印真实值 |
| QQ 通道 false | OneBot 未连接、通道未启用或设置未保存 | 检查 `/api/state`、`data/settings.json` 和 `ncc connect` |
| 白名单群不回复 | 群号不在 allowlist、未 @/回复 Bot、用户被 ban | 检查 state、`qq`/`onebot` 日志和权限 |
| Codex 回复失败 | 未登录、CLI 路径/模型不可用、队列满 | `codex --version`、登录状态、maintenance、`codex` 日志 |
| 主动兴趣不回复 | 周期为空、judge 关闭/失败、兴趣不足、结果过时 | `interest` 日志、当前厂商对应 key、模型参数和群活跃状态 |
| QQ 图片提示 `URL_PRIVATE_ADDRESS` 且解析到 `198.18/15` | 代理软件使用 Fake-IP DNS，严格下载模式按保留地址拦截 | 保持私网保护，设置 `CODEX_REMOTE_CONTACT_SAFE_FETCH_MODE=proxy-compatible` 后只重启 Hub；字面私网 IP 和其他保留地址仍会拒绝 |
| 无关文字回复出现 `image download returned HTTP 400` | 持久化的附带上下文图片保留了已过期的腾讯下载地址 | 当前/明确引用图片仍可用；附带上下文图片会排除超过两小时或无时间戳的引用，确认运行中的 Hub 已加载当前源码 |
| 主动加好友无回复、出现参数断言或返回 `native_timeout` | 旧桥可能无限等待 QQ 原生调用，或当前 QQ 暴露了不同的原生参数签名 | 部署好友桥 v8，并确认 `/health` 返回 `preferredFriendSubmitApi: buddy-service-uin`。UID/预检失败不会阻止提交；提交卡住会返回 HTTP 504 并指出原生接口。若预检返回 `verification_message_required`，请带 `验证=...` 重试 |
| 联网失败 | key、provider、网络或超时 | `/api/maintenance` 的 provider attempts，`search` 日志 |
| `ncc` 命令不认识参数 | 调用了另一套同名控制器 | `command -v ncc`、`readlink -f`、`ncc help`；仓库命令改用 `npm run ncc --` |
| dead screen session | 异常退出留下 socket | 确认没有活进程后 `screen -wipe`，再启动 |

## 临时公网访问

设置页提供一个默认关闭的**公网临时访问**开关，底层使用 [Cloudflare Quick Tunnels](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/)。它保持 Hub 监听 `127.0.0.1`，只启动一个本地 `cloudflared` 子进程转发到 `http://127.0.0.1:3789`。

开启前，按 Cloudflare 对应平台说明安装 `cloudflared`，并确保 Hub 继承的 PATH 能找到它。仪表盘不会自动安装或下载依赖。命令缺失、启动失败或在超时内没有返回地址时，API 会明确报错，并且不会保留公网地址。

开启后：

1. 若尚无管理 token，Hub 会自动创建并持久化一个。
2. 仪表盘显示当前随机的 `https://*.trycloudflare.com` 地址；重启或重新开启后地址可能变化。
3. 把地址和 token 分开发给可信访问者；访问者在仪表盘提示框中输入 token，token 只保存在该浏览器标签页。
4. 所有非回环管理 API 仍必须携带 token；同源 CORS 只放行当前精确的隧道 Host。
5. 只有从回环地址加载的本机页面才能启停隧道或读取 token；关闭开关会终止子进程。

开关的期望状态会持久化，因此开启状态下重启 Hub 会重新创建隧道。Quick Tunnel 只适合临时开发/测试，不应作为长期生产暴露方案。需要稳定公网服务时，应使用受管的命名隧道，或带独立身份认证、限速与监控的 TLS 反向代理。

## 局域网访问

默认只使用 `127.0.0.1`。只有用户明确要求时才开启：

1. 通过本机仪表盘开启 LAN，或设置明确的 host、`ALLOW_REMOTE=1` 和随机 API token。
2. 限制 CORS，不使用无 token 的 `*`。
3. 防火墙只放行需要的局域网段，代理/VPN 对私网地址使用直连。
4. 从另一设备验证页面与带 token API；确认 token 没有进入 Git、日志或截图。
5. 长期公网访问应使用受管命名隧道，或带 TLS、访问控制和限速的反向代理，不要把 Hub 直接绑定到公网。
