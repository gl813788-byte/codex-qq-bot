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

`src/server.js` 是组合根，负责连接依赖、启动 HTTP 监听和关闭进程。它仍是渐进拆分中的大文件，不是新增子系统的默认位置。新的解析、校验、策略和持久化逻辑应放入职责明确的模块，只在组合根中接线。

## 目录地图

| 路径 | 职责 | 适合在这里修改 |
| --- | --- | --- |
| `src/app/` | 应用状态和启动组合 | 全局状态结构、启动生命周期 |
| `src/channels/qq/` | 唯一的 QQ / OneBot 消息传输边界 | 解析、校验和归一化 QQ 事件 |
| `src/config/` | 环境变量与运行默认值 | 新环境变量、默认值、范围约束 |
| `src/qq-enhancer/` | 可选 QQ 回复增强 | 图片、主动兴趣、回复风格 |
| `src/qq-main-prompt.js` | 主模型提示词边界 | 角色、执行顺序、主动任务和按需工具目录 |
| `src/qq-proactive-pipeline.js` | 主动聊天双模型契约 | 普通接话、冷群话题/水群和主动私聊的兴趣批准凭据与主模型必经校验 |
| `src/qq-proactive-cycle-state.js` | 普通兴趣内存周期状态 | pending 消息计数、Bot 确认送达后的重置，以及作废送达前执行中 judge 且保留后续消息 |
| `src/qq-message-run-compaction.js` | 模型上下文连续复读压缩 | 相邻同文消息的语义签名、计数合并和中文条数标注 |
| `src/codex-app-server-turn.js` | Codex app-server 单轮客户端 | `thread/start`/`thread/resume`、`turn/start`、运行中控制、直接截断续开、inactive turn 竞态恢复、超时和中断 |
| `src/qq-codex-turn-recovery.js` | 融合 turn 故障隔离 | 识别无进展的替代 turn，并用原始 prompt 与已接收融合输入重建一次全新线程尝试 |
| `src/qq-reply-steering.js` | QQ 追问融合调度 | 每条新追问重置的 5 秒静默窗口、单批快照消费、直接开始替代 turn、已完成草稿替换、失败保留和活动轮次校验 |
| `src/qq-context-relevance.js` | 远聊天语义评分 | 缓存本地语义画像并为较早的人类/Bot 聊天片段计算相关性 |
| `src/qq-reply-targeting.js` | 融合回复寻址策略 | 有界参与者候选、模型隐藏引用/艾特/普通回复标记和安全的普通回复回退 |
| `src/qq-delivery-receipt.js` | QQ 投递事实边界 | 成功/失败气泡回执和下一轮可见的有界失败上下文 |
| `src/qq-codex-session.js` | QQ Codex 会话策略 | 临时/长期/自动模式、频率判断、线程映射归一化和淘汰 |
| `src/qq-outgoing-mentions.js` | QQ 出站艾特解析 | 准确昵称/QQ号解析、重名拒绝、群成员缓存和真实 `at` 消息段构造 |
| `src/qq-knowledge-base.js` | QQ 长期知识库领域模块 | 标题/范围、黑话匹配、频率证据、删除复核状态与 repository |
| `src/dashboard-knowledge-base.js` | 网页知识管理领域边界 | 校验并精确增删改单个标题范围解释，处理并发冲突且保留频率证据 |
| `src/qq-knowledge-review.js` | 知识复杂审核提示词边界 | 兴趣模型有界初筛、主模型完整证据终审与严格结果解析 |
| `src/qq-history-retrieval.js` | QQ 复盘历史边界 | NapCat 分页、消息归一化、本地合并和去重 |
| `src/qq-short-term-memory.js` | QQ 短期记忆领域 | 旧数据迁移、简述/详述、覆盖和过时生命周期 |
| `src/qq-style-review.js` | 真人/Bot 风格复盘边界 | 灵活主模型提示、结构解析和安全压缩 |
| `src/qq-manual-ai-task.js` + `src/qq-menu.js` | 手动模型任务与 QQ 菜单的纯策略/呈现边界 | 修改任务别名、范围校验、强制模式说明或菜单视觉分区 |
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
- **Codex：**普通 QQ 回复通过 app-server 的可控 turn 运行；一批追问静默满 5 秒后，Hub 直接 `turn/interrupt`，再在同一 thread 中 `turn/start` 一段替代输入。app-server 若报告旧 turn 已经 inactive，Hub 会把它视为可以直接开始替代 turn 的边界竞态，而不是继续保留批次。每次追问引导被接受或替代 turn 开始时，任务截止时间都会按当前任务类型续成完整窗口，而不是沿用旧 turn 的剩余时间。替代 turn 连续 60 秒没有协议活动时会被隔离，并在全新 app-server 线程中用原始完整 prompt 与已接收融合输入重试一次；普通非融合超时不会重试。如果 turn 完成时仍有一批追问等待处理，未发送草稿会被丢弃，这批追问立即开启替代轮次，不继续等待也不投递过时文本。长期 scope 通过独立 app-server 进程 `thread/resume` 同一本地线程；每个子进程仍使用受控环境、并发限制和当前 QQ 模型配置。
- **QQ 上下文：**连续复读压缩后，总会完整发送一段连续的近期窗口（群普通 20 条、群明确触发 30 条、群扩展 48 条；私聊 30 条、扩展 60 条）。语义筛选只处理保留记录中更早的部分，并同时覆盖人类与 Bot 消息。当前正文、引用和融合追问组成同一查询，也供短期记忆、知识、印象和统一记忆召回复用。
- **QQ 投递：**多人融合轮把有界参与者交给主模型，每位候选人都能被选择引用或艾特；缺少或无效标记时安全回退为普通回复。单人轮仍沿用基于关系距离的引用/艾特/普通回复策略。OneBot 每个气泡结果都会形成投递回执，只有成功文本进入“已发送”记忆，失败项单独保留给下一轮主模型。
- **模型职责：**已配置的 OpenRouter、DeepSeek 或自定义 OpenAI 兼容兴趣模型是后台轻量判定与杂项初筛面，厂商适配集中在 `src/interest-model-provider.js`；密钥只在环境配置中，厂商/模型选择可持久化。兴趣模型只处理有界触发、分类、风险标注和简单审核；Codex 主模型负责聊天、总结、工具检索、选题、知识提取、复杂推理和最终回复。
- **存储：**设置、记忆和社交状态保存在本地文件；QQ scope 到 Codex thread 的映射单独原子写入 `data/qq-codex-sessions.json`，不复制 Codex 线程正文。`qq-knowledge-base` 已通过 repository 进行安全加载与原子写入；格式错误会保留原文件并切换只读保护，其他存储后续按小步继续抽取。
- **周期与手动任务：**`src/wall-clock-scheduler.js` 只负责唤醒领域检查；到期时间仍保存在对应领域数据中。普通兴趣周期与短期记忆写入 `data/qq-memory.json`，知识频率复核时钟写入 `data/qq-knowledge-base.json`，自适应/人格时钟继续留在 persona 文件。启动和 QQ 通道恢复时只立即补做一轮，完成时刻成为下一周期的新起点。`/api/qq/ai-tasks`、QQ `/AI任务` 与 NCC 复用同一套总结/复盘函数、范围校验和并发锁；强制模式只跳过调度与常规样本条件。知识低频复核无论自动还是手动都先通过 `qq-enhancer` 的兴趣模型结构化通道做有界初筛，再启动 Codex 主模型读取完整证据终审。

