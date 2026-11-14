# 架构与目录职责

简体中文 | [English](ARCHITECTURE.md)

这份文档用于在修改项目前快速确认边界，避免每次都从 `src/server.js` 重新理解整个系统。

## 运行流程

```text
环境变量 + 运行路径
          |
          v
      应用初始状态
          |
          v
 HTTP Hub / 通道适配器 -----> QQ / OneBot
          v
       领域服务 -----------> 记忆、人格、贴纸、联网搜索
          |
          v
       基础设施 -----------> Codex CLI、文件、进程、日志
```

`src/server.js` 是组合根，负责连接依赖、启动 HTTP 监听和关闭进程。它仍包含待拆的旧编排，但 Codex Agent 执行、原生工具/输出边界、运行参数策略、设置快照/仓库、文件 Agent 策略和 HTTP server 适配器都已移入职责明确的模块。新的解析、校验、策略和持久化逻辑仍只应在组合根接线。

## 目录地图

| 路径 | 职责 | 适合在这里修改 |
| --- | --- | --- |
| `src/app/` | 应用状态和启动组合 | 全局状态结构、启动生命周期 |
| `src/app/qq-codex-runtime-settings.js` | Codex 原生轮次参数指令策略 | 推理摘要、人格、服务档位校验或持久化动作 |
| `src/app/qq-file-agent-turn.js` | 主人/管理员/公开文件 Agent 能力策略 | 文件任务根目录、沙箱、管理员破坏性操作拒绝策略或文件任务指令 |
| `src/app/qq-host-command.js` | 按命令申请本机权限 | 原始发送者身份校验、隔离命令环境、执行时限和结果；两个引擎共用 |
| `src/qq-media/` + `src/app/qq-media-tool.js` + `src/app/qq-media-services.js` | 看视频、听声音、逛 B站 | 媒体候选与选择器、视频平台白名单、可选组件探测、单槽媒体队列与内存检查、yt-dlp/分镜/转写子进程参数、B站只读客户端（WBI 签名）、QQ 视频与语音获取，以及 `qq_media` 的视觉结果 |
| `src/qq-media/music-links.js` + `music-resolver.js` + `media-updates.js` | 歌曲与组件更新 | 音乐分享链接解析、可信音频域名、LRC 歌词解析、基于 Meting 的歌曲解析，以及新版本检查与自动更新策略 |
| `scripts/media/` | 可选媒体组件安装与转写子进程 | `ncc media` 安装校验、SenseVoice/VAD/CED 转写 worker 的输入输出约定 |
| `src/app/qq-voice-transcription.js` | 语音消息自动转写 | 路由前听语音的数量与时限、`[语音]` 标记替换 |
| `src/qq-human-action-stats.js` | 群友互动频率统计 | 贴表情、拍一拍、撤回、分享等计数、半衰期与汇总；动作规划在 `src/qq-human-behavior.js` |
| `src/qq-subagents.js` + `src/app/qq-subagent-turn.js` + `src/app/qq-subagent-tool.js` | 后台子代理 | 槽位与排队、中途消息与续做、取消、可见范围、子代理工具子集、提示词与汇报提示、`qq_agent.manage` |
| `src/qq-bot-life-activities.js` | 按作息做事 | 作息活动到期选择、每日次数、计划聊天与社交上限、活动任务提示词、真实经历记录与上下文 |
| `src/qq-bot-planned-chat.js` | 按作息主动聊天 | 给作息规划的联系人候选（名字、关系、时间，绝不含消息内容）、联系人校验、硬性阻止条件、兴趣模型与主模型提示，以及聊天时段在各会话里的隐私呈现 |
| `src/qq-bot-drawings.js` + `src/app/qq-drawings-tool.js` | Bot 的画作库 | 画作索引与会话可见范围、按内容哈希存储与清理、`qq_context.images` 中画作部分的查看与取出（图片工具本身在 `src/app/qq-image-memory-tool.js`） |
| `src/app/qq-card-tools.js` | 卡片与特殊消息 | 音乐卡片（网易云/QQ音乐/酷狗/酷我，来自 `song-N`、`music-N`、ID 或搜索）、B站视频卡片（`get_mini_app_ark`）、以 Bot 自己账号写的聊天记录卡片、骰子、猜拳、名片分享与每轮上限 |
| `src/host-memory.js` | 可用内存检查 | MemAvailable 读取、内存闸门和命令轻重分级 |
| `src/channels/http/hub-http-server.js` | HTTP 请求分发与安全错误边界 | API/资源路由或 OneBot webhook 限流 |
| `src/channels/qq/` | 唯一的 QQ / OneBot 消息传输边界 | 解析、校验和归一化 QQ 事件 |
| `src/config/` | 环境变量与运行默认值 | 新环境变量、默认值、范围约束 |
| `src/config/resource-profile.js` + `src/infrastructure/host-resources.js` | 启动资源预算与 OS/cgroup 检测 | CPU/内存约束、系统余量、堆/并发/队列和图片预算；启动控制器共用 |
| `src/qq-enhancer/compress-image.js` | 有界本地图片压缩 | 首帧 JPEG 预览、解码资源限制和临时快照清理 |
| `src/qq-enhancer/` | 可选 QQ 回复增强 | 图片、主动兴趣、回复风格 |
| `src/qq-enhancer/context-images.js` + `src/app/qq-image-memory-tool.js` | 图片短期引用与按需重看 | 5 分钟或 20 条原始消息窗口、同范围图片目录、活动任务 input 校验与视觉工具结果 |
| `src/qq-memory-image-store.js` | 记忆图片存储 | 头像与知识配图共用：内容哈希寻址、原子写入、每次读取重验大小/签名/哈希、导出到任务 input、只清理自身创建且无引用的旧文件 |
| `src/qq-avatar-memory.js` + `src/app/qq-avatar-memory-tool.js` | 人物头像记忆 | 头像记录与复查退避、文字特征只绑定实际描述过的图片、会话范围候选、含图提示词、后台批量描述的提示词/Schema/解析、有界下载与单线程刷新队列、手动刷新/描述的目标选择与状态汇总，以及 `qq_memory.avatar` 的看图后才可记录规则 |
| `src/app/qq-knowledge-image-tool.js` | 知识配图工具 | `qq_knowledge.image` 的读写范围、图片目录 selector 导入、添加/替换/改说明/移除/查看；纯数据变更在 `src/qq-knowledge-base.js`，网页上传校验在 `src/dashboard-knowledge-base.js` |
| `src/qq-enhancer/interest-vision.js` | 兴趣模型看图 | 看图模式（auto/on/off）、按厂商/模型记住是否支持图片、图片拒绝识别、被判断消息的有界选图与多模态消息内容 |
| `src/app/qq-web-image-tool.js` | 联网搜图工具 | `qq_search.images` 的本轮 selector、下载到任务 output、签名校验与预览；Tavily 图片请求在 `src/web-search.js` |
| `src/qq-main-prompt.js` | 主模型提示词边界 | 角色、执行顺序、活人感规则、主动任务、每个命名空间一行的工具索引，以及只聊天部署可选的精简 QQ 基础提示 |
| `src/qq-proactive-pipeline.js` | 主动聊天双模型契约 | 普通接话、冷群话题/水群和主动私聊的兴趣批准凭据与主模型必经校验 |
| `src/qq-proactive-cycle-state.js` | 普通兴趣内存周期状态 | pending 消息计数、Bot 确认送达后的重置，以及作废送达前执行中 judge 且保留后续消息 |
| `src/qq-conversation-follow-up.js` | Bot 回复后的续聊批次状态机 | 同一发送者、自适应 3–12 分钟与 2–6 条边界、满条不提前判定的 5 秒静默合并、judge 前冻结入口及兴趣模型语义复核元数据 |
| `src/qq-language-style.js` | QQ 语言统计候选 | 群/成员标点与功能性短语计数及高频候选，不分配任何含义；打字习惯占比（空格断句、句末标点、括号补充语、颜文字、波浪号、笑声写法）及至少两人用过的具体写法 |
| `src/qq-message-run-compaction.js` | 模型上下文连续复读压缩 | 相邻同文消息的语义签名、计数合并和中文条数标注 |
| `src/codex-app-server-turn.js` | Codex app-server 单轮客户端 | `thread/start`/`thread/resume`、`turn/start`、运行中控制、直接截断续开、inactive turn 竞态恢复、超时和中断 |
| `src/infrastructure/codex/qq-turn-runner.js` | QQ App Server 生命周期适配器 | 限流、用一张引擎表集中 Codex/Claude Code 的全部差异、隔离子进程环境、原生轮次参数、诊断、融合恢复、取消和配额刷新 |
| `src/infrastructure/codex/codex-protocol-quota.js` | 从 App Server 协议读取 Codex 用量 | 稀疏合并每轮 Codex 对话推送的 `account/rateLimits/updated` 和 `thread/tokenUsage/updated` 通知；Hub 没有近期数据时，限频地用短命进程调用一次 `account/rateLimits/read`（不建线程、不跑模型）。新版 Codex 已不再把用量写进 rollout 文件或日志数据库 |
| `src/infrastructure/agent/agent-turn-process.js` | 引擎无关的轮次底层 | 两个单轮客户端共用：总超时与替代轮空闲超时、带输出上限的 NDJSON 分帧、子进程托管（stderr 尾部、终止、只通知一次退出）、动态工具结果归一化和 `CODEX_*` 错误码 |
| `src/infrastructure/agent/agent-engines.js` | 引擎信息与能力 | 不依赖任何模块的引擎表：展示名、运行方式、模型选择和能力标记（`reportsQuota`、`modelCatalog`），以及 `agent` 日志分类、旧 `codex` 条目兼容和按条目识别引擎，供日志写入、日志 API、终端查看器和仪表盘接口共用 |
| `src/infrastructure/agent/agent-cli-version.js` | Agent CLI 版本探测 | 给仪表盘用的 `--version` 缓存结果，用最小环境在后台刷新 |
| `src/infrastructure/agent/agent-child-env.js` | 引擎无关的子进程环境工具 | 两个引擎子进程环境共用的基础运行时白名单、白名单过滤和 ncc profile env 解析 |
| `src/infrastructure/claude/claude-code-turn.js` | Claude Code 单轮客户端 | 与 `runCodexAppServerTurn` 同一接口：`claude -p` stream-json、`--json-schema` 结构化输出、追问/替代/中断、沙箱到 `--restricted` 工具集的映射、失效会话重建 |
| `src/infrastructure/agent/qq-mcp-tools.js` + `qq-mcp-bridge.mjs` | 引擎无关的 QQ MCP 传输 | 把 QQ 工具目录展开为带注解的 MCP 工具，用本轮私有 Unix socket 提供工具，生成 Codex 的 `mcp_servers` 条目（由 Hub 预先批准、工具时限更长）和 Claude 的 `--mcp-config`，给常驻工具（`qq_chat.send`）加上 `_meta["anthropic/alwaysLoad"]`，作为 Codex 动态工具时也不延迟加载；两个引擎拉起的同一个 stdio 桥把每次调用连同引擎调用 ID 交回 Hub，按原发送者权限执行 |
| `src/infrastructure/codex/codex-lean-config.js` | 可选的精简 Codex 上下文 | 因为 Bot 同时是 Agent，默认关闭；开启后按线程覆盖配置，从 QQ 轮次去掉连接器、插件、浏览器/电脑操控、子 Agent、目标、技能目录和仓库 AGENTS.md（特权文件任务保留项目文档） |
| `src/infrastructure/claude/claude-child-env.js` | Claude 子进程环境 | 白名单变量、连接 profile 和固定的静默开关 |
| `src/infrastructure/codex/qq-native-tools.js` | QQ 工具目录与分发 | 带 MCP 注解的工具 Schema、每轮调用上限（发言工具单独计数）与 callId 去重、发言/视觉/消息/资料查询/自身状态工具固定绑定原会话，以及映射到已有鉴权 Hub 操作 |
| `src/app/qq-chat-send-tool.js` | 用 `qq_chat.send` 说话 | 哪些轮次用工具说话（`resolveQqReplyDelivery`）；每轮一个发送会话：把参数规整成最终输出的可见字段、串行发送、每轮次数上限、拒绝已送达内容的重复和回合结束后的迟到调用、给模型的回执，`finalize()` 把所有回执合成一组只算一次的 reply/send 交给生命周期记录，以及说过话后又失败时补发一次“没弄完”提示；实际投递由组合根注入 |
| `src/qq-reply-delivery-prompt.js` | 两种说话方式的措辞 | `tool` 与 `final` 两种方式下不同的回复提示句：引导进来的追加消息、长期会话续接说明、结尾指令（普通、私聊主动、冷群）、融合追问提示和中断提示 |
| `src/infrastructure/agent/agent-tool-activity.js` | 可读的工具记录 | 把每次工具调用（QQ 工具和两种引擎的原生工具）连同结果写成一行中文，并汇总每轮的工具步骤；本机命令内容、聊天搜索词、口癖词和人设取值不进日志 |
| `src/infrastructure/agent/agent-drawing.js` + `src/infrastructure/codex/codex-image-generation.js` + `src/app/qq-draw-tool.js` | 没有原生生图时画图 | 启动时决定原生/Codex/不画；每张图跑一轮无工具、只读的 Codex 生图并导入本轮输出目录；`qq_draw.image` 一次只画一张并排队、过主机余量闸门、每轮限量、参考图需校验 |
| `src/qq-sticker-search.js` + `src/app/qq-sticker-tool.js` | 按需表情包库 | 由标签库身份生成的稳定 `#编号`、按情绪/场合/梗搜索并降低近期用过的权重，以及 `qq_sticker.manage` 的 search/inspect（真实视觉输入）/label/favorite |
| `src/app/qq-message-tools.js` + `src/qq-sent-message-ledger.js` | 表情回应与撤回 | `qq_message.act` 给当前/被引用群消息贴表情回应，以及撤回 Bot 自己两分钟内已确认送达的消息；消息 ID 在最底层发送处只记在内存 |
| `src/app/qq-lookup-tool.js` | 只读 QQ 资料查询 | `qq_context.lookup` 的成员/群/公告/精华信息，只限本会话出现过的人，绝不返回性别、年龄或地区 |
| `src/app/qq-archive-tool.js` + `src/qq-history-retrieval.js` 的 `fetchQqHistoryPage` | 服务器端历史、旧文件与群文件 | `qq_context.archive` 分页读取和搜索原始会话的 NapCat 历史，按轮编号文件（`hf-N`）、图片（`hi-N`）、群文件（`gf-N`）和文件夹（`gd-N`），只下载/查看已列出的编号并走已校验的文件/图片路径，剔除本地图片路径，日志只记计数 |
| `src/qq-bot-life-state.js` + `src/qq-bot-daily-routine.js` | Bot 的连续状态 | 跨会话延续的心情、来自结构化输出的分会话第一人称内心OS、每日作息（每个作息日一次无工具任务，05:00 换日），以及它们在提示词和工具里的呈现 |
| `src/qq-bot-personality.js` + `src/qq-affinity-command.js` | 核心人格与关系 | 部署者设定的基本资料、性格维度、说话方式滑块、待人方式、角色资料、世界书与预设；角色卡映射与导出；有界的自主调整（工具与周期复盘）、经核实的主人指令修改、改动历史与撤销；真人化规划使用的表达偏置；每人的好感、熟悉度、称呼与历史，带每轮/每日截断、主人下限、半衰期淡化和同会话理由；回复、世界书与兴趣判断的提示词片段；`/好感度` 解析 |
| `src/qq-character-card.js` | 角色卡格式 | 纯函数解析 Character Card V1/V2/V3、Pygmalion 与 Agnai JSON、PNG 文本块、`.charx` 压缩包和纯文字；导出 V2/V3 |
| `src/qq-bot-language-habits.js` | Bot 自己的语言习惯 | 由总结、人设刷新和 `qq_self.language_habit` 选出的分范围/通用黑话、符号、颜文字与说法；数量上限、模型每日收取上限、按已送达回复计数、复盘视图与提示词片段；从已审定知识选出本范围黑话 |
| `src/infrastructure/agent/subscription-model-task.js` | 订阅判断执行器 | Codex/Claude 兴趣判断的有界槽位与队列、临时任务目录、校验后的图片文件；引擎通过 turn runner 引擎表里的 `runQqAgentBackgroundTask` 选择 |
| `src/dashboard-admin-settings.js` | 仪表盘高级设置校验 | 按实时模型目录校验主模型设置、身份/角色名单和指令开放开关 |
| `src/qq-cross-session.js` | 跨会话目录与事件重绑定 | 列出/解析群聊私聊 selector，或把已验证角色安全绑定到目标会话 |
| `src/qq-cross-session-search.js` | 跨会话聊天记录检索 | 聊天记录工具的读取/搜索流程：按关键词、人物 QQ 号或语义近似检索所有可访问会话或按名称/选择器指定的会话，逐条标注来源会话；执行他人私聊隐私边界，并为兴趣模型组装有界的跨会话材料 |
| `src/qq-operation-log.js` | QQ 操作日志统一字段 | 统一 Agent、管理员、社交和跨会话的操作者及来源/目标范围 |
| `src/infrastructure/codex/qq-agent-output.js` | QQ 结构化最终输出边界 | 内心OS/回复/静默/寻址/附件/表情包/好感/心情 Schema（内心OS最先生成且绝不投递）、用 `qq_chat.send` 说话时的私有 Schema（内心OS、已发言/沉默、好感、心情）与投递兼容转换 |
| `src/app/qq-outbound-attachments.js` | 待发附件整理 | 把 `qq_chat.send` 附件里的文本 `content` 写进本轮输出目录；把输出目录里 QQ 不能显示的图片转成 PNG；不是图片或渲染失败时改按普通文件发送，并为回执留下说明 |
| `src/qq-enhancer/convert-image.js` | 图片格式识别与转换 | 按文件头识别格式、检查 SVG 安全性并确定渲染尺寸、在限制内用 `rsvg-convert` / `magick` 转成 PNG |
| `src/infrastructure/codex/qq-agent-attachments.js` | Codex 生成图导入边界 | 仅把当前轮、当前线程且通过图片签名校验的生成图复制进活动 QQ 任务输出目录；明确生图任务漏填附件时回收最新有效图片，普通文件策略保持不变 |
| `src/qq-inbound-files.js` | QQ 入站文件信任与传输边界 | 提取并脱敏当前/引用文件元数据、分配本轮 selector、构造群聊/私聊 URL 查询，并把有界下载限制在活动任务 input |
| `src/infrastructure/storage/settings-repository.js` | 原子设置 I/O | 加载或持久化 `data/settings.json`，不把文件系统逻辑塞回组合根 |
| `src/qq-codex-turn-recovery.js` | 融合 turn 故障隔离 | 识别超过“任务类型 × 思考强度”协议静默窗口的替代 turn，并用原始 prompt 与已接收融合输入重建一次全新线程尝试 |
| `src/qq-reply-steering.js` | QQ 追问融合调度 | 每条新追问重置的 5 秒静默窗口、单批快照消费、优先 steer 活跃 turn、拒绝时替代、已完成草稿替换、失败保留和活动轮次校验 |
| `src/qq-context-relevance.js` | 远聊天语义评分 | 缓存本地语义画像并为较早的人类/Bot 聊天片段计算相关性 |
| `src/qq-reply-targeting.js` | 融合回复寻址策略 | 有界参与者候选、模型结构化引用/艾特/普通回复目标和安全的普通回复回退 |
| `src/qq-delivery-receipt.js` | QQ 投递事实边界 | 成功/失败气泡回执和下一轮可见的有界失败上下文 |
| `src/qq-codex-session.js` | QQ Codex 会话策略 | 临时/长期/自动模式、频率判断、线程映射归一化和淘汰 |
| `src/qq-outgoing-mentions.js` | QQ 出站艾特解析 | 准确昵称/QQ号解析、重名拒绝、群成员缓存和真实 `at` 消息段构造 |
| `src/qq-knowledge-base.js` | QQ 长期知识库领域模块 | 标题/范围、黑话匹配、频率证据、删除复核状态与 repository |
| `src/dashboard-knowledge-base.js` | 网页知识管理领域边界 | 校验并精确增删改单个标题范围解释，处理并发冲突且保留频率证据 |
| `src/qq-knowledge-review.js` | 知识复杂审核提示词边界 | 兴趣模型有界初筛、主模型完整证据终审与严格结果解析 |
| `src/qq-history-retrieval.js` | QQ 复盘历史边界 | NapCat 分页、消息归一化、本地合并和去重 |
| `src/qq-robot-profile.js` | QQ 机器人人物元数据策略 | 官方 `is_robot` 优先级、上下文判断归一化、低风险指令过滤和有界机器人画像状态 |
| `src/qq-short-term-memory.js` | QQ 短期记忆领域 | 旧数据迁移、简述/详述、覆盖和过时生命周期 |
| `src/qq-style-review.js` | 真人/Bot 风格复盘边界 | 灵活主模型提示、短语/句式用法总结、带置信度与边界的标点黑话引用、范围黑话补丁、结构解析和安全压缩 |
| `src/qq-manual-ai-task.js` + `src/qq-menu.js` | 手动模型任务与 QQ 菜单的纯策略/呈现边界 | 修改任务别名、范围校验、强制模式说明或菜单视觉分区 |
| `src/qq-command-catalog.js` + `src/qq-command-reply.js` | 唯一的 QQ 指令目录与回复排版 | 新增指令及其权限 key、菜单行、说明和用法；所有指令回复统一使用卡片、`✅` 结果与 `⚠️` 警告格式 |
| `src/qq-manual-ai-task-runner.js` | 手动 AI 任务生命周期 | 前台结果/后台受理、同任务锁、有界状态历史；后台工作保留原模型限流 |
| `src/infrastructure/agent/agent-process-gate.js` | Agent CLI 启动前的本机余量闸门 | 按 Android 幻影进程上限统计存活进程并检查可用内存，为刚启动的回合预留余量，排队等待或以 `CODEX_HOST_BUSY` 拒绝 |
| `src/infrastructure/agent/agent-tool-context.js` | 原生工具模型调用边界 | 标记工具异步上下文，拒绝同步嵌套模型；后台提交显式脱离工具等待链 |
| `src/unified-memory/` | 跨通道统一记忆 | SQLite/FTS/语义向量混合召回、QQ 号/唯一别名人物识别、AI 画像提升、跨会话人物范围过滤和单次简述注入 |
| `src/*.js` | 现有领域与基础设施模块 | 修改对应能力并渐进迁移 |
| `modules/` | 平台客户端和可选集成 | 共享界面、启动器、QQ 社交桥接 |
| `scripts/` | 部署与运维命令 | 检查、部署、日志和仓库 `ncc` |
| `test/` | Node.js 测试 | 每次行为调整或模块抽取 |
| `data/` | 本地持久状态 | 不是源码；升级时必须保留 |
| `runtime/` | 日志、回复和临时生成物 | 不是源码；排障时必须保留 |

## 依赖规则

1. 通道适配器先归一化不可信输入，应用策略不直接消费原始 OneBot payload。
2. 新环境变量必须进入 `createEnvironmentConfig`，再把归一化值传给功能模块。`server.js` 内剩余的直接读取是待迁移代码，不应照搬。
3. 可变初始状态由 `createInitialState` 创建，保证测试和未来嵌入式运行获得相互隔离的实例。
4. 领域模块不能自行启动监听器、安装信号处理器或结束进程。
5. 文件、子进程和网络副作用应藏在小型导出接口之后，让策略能在不执行副作用的情况下测试。
6. `data/` 与 `runtime/` 只存运行数据，不能作为源码导入。

## 配置生命周期

```text
进程环境 / config/local.env
              |
              v
    createEnvironmentConfig
              |
              v
         启动默认值
              |
              +---- data/settings.json 覆盖持久设置
              v
           应用状态
```

仓库的 `npm run ncc -- start` 会加载 `config/local.env`；直接执行 `npm start` 只继承当前进程已有的环境变量。`data/settings.json` 加载后会覆盖对应的启动默认值。密钥应留在环境中，详见[配置参考](CONFIGURATION_CN.md)。

## 运行边界

- **HTTP：**仪表盘和管理 API 提供公开状态、维护信息和日志；没有显式开启远程绑定与认证时拒绝非回环访问。
- **OneBot：**Webhook 先经过认证或回环限制、大小限制、归一化和去重，再进入 QQ 策略。
- **Codex：**主回复、主人/公开文件任务、聊天总结、人设/风格总结和复杂知识终审全部走 App Server，旧的 `codex exec` 回复控制层已删除。多轮工具、计划、上下文压缩、Web Search、文件操作和 Shell 由 Codex 原生能力负责；默认（`CODEX_REMOTE_CONTACT_AGENT_TOOL_TRANSPORT=mcp`）由 Hub 在线程的 `mcp_servers` 配置里挂上本轮 MCP 服务提供 QQ 工具；Codex 会把 MCP 工具定义藏在工具搜索之后，直到模型选中才加载，并在每次 `thread/resume` 重新列出；因为 Hub 自己的分发器仍是权限依据，Codex 侧对它们预先批准。`dynamic` 则继续通过 `item/tool/call` 暴露 App Server 动态工具，并带上 `deferLoading`。两种方式都按原始发送者权限执行，最终输出必须符合严格 Schema。QQ 轮次默认保留 Codex 的全部原生功能和 Codex 自带基础指令；只聊天的部署可以选择开启精简的按线程配置和精简 QQ 基础提示。有界的原生 commentary 会单独经过清理，再作为带回执的任务进度投递；如果 App Server 因输出 Schema 把 commentary 包进完整的 QQ 输出对象，Hub 只在精确校验对象结构、`status`、寻址字段和空附件列表后提取可见 `text`/`bubbles`。原始 JSON 外壳、plan、silent、带附件的中途结果与最终 Schema JSON 始终留在内部。融合追问的替代、完整时限续期和新线程单次恢复保持原语义；替代 turn 的协议静默检测使用同一实际“任务类型 × 思考强度”窗口，不再固定 1 分钟截断。长期 scope 只在已保存的 SHA-256 工具指纹一致时续用同一 thread：动态工具的指纹覆盖完整定义，因为 Codex 0.158 起 `thread/resume` 不替换动态工具；MCP 只有一个传输指纹，因为 MCP 工具会在续接时重新列出。动态工具下的目录变化、传输方式变化，以及缺少指纹的旧记录，都会携带完整当前上下文新建线程，并在成功投递后保存新映射。每个子进程使用隔离白名单环境，并接收当前模型、强度、摘要、人格和服务档位。
- **Claude Code：**`CODEX_REMOTE_CONTACT_AGENT_ENGINE=claude` 时，同一个 turn runner 改调 `src/infrastructure/claude/claude-code-turn.js`，上层的提示词、动态工具、结构化 Schema、融合追问和恢复逻辑都不变。每轮起一个 `claude -p` stream-json 进程：QQ 工具通过同一个本轮 MCP 桥交回 Hub，按原发送者权限执行，并用 `ENABLE_TOOL_SEARCH=true` 和 `ToolSearch` 工具让它们的定义保持延迟加载；最终输出走 `--json-schema`；追问写入 stdin，靠回显的消息 uuid 判断是否已被模型读到，替代时先发 interrupt 控制请求。所有轮次都带 `--restricted`、`--setting-sources ''` 和 `--strict-mcp-config`，文件工具只能访问 cwd 和本轮工作区，不开放 WebFetch，只有主人/管理员文件任务才有 Bash。会话 ID 以 `claude:<uuid>` 存进同一份线程映射；切回 Codex 时会忽略这些 ID，新建线程。
- **QQ 上下文：**连续复读压缩后，总会完整发送一段连续的近期窗口（群普通 20 条、群明确触发 30 条、群扩展 48 条；私聊 30 条、扩展 60 条）。语义筛选只处理保留记录中更早的部分，并同时覆盖人类与 Bot 消息。当前正文、引用和融合追问组成同一查询，也供短期记忆、知识、印象和统一记忆召回复用。
- **QQ 投递：**主模型从完整上下文自行判断闲聊或实质任务；解题、代码、写作、总结及其短续答以完成任务为长度依据，不受闲聊字数建议限制。投递前，`src/qq-reply-chunks.js` 把超过单条安全字符上限的正文优先按段落/句子边界拆成多条有序气泡，避免把完整答案硬裁到 900 字或用一条超限消息发送。多人融合轮把有界参与者交给主模型，每位候选人都能通过结构化 `reply` 对象被选择引用或艾特；缺少或无效目标时安全回退为普通回复。旧目标 marker 会先从结构化可见正文中清掉，再进入拟人风格保护。闲聊字数预算只是提示词建议：该保护只会去掉模板化开场白或把短回复拆成气泡，绝不丢弃模型写出的内容。单人轮仍沿用基于关系距离的引用/艾特/普通回复策略。OneBot 每个气泡结果都会形成投递回执，只有成功文本进入“已发送”记忆，失败项单独保留给下一轮主模型。
- **模型职责：**已配置的 OpenRouter、DeepSeek 或自定义 OpenAI 兼容兴趣模型是后台轻量判定与杂项初筛面，厂商适配集中在 `src/interest-model-provider.js`；密钥只在环境配置中，厂商/模型选择可持久化。兴趣模型只处理有界触发、分类、风险标注、简单审核，以及 Bot 回复后同一人的冻结批次是否真实承接上一轮；Codex 主模型负责聊天、总结、工具检索、选题、词语/标点范围含义标注、知识提取、复杂推理和最终回复。词语、短语和标点的所有语境含义统一进入现有范围黑话 variant；语言画像只保存结构用法和对黑话条目的引用。
- **存储：**设置、记忆和社交状态保存在本地文件。`data/settings.json` 通过 `src/infrastructure/storage/settings-repository.js` 加载和原子替换，纯快照包含全部 Codex 原生运行参数。QQ scope 到 Codex thread 的映射单独原子写入 `data/qq-codex-sessions.json`，不复制 Codex 线程正文。`qq-knowledge-base` 在格式错误时保留原文件并切换只读保护；其他记忆存储继续按小步抽取。 头像与知识配图存放在 `data/qq-memory-images/`，记录里只保存图片 ID；只有人物印象和知识库都安全加载时才清理无引用文件。
- **周期与手动任务：**`src/wall-clock-scheduler.js` 只负责唤醒领域检查；到期时间仍保存在对应领域数据中。普通兴趣周期与短期记忆写入 `data/qq-memory.json`，知识频率复核时钟写入 `data/qq-knowledge-base.json`，自适应/人格时钟继续留在 persona 文件。启动和 QQ 通道恢复时只立即补做一轮，完成时刻成为下一周期的新起点。`/api/qq/ai-tasks`、QQ `/AI任务` 与 NCC 复用同一套总结/复盘函数、范围校验和并发锁；强制模式只跳过调度与常规样本条件。知识低频复核无论自动还是手动都先通过 `qq-enhancer` 的兴趣模型结构化通道做有界初筛，再启动 Codex 主模型读取完整证据终审。