## 新增功能的步骤

1. 选择最窄边界，优先放入 `src/channels/`、`src/app/` 或已有领域目录。
2. 在 `src/config/environment.js` 增加配置、默认值和范围限制，不再扩大 `server.js` 的直接环境读取。
3. 把纯解析/策略函数与带副作用函数分开导出。
4. 在 `src/server.js` 做少量接线。
5. 新增对应的 `test/<capability>.test.js`，运行 `npm run verify`。

## 渐进拆分路线

后续按行为不变的小切片继续缩小 `src/server.js`：

1. 仪表盘/API 路由移到 `src/channels/http/`。
2. OneBot API 调用和 QQ 回复发送移到 `src/channels/qq/`。
3. Codex CLI 执行和额度发现移到 `src/infrastructure/codex/`。
4. 设置与记忆持久化移到 `src/infrastructure/storage/`。

每个切片都应保持公共接口兼容并带回归测试。避免一次性大规模移动文件，否则难以审查行为变化和回滚。

## 修改检查表

1. 明确边界及其不可信输入。
2. 保持持久化 schema 兼容，或提供兼容迁移。
3. 添加聚焦单测，并覆盖副作用与策略的连接处。
4. 运行 `npm run verify`。
5. 同步受影响的中英文文档；运维行为变化时同步仓库 Skill。