## 新增功能的步骤

1. 选择最窄边界，优先放入 `src/channels/`、`src/app/` 或已有领域目录。
2. 在 `src/config/environment.js` 增加配置、默认值和范围限制，不再扩大 `server.js` 的直接环境读取。
3. 把纯解析/策略函数与带副作用函数分开导出。
4. 在 `src/server.js` 做少量接线。
5. 新增对应的 `test/<capability>.test.js`，运行 `npm run verify`。

## 渐进拆分路线

后续按行为不变的小切片继续缩小 `src/server.js`：

1. 继续把单个仪表盘/API 路由放到新的 `src/channels/http/hub-http-server.js` 边界之后。
2. OneBot API 调用和 QQ 回复发送移到 `src/channels/qq/`。
3. 把剩余的旧版 Codex 额度读取（rollout 文件、日志数据库、桌面缓存）移到 `src/infrastructure/codex/`；Agent turn 执行和协议用量读取已完成拆分。
4. 把剩余记忆持久化移到 `src/infrastructure/storage/`；settings 已完成拆分。

每个切片都应保持公共接口兼容并带回归测试。避免一次性大规模移动文件，否则难以审查行为变化和回滚。

## 修改检查表

1. 明确边界及其不可信输入。
2. 保持持久化 schema 兼容，或提供兼容迁移。
3. 添加聚焦单测，并覆盖副作用与策略的连接处。
4. 运行 `npm run verify`。
5. 同步受影响的中英文文档；运维行为变化时同步仓库 Skill。
