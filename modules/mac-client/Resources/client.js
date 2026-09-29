const HUB = location.protocol === "http:" || location.protocol === "https:" ? "" : "http://127.0.0.1:3789";
const STORAGE_PREFIX = "codexRemoteContact.";
const validViews = new Set(["overview", "channels", "intelligence", "memory", "knowledge", "activity", "settings"]);
const engineNames = { codex: "Codex", claude: "Claude Code" };

const translations = {
  zh: {
    skipToContent: "跳到主要内容", mainNavigation: "主导航", mobileNavigation: "移动端导航", brandHome: "控制台首页", brandSubtitle: "本地控制台", engineLabel: "AI 引擎",
    navOverview: "总览", navChannels: "通道", navIntelligence: "行为", navMemory: "记忆", navKnowledge: "知识", navActivity: "日志", navSettings: "设置",
    overviewTitle: "运行总览", channelsTitle: "消息通道", intelligenceTitle: "Bot 行为", memoryTitle: "记忆", knowledgeTitle: "知识库", activityTitle: "日志", settingsTitle: "设置",
    overviewSubtitle: "{engine} 正在驱动 QQ Bot", overviewSubtitleWaiting: "正在读取运行状态", channelsSubtitle: "QQ 通道、群白名单与最近事件", intelligenceSubtitle: "功能开关、人设、表达学习与主动兴趣", memorySubtitle: "统一摘要与 QQ 会话上下文", knowledgeSubtitle: "黑话、群内知识与成员理解", activitySubtitle: "所有模块的结构化运行日志", settingsSubtitle: "外观、刷新与访问方式",
    connecting: "正在连接", waitingSync: "等待同步", quickActions: "快速操作", openQuickActions: "打开快速操作", refreshCurrent: "刷新当前页面", toggleTheme: "切换主题",
    hubUnavailable: "Hub 暂时不可用", offlineHint: "请确认本地服务已启动。", retry: "重试", manageChannels: "管理通道", openApi: "查看 API",
    runtimeSummary: "运行摘要", serviceHealth: "服务状态", serviceHealthHint: "Hub 与各个依赖的实时健康度", checkNow: "立即检查",
    usageWindow: "Codex 用量", latencyTitle: "接口响应", waitingSamples: "等待首个样本", sampleCount: "最近 {count} 次采样", now: "现在",
    recentActivity: "最近活动", recentActivityHint: "最近的 QQ 消息与回复", openLogs: "查看日志", noRecentActivity: "还没有最近活动。",
    systemReady: "一切正常", systemReadyBody: "所有服务在线，{engine} 随时可以回复消息。", systemAttention: "部分功能未启用", systemAttentionBody: "{items} 当前未启用，其余功能不受影响。", systemCritical: "有服务需要处理", systemCriticalBody: "{items} 状态异常，先看下方的服务详情。",
    uptime: "运行时长", servicesOnline: "在线服务", activeTasks: "进行中", pendingTasks: "排队中", startedAtHint: "启动于 {time}", queueHint: "上限 {max}",
    serviceHub: "Hub", serviceOneBot: "OneBot", serviceQq: "QQ 通道", serviceWeb: "联网查询",
    stateOk: "正常", stateBusy: "运行中", stateBad: "异常", stateOff: "未启用", statePending: "检查中",
    hubDetail: "本地接口 {endpoint}", oneBotDetail: "{name} · QQ {id}", oneBotDown: "无法连接 OneBot：{error}", qqEnabledDetail: "{groups} 个白名单群 · {events} 条最近事件", qqDisabledDetail: "QQ 通道已关闭", qqBusyDetail: "生成中 {active} · 待回复 {pending}",
    webDetail: "{provider}", webLastQuery: "{provider} · 最近查询：{query}", webDisabled: "联网查询已关闭",
    agentDetail: "{model} · 思考强度 {effort}", agentPathMissing: "找不到 {engine} 命令",
    engineModel: "模型", engineEffort: "思考强度", engineVersion: "CLI 版本", engineConnection: "连接方式", engineQueue: "任务队列", engineSessions: "长期会话",
    connectionProfile: "ncc 连接配置", connectionLogin: "本机登录", connectionAppServer: "App Server", queueValue: "进行 {active} · 排队 {pending}", sessionsValue: "{count} 个",
    versionMissing: "命令不可用", versionChecking: "检查中",
    lastRunOk: "上次运行成功", lastRunFailed: "上次运行失败", lastRunNever: "还没有运行过", lastRunMeta: "{time} · 耗时 {duration}",
    quotaUnavailable: "暂无可用额度快照", quotaNotReported: "{engine} 不向 Hub 提供用量数据。", fiveHours: "5 小时窗口", sevenDays: "7 天窗口", remaining: "剩余 {value}%", resetsAt: "{time} 重置", noReset: "重置时间未知", recordedAt: "记录于 {time}",
    toggleQq: "启用 QQ 通道", qqAllowlist: "QQ 群白名单", qqAllowlistHint: "只有列表内的群聊会触发 Bot。", groupId: "群号", groupIdExample: "输入群号，例如 123456789", add: "添加",
    qqRecent: "QQ 最近事件", qqRecentHint: "最近 30 条进入 Hub 的 QQ 消息", colTime: "时间", colScope: "来源", colSender: "发送者", colState: "状态", colMessage: "消息",
    connAccount: "QQ 账号", connBridge: "OneBot 桥", connQueue: "消息队列", active: "进行", pending: "排队", enabled: "已开启", disabled: "已关闭", healthy: "正常", attention: "异常",
    replied: "已回复", ignored: "未回复", privateChat: "私聊", groupLabel: "群 {value}", replyLabel: "回复：", noEvents: "还没有事件。", noGroups: "还没有添加白名单群。",
    removeGroupTitle: "移除白名单群", removeGroupMessage: "确定把群 {value} 移出白名单吗？", groupInvalid: "请输入 4–20 位数字群号。", channelUpdated: "通道状态已更新", saved: "已保存",
    botControlHeading: "功能开关与调试参数", botControlBody: "开关立即生效；判定参数只影响主动兴趣，不影响直接 @ Bot 的回复。",
    settingsSynced: "设置已同步", settingsUnsaved: "有未保存的修改", settingsSaving: "正在保存", settingsSaveFailed: "保存失败",
    qqEnhancerFeature: "QQ 增强能力", qqEnhancerFeatureHint: "图片上下文、自然表达与扩展行为的总开关。", webLookupFeature: "联网查询", webLookupFeatureHint: "允许 Bot 在需要时调用已配置的搜索服务。", proactiveFeature: "主动兴趣", proactiveFeatureHint: "允许普通群消息、冷群和私聊进入主动判断。", interestJudgeFeature: "兴趣模型判定", interestJudgeFeatureHint: "用所选服务的模型判断是否值得自然接话。",
    judgeEveryMessages: "消息间隔", judgeEveryMinutes: "分钟间隔", judgeProvider: "模型服务", judgeProviderCustom: "自定义兼容服务", judgeModel: "判定模型", judgeTimeout: "静默超时（ms）", judgeRecentMessages: "最近上下文", saveBotSettings: "保存 Bot 设置", botSettingsSaved: "Bot 设置已保存", waitingBotSettings: "等待 Bot 设置",
    diagEngine: "引擎：{value}", diagJudgeProvider: "判定服务：{value}", diagJudgeKeyReady: "判定 Key 已配置", diagJudgeKeyMissing: "判定 Key 未配置", diagSearchProvider: "搜索：{value}", diagSafeFetch: "安全下载：{value}", safeFetchProxy: "代理兼容", safeFetchStrict: "严格", diagActiveGeneration: "生成中：{value}", diagPendingReplies: "待回复：{value}",
    selfPersona: "Bot 全局人设", selfPersonaHint: "从各群和私聊的匿名摘要生成；QQ 昵称固定作为名字。", viewDetailedLogs: "查看日志",
    selfPersonaCollecting: "正在积累会话与 Bot 回复，达到阈值后自动生成人设。", selfPersonaGenerated: "第 {revision} 版 · {time}", selfPersonaProgress: "真人消息 {human} · Bot 回复 {bot} · 已总结 {summaries}/{scopes} 个会话",
    selfPersonaPolicy: "会话摘要：首次 {initial} 条，之后每 {messages} 条或 {botReplies} 次 Bot 回复，间隔至少 {scopeHours} 小时", selfPersonaGlobalPolicy: "全局人设：首次 {initial} 条消息且至少 2 个会话；之后新增 {messages} 条真人消息、{botReplies} 次 Bot 回复或 {summaries} 份摘要，间隔至少 {hours} 小时；失败 {retry} 小时后重试",
    selfPersonaKeywords: "兴趣关键词", selfPersonaTopics: "加权兴趣",
    adaptiveLearning: "自动适应", adaptiveLearningHint: "按群学习活跃时段与成员节奏，并每 24 小时复盘 Bot 的表达。", adaptiveSamples: "{count} 条真人消息 · {members} 位成员", adaptiveHours: "常见活跃时段：{hours}", adaptiveColdWaiting: "有未获回复的 Bot 消息，兴趣已自动降低", adaptiveCollecting: "正在积累 Bot 回复，样本足够后每 24 小时复盘。", noAdaptiveLearning: "还没有可用的学习样本。",
    learningHuman: "真人学习参数", learningBot: "Bot 实际表现", learningReview: "风格复盘", learningInterest: "兴趣回复参数",
    detailSample: "样本 {value}", detailConfidence: "置信度 {value}%", detailTextSample: "文字样本 {value}", detailAverageChars: "平均 {value} 字", detailShortRatio: "短消息 {value}%", detailLongRatio: "长消息 {value}%", detailStickerRatio: "表情包 {value}%", detailImageRatio: "图片 {value}%", detailEmojiRatio: "Emoji {value}%", detailReplyRatio: "引用回复 {value}%", detailMentionRatio: "@ 消息 {value}%", detailQuestionRatio: "问句 {value}%", detailBotInteraction: "与 Bot 互动 {value}%", detailBurstRatio: "两分钟连发 {value}%", detailPokeRatio: "拍一拍 {value}% · {count} 次（拍 Bot {bot}%）", detailInterruptionRate: "插话率 {value}% · {samples} 次衔接", detailGap: "间隔中位数 {value}", detailActiveDays: "活跃 {value} 天", detailDailyMessages: "活跃日均 {value} 条", detailCurrentHour: "当前时段占比 {value}%", detailFirstSeen: "开始学习 {value}", detailLastHuman: "最后真人消息 {value}",
    detailBotReplies: "Bot 回复 {value}", detailBotChars: "Bot 平均 {value} 字", detailBotSticker: "Bot 表情包 {value}%", detailBotBubbles: "多气泡 {value}%", detailBotFollowup: "真人接话率 {value}%", detailTrackingStart: "统计起点 {value}", detailLastBot: "最后 Bot 回复 {value}",
    detailReviewSamples: "复盘样本 真人 {human} / Bot {bot}", detailLastReview: "上次复盘 {value}", detailNextReview: "下次复盘 {value}",
    detailOrdinaryInterest: "普通兴趣：{messages} 条或 {minutes} 分钟", detailInterestReason: "间隔依据 {value}", detailLearnedHours: "开放时段 {value}", detailUnanswered: "连续未回复 {value}", detailInterestMultiplier: "兴趣系数 {value}", detailColdIdle: "已沉默 {idle} / 需要 {required} 小时", detailColdReason: "当前状态 {value}", detailColdThreshold: "计时阈值 {value}", detailColdCheck: "上次判断 {value}", detailColdSent: "上次主动发言 {value}", detailNextCheck: "下次可判断 {value}",
    stickerFrequency: "表情包频率", stickerFrequencyHint: "真人与 Bot 在各群的实际使用率。", stickerHuman: "真人", stickerBot: "Bot", stickerPlan: "计划", stickerSamples: "真人 {human} 条 · Bot {bot} 条", noStickerFrequency: "还没有可统计的群聊样本。",
    coldInterest: "冷群兴趣发言", coldInterestHint: "按最后一条消息计时，结合群节奏决定发一句或保持沉默。", coldInterestPolicy: "开放时段：{hours} · 基础重试 {retry} 小时 · 未获回复会降低兴趣并延长间隔", learnedHours: "按各群活跃统计", recentDecisions: "最近判断", noColdInterest: "还没有可展示的冷群状态。", noColdInterestDecisions: "还没有触发过冷群判断。",
    privateInterest: "私聊主动兴趣", privateInterestHint: "按互动频率与间隔估算概率，连续未回复会自动退避。", privateContact: "联系人 {value}", privatePhase: "阶段 {value}", privateProbability: "候选概率 {value}%", privateFrequency: "互动频率 {value}", noPrivateInterest: "还没有可展示的私聊学习状态。", noPrivateInterestDecisions: "还没有触发过私聊主动判断。",
    outcomeSent: "已发送", outcomeSilent: "保持沉默", outcomeFailed: "失败", outcomeCancelled: "因新消息取消",
    memoryType: "记忆类型", unified: "统一记忆", searchMemory: "搜索记忆", refresh: "刷新", noMemory: "没有符合条件的记忆。", entriesCount: "{count} 条", clear: "清空", clearMemoryTitle: "清空记忆", clearMemoryMessage: "会永久清理“{value}”中的记忆，确定继续吗？", allRelatedMemory: "{value} 的全部相关记忆", memoryCleared: "记忆已清空",
    unifiedEntries: "统一摘要", handoffs: "交接", ideas: "点子", projects: "项目", todos: "待办", notes: "记录", recentState: "近期状态", latestHandoff: "最近交接", noState: "暂无近期状态", updated: "更新于 {time}",
    autoSkillMemory: "Skill 回看后写入", autoSkillHint: "桌面 Skill 调用记忆后自动沉淀", manualHandoff: "允许手动交接", manualHandoffHint: "允许 /交接 指令写入摘要",
    shortTermMemory: "短期记忆", recentMessages: "最近消息", roleUser: "用户", roleAssistant: "助手", publicMemory: "公共长期记忆", personas: "群友画像", conversationImpressions: "对话印象", impressionBrief: "印象简述", impressionDetail: "印象详述", thoughtBrief: "感想简述", thoughtDetail: "感想详述", recentTopic: "近期话题", recentInteraction: "近期互动",
    knowledgeTitles: "知识标题", knowledgeVariants: "范围解释", knowledgeSlang: "黑话", knowledgeReviews: "审查记录",
    knowledgeSearch: "搜索标题、含义、群或成员", knowledgeKind: "知识类型", knowledgeAllKinds: "全部类型", knowledgeKindSlang: "黑话", knowledgeKindNote: "知识", knowledgeScope: "适用范围", knowledgeAllScopes: "全部范围", knowledgeGlobal: "全局", knowledgeGroup: "群", knowledgeMember: "成员", knowledgeGroupMember: "群内成员", knowledgeSortLabel: "排序方式", knowledgeSortUpdated: "最近更新", knowledgeSortFrequency: "出现频率", knowledgeSortTitle: "标题", newKnowledge: "新建知识",
    knowledgeAll: "全部知识", knowledgeNotes: "普通知识", knowledgePendingReview: "待审查", knowledgeResults: "{count} 个标题", knowledgeNoEntries: "没有符合条件的知识。", knowledgeEmptyHint: "知识会随总结自动写入，也可以在这里手动添加。", knowledgeCreateFirst: "添加第一条知识", knowledgeNoSelection: "从列表中选择一条知识，查看含义、范围与出现记录。",
    knowledgeDefinition: "含义与内容", knowledgeStatistics: "出现统计", knowledgeHitCount: "累计出现", knowledgeLastSeen: "最近出现", knowledgeAliases: "别名", knowledgeEvidence: "最近语境", knowledgeReviewState: "模型审查", knowledgeReviewHealthy: "当前无需删除审查", knowledgeNeverSeen: "还没有在聊天中出现过",
    editKnowledge: "编辑", deleteKnowledge: "删除", deleteKnowledgeTitle: "删除这条知识", deleteKnowledgeMessage: "确定删除“{value}”在当前范围内的解释吗？其他群或成员的解释不受影响。", knowledgeDeleted: "知识已删除", knowledgeSaved: "知识已保存",
    knowledgeEditorTitleNew: "新建知识", knowledgeEditorTitleEdit: "编辑知识", knowledgeScopeType: "适用范围", knowledgeTitleField: "标题 / 词语", knowledgeContent: "含义 / 内容", knowledgeAliasesHint: "多个别名用逗号分隔", knowledgeGroupId: "群 QQ 号", knowledgeGroupName: "群名称", knowledgeUserId: "成员 QQ 号", knowledgeUserName: "成员名称", saveKnowledge: "保存知识",
    knowledgeHitValue: "{count} 次", knowledgeOccurrenceMessage: "{sender} · {time}", knowledgeReviewDecision: "{decision} · {time}", knowledgeScopeGlobal: "全部会话", knowledgeScopeGroup: "{name} · 群 {id}", knowledgeScopeMember: "{name} · QQ {id}", knowledgeScopeGroupMember: "{group}（{groupId}）中的 {user}（{userId}）", knowledgeSourceCount: "{count} 条来源", knowledgeUpdated: "更新于 {time}", knowledgeContextBefore: "上文", knowledgeContextAfter: "下文", knowledgeUnknownName: "未命名",
    level: "级别", allLevels: "全部级别", category: "模块", allCategories: "全部模块", engineFilter: "AI 引擎", allEngines: "全部引擎", search: "搜索", logSearchHint: "消息、Trace、群或发送者", slowThreshold: "慢请求", noLimit: "不限", visibleLogCount: "显示条数", resetFilter: "重置", applyFilter: "筛选", filterApplied: "筛选已应用",
    structuredLogs: "实时日志", waitingLogs: "等待日志", matchedLogs: "显示 {visible} 条 · 共匹配 {matched} 条", liveConnected: "实时连接", livePaused: "已暂停", liveError: "连接异常", liveRefresh: "实时刷新", followLatest: "跟随最新", expandDetails: "展开详情", liveLogStream: "实时日志", noLogs: "没有符合筛选条件的日志。",
    totalLogs: "日志总数", traces: "链路", p95Latency: "P95 耗时", maxLatency: "最慢耗时", engineLogs: "{engine} {count} 条", viewJson: "查看 JSON",
    catSystem: "系统", catQq: "QQ", catOnebot: "OneBot", catAgent: "智能体", catCodex: "Codex", catWeb: "接口", catSearch: "搜索", catInterest: "兴趣", catLearning: "学习", catMemory: "记忆", catCommand: "指令", catLifecycle: "流程",
    appearance: "外观", appearanceHint: "跟随系统，或固定使用浅色 / 深色。", theme: "主题", system: "系统", light: "浅色", dark: "深色", language: "界面语言", languageHint: "切换控制台文案与时间格式。", autoRefresh: "自动刷新", autoRefreshHint: "页面隐藏时自动暂停。", refreshInterval: "刷新间隔",
    hubEndpoint: "Hub 地址", hubEndpointHint: "当前页面连接的 Hub 地址。", copy: "复制", rawState: "原始状态",
    lanAccess: "局域网访问", lanAccessHint: "只显示其他设备可达的物理局域网地址；若代理仍拦截，请把该地址设为直连。", lanLocalOnly: "仅本机可访问", lanNoAddress: "已开放，但没有找到物理局域网 IPv4 地址，请检查 Wi-Fi / 以太网或代理设置", copyLanToken: "复制访问令牌", lanEnableTitle: "开启局域网访问", lanEnableMessage: "同一局域网内的设备将可以打开控制台，管理接口仍受访问令牌保护。", lanAccessUpdated: "局域网访问设置已更新", lanTokenCopied: "访问令牌已复制", lanManagedByEnvironment: "监听地址由环境变量管理，无法在网页中修改。",
    publicTunnel: "临时公网访问", publicTunnelHint: "通过 Cloudflare Quick Tunnel 生成临时 HTTPS 地址；远端仍需访问令牌。", publicTunnelRunningHint: "公网地址已就绪。请把地址和令牌分开、安全地交给需要访问的人。", publicTunnelStarting: "正在创建临时公网地址…", publicTunnelOff: "未开启公网访问", publicTunnelUnavailable: "没有找到 cloudflared，请先安装并确保它在 Hub 的 PATH 中。", publicTunnelRemoteManaged: "为防止远端扩大访问范围，只能在本机页面开启、关闭和复制令牌。", publicTunnelError: "隧道启动失败：{error}", publicTunnelEnableTitle: "开启临时公网访问", publicTunnelEnableMessage: "这会把控制台临时开放到公网。远端管理接口仍需访问令牌，请只交给可信的人。", publicTunnelUpdated: "临时公网访问设置已更新", copyPublicTunnelUrl: "复制地址", publicTunnelUrlCopied: "公网地址已复制",
    aboutBody: "把 QQ 接到本机 Codex 或 Claude Code 的本地中枢。", factEngine: "AI 引擎", factModel: "当前模型", factEffort: "思考强度", factStarted: "启动时间",
    confirmAction: "确认操作", cancel: "取消", confirm: "确认", logDetail: "日志详情", close: "关闭", copyJson: "复制 JSON", done: "完成", copied: "已复制", copyFailed: "复制失败，请手动选择内容。",
    hubOnline: "Hub 在线", hubOffline: "Hub 离线", syncedNow: "刚刚同步",
    searchActions: "搜索页面或操作", commandHint: "↑↓ 选择 · Enter 执行 · Esc 关闭", noMatchingActions: "没有匹配的操作",
    actionOverviewHint: "服务健康、AI 引擎与最近活动", actionChannelsHint: "QQ 通道、白名单与最近事件", actionIntelligenceHint: "开关、人设、表达学习与主动兴趣", actionMemoryHint: "搜索和清理上下文记忆", actionKnowledgeHint: "管理长期知识与黑话", actionLogsHint: "查看实时日志并追踪问题", actionSettingsHint: "主题、语言、刷新与访问方式",
    actionRefresh: "刷新当前页面", actionRefreshHint: "重新同步当前页面的数据", actionHealth: "检查服务健康", actionHealthHint: "立即重新探测本地服务", actionTheme: "切换明暗主题", actionThemeHint: "在浅色与深色之间切换", actionApi: "查看原始状态", actionApiHint: "打开 Hub 返回的原始 JSON", actionAddGroup: "添加 QQ 群", actionAddGroupHint: "前往通道页并定位群号输入框", actionEngineLogs: "查看 {engine} 日志", actionEngineLogsHint: "只看当前 AI 引擎的运行记录",
    apiTokenPrompt: "这个 Hub 启用了 API Token。请输入 Token（只保存在当前标签页）：", requestFailed: "请求失败", networkError: "无法连接到本地 Hub。", unknown: "未知", yes: "是", no: "否"
  },
  en: {
    skipToContent: "Skip to main content", mainNavigation: "Main navigation", mobileNavigation: "Mobile navigation", brandHome: "Console home", brandSubtitle: "Local console", engineLabel: "AI engine",
    navOverview: "Overview", navChannels: "Channels", navIntelligence: "Behavior", navMemory: "Memory", navKnowledge: "Knowledge", navActivity: "Logs", navSettings: "Settings",
    overviewTitle: "Overview", channelsTitle: "Channels", intelligenceTitle: "Bot behavior", memoryTitle: "Memory", knowledgeTitle: "Knowledge base", activityTitle: "Logs", settingsTitle: "Settings",
    overviewSubtitle: "{engine} is driving the QQ Bot", overviewSubtitleWaiting: "Reading runtime status", channelsSubtitle: "QQ channel, group allowlist and recent events", intelligenceSubtitle: "Switches, persona, expression learning and proactive interest", memorySubtitle: "Unified summaries and QQ conversation context", knowledgeSubtitle: "Slang, group knowledge and member notes", activitySubtitle: "Structured runtime logs from every module", settingsSubtitle: "Appearance, refresh and access",
    connecting: "Connecting", waitingSync: "Waiting to sync", quickActions: "Quick actions", openQuickActions: "Open quick actions", refreshCurrent: "Refresh this page", toggleTheme: "Toggle theme",
    hubUnavailable: "Hub is unavailable", offlineHint: "Make sure the local service is running.", retry: "Retry", manageChannels: "Manage channels", openApi: "View API",
    runtimeSummary: "Runtime summary", serviceHealth: "Services", serviceHealthHint: "Live health of the Hub and its dependencies", checkNow: "Check now",
    usageWindow: "Codex usage", latencyTitle: "API response", waitingSamples: "Waiting for the first sample", sampleCount: "Samples: {count}", now: "Now",
    recentActivity: "Recent activity", recentActivityHint: "Latest QQ messages and replies", openLogs: "Open logs", noRecentActivity: "No recent activity yet.",
    systemReady: "All systems normal", systemReadyBody: "Every service is online and {engine} is ready to reply.", systemAttention: "Some features are off", systemAttentionBody: "{items} disabled; everything else keeps working.", systemCritical: "A service needs attention", systemCriticalBody: "{items} unhealthy. Check the service details below.",
    uptime: "Uptime", servicesOnline: "Services online", activeTasks: "In progress", pendingTasks: "Queued", startedAtHint: "Started {time}", queueHint: "Limit {max}",
    serviceHub: "Hub", serviceOneBot: "OneBot", serviceQq: "QQ channel", serviceWeb: "Web lookup",
    stateOk: "Healthy", stateBusy: "Running", stateBad: "Problem", stateOff: "Off", statePending: "Checking",
    hubDetail: "Local API {endpoint}", oneBotDetail: "{name} · QQ {id}", oneBotDown: "Cannot reach OneBot: {error}", qqEnabledDetail: "{groups} allowlisted groups · {events} recent events", qqDisabledDetail: "QQ channel is off", qqBusyDetail: "Generating {active} · pending {pending}",
    webDetail: "{provider}", webLastQuery: "{provider} · last query: {query}", webDisabled: "Web lookup is off",
    agentDetail: "{model} · effort {effort}", agentPathMissing: "{engine} command not found",
    engineModel: "Model", engineEffort: "Reasoning effort", engineVersion: "CLI version", engineConnection: "Connection", engineQueue: "Task queue", engineSessions: "Persistent sessions",
    connectionProfile: "ncc connection profile", connectionLogin: "Local login", connectionAppServer: "App Server", queueValue: "{active} running · {pending} queued", sessionsValue: "{count}",
    versionMissing: "Command unavailable", versionChecking: "Checking",
    lastRunOk: "Last run succeeded", lastRunFailed: "Last run failed", lastRunNever: "Not run yet", lastRunMeta: "{time} · took {duration}",
    quotaUnavailable: "No usage snapshot yet", quotaNotReported: "{engine} does not report usage to the Hub.", fiveHours: "5-hour window", sevenDays: "7-day window", remaining: "{value}% left", resetsAt: "Resets {time}", noReset: "Reset time unknown", recordedAt: "Recorded {time}",
    toggleQq: "Enable QQ channel", qqAllowlist: "QQ group allowlist", qqAllowlistHint: "Only listed groups can trigger the Bot.", groupId: "Group ID", groupIdExample: "Group ID, e.g. 123456789", add: "Add",
    qqRecent: "Recent QQ events", qqRecentHint: "The last 30 QQ messages that reached the Hub", colTime: "Time", colScope: "Source", colSender: "Sender", colState: "State", colMessage: "Message",
    connAccount: "QQ account", connBridge: "OneBot bridge", connQueue: "Message queue", active: "Active", pending: "Pending", enabled: "Enabled", disabled: "Disabled", healthy: "Healthy", attention: "Problem",
    replied: "Replied", ignored: "No reply", privateChat: "Private", groupLabel: "Group {value}", replyLabel: "Reply: ", noEvents: "No events yet.", noGroups: "No allowlisted groups yet.",
    removeGroupTitle: "Remove group", removeGroupMessage: "Remove group {value} from the allowlist?", groupInvalid: "Enter a 4–20 digit group ID.", channelUpdated: "Channel updated", saved: "Saved",
    botControlHeading: "Feature switches and tuning", botControlBody: "Switches apply immediately; judge settings only affect proactive interest, never direct @Bot replies.",
    settingsSynced: "Settings synced", settingsUnsaved: "Unsaved changes", settingsSaving: "Saving", settingsSaveFailed: "Save failed",
    qqEnhancerFeature: "QQ enhancement", qqEnhancerFeatureHint: "Master switch for image context, natural expression and extended behavior.", webLookupFeature: "Web lookup", webLookupFeatureHint: "Lets the Bot use configured search services when needed.", proactiveFeature: "Proactive interest", proactiveFeatureHint: "Allows ordinary group, cold-group and private proactive candidates.", interestJudgeFeature: "Interest model judge", interestJudgeFeatureHint: "Uses the selected provider to decide whether joining in adds value.",
    judgeEveryMessages: "Message interval", judgeEveryMinutes: "Minute interval", judgeProvider: "Provider", judgeProviderCustom: "Custom compatible service", judgeModel: "Judge model", judgeTimeout: "Idle timeout (ms)", judgeRecentMessages: "Recent context", saveBotSettings: "Save Bot settings", botSettingsSaved: "Bot settings saved", waitingBotSettings: "Waiting for Bot settings",
    diagEngine: "Engine: {value}", diagJudgeProvider: "Judge: {value}", diagJudgeKeyReady: "Judge key configured", diagJudgeKeyMissing: "Judge key missing", diagSearchProvider: "Search: {value}", diagSafeFetch: "Safe downloads: {value}", safeFetchProxy: "proxy-compatible", safeFetchStrict: "strict", diagActiveGeneration: "Generating: {value}", diagPendingReplies: "Pending replies: {value}",
    selfPersona: "Global Bot persona", selfPersonaHint: "Generated from anonymous group and private summaries; the QQ nickname stays the name.", viewDetailedLogs: "View logs",
    selfPersonaCollecting: "Collecting conversations and Bot replies; the persona is generated once the threshold is reached.", selfPersonaGenerated: "Revision {revision} · {time}", selfPersonaProgress: "{human} human messages · {bot} Bot replies · {summaries}/{scopes} scopes summarized",
    selfPersonaPolicy: "Scope summary: first at {initial} messages, then every {messages} messages or {botReplies} Bot replies, at least {scopeHours}h apart", selfPersonaGlobalPolicy: "Global persona: first at {initial} messages across 2+ scopes; then after {messages} human messages, {botReplies} Bot replies or {summaries} summaries, at least {hours}h apart; failures retry after {retry}h",
    selfPersonaKeywords: "Interest keywords", selfPersonaTopics: "Weighted interests",
    adaptiveLearning: "Adaptive learning", adaptiveLearningHint: "Learns group timing and member rhythm, and reviews the Bot's expression every 24 hours.", adaptiveSamples: "{count} human messages · {members} members", adaptiveHours: "Active hours: {hours}", adaptiveColdWaiting: "Unanswered Bot messages lowered interest", adaptiveCollecting: "Collecting Bot replies; reviews run every 24 hours once samples suffice.", noAdaptiveLearning: "No learning samples yet.",
    learningHuman: "Human signals", learningBot: "Bot behavior", learningReview: "Style review", learningInterest: "Interest signals",
    detailSample: "Samples {value}", detailConfidence: "Confidence {value}%", detailTextSample: "Text samples {value}", detailAverageChars: "Average {value} chars", detailShortRatio: "Short {value}%", detailLongRatio: "Long {value}%", detailStickerRatio: "Stickers {value}%", detailImageRatio: "Images {value}%", detailEmojiRatio: "Emoji {value}%", detailReplyRatio: "Replies {value}%", detailMentionRatio: "Mentions {value}%", detailQuestionRatio: "Questions {value}%", detailBotInteraction: "Bot interaction {value}%", detailBurstRatio: "Two-minute bursts {value}%", detailPokeRatio: "Pokes {value}% · {count} ({bot}% to Bot)", detailInterruptionRate: "Interjections {value}% · {samples} transitions", detailGap: "Median gap {value}", detailActiveDays: "Active {value} days", detailDailyMessages: "{value} per active day", detailCurrentHour: "Current-hour share {value}%", detailFirstSeen: "Learning since {value}", detailLastHuman: "Last human message {value}",
    detailBotReplies: "Bot replies {value}", detailBotChars: "Bot average {value} chars", detailBotSticker: "Bot stickers {value}%", detailBotBubbles: "Multi-bubble {value}%", detailBotFollowup: "Human follow-up {value}%", detailTrackingStart: "Tracking since {value}", detailLastBot: "Last Bot reply {value}",
    detailReviewSamples: "Review samples human {human} / Bot {bot}", detailLastReview: "Last review {value}", detailNextReview: "Next review {value}",
    detailOrdinaryInterest: "Ordinary interest: {messages} messages or {minutes} minutes", detailInterestReason: "Cadence basis {value}", detailLearnedHours: "Open hours {value}", detailUnanswered: "Unanswered streak {value}", detailInterestMultiplier: "Interest multiplier {value}", detailColdIdle: "Idle {idle} / needs {required}h", detailColdReason: "State {value}", detailColdThreshold: "Threshold {value}", detailColdCheck: "Last check {value}", detailColdSent: "Last outreach {value}", detailNextCheck: "Next check {value}",
    stickerFrequency: "Sticker frequency", stickerFrequencyHint: "Actual sticker use by humans and the Bot per group.", stickerHuman: "Humans", stickerBot: "Bot", stickerPlan: "Target", stickerSamples: "{human} human · {bot} Bot messages", noStickerFrequency: "No group samples yet.",
    coldInterest: "Cold-group interest", coldInterestHint: "Times from the latest message and uses group rhythm to speak once or stay quiet.", coldInterestPolicy: "Open hours: {hours} · base retry {retry}h · unanswered outreach lowers interest and lengthens the interval", learnedHours: "learned per group", recentDecisions: "Recent decisions", noColdInterest: "No cold-group status yet.", noColdInterestDecisions: "No cold-group decision has run yet.",
    privateInterest: "Private proactive interest", privateInterestHint: "Estimates probability from interaction frequency and gaps, backing off after unanswered messages.", privateContact: "Contact {value}", privatePhase: "Phase {value}", privateProbability: "Probability {value}%", privateFrequency: "Frequency {value}", noPrivateInterest: "No private-chat learning yet.", noPrivateInterestDecisions: "No private proactive decision has run yet.",
    outcomeSent: "Sent", outcomeSilent: "Stayed silent", outcomeFailed: "Failed", outcomeCancelled: "Cancelled by new activity",
    memoryType: "Memory type", unified: "Unified", searchMemory: "Search memory", refresh: "Refresh", noMemory: "No matching memory.", entriesCount: "{count} entries", clear: "Clear", clearMemoryTitle: "Clear memory", clearMemoryMessage: "This permanently removes memory from “{value}”. Continue?", allRelatedMemory: "All memory related to {value}", memoryCleared: "Memory cleared",
    unifiedEntries: "Unified summaries", handoffs: "Handoffs", ideas: "Ideas", projects: "Projects", todos: "Todos", notes: "Notes", recentState: "Recent state", latestHandoff: "Latest handoff", noState: "No recent state", updated: "Updated {time}",
    autoSkillMemory: "Write after Skill recall", autoSkillHint: "Persist useful context after a desktop Skill recall", manualHandoff: "Allow manual handoff", manualHandoffHint: "Allow /handoff to write a summary",
    shortTermMemory: "Short-term memory", recentMessages: "Recent messages", roleUser: "User", roleAssistant: "Assistant", publicMemory: "Public long-term memory", personas: "Personas", conversationImpressions: "Conversation impressions", impressionBrief: "Impression brief", impressionDetail: "Impression detail", thoughtBrief: "Thought brief", thoughtDetail: "Thought detail", recentTopic: "Recent topic", recentInteraction: "Recent interaction",
    knowledgeTitles: "Titles", knowledgeVariants: "Scoped meanings", knowledgeSlang: "Slang", knowledgeReviews: "Reviews",
    knowledgeSearch: "Search titles, meanings, groups or members", knowledgeKind: "Type", knowledgeAllKinds: "All types", knowledgeKindSlang: "Slang", knowledgeKindNote: "Note", knowledgeScope: "Scope", knowledgeAllScopes: "All scopes", knowledgeGlobal: "Global", knowledgeGroup: "Group", knowledgeMember: "Member", knowledgeGroupMember: "Member in group", knowledgeSortLabel: "Sort", knowledgeSortUpdated: "Recently updated", knowledgeSortFrequency: "Frequency", knowledgeSortTitle: "Title", newKnowledge: "New knowledge",
    knowledgeAll: "All knowledge", knowledgeNotes: "Notes", knowledgePendingReview: "Pending review", knowledgeResults: "{count} titles", knowledgeNoEntries: "No knowledge matches these filters.", knowledgeEmptyHint: "Knowledge is written with summaries, or you can add it here.", knowledgeCreateFirst: "Add the first item", knowledgeNoSelection: "Select an item to see its meaning, scope and occurrences.",
    knowledgeDefinition: "Meaning", knowledgeStatistics: "Occurrences", knowledgeHitCount: "Total hits", knowledgeLastSeen: "Last seen", knowledgeAliases: "Aliases", knowledgeEvidence: "Recent context", knowledgeReviewState: "Model review", knowledgeReviewHealthy: "No deletion review needed", knowledgeNeverSeen: "Not seen in chat yet",
    editKnowledge: "Edit", deleteKnowledge: "Delete", deleteKnowledgeTitle: "Delete this knowledge", deleteKnowledgeMessage: "Delete the meaning of “{value}” in this scope? Other groups and members keep theirs.", knowledgeDeleted: "Knowledge deleted", knowledgeSaved: "Knowledge saved",
    knowledgeEditorTitleNew: "New knowledge", knowledgeEditorTitleEdit: "Edit knowledge", knowledgeScopeType: "Scope", knowledgeTitleField: "Title / term", knowledgeContent: "Meaning / content", knowledgeAliasesHint: "Separate aliases with commas", knowledgeGroupId: "Group QQ ID", knowledgeGroupName: "Group name", knowledgeUserId: "Member QQ ID", knowledgeUserName: "Member name", saveKnowledge: "Save",
    knowledgeHitValue: "{count} hits", knowledgeOccurrenceMessage: "{sender} · {time}", knowledgeReviewDecision: "{decision} · {time}", knowledgeScopeGlobal: "All conversations", knowledgeScopeGroup: "{name} · group {id}", knowledgeScopeMember: "{name} · QQ {id}", knowledgeScopeGroupMember: "{user} ({userId}) in {group} ({groupId})", knowledgeSourceCount: "{count} sources", knowledgeUpdated: "Updated {time}", knowledgeContextBefore: "Before", knowledgeContextAfter: "After", knowledgeUnknownName: "Unnamed",
    level: "Level", allLevels: "All levels", category: "Module", allCategories: "All modules", engineFilter: "AI engine", allEngines: "All engines", search: "Search", logSearchHint: "Message, trace, group or sender", slowThreshold: "Slow", noLimit: "Any", visibleLogCount: "Rows", resetFilter: "Reset", applyFilter: "Apply", filterApplied: "Filter applied",
    structuredLogs: "Live logs", waitingLogs: "Waiting for logs", matchedLogs: "Showing {visible} of {matched} matches", liveConnected: "Live", livePaused: "Paused", liveError: "Connection error", liveRefresh: "Live refresh", followLatest: "Follow latest", expandDetails: "Expand details", liveLogStream: "Live log stream", noLogs: "No logs match these filters.",
    totalLogs: "Total logs", traces: "Traces", p95Latency: "P95 latency", maxLatency: "Slowest", engineLogs: "{engine} {count}", viewJson: "View JSON",
    catSystem: "System", catQq: "QQ", catOnebot: "OneBot", catAgent: "Agent", catCodex: "Codex", catWeb: "API", catSearch: "Search", catInterest: "Interest", catLearning: "Learning", catMemory: "Memory", catCommand: "Command", catLifecycle: "Lifecycle",
    appearance: "Appearance", appearanceHint: "Follow the system or lock light / dark.", theme: "Theme", system: "System", light: "Light", dark: "Dark", language: "Language", languageHint: "Switch console copy and time formats.", autoRefresh: "Auto refresh", autoRefreshHint: "Pauses automatically while the page is hidden.", refreshInterval: "Refresh interval",
    hubEndpoint: "Hub endpoint", hubEndpointHint: "The Hub address this page talks to.", copy: "Copy", rawState: "Raw state",
    lanAccess: "LAN access", lanAccessHint: "Only physical LAN addresses reachable by other devices are shown; if a proxy intercepts them, set them to DIRECT.", lanLocalOnly: "This computer only", lanNoAddress: "Enabled, but no physical LAN IPv4 address was found; check Wi-Fi / Ethernet or proxy settings", copyLanToken: "Copy access token", lanEnableTitle: "Enable LAN access", lanEnableMessage: "Devices on the same LAN will be able to open the console. Management APIs stay protected by the access token.", lanAccessUpdated: "LAN access updated", lanTokenCopied: "Access token copied", lanManagedByEnvironment: "The listening address is set by an environment variable and cannot be changed here.",
    publicTunnel: "Temporary public access", publicTunnelHint: "Creates a temporary HTTPS address with Cloudflare Quick Tunnel; remote access still needs the token.", publicTunnelRunningHint: "The public address is ready. Share the address and the token separately and only with people you trust.", publicTunnelStarting: "Creating a temporary public address…", publicTunnelOff: "Public access is off", publicTunnelUnavailable: "cloudflared was not found. Install it and make sure it is on the Hub PATH.", publicTunnelRemoteManaged: "To keep remote access from widening itself, only the local page can start, stop or copy the token.", publicTunnelError: "Tunnel failed to start: {error}", publicTunnelEnableTitle: "Enable temporary public access", publicTunnelEnableMessage: "This exposes the console to the internet for a while. Remote management still needs the token; share it only with people you trust.", publicTunnelUpdated: "Temporary public access updated", copyPublicTunnelUrl: "Copy address", publicTunnelUrlCopied: "Public address copied",
    aboutBody: "A local hub that connects QQ to Codex or Claude Code on this machine.", factEngine: "AI engine", factModel: "Model", factEffort: "Reasoning effort", factStarted: "Started",
    confirmAction: "Confirm", cancel: "Cancel", confirm: "Confirm", logDetail: "Log detail", close: "Close", copyJson: "Copy JSON", done: "Done", copied: "Copied", copyFailed: "Copy failed. Select the content manually.",
    hubOnline: "Hub online", hubOffline: "Hub offline", syncedNow: "Synced just now",
    searchActions: "Search pages or actions", commandHint: "↑↓ select · Enter run · Esc close", noMatchingActions: "No matching actions",
    actionOverviewHint: "Service health, AI engine and recent activity", actionChannelsHint: "QQ channel, allowlist and recent events", actionIntelligenceHint: "Switches, persona, learning and proactive interest", actionMemoryHint: "Search and clear context memory", actionKnowledgeHint: "Manage long-term knowledge and slang", actionLogsHint: "Inspect live logs and trace problems", actionSettingsHint: "Theme, language, refresh and access",
    actionRefresh: "Refresh this page", actionRefreshHint: "Sync this page's data again", actionHealth: "Check service health", actionHealthHint: "Probe local services now", actionTheme: "Toggle color theme", actionThemeHint: "Switch between light and dark", actionApi: "View raw state", actionApiHint: "Open the raw JSON from the Hub", actionAddGroup: "Add QQ group", actionAddGroupHint: "Open Channels and focus the group field", actionEngineLogs: "View {engine} logs", actionEngineLogsHint: "Only runtime logs from the active AI engine",
    apiTokenPrompt: "This Hub requires an API token. Enter it (kept only in this tab):", requestFailed: "Request failed", networkError: "Unable to reach the local Hub.", unknown: "Unknown", yes: "yes", no: "no"
  }
};

const app = (() => {
  const restoredUiState = loadDashboardUiState();
  return {
    view: validViews.has(location.hash.slice(1)) ? location.hash.slice(1) : "overview",
    language: readStorage(localStorage, "language") === "en" ? "en" : "zh",
    theme: ["system", "light", "dark"].includes(readStorage(localStorage, "theme")) ? readStorage(localStorage, "theme") : "system",
    autoRefresh: readStorage(localStorage, "autoRefresh") !== "0",
    refreshSeconds: [5, 10, 30, 60].includes(Number(readStorage(localStorage, "refreshSeconds"))) ? Number(readStorage(localStorage, "refreshSeconds")) : 5,
    liveLogs: restoredUiState.liveLogs !== false,
    logFollow: restoredUiState.logFollow !== false,
    logExpand: restoredUiState.logExpand === true,
    openLogIds: new Set(),
    lastLogSignature: "",
    state: null,
    maintenance: null,
    memory: null,
    logs: null,
    activeMemoryTab: restoredUiState.activeMemoryTab === "qq" ? "qq" : "unified",
    memoryQuery: restoredUiState.memoryQuery || "",
    knowledgeQuery: restoredUiState.knowledgeQuery || "",
    knowledgeKind: ["all", "slang", "note"].includes(restoredUiState.knowledgeKind) ? restoredUiState.knowledgeKind : "all",
    knowledgeScope: ["all", "global", "group", "member", "group-member"].includes(restoredUiState.knowledgeScope) ? restoredUiState.knowledgeScope : "all",
    knowledgeSort: ["updated", "frequency", "title"].includes(restoredUiState.knowledgeSort) ? restoredUiState.knowledgeSort : "updated",
    selectedKnowledgeEntryId: restoredUiState.selectedKnowledgeEntryId || "",
    selectedKnowledgeVariantId: restoredUiState.selectedKnowledgeVariantId || "",
    openMemoryGroups: new Set(restoredUiState.openMemoryGroups || []),
    openAdaptiveLearningGroups: new Set(restoredUiState.openAdaptiveLearningGroups || []),
    controllers: new Map(),
    busyKeys: new Set(),
    dirtyForms: new Set(restoredUiState.botSettingsDraft ? ["botSettingsForm"] : []),
    groupDraft: restoredUiState.groupDraft || "",
    botSettingsDraft: restoredUiState.botSettingsDraft || null,
    logFilters: restoredUiState.logFilters || {},
    logScrollTop: restoredUiState.logScrollTop || 0,
    apiToken: readStorage(sessionStorage, "apiToken") || "",
    authPromptPromise: null,
    lastFetch: { state: 0, maintenance: 0, memory: 0, logs: 0 },
    logCategories: new Set(["system", "qq", "onebot", "agent", "search", "interest", "learning", "memory", "lifecycle"]),
    commandIndex: 0,
    connectionOk: false,
    runtimeSamples: loadRuntimeSamples()
  };
})();

// ---------- Storage ----------
function readStorage(storage, key) {
  try {
    return storage.getItem(`${STORAGE_PREFIX}${key}`);
  } catch {
    return null;
  }
}

function writeStorage(storage, key, value) {
  try {
    if (value == null) storage.removeItem(`${STORAGE_PREFIX}${key}`);
    else storage.setItem(`${STORAGE_PREFIX}${key}`, value);
  } catch {
    // Private browsing or a full quota must not break the console.
  }
}

function loadRuntimeSamples() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(`${STORAGE_PREFIX}runtimeSamples`) || "[]");
    return Array.isArray(parsed) ? parsed.filter((sample) => Number.isFinite(sample?.at) && Number.isFinite(sample?.latencyMs)).slice(-60) : [];
  } catch {
    return [];
  }
}

function loadDashboardUiState() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(`${STORAGE_PREFIX}uiState`) || "{}");
    if (!parsed || typeof parsed !== "object") return {};
    const logFilters = parsed.logFilters && typeof parsed.logFilters === "object" ? parsed.logFilters : {};
    return {
      liveLogs: parsed.liveLogs !== false,
      logFollow: parsed.logFollow !== false,
      logExpand: parsed.logExpand === true,
      activeMemoryTab: parsed.activeMemoryTab === "qq" ? "qq" : "unified",
      memoryQuery: boundedUiText(parsed.memoryQuery, 200),
      knowledgeQuery: boundedUiText(parsed.knowledgeQuery, 240),
      knowledgeKind: ["all", "slang", "note"].includes(parsed.knowledgeKind) ? parsed.knowledgeKind : "all",
      knowledgeScope: ["all", "global", "group", "member", "group-member"].includes(parsed.knowledgeScope) ? parsed.knowledgeScope : "all",
      knowledgeSort: ["updated", "frequency", "title"].includes(parsed.knowledgeSort) ? parsed.knowledgeSort : "updated",
      selectedKnowledgeEntryId: boundedUiText(parsed.selectedKnowledgeEntryId, 120),
      selectedKnowledgeVariantId: boundedUiText(parsed.selectedKnowledgeVariantId, 120),
      openMemoryGroups: boundedList(parsed.openMemoryGroups),
      openAdaptiveLearningGroups: boundedList(parsed.openAdaptiveLearningGroups),
      groupDraft: /^\d{0,20}$/.test(String(parsed.groupDraft || "")) ? String(parsed.groupDraft || "") : "",
      botSettingsDraft: parsed.botSettingsDirty === true ? normalizeBotSettingsDraft(parsed.botSettingsDraft) : null,
      logFilters: {
        level: ["", "error", "warn", "success", "info", "debug"].includes(logFilters.level) ? logFilters.level : "",
        category: boundedUiText(logFilters.category, 80),
        engine: ["", "codex", "claude"].includes(logFilters.engine) ? logFilters.engine : "",
        query: boundedUiText(logFilters.query, 240),
        slow: ["", "500", "1000", "3000", "10000"].includes(String(logFilters.slow || "")) ? String(logFilters.slow || "") : "",
        limit: ["100", "250", "500", "1000"].includes(String(logFilters.limit || "")) ? String(logFilters.limit || "") : "250"
      },
      logScrollTop: Number.isFinite(Number(parsed.logScrollTop)) ? Math.max(0, Number(parsed.logScrollTop)) : 0
    };
  } catch {
    return {};
  }
}

function boundedUiText(value, maxLength) {
  return String(value || "").slice(0, maxLength);
}

function boundedList(value) {
  return Array.isArray(value) ? value.map((item) => boundedUiText(item, 160)).filter(Boolean).slice(0, 200) : [];
}

function normalizeBotSettingsDraft(value) {
  if (!value || typeof value !== "object") return null;
  return {
    enhancerEnabled: Boolean(value.enhancerEnabled),
    webLookupEnabled: Boolean(value.webLookupEnabled),
    proactiveEnabled: Boolean(value.proactiveEnabled),
    judgeEnabled: Boolean(value.judgeEnabled),
    judgeEveryMessages: boundedUiText(value.judgeEveryMessages, 8),
    judgeEveryMinutes: boundedUiText(value.judgeEveryMinutes, 8),
    judgeProvider: ["openrouter", "deepseek", "custom"].includes(value.judgeProvider) ? value.judgeProvider : "openrouter",
    judgeModel: boundedUiText(value.judgeModel, 200),
    judgeTimeoutMs: boundedUiText(value.judgeTimeoutMs, 8),
    judgeMaxRecentMessages: boundedUiText(value.judgeMaxRecentMessages, 8)
  };
}

function collectBotSettingsDraft() {
  return {
    enhancerEnabled: $("#botEnhancerToggle").checked,
    webLookupEnabled: $("#botWebLookupToggle").checked,
    proactiveEnabled: $("#botProactiveToggle").checked,
    judgeEnabled: $("#botJudgeToggle").checked,
    judgeEveryMessages: $("#botJudgeMessages").value,
    judgeEveryMinutes: $("#botJudgeMinutes").value,
    judgeProvider: $("#botJudgeProvider").value,
    judgeModel: $("#botJudgeModel").value,
    judgeTimeoutMs: $("#botJudgeTimeout").value,
    judgeMaxRecentMessages: $("#botJudgeRecent").value
  };
}

function applyBotSettingsDraft(draft) {
  if (!draft) return;
  $("#botEnhancerToggle").checked = draft.enhancerEnabled;
  $("#botWebLookupToggle").checked = draft.webLookupEnabled;
  $("#botProactiveToggle").checked = draft.proactiveEnabled;
  $("#botJudgeToggle").checked = draft.judgeEnabled;
  $("#botJudgeMessages").value = draft.judgeEveryMessages;
  $("#botJudgeMinutes").value = draft.judgeEveryMinutes;
  $("#botJudgeProvider").value = draft.judgeProvider;
  $("#botJudgeModel").value = draft.judgeModel;
  $("#botJudgeTimeout").value = draft.judgeTimeoutMs;
  $("#botJudgeRecent").value = draft.judgeMaxRecentMessages;
}

function readLogFilters() {
  return {
    level: $("#logLevel")?.value || "",
    category: $("#logCategory")?.value || "",
    engine: $("#logEngine")?.value || "",
    query: $("#logQuery")?.value || "",
    slow: $("#logSlow")?.value || "",
    limit: $("#logLimit")?.value || "250"
  };
}

function persistDashboardUiState() {
  try {
    rememberOpenMemoryGroups();
    rememberOpenAdaptiveLearningGroups();
    app.groupDraft = $("#groupInput")?.value || "";
    app.logFilters = readLogFilters();
    app.logScrollTop = $("#logStream")?.scrollTop || 0;
    if (app.dirtyForms.has("botSettingsForm")) app.botSettingsDraft = collectBotSettingsDraft();
    sessionStorage.setItem(`${STORAGE_PREFIX}uiState`, JSON.stringify({
      version: 2,
      liveLogs: app.liveLogs,
      logFollow: app.logFollow,
      logExpand: app.logExpand,
      activeMemoryTab: app.activeMemoryTab,
      memoryQuery: app.memoryQuery,
      knowledgeQuery: app.knowledgeQuery,
      knowledgeKind: app.knowledgeKind,
      knowledgeScope: app.knowledgeScope,
      knowledgeSort: app.knowledgeSort,
      selectedKnowledgeEntryId: app.selectedKnowledgeEntryId,
      selectedKnowledgeVariantId: app.selectedKnowledgeVariantId,
      openMemoryGroups: [...app.openMemoryGroups],
      openAdaptiveLearningGroups: [...app.openAdaptiveLearningGroups],
      groupDraft: app.groupDraft,
      botSettingsDirty: app.dirtyForms.has("botSettingsForm"),
      botSettingsDraft: app.dirtyForms.has("botSettingsForm") ? app.botSettingsDraft : null,
      logFilters: app.logFilters,
      logScrollTop: app.logScrollTop
    }));
  } catch {
    // Private browsing or a storage quota must not interrupt dashboard operations.
  }
}

function restoreDashboardUiState() {
  $("#groupInput").value = app.groupDraft;
  $("#memorySearch").value = app.memoryQuery;
  $("#knowledgeSearch").value = app.knowledgeQuery;
  $("#knowledgeKindFilter").value = app.knowledgeKind;
  $("#knowledgeScopeFilter").value = app.knowledgeScope;
  $("#knowledgeSort").value = app.knowledgeSort;
  $("#liveLogsToggle").checked = app.liveLogs;
  $("#logFollowToggle").checked = app.logFollow;
  $("#logExpandToggle").checked = app.logExpand;
  $("#logLevel").value = app.logFilters.level || "";
  $("#logEngine").value = app.logFilters.engine || "";
  $("#logQuery").value = app.logFilters.query || "";
  $("#logSlow").value = app.logFilters.slow || "";
  $("#logLimit").value = app.logFilters.limit || "250";
  if (app.logFilters.category) app.logCategories.add(app.logFilters.category);
  updateLogCategories({});
  $("#logCategory").value = app.logFilters.category || "";
  applyBotSettingsDraft(app.botSettingsDraft);
}

function markBotSettingsDirty() {
  app.dirtyForms.add("botSettingsForm");
  app.botSettingsDraft = collectBotSettingsDraft();
  setBotControlStatus("dirty", "settingsUnsaved");
  persistDashboardUiState();
}

function clearBotSettingsDraft() {
  app.dirtyForms.delete("botSettingsForm");
  app.botSettingsDraft = null;
  persistDashboardUiState();
}

// ---------- Core helpers ----------
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function t(key, values = {}) {
  const template = translations[app.language]?.[key] ?? translations.zh[key] ?? key;
  return String(template).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? `{${name}}`);
}

function applyI18n() {
  document.documentElement.lang = app.language === "en" ? "en" : "zh-CN";
  $$("[data-i18n]").forEach((node) => { node.textContent = t(node.dataset.i18n); });
  $$("[data-i18n-placeholder]").forEach((node) => { node.placeholder = t(node.dataset.i18nPlaceholder); });
  $$("[data-i18n-title]").forEach((node) => { node.title = t(node.dataset.i18nTitle); });
  $$("[data-i18n-aria-label]").forEach((node) => { node.setAttribute("aria-label", t(node.dataset.i18nAriaLabel)); });
  $("#languageSelect").value = app.language;
  app.lastLogSignature = "";
  updatePageIdentity();
  renderAll();
  setLiveLogState(app.liveLogs ? "active" : "paused");
  if ($("#commandDialog").open) renderCommands();
}

function setTheme(theme) {
  app.theme = ["system", "light", "dark"].includes(theme) ? theme : "system";
  document.documentElement.dataset.theme = app.theme;
  writeStorage(localStorage, "theme", app.theme);
  $$("[data-theme-choice]").forEach((button) => {
    const selected = button.dataset.themeChoice === app.theme;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-checked", String(selected));
    button.tabIndex = selected ? 0 : -1;
  });
}

function isDarkTheme() {
  return app.theme === "dark" || (app.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
}

function updatePageIdentity() {
  const titles = { overview: "overviewTitle", channels: "channelsTitle", intelligence: "intelligenceTitle", memory: "memoryTitle", knowledge: "knowledgeTitle", activity: "activityTitle", settings: "settingsTitle" };
  const subtitles = { channels: "channelsSubtitle", intelligence: "intelligenceSubtitle", memory: "memorySubtitle", knowledge: "knowledgeSubtitle", activity: "activitySubtitle", settings: "settingsSubtitle" };
  $("#pageTitle").textContent = t(titles[app.view]);
  const engine = getEngineInfo();
  $("#pageSubtitle").textContent = app.view === "overview"
    ? (engine.engine ? t("overviewSubtitle", { engine: engineSummary(engine) }) : t("overviewSubtitleWaiting"))
    : t(subtitles[app.view]);
  document.title = `${t(titles[app.view])} · Codex QQ Bot`;
}

function setView(view, { updateHash = true, quiet = true, focus = false } = {}) {
  if (!validViews.has(view)) view = "overview";
  app.view = view;
  $$("[data-view-panel]").forEach((panel) => {
    const active = panel.dataset.viewPanel === view;
    panel.hidden = !active;
    panel.classList.toggle("active", active);
  });
  $$("[data-view]").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  if (updateHash && location.hash !== `#${view}`) history.replaceState(null, "", `#${view}`);
  updatePageIdentity();
  if (focus) {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
    requestAnimationFrame(() => $("#pageTitle").focus({ preventScroll: true }));
  }
  void refreshView({ quiet });
}

function prefersReducedMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// ---------- API ----------
async function api(path, options = {}, { key = "", retryAuth = true } = {}) {
  let controller = null;
  if (key) {
    app.controllers.get(key)?.abort();
    controller = new AbortController();
    app.controllers.set(key, controller);
  }
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (app.apiToken) headers.set("authorization", `Bearer ${app.apiToken}`);
  try {
    const response = await fetch(`${HUB}${path}`, {
      ...options,
      headers,
      signal: controller?.signal || options.signal,
      credentials: "same-origin"
    });
    if (response.status === 401 && retryAuth) {
      app.apiToken = "";
      writeStorage(sessionStorage, "apiToken", null);
      const token = await requestApiToken();
      if (token) return api(path, options, { key, retryAuth: false });
    }
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
      const error = new Error(payload?.error || payload || `${t("requestFailed")} (${response.status})`);
      error.status = response.status;
      throw error;
    }
    return payload;
  } catch (error) {
    if (error.name === "AbortError") throw error;
    if (error instanceof TypeError) error.message = t("networkError");
    throw error;
  } finally {
    if (key && app.controllers.get(key) === controller) app.controllers.delete(key);
  }
}

async function requestApiToken() {
  if (app.authPromptPromise) return app.authPromptPromise;
  const promptPromise = Promise.resolve().then(() => {
    const token = window.prompt(t("apiTokenPrompt"))?.trim() || "";
    if (token) {
      app.apiToken = token;
      writeStorage(sessionStorage, "apiToken", token);
    }
    return token;
  });
  app.authPromptPromise = promptPromise.finally(() => {
    app.authPromptPromise = null;
  });
  return app.authPromptPromise;
}

async function refreshState({ quiet = false } = {}) {
  if (!quiet) setSync("loading");
  try {
    app.state = await api("/api/state", {}, { key: "state" });
    app.lastFetch.state = Date.now();
    setConnection(true);
    renderState();
    if (!quiet) setSync("ok");
    return app.state;
  } catch (error) {
    if (error.name === "AbortError") return null;
    setConnection(false, error.message);
    setSync("error", error.message);
    throw error;
  }
}

async function refreshMaintenance({ quiet = false, force = false } = {}) {
  const requestStartedAt = performance.now();
  try {
    app.maintenance = await api(`/api/maintenance${force ? "?force=1" : ""}`, {}, { key: "maintenance" });
    app.lastFetch.maintenance = Date.now();
    recordRuntimeSample(performance.now() - requestStartedAt);
    renderMaintenance();
    if (!quiet) setSync("ok");
    return app.maintenance;
  } catch (error) {
    if (error.name !== "AbortError") {
      if (!quiet) showToast(error.message, "error");
      renderServiceList(error.message);
    }
    return null;
  }
}

async function refreshMemory({ quiet = false } = {}) {
  try {
    app.memory = await api("/api/memory", {}, { key: "memory" });
    app.lastFetch.memory = Date.now();
    renderMemory();
    renderKnowledge();
    if (!quiet) setSync("ok");
    return app.memory;
  } catch (error) {
    if (error.name !== "AbortError") {
      $("#memoryView").innerHTML = emptyState(error.message);
      $("#knowledgeList").innerHTML = emptyState(error.message);
      if (!quiet) showToast(error.message, "error");
    }
    return null;
  }
}

function buildLogQuery() {
  const params = new URLSearchParams({ limit: $("#logLimit").value || "250", verbose: "1" });
  const values = {
    level: $("#logLevel").value,
    category: $("#logCategory").value,
    engine: $("#logEngine").value,
    q: $("#logQuery").value.trim(),
    slow: $("#logSlow").value
  };
  for (const [key, value] of Object.entries(values)) if (value) params.set(key, value);
  return params.toString();
}

async function refreshLogs({ quiet = false } = {}) {
  try {
    app.logs = await api(`/api/logs?${buildLogQuery()}`, {}, { key: "logs" });
    app.lastFetch.logs = Date.now();
    renderLogs();
    setLiveLogState(app.liveLogs ? "active" : "paused");
    $("#logLastUpdated").textContent = formatClock(app.lastFetch.logs);
    if (!quiet) setSync("ok");
    return app.logs;
  } catch (error) {
    if (error.name !== "AbortError") {
      setLiveLogState("error");
      if (!app.logs?.entries?.length) $("#logStream").innerHTML = emptyState(error.message);
      if (!quiet) showToast(error.message, "error");
    }
    return null;
  }
}

async function refreshView({ quiet = false } = {}) {
  const tasks = [refreshState({ quiet })];
  // The engine identity lives in maintenance, so every view keeps it fresh.
  tasks.push(refreshMaintenance({ quiet }));
  if (["memory", "knowledge"].includes(app.view)) tasks.push(refreshMemory({ quiet }));
  if (app.view === "activity") tasks.push(refreshLogs({ quiet }));
  await Promise.allSettled(tasks);
}

function setSync(status, detail = "") {
  const root = $("#syncState");
  root.className = `sync-state ${status}`;
  root.querySelector(".dot").className = `dot ${status === "loading" ? "pending" : status === "error" ? "bad" : "ok"}`;
  $("#syncText").textContent = status === "loading" ? t("connecting") : status === "error" ? t("hubOffline") : t("syncedNow");
  root.title = detail;
  $("#refreshButton").classList.toggle("loading", status === "loading");
  $("#refreshButton").setAttribute("aria-busy", String(status === "loading"));
}

function setLiveLogState(status) {
  const root = $("#liveLogState");
  root.className = `live-state ${status}`;
  root.querySelector("span").textContent = t(status === "active" ? "liveConnected" : status === "error" ? "liveError" : "livePaused");
}

function setConnection(ok, reason = "") {
  app.connectionOk = ok;
  $("#offlineBanner").hidden = ok;
  $("#offlineReason").textContent = reason || t("offlineHint");
  $("#sidebarStatus").textContent = ok ? t("hubOnline") : t("hubOffline");
  $("#sidebarStatusDot").className = `dot ${ok ? "ok" : "bad"}`;
}

// ---------- Engine ----------
function getEngineInfo() {
  const agent = app.maintenance?.agent || {};
  const ai = app.state?.ai || {};
  const engine = agent.engine || ai.engine || "";
  const queue = agent.queue || app.maintenance?.codex?.queue || {};
  return {
    engine,
    name: agent.name || ai.engineName || engineNames[engine] || t("unknown"),
    model: agent.model ?? ai.activeModel ?? null,
    reasoningEffort: agent.reasoningEffort ?? ai.activeReasoningEffort ?? null,
    runtime: agent.runtime || ai.runtime || "",
    reportsQuota: agent.reportsQuota ?? engine === "codex",
    cliPathExists: agent.cliPathExists,
    cliVersion: agent.cliVersion || null,
    connection: agent.connection || null,
    lastRunAt: agent.lastRunAt ?? null,
    lastDurationMs: agent.lastDurationMs ?? null,
    lastOk: agent.lastOk ?? null,
    lastError: agent.lastError ?? null,
    queue
  };
}

function engineSummary(engine) {
  const settings = [engine.model, engine.reasoningEffort].filter(Boolean).join(" / ");
  return settings ? `${engine.name} · ${settings}` : engine.name;
}

function getEngineState(engine = getEngineInfo()) {
  if (!app.maintenance) return "pending";
  if (engine.cliPathExists === false || engine.lastOk === false) return "bad";
  return Number(engine.queue?.active || 0) > 0 ? "busy" : "ok";
}

function renderEngineIdentity() {
  const engine = getEngineInfo();
  for (const selector of ["#sidebarEngine", "#topEngine", "#engineCard"]) $(selector).dataset.engine = engine.engine;
  $("#sidebarEngineName").textContent = engine.engine ? engine.name : "—";
  $("#topEngineName").textContent = engine.engine ? engine.name : "—";
  $("#topEngine").title = engine.engine ? engineSummary(engine) : "";
  updatePageIdentity();
}

// ---------- Rendering ----------
function renderAll() {
  renderState();
  renderMaintenance();
  renderMemory();
  renderKnowledge();
  renderLogs();
  renderSettings();
}

function renderState() {
  if (!app.state) return;
  const qqToggle = $("#qqToggle");
  const qqBusy = app.busyKeys.has("channel:qq");
  if (!qqBusy && document.activeElement !== qqToggle) qqToggle.checked = Boolean(app.state.channels?.qq);
  qqToggle.disabled = qqBusy;
  renderEngineIdentity();
  renderOverview();
  renderChannelSettings();
  renderBotControls();
  renderEvents();
  renderRecentTimeline();
  renderSettings();
}

function renderMaintenance() {
  if (!app.maintenance) return;
  renderEngineIdentity();
  renderOverview();
  renderRuntimePulse();
  renderChannelSettings();
  renderBotControls();
  renderSettings();
}

function getServices() {
  const h = app.maintenance;
  const engine = getEngineInfo();
  if (!h) {
    return ["onebot", "agent", "qq", "web"].map((id) => ({ id, state: "pending" }));
  }
  const qqEnabled = Boolean(h.channels?.qq);
  const qqBusy = Number(h.qq?.activeGenerations || 0) > 0 || Number(h.qq?.pendingReplies || 0) > 0;
  return [
    { id: "onebot", state: h.oneBot?.ok ? "ok" : "bad" },
    { id: "agent", state: getEngineState(engine) },
    { id: "qq", state: !qqEnabled ? "off" : !h.oneBot?.ok ? "bad" : qqBusy ? "busy" : "ok" },
    { id: "web", state: !h.webLookup?.enabled ? "off" : h.webLookup?.lastOk === false ? "bad" : "ok" }
  ];
}

function serviceName(id) {
  if (id === "agent") return getEngineInfo().name;
  return t({ hub: "serviceHub", onebot: "serviceOneBot", qq: "serviceQq", web: "serviceWeb" }[id]);
}

function stateLabel(state) {
  return t({ ok: "stateOk", busy: "stateBusy", bad: "stateBad", off: "stateOff" }[state] || "statePending");
}

function renderOverview() {
  renderStatusBanner();
  renderOverviewStats();
  renderServiceList();
  renderEngineCard();
  renderQuota();
}

function renderStatusBanner() {
  const services = getServices();
  const root = $("#statusBanner");
  if (!app.maintenance) {
    root.className = `status-banner ${app.connectionOk ? "pending" : "critical"}`;
    $("#statusTitle").textContent = app.connectionOk ? t("connecting") : t("hubOffline");
    $("#statusBody").textContent = app.connectionOk ? "" : t("offlineHint");
    return;
  }
  const bad = services.filter((service) => service.state === "bad");
  const off = services.filter((service) => service.state === "off");
  const names = (items) => items.map((service) => serviceName(service.id)).join(app.language === "en" ? ", " : "、");
  const mode = !app.connectionOk || bad.length ? "critical" : off.length ? "attention" : "ready";
  root.className = `status-banner ${mode}`;
  const engine = getEngineInfo().name;
  if (mode === "critical") {
    $("#statusTitle").textContent = t("systemCritical");
    $("#statusBody").textContent = t("systemCriticalBody", { items: app.connectionOk ? names(bad) : "Hub" });
  } else if (mode === "attention") {
    $("#statusTitle").textContent = t("systemAttention");
    $("#statusBody").textContent = t("systemAttentionBody", { items: names(off) });
  } else {
    $("#statusTitle").textContent = t("systemReady");
    $("#statusBody").textContent = t("systemReadyBody", { engine });
  }
}

function renderOverviewStats() {
  const h = app.maintenance || {};
  const services = getServices();
  const online = services.filter((service) => ["ok", "busy"].includes(service.state)).length;
  const queue = getEngineInfo().queue || {};
  const activeTasks = Math.max(Number(queue.active || 0), Number(h.qq?.activeGenerations || 0));
  const pendingTasks = Number(queue.pending || 0) + Number(h.qq?.pendingReplies || 0);
  const uptime = formatDuration(Date.now() - Date.parse(h.startedAt || ""));
  const stats = [
    { label: t("uptime"), value: uptime || "—", hint: h.startedAt ? t("startedAtHint", { time: formatTime(h.startedAt) }) : "", icon: icons.clock },
    { label: t("servicesOnline"), value: `${online}/${services.length}`, hint: services.filter((service) => service.state === "bad").map((service) => serviceName(service.id)).join(" · "), tone: services.some((service) => service.state === "bad") ? "bad" : "ok", icon: icons.pulse },
    { label: t("activeTasks"), value: formatNumber(activeTasks), hint: t("queueHint", { max: queue.maxConcurrent ?? "—" }), tone: activeTasks ? "busy" : "", icon: icons.activity },
    { label: t("pendingTasks"), value: formatNumber(pendingTasks), hint: t("queueHint", { max: queue.maxPending ?? "∞" }), tone: pendingTasks ? "warn" : "", icon: icons.logs }
  ];
  setHtml($("#overviewStats"), stats.map(statCard).join(""));
}

function statCard({ label, value, hint = "", tone = "", icon = "" }) {
  return `<article class="stat ${tone ? `tone-${tone}` : ""}"><span class="stat-label">${icon}${escapeHtml(label)}</span><strong class="stat-value">${escapeHtml(value)}</strong><span class="stat-hint">${escapeHtml(hint || " ")}</span></article>`;
}

function renderServiceList(errorMessage = "") {
  const h = app.maintenance || {};
  const engine = getEngineInfo();
  const states = Object.fromEntries(getServices().map((service) => [service.id, service.state]));
  const endpoint = (HUB || location.origin).replace(/^https?:\/\//, "");
  const rows = [
    { id: "hub", icon: icons.hub, state: app.connectionOk ? "ok" : "bad", detail: t("hubDetail", { endpoint }) },
    {
      id: "onebot",
      icon: icons.oneBot,
      state: states.onebot,
      detail: h.oneBot?.ok
        ? t("oneBotDetail", { name: h.oneBot?.nickname || "QQ", id: h.oneBot?.selfId || "—" })
        : t("oneBotDown", { error: h.oneBot?.lastError || t("unknown") }),
      error: !h.oneBot?.ok
    },
    {
      id: "agent",
      icon: icons.agent,
      state: states.agent,
      detail: engine.cliPathExists === false
        ? t("agentPathMissing", { engine: engine.name })
        : engine.lastOk === false && engine.lastError
          ? compactUiText(engine.lastError, 140)
          : t("agentDetail", { model: engine.model || "—", effort: engine.reasoningEffort || "—" }),
      error: states.agent === "bad"
    },
    {
      id: "qq",
      icon: icons.qq,
      state: states.qq,
      detail: !h.channels?.qq
        ? t("qqDisabledDetail")
        : states.qq === "busy"
          ? t("qqBusyDetail", { active: h.qq?.activeGenerations || 0, pending: h.qq?.pendingReplies || 0 })
          : t("qqEnabledDetail", { groups: h.qq?.allowedGroups || 0, events: h.qq?.recentEvents || 0 })
    },
    {
      id: "web",
      icon: icons.globe,
      state: states.web,
      detail: !h.webLookup?.enabled
        ? t("webDisabled")
        : h.webLookup?.lastQuery
          ? t("webLastQuery", { provider: h.webLookup?.effectiveProvider || t("unknown"), query: compactUiText(h.webLookup.lastQuery, 60) })
          : t("webDetail", { provider: h.webLookup?.effectiveProvider || t("unknown") }),
      error: states.web === "bad"
    }
  ];
  const markup = rows.map((row) => `<div class="service-row ${row.state}" data-service="${row.id}">
      <span class="service-icon">${row.icon}</span>
      <span class="service-copy"><strong>${escapeHtml(serviceName(row.id))}</strong><small class="${row.error ? "service-error" : ""}" title="${escapeHtml(row.detail)}">${escapeHtml(row.detail)}</small></span>
      <span class="badge ${row.state}">${escapeHtml(stateLabel(row.state))}</span>
    </div>`).join("");
  setHtml($("#serviceList"), errorMessage ? `${markup}${emptyState(errorMessage)}` : markup);
}

function renderEngineCard() {
  const engine = getEngineInfo();
  const state = getEngineState(engine);
  $("#engineTitle").textContent = engine.engine ? engine.name : "—";
  $("#engineRuntime").textContent = engine.runtime || "—";
  const badge = $("#engineState");
  badge.className = `badge ${state}`;
  badge.textContent = stateLabel(state);
  const connection = engine.engine === "claude"
    ? (engine.connection === "profile" ? t("connectionProfile") : t("connectionLogin"))
    : t("connectionAppServer");
  const version = engine.cliPathExists === false ? t("versionMissing") : engine.cliVersion || (app.maintenance ? t("versionChecking") : "—");
  const facts = [
    [t("engineModel"), engine.model || "—", true],
    [t("engineEffort"), engine.reasoningEffort || "—", false],
    [t("engineVersion"), version, Boolean(engine.cliVersion)],
    [t("engineConnection"), connection, false],
    [t("engineQueue"), t("queueValue", { active: engine.queue?.active || 0, pending: engine.queue?.pending || 0 }), false],
    [t("engineSessions"), t("sessionsValue", { count: app.state?.qq?.codexSession?.activeThreads ?? 0 }), false]
  ];
  setHtml($("#engineFacts"), facts.map(([label, value, mono]) => `<div><dt>${escapeHtml(label)}</dt><dd class="${mono ? "mono" : ""}" title="${escapeHtml(value)}">${escapeHtml(value)}</dd></div>`).join(""));
  const lastRun = engine.lastRunAt
    ? `<div class="last-run-line"><span class="badge ${engine.lastOk === false ? "bad" : "ok"}">${escapeHtml(engine.lastOk === false ? t("lastRunFailed") : t("lastRunOk"))}</span><span class="muted">${escapeHtml(t("lastRunMeta", { time: formatRelative(engine.lastRunAt), duration: formatMs(engine.lastDurationMs) }))}</span></div>${engine.lastOk === false && engine.lastError ? `<p class="last-run-error">${escapeHtml(compactUiText(engine.lastError, 320))}</p>` : ""}`
    : `<div class="last-run-line"><span class="badge off">${escapeHtml(t("lastRunNever"))}</span></div>`;
  setHtml($("#engineLastRun"), lastRun);
}

function renderQuota() {
  const engine = getEngineInfo();
  const section = $("#quotaSection");
  if (!engine.engine) {
    section.hidden = true;
    return;
  }
  section.hidden = false;
  if (!engine.reportsQuota) {
    $("#quotaUpdated").textContent = "";
    section.querySelector("h3").textContent = t("usageWindow").replace("Codex", engine.name);
    setHtml($("#quotaOverview"), `<p class="quota-note">${escapeHtml(t("quotaNotReported", { engine: engine.name }))}</p>`);
    return;
  }
  section.querySelector("h3").textContent = t("usageWindow");
  const quota = app.maintenance?.codex?.quota;
  $("#quotaUpdated").textContent = quota?.updatedAt ? t("recordedAt", { time: formatRelative(quota.updatedAt) }) : "";
  if (!quota?.available) {
    setHtml($("#quotaOverview"), `<p class="quota-note">${escapeHtml(t("quotaUnavailable"))}</p>`);
    return;
  }
  const windows = [[t("fiveHours"), quota.primary], [t("sevenDays"), quota.secondary]].filter(([, value]) => value);
  setHtml($("#quotaOverview"), windows.map(([label, value]) => {
    const remaining = clampPercent(value.remainingPercent);
    const tone = remaining <= 10 ? "bad" : remaining <= 30 ? "warn" : "";
    return `<div class="quota-item ${tone}"><div class="quota-top"><span>${escapeHtml(label)}</span><strong>${escapeHtml(t("remaining", { value: remaining }))}</strong></div><div class="quota-bar" role="img" aria-label="${escapeHtml(`${label} ${t("remaining", { value: remaining })}`)}"><svg preserveAspectRatio="none"><rect x="0" y="0" height="6" width="${remaining}%" rx="3" /></svg></div><p>${escapeHtml(value.resetsAt ? t("resetsAt", { time: formatReset(value.resetsAt) }) : t("noReset"))}</p></div>`;
  }).join("") || `<p class="quota-note">${escapeHtml(t("quotaUnavailable"))}</p>`);
}

function recordRuntimeSample(latencyMs) {
  if (!app.maintenance || !Number.isFinite(latencyMs)) return;
  const services = getServices();
  app.runtimeSamples.push({
    at: Date.now(),
    latencyMs: Math.max(0, Math.round(latencyMs)),
    online: services.filter((service) => ["ok", "busy"].includes(service.state)).length,
    total: services.length
  });
  app.runtimeSamples = app.runtimeSamples.slice(-60);
  writeStorage(sessionStorage, "runtimeSamples", JSON.stringify(app.runtimeSamples));
}

function renderRuntimePulse() {
  const samples = app.runtimeSamples;
  const line = $("#pulseLine");
  const area = $("#pulseArea");
  const point = $("#pulsePoint");
  $("#pulseSampleLabel").textContent = samples.length ? t("sampleCount", { count: samples.length }) : t("waitingSamples");
  if (!samples.length) {
    line.setAttribute("d", "");
    area.setAttribute("d", "");
    // SVG elements have no hidden property; toggle the attribute itself.
    point.setAttribute("hidden", "");
    $("#pulseLiveStatus").textContent = "—";
    $("#pulseAxisStart").textContent = "—";
    $("#pulseAxisMiddle").textContent = "—";
    $("#pulseAxisEnd").textContent = t("now");
    return;
  }
  const width = 560;
  const top = 14;
  const bottom = 128;
  const values = samples.map((sample) => sample.latencyMs);
  const maximum = Math.max(40, ...values) * 1.1;
  const points = samples.map((sample, index) => ({
    x: samples.length === 1 ? width / 2 : (index / (samples.length - 1)) * width,
    y: bottom - (sample.latencyMs / maximum) * (bottom - top)
  }));
  const path = points.map(({ x, y }, index) => `${index ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  line.setAttribute("d", path);
  area.setAttribute("d", `${path} L${points.at(-1).x.toFixed(1)} 140 L${points[0].x.toFixed(1)} 140 Z`);
  const latestPoint = points.at(-1);
  const latest = samples.at(-1);
  point.removeAttribute("hidden");
  point.setAttribute("cx", latestPoint.x.toFixed(1));
  point.setAttribute("cy", latestPoint.y.toFixed(1));
  $("#pulseLiveStatus").textContent = `${latest.latencyMs} ms`;
  const midpointAt = samples.length > 1 ? Math.round((samples[0].at + latest.at) / 2) : latest.at;
  $("#pulseAxisStart").textContent = formatClock(samples[0].at);
  $("#pulseAxisMiddle").textContent = formatClock(midpointAt);
  $("#pulseAxisEnd").textContent = formatClock(latest.at);
}

function renderRecentTimeline() {
  if (!app.state) return;
  const rows = (app.state.qq?.events || [])
    .slice()
    .sort((a, b) => Date.parse(b.receivedAt || "") - Date.parse(a.receivedAt || ""))
    .slice(0, 6);
  setHtml($("#recentTimeline"), rows.length ? rows.map((record) => {
    const event = record.event || {};
    const sender = event.senderLabel || event.senderName || "QQ";
    const scope = event.groupId ? t("groupLabel", { value: event.groupId }) : t("privateChat");
    return `<article class="timeline-item">
      <span class="timeline-avatar">${escapeHtml(initial(sender))}</span>
      <div class="timeline-copy"><strong>${escapeHtml(sender)} <span class="muted small-text">· ${escapeHtml(scope)}</span></strong><p>${escapeHtml(event.text || "—")}</p>${record.reply ? `<p class="timeline-reply">↳ ${escapeHtml(record.reply)}</p>` : ""}</div>
      <time>${escapeHtml(formatRelative(record.receivedAt))}</time>
    </article>`;
  }).join("") : emptyState(t("noRecentActivity")));
}

function renderChannelSettings() {
  if (!app.state) return;
  const state = app.state;
  const h = app.maintenance || {};
  $("#qqStatusText").textContent = state.channels?.qq ? t("enabled") : t("disabled");
  const account = state.qq?.selfPersona?.account || {};
  const queueActive = Number(h.qq?.activeGenerations || 0);
  const queuePending = Number(h.qq?.pendingReplies || 0);
  const rows = [
    [t("connAccount"), h.oneBot?.nickname || account.nickname || "QQ", h.oneBot?.selfId || account.userId || "—", h.oneBot?.ok ? "ok" : "bad"],
    [t("connBridge"), h.oneBot?.ok ? t("healthy") : t("attention"), h.oneBot?.lastCheckedAt ? formatClock(h.oneBot.lastCheckedAt) : "—", h.oneBot?.ok ? "ok" : "bad"],
    [t("connQueue"), `${t("active")} ${queueActive} · ${t("pending")} ${queuePending}`, "", queueActive || queuePending ? "busy" : "ok"]
  ];
  setHtml($("#qqChannelMeta"), rows.map(([label, value, detail, kind]) => `<div class="connection-row ${kind}"><span class="connection-label">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><code>${escapeHtml(detail)}</code><i aria-hidden="true"></i></div>`).join(""));
  renderQqStickerFrequency(state.qq?.humanBehavior?.stickerFrequency || {});
  renderQqSelfPersona(state.qq?.selfPersona || {});
  renderQqAdaptiveLearning(state.qq?.humanBehavior?.adaptiveLearning || {});
  renderQqColdInterest(state.qq?.proactive?.coldGroupInterest || {}, state.qq?.humanBehavior?.adaptiveLearning || {}, state.qq?.events || []);
  renderQqPrivateInterest(state.qq?.humanBehavior?.privateAdaptiveLearning || {}, state.qq?.events || []);
  renderGroups(state.qq?.allowedGroups || []);
}

function renderGroups(groups) {
  if (app.busyKeys.has("groups")) return;
  $("#groupCount").textContent = String(groups.length);
  setHtml($("#groupList"), groups.length
    ? groups.map((id) => `<span class="token-item"><code>${escapeHtml(id)}</code><button type="button" data-remove-group="${escapeHtml(id)}" aria-label="${escapeHtml(t("removeGroupTitle"))} ${escapeHtml(id)}">×</button></span>`).join("")
    : `<p class="token-empty">${escapeHtml(t("noGroups"))}</p>`);
}

function renderEvents() {
  if (!app.state) return;
  const events = app.state.qq?.events || [];
  $("#qqEventCount").textContent = String(events.length);
  setHtml($("#qqEvents"), events.length ? events.map((record) => {
    const event = record.event || {};
    const ok = Boolean(record.decision?.ok);
    return `<article class="event-row">
      <time>${escapeHtml(formatTime(record.receivedAt))}</time>
      <span class="event-scope">${escapeHtml(event.groupId ? t("groupLabel", { value: event.groupId }) : t("privateChat"))}</span>
      <strong>${escapeHtml(event.senderLabel || event.senderName || "QQ")}</strong>
      <span class="badge ${ok ? "ok" : "off"}">${escapeHtml(ok ? t("replied") : t("ignored"))}</span>
      <p>${escapeHtml(event.text || "—")}${record.reply ? `<small>${escapeHtml(t("replyLabel"))}${escapeHtml(record.reply)}</small>` : ""}</p>
    </article>`;
  }).join("") : emptyState(t("noEvents")));
}

function renderBotControls() {
  const form = $("#botSettingsForm");
  const settings = app.state?.qq?.botSettings;
  const busy = app.busyKeys.has("bot-settings");
  const dirty = app.dirtyForms.has("botSettingsForm");
  $$("input, select, button", form).forEach((control) => { control.disabled = !settings || busy; });
  if (!settings) {
    setHtml($("#botDiagnostics"), `<span class="chip warn">${escapeHtml(t("waitingBotSettings"))}</span>`);
    return;
  }
  if (!busy && !dirty && !form.contains(document.activeElement)) {
    $("#botEnhancerToggle").checked = settings.enhancerEnabled;
    $("#botWebLookupToggle").checked = settings.webLookupEnabled;
    $("#botProactiveToggle").checked = settings.proactiveEnabled;
    $("#botJudgeToggle").checked = settings.judgeEnabled;
    $("#botJudgeMessages").value = settings.judgeEveryMessages;
    $("#botJudgeMinutes").value = settings.judgeEveryMinutes;
    $("#botJudgeProvider").value = settings.judgeProvider || "openrouter";
    $("#botJudgeModel").value = settings.judgeModel || "";
    $("#botJudgeTimeout").value = settings.judgeTimeoutMs;
    $("#botJudgeRecent").value = settings.judgeMaxRecentMessages;
  }
  if (dirty && !busy) setBotControlStatus("dirty", "settingsUnsaved");
  const activeGenerations = sumValues(app.state?.qq?.activeGenerationCounts);
  const pendingReplies = sumValues(app.state?.qq?.pendingReplyCounts);
  const provider = app.maintenance?.webLookup?.effectiveProvider || t("unknown");
  const safeFetchMode = app.state?.network?.safeFetchMode === "proxy-compatible" ? t("safeFetchProxy") : t("safeFetchStrict");
  const engine = getEngineInfo();
  setHtml($("#botDiagnostics"), [
    [t("diagEngine", { value: engineSummary(engine) }), ""],
    [t("diagJudgeProvider", { value: settings.judgeProvider || "openrouter" }), ""],
    [settings.judgeApiKeyConfigured ? t("diagJudgeKeyReady") : t("diagJudgeKeyMissing"), settings.judgeApiKeyConfigured ? "ok" : "bad"],
    [t("diagSearchProvider", { value: provider }), settings.webLookupEnabled ? "" : "warn"],
    [t("diagSafeFetch", { value: safeFetchMode }), ""],
    [t("diagActiveGeneration", { value: activeGenerations }), activeGenerations ? "warn" : ""],
    [t("diagPendingReplies", { value: pendingReplies }), pendingReplies ? "warn" : ""]
  ].map(([label, kind]) => `<span class="chip ${kind}">${escapeHtml(label)}</span>`).join(""));
}

function collectBotSettings() {
  return {
    enhancerEnabled: $("#botEnhancerToggle").checked,
    webLookupEnabled: $("#botWebLookupToggle").checked,
    proactiveEnabled: $("#botProactiveToggle").checked,
    judgeEnabled: $("#botJudgeToggle").checked,
    judgeEveryMessages: Number($("#botJudgeMessages").value),
    judgeEveryMinutes: Number($("#botJudgeMinutes").value),
    judgeProvider: $("#botJudgeProvider").value,
    judgeModel: $("#botJudgeModel").value.trim(),
    judgeTimeoutMs: Number($("#botJudgeTimeout").value),
    judgeMaxRecentMessages: Number($("#botJudgeRecent").value)
  };
}

function setBotControlStatus(status, messageKey) {
  const node = $("#botControlStatus");
  node.className = `save-state ${status === "ok" ? "" : status}`;
  node.textContent = t(messageKey);
}

async function saveBotSettings(control) {
  const form = $("#botSettingsForm");
  if (!form.reportValidity()) return false;
  const controls = $$("input, select, button", form);
  app.busyKeys.add("bot-settings");
  app.botSettingsDraft = collectBotSettingsDraft();
  persistDashboardUiState();
  controls.forEach((item) => { item.disabled = true; });
  setBotControlStatus("saving", "settingsSaving");
  try {
    app.state = await api("/api/qq/bot-settings", { method: "POST", body: JSON.stringify(collectBotSettings()) }, { key: "bot-settings" });
    app.lastFetch.state = Date.now();
    clearBotSettingsDraft();
    setBotControlStatus("ok", "settingsSynced");
    renderState();
    showToast(t("botSettingsSaved"), "success");
    return true;
  } catch (error) {
    app.dirtyForms.add("botSettingsForm");
    app.botSettingsDraft = collectBotSettingsDraft();
    persistDashboardUiState();
    setBotControlStatus("error", "settingsSaveFailed");
    document.activeElement?.blur?.();
    showToast(error.message, "error");
    if (control) control.focus();
    return false;
  } finally {
    app.busyKeys.delete("bot-settings");
    controls.forEach((item) => { item.disabled = !app.state?.qq?.botSettings; });
  }
}

function renderQqSelfPersona(summary) {
  const persona = summary?.persona || {};
  const generation = summary?.generation || {};
  const totals = summary?.totals || {};
  const policy = summary?.updatePolicy || {};
  const name = summary?.account?.nickname || persona.name || "Bot";
  const keywords = Array.isArray(persona.interestKeywords) ? persona.interestKeywords : [];
  const interests = Array.isArray(persona.interests) ? persona.interests : [];
  const generated = Number(generation.revision || 0) > 0;
  const description = persona.interestParagraph || persona.selfDescription || "";
  const policyLines = [
    policy.scopeInitialMessages ? t("selfPersonaPolicy", { initial: policy.scopeInitialMessages, messages: policy.scopeMessages, botReplies: policy.scopeBotReplies, scopeHours: policy.scopeCooldownHours }) : "",
    policy.generationInitialMessages ? t("selfPersonaGlobalPolicy", { initial: policy.generationInitialMessages, messages: policy.generationMessages, botReplies: policy.generationBotReplies, summaries: policy.generationScopeSummaries, hours: policy.generationCooldownHours, retry: policy.failureRetryHours }) : ""
  ].filter(Boolean);
  setHtml($("#qqSelfPersona"), `<article class="info-block">
    <div class="info-block-head"><strong>${escapeHtml(name)}</strong><small>${escapeHtml(generated ? t("selfPersonaGenerated", { revision: generation.revision, time: formatTime(generation.generatedAt) }) : t("selfPersonaCollecting"))}</small></div>
    ${description ? `<p class="persona-copy">${escapeHtml(description)}</p>` : ""}
    <p>${escapeHtml(t("selfPersonaProgress", { human: totals.humanMessages || 0, bot: totals.botReplies || 0, summaries: summary.summarizedScopes || 0, scopes: summary.scopeCount || 0 }))}</p>
    <h4>${escapeHtml(t("selfPersonaKeywords"))}</h4>
    <div class="chip-row">${keywords.length ? keywords.map((keyword) => `<span class="chip">${escapeHtml(keyword)}</span>`).join("") : `<span class="muted small-text">—</span>`}</div>
    <h4>${escapeHtml(t("selfPersonaTopics"))}</h4>
    <div class="chip-row">${interests.length ? interests.slice(0, 12).map((interest) => `<span class="chip">${escapeHtml(interest.topic || "—")} · ${escapeHtml(Math.round(Number(interest.weight || 0)))}%</span>`).join("") : `<span class="muted small-text">—</span>`}</div>
    ${policyLines.map((line) => `<p class="muted small-text">${escapeHtml(line)}</p>`).join("")}
  </article>`);
}

function renderQqAdaptiveLearning(groups) {
  rememberOpenAdaptiveLearningGroups();
  const entries = Object.entries(groups || {})
    .filter(([, item]) => Number(item.sampleSize || 0) > 0 || Number(item.humanPokeCount || 0) > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  setHtml($("#qqAdaptiveLearning"), entries.length ? entries.map(([groupId, item]) => {
    const hours = (item.activeHours || []).map((hour) => `${hour}:00`).join(" · ") || "—";
    const guidance = (item.styleGuidance || []).slice(0, 5);
    const reviewDetail = String(item.styleReviewDetail || "").split("\n").filter(Boolean).slice(0, 18);
    const intervals = item.proactiveIntervals || {};
    const cold = item.coldInterest || {};
    const sections = [
      detailSection(t("learningHuman"), [
        t("detailSample", { value: item.sampleSize || 0 }), t("detailConfidence", { value: formatRate(item.confidence) }), t("detailTextSample", { value: item.textSampleSize || 0 }),
        t("detailAverageChars", { value: item.averageTextChars || 0 }), t("detailShortRatio", { value: formatRate(item.shortTextRatio) }), t("detailLongRatio", { value: formatRate(item.longTextRatio) }),
        t("detailStickerRatio", { value: formatRate(item.stickerMessageRatio) }), t("detailImageRatio", { value: formatRate(item.imageMessageRatio) }), t("detailEmojiRatio", { value: formatRate(item.emojiMessageRatio) }),
        t("detailReplyRatio", { value: formatRate(item.replyMessageRatio) }), t("detailMentionRatio", { value: formatRate(item.mentionMessageRatio) }), t("detailQuestionRatio", { value: formatRate(item.questionMessageRatio) }),
        t("detailBotInteraction", { value: formatRate(item.directBotInteractionRatio) }), t("detailBurstRatio", { value: formatRate(item.burstContinuationRatio) }),
        t("detailPokeRatio", { value: formatRate(item.humanPokeActivityRatio), count: item.humanPokeCount || 0, bot: formatRate(item.humanPokeToBotRatio) }),
        t("detailInterruptionRate", { value: formatRate(item.interruptionRate), samples: item.interruptionSampleSize || 0 }), t("detailGap", { value: formatAdaptiveGap(item.medianGapSeconds) }),
        t("detailActiveDays", { value: item.activeDays || 0 }), t("detailDailyMessages", { value: item.messagesPerActiveDay || 0 }), t("detailCurrentHour", { value: formatRate(item.currentHourShare) }),
        t("detailFirstSeen", { value: formatTime(item.firstSeenAt) }), t("detailLastHuman", { value: formatTime(item.lastMessageAt) })
      ]),
      detailSection(t("learningBot"), [
        t("detailBotReplies", { value: item.botReplyCount || 0 }), t("detailBotChars", { value: item.averageBotReplyChars || 0 }), t("detailBotSticker", { value: formatRate(item.botStickerReplyRatio) }),
        t("detailBotBubbles", { value: formatRate(item.botMultiBubbleReplyRatio) }), t("detailBotFollowup", { value: formatRate(item.botReplyFollowUpRatio) }),
        t("detailTrackingStart", { value: formatTime(item.botTrackingStartedAt) }), t("detailLastBot", { value: formatTime(item.lastBotReplyAt) })
      ]),
      detailSection(t("learningReview"), [
        t("detailReviewSamples", { human: item.styleHumanSampleSize || 0, bot: item.styleBotSampleSize || 0 }),
        t("detailLastReview", { value: formatTime(item.lastStyleReviewAt) }), t("detailNextReview", { value: formatTime(item.nextStyleReviewAt) }),
        item.styleReviewSummary || t("adaptiveCollecting"),
        ...reviewDetail.map((line) => `↳ ${line}`),
        ...(reviewDetail.length ? [] : guidance.map((rule) => `↳ ${rule}`))
      ]),
      detailSection(t("learningInterest"), [
        t("detailOrdinaryInterest", { messages: intervals.judgeEveryMessages ?? "—", minutes: intervals.judgeEveryMinutes ?? "—" }),
        t("detailInterestReason", { value: formatAdaptiveReason(intervals.reason) }),
        t("detailLearnedHours", { value: cold.socialHours?.label || item.socialHours?.label || "—" }),
        t("detailUnanswered", { value: cold.unansweredBotStreak ?? item.unansweredBotStreak ?? 0 }),
        t("detailInterestMultiplier", { value: cold.interestMultiplier ?? 1 }),
        t("detailColdIdle", { idle: cold.idleHours ?? "—", required: cold.idleHoursRequired ?? "—" }),
        t("detailColdReason", { value: formatAdaptiveReason(cold.reason) }),
        t("detailColdThreshold", { value: formatTime(cold.thresholdReachedAt) }),
        t("detailColdCheck", { value: formatTime(cold.lastCheckAt || item.lastColdProactiveCheckAt) }),
        t("detailColdSent", { value: formatTime(cold.lastProactiveAt || item.lastColdProactiveAt) })
      ])
    ].join("");
    return `<details class="info-block adaptive-learning-item" data-adaptive-learning-key="${escapeHtml(groupId)}" ${app.openAdaptiveLearningGroups.has(groupId) ? "open" : ""}>
      <summary><span class="summary-title"><strong>${escapeHtml(t("groupLabel", { value: groupId }))}</strong><small>${escapeHtml(formatActivityLevel(item.activityLevel))} · ${escapeHtml(t("adaptiveHours", { hours }))}</small></span><span class="summary-meta">${escapeHtml(t("adaptiveSamples", { count: item.sampleSize || 0, members: item.learnedMembers || 0 }))}</span></summary>
      ${item.coldProactiveAwaitingHuman ? `<div class="chip-row"><span class="chip warn">${escapeHtml(t("adaptiveColdWaiting"))}</span></div>` : ""}
      <div class="detail-sections">${sections}</div>
    </details>`;
  }).join("") : `<p class="token-empty">${escapeHtml(t("noAdaptiveLearning"))}</p>`);
}

function rememberOpenAdaptiveLearningGroups() {
  $$(".adaptive-learning-item[data-adaptive-learning-key]", $("#qqAdaptiveLearning")).forEach((group) => {
    if (group.open) app.openAdaptiveLearningGroups.add(group.dataset.adaptiveLearningKey);
    else app.openAdaptiveLearningGroups.delete(group.dataset.adaptiveLearningKey);
  });
}

function detailSection(title, values) {
  return `<section class="detail-section"><h4>${escapeHtml(title)}</h4><ul>${values.filter(Boolean).map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul></section>`;
}

function renderQqStickerFrequency(frequency) {
  const entries = Object.entries(frequency || {}).sort(([left], [right]) => left.localeCompare(right));
  setHtml($("#qqStickerFrequency"), entries.length ? entries.map(([groupId, item]) => `<article class="info-block">
      <div class="info-block-head"><strong>${escapeHtml(t("groupLabel", { value: groupId }))}</strong><small>${escapeHtml(t("stickerSamples", { human: item.humanSampleSize || 0, bot: item.botSampleSize || 0 }))}</small></div>
      <div class="rate-bars">
        ${rateBar(t("stickerHuman"), item.humanStickerMessageRatio, "human")}
        ${rateBar(t("stickerBot"), item.botStickerMessageRatio, "bot")}
        ${rateBar(t("stickerPlan"), item.plannedCasualStickerRatio, "plan")}
      </div>
    </article>`).join("") : `<p class="token-empty">${escapeHtml(t("noStickerFrequency"))}</p>`);
}

function rateBar(label, ratio, kind) {
  const percent = Math.max(0, Math.min(100, Number(ratio || 0) * 100));
  return `<div class="rate-bar ${kind}"><span>${escapeHtml(label)}</span><svg preserveAspectRatio="none" aria-hidden="true"><rect x="0" y="0" height="6" rx="3" width="${percent.toFixed(1)}%" /></svg><b>${escapeHtml(formatRate(ratio))}%</b></div>`;
}

function renderQqColdInterest(policy, groups, events) {
  const entries = Object.entries(groups || {}).filter(([, item]) => Number(item.sampleSize || 0) > 0).sort(([left], [right]) => left.localeCompare(right));
  const policyHours = policy.allowedHours === "learned-per-group" ? t("learnedHours") : (policy.allowedHours || policy.fallbackAllowedHours || "09:00-23:00");
  const cards = entries.map(([groupId, item]) => {
    const cold = item.coldInterest || {};
    const status = cold.eligible ? "ready" : cold.awaitingHuman ? "waiting" : "";
    return `<article class="info-block ${status}">
      <div class="info-block-head"><strong>${escapeHtml(t("groupLabel", { value: groupId }))}</strong><span>${escapeHtml(formatAdaptiveReason(cold.reason))}</span></div>
      <div class="metric-line">
        <span>${escapeHtml(t("detailLearnedHours", { value: cold.socialHours?.label || item.socialHours?.label || "—" }))}</span>
        <span>${escapeHtml(t("detailColdIdle", { idle: cold.idleHours ?? "—", required: cold.idleHoursRequired ?? "—" }))}</span>
        <span>${escapeHtml(t("detailUnanswered", { value: cold.unansweredBotStreak ?? item.unansweredBotStreak ?? 0 }))}</span>
        <span>${escapeHtml(t("detailInterestMultiplier", { value: cold.interestMultiplier ?? 1 }))}</span>
        <span>${escapeHtml(t("detailColdCheck", { value: formatTime(cold.lastCheckAt || item.lastColdProactiveCheckAt) }))}</span>
      </div>
    </article>`;
  }).join("");
  const decisions = (events || []).filter((record) => record.event?.coldProactive).slice(0, 5);
  setHtml($("#qqColdInterest"), `<p class="muted small-text">${escapeHtml(t("coldInterestPolicy", { hours: policyHours, retry: policy.retryCooldownHours ?? 3 }))}</p>
    ${cards || `<p class="token-empty">${escapeHtml(t("noColdInterest"))}</p>`}
    <p class="section-label">${escapeHtml(t("recentDecisions"))}</p>
    ${decisions.length ? `<div class="decision-list">${decisions.map((record) => decisionItem(t("groupLabel", { value: record.event?.groupId || "—" }), record, record.reply || record.decision?.reason || formatAdaptiveReason(record.decision?.coldInterest?.reason))).join("")}</div>` : `<p class="token-empty">${escapeHtml(t("noColdInterestDecisions"))}</p>`}`);
}

function renderQqPrivateInterest(contacts, events) {
  const entries = Object.entries(contacts || {}).filter(([, item]) => Number(item.sampleSize || 0) > 0).sort(([left], [right]) => left.localeCompare(right));
  const cards = entries.map(([userId, item]) => {
    const plan = item.privateInterest || {};
    const status = plan.eligible ? "ready" : Number(plan.unansweredBotStreak || 0) > 0 ? "waiting" : "";
    return `<article class="info-block ${status}">
      <div class="info-block-head"><strong>${escapeHtml(t("privateContact", { value: userId }))}</strong><span>${escapeHtml(formatAdaptiveReason(plan.reason))}</span></div>
      <div class="metric-line">
        <span>${escapeHtml(t("privatePhase", { value: formatPrivatePhase(plan.phase) }))}</span>
        <span>${escapeHtml(t("privateFrequency", { value: formatPrivateFrequency(plan.frequency) }))}</span>
        <span>${escapeHtml(t("privateProbability", { value: formatRate(plan.probability) }))}</span>
        <span>${escapeHtml(t("detailUnanswered", { value: plan.unansweredBotStreak ?? item.unansweredBotStreak ?? 0 }))}</span>
        <span>${escapeHtml(t("detailNextCheck", { value: formatTime(plan.nextCheckAt) }))}</span>
      </div>
    </article>`;
  }).join("");
  const decisions = (events || []).filter((record) => record.event?.privateProactive).slice(0, 5);
  setHtml($("#qqPrivateInterest"), `${cards || `<p class="token-empty">${escapeHtml(t("noPrivateInterest"))}</p>`}
    <p class="section-label">${escapeHtml(t("recentDecisions"))}</p>
    ${decisions.length ? `<div class="decision-list">${decisions.map((record) => decisionItem(t("privateContact", { value: record.event?.senderId || "—" }), record, record.decision?.reason || formatAdaptiveReason(record.decision?.privateInterest?.phase))).join("")}</div>` : `<p class="token-empty">${escapeHtml(t("noPrivateInterestDecisions"))}</p>`}`);
}

function decisionItem(title, record, text) {
  const outcome = decisionOutcome(record);
  return `<article class="decision ${outcome.kind}"><div class="decision-head"><span>${escapeHtml(title)} · ${escapeHtml(outcome.label)}</span><time>${escapeHtml(formatRelative(record.receivedAt))}</time></div>${text ? `<p>${escapeHtml(text)}</p>` : ""}</article>`;
}

function decisionOutcome(record) {
  if (record.error || record.send?.ok === false) return { kind: "failed", label: t("outcomeFailed") };
  if (record.decision?.superseded) return { kind: "", label: t("outcomeCancelled") };
  if (record.reply) return { kind: "sent", label: t("outcomeSent") };
  return { kind: "", label: t("outcomeSilent") };
}

function formatActivityLevel(value) {
  const labels = app.language === "en"
    ? { high: "high activity", typical: "typical activity", low: "low activity", unknown: "learning" }
    : { high: "高活跃", typical: "一般活跃", low: "低活跃", unknown: "学习中" };
  return labels[value] || labels.unknown;
}

function formatAdaptiveReason(value) {
  const zh = {
    learning_sample_low: "学习样本不足", outside_social_hours: "不在开放时段", no_human_context: "缺少真人上下文",
    awaiting_human_after_cold_proactive: "等待真人接话", cold_check_cooldown: "判断冷却中", group_not_cold: "尚未达到沉默时长",
    bot_spoke_recently: "Bot 最近说过话", cold_group_time_due: "已到判断时间", ordinary_interest_pending: "普通兴趣消息待判断",
    reply_queue_pending: "回复队列处理中", reply_generation_active: "正在生成回复", activity_high: "群当前高活跃",
    activity_typical: "群当前一般活跃", activity_low: "群当前低活跃", activity_unknown: "活跃度仍在学习",
    private_too_soon: "距离上次互动太近", private_check_cooldown: "私聊判断冷却中", private_short_candidate: "短期兴趣候选",
    private_middle_candidate: "中期低概率候选", private_long_candidate: "长期兴趣回升候选"
  };
  const en = {
    learning_sample_low: "learning sample is low", outside_social_hours: "outside allowed hours", no_human_context: "no human context",
    awaiting_human_after_cold_proactive: "waiting for a human", cold_check_cooldown: "decision cooldown", group_not_cold: "quiet threshold not reached",
    bot_spoke_recently: "Bot spoke recently", cold_group_time_due: "ready for a decision", ordinary_interest_pending: "ordinary interest pending",
    reply_queue_pending: "reply queue pending", reply_generation_active: "reply generation active", activity_high: "high activity now",
    activity_typical: "typical activity now", activity_low: "low activity now", activity_unknown: "activity still learning",
    private_too_soon: "too soon since the last interaction", private_check_cooldown: "private decision cooldown", private_short_candidate: "short-term candidate",
    private_middle_candidate: "middle low-probability candidate", private_long_candidate: "long-term rising candidate"
  };
  return (app.language === "en" ? en : zh)[value] || value || "—";
}

function formatPrivatePhase(value) {
  const labels = app.language === "en" ? { short: "short", middle: "middle", long: "long" } : { short: "短期", middle: "中期低谷", long: "长期回升" };
  return labels[value] || value || "—";
}

function formatPrivateFrequency(value) {
  const labels = app.language === "en" ? { high: "high", typical: "typical", low: "low" } : { high: "高频", typical: "一般", low: "低频" };
  return labels[value] || value || "—";
}

function formatAdaptiveGap(seconds) {
  const value = Number(seconds);
  return Number.isFinite(value) && value > 0 ? formatDuration(value * 1000) : "—";
}

function formatRate(value) {
  const rate = Number(value || 0) * 100;
  return rate >= 10 ? rate.toFixed(0) : rate.toFixed(1);
}

// ---------- Memory ----------
function renderMemory() {
  if (!app.memory) return;
  if (app.busyKeys.has("memory") && $("#memoryView").childElementCount > 0) return;
  rememberOpenMemoryGroups();
  $$("[data-memory-tab]").forEach((button) => {
    const active = button.dataset.memoryTab === app.activeMemoryTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    if (active) $("#memoryView").setAttribute("aria-labelledby", button.id);
  });
  const html = app.activeMemoryTab === "unified" ? renderUnifiedMemory(app.memory.unified || {}) : renderQqMemory(app.memory.qq || {});
  $("#memoryView").innerHTML = html || emptyState(t("noMemory"));
}

function renderUnifiedMemory(memory) {
  const entries = filterMemoryEntries(memory.entries || []);
  const counts = countUnifiedEntries(memory.entries || []);
  const settings = memory.settings || {};
  const stateText = Object.values(memory.currentState || {}).filter(Boolean).join(" · ");
  const categories = [
    [t("unifiedEntries"), memory.entries?.length || 0], [t("handoffs"), counts.handoff], [t("ideas"), counts.idea],
    [t("projects"), counts.projectNote], [t("todos"), counts.openLoop], [t("notes"), counts.note + counts.dailyState]
  ];
  return `<div class="memory-layout memory-browser">
    <aside class="memory-side">
      <div class="category-list">${categories.map(([label, value], index) => `<span class="category-item ${index === 0 ? "active" : ""}"><span>${escapeHtml(label)}</span><em>${escapeHtml(value)}</em></span>`).join("")}</div>
      ${memorySetting("autoWriteOnSkillRecall", t("autoSkillMemory"), t("autoSkillHint"), Boolean(settings.autoWriteOnSkillRecall))}
      ${memorySetting("manualHandoffCommand", t("manualHandoff"), t("manualHandoffHint"), settings.manualHandoffCommand !== false)}
    </aside>
    <section class="memory-entries">
      <div class="list-head"><span>${escapeHtml(t("unifiedEntries"))}</span><span>${escapeHtml(memory.updatedAt ? t("updated", { time: formatTime(memory.updatedAt) }) : "")}</span></div>
      ${entries.length ? entries.map((entry) => renderMemoryEntry({ role: `${formatUnifiedType(entry.type)}${entry.topic ? ` · ${entry.topic}` : ""}`, text: entry.summary, at: entry.updatedAt })).join("") : emptyState(t("noMemory"))}
    </section>
    <aside class="memory-side memory-state">
      <article class="state-card"><h3>${escapeHtml(t("recentState"))}</h3><p>${escapeHtml(stateText || t("noState"))}</p></article>
      ${memory.latestHandoff?.summary ? `<article class="state-card"><h3>${escapeHtml(t("latestHandoff"))}</h3><p>${escapeHtml(memory.latestHandoff.summary)}</p></article>` : ""}
    </aside>
  </div>`;
}

function memorySetting(key, title, hint, checked) {
  return `<label class="setting-toggle"><span><strong>${escapeHtml(title)}</strong><p>${escapeHtml(hint)}</p></span><span class="switch small"><input type="checkbox" data-unified-setting="${key}" ${checked ? "checked" : ""} /><span aria-hidden="true"></span></span></label>`;
}

function renderQqMemory(qq) {
  const grouped = new Map();
  const addEntries = (group, section) => {
    const id = String(group.id || "");
    if (!id) return;
    const existing = grouped.get(id) || { id, title: group.title || id, entries: [], scope: "qq" };
    existing.entries.push(...(group.entries || []).map((entry) => ({ ...entry, role: entry.role ? `${section} · ${formatRole(entry.role)}` : section })));
    existing.clearTitle = t("allRelatedMemory", { value: existing.title });
    grouped.set(id, existing);
  };
  for (const group of qq.lightweight || []) addEntries(group, t("shortTermMemory"));
  for (const group of qq.recent || []) addEntries(group, t("recentMessages"));
  for (const group of qq.personas || []) addEntries(group, t("personas"));
  const impressionEntries = (item) => [
    item.impressionSummary ? { role: t("impressionBrief"), text: item.impressionSummary } : null,
    item.impressionDetail ? { role: t("impressionDetail"), text: item.impressionDetail } : null,
    item.botThoughtSummary ? { role: t("thoughtBrief"), text: item.botThoughtSummary } : null,
    item.botThoughtDetail ? { role: t("thoughtDetail"), text: item.botThoughtDetail } : null,
    ...(item.recentTopics || []).map((topic) => ({ role: t("recentTopic"), text: topic.summary || topic.label || topic.text })),
    ...(item.recentConversations || []).map((entry) => ({ role: t("recentInteraction"), text: entry.summary || entry.text }))
  ].filter((entry) => entry?.text);
  for (const group of qq.conversationMemory?.groups || []) {
    const entries = impressionEntries(group);
    if (entries.length) addEntries({ id: group.id, title: group.title, entries }, t("conversationImpressions"));
  }
  for (const chat of qq.conversationMemory?.privateChats || []) {
    const entries = impressionEntries(chat);
    if (entries.length) addEntries({ id: `private:${chat.id}`, title: chat.title, entries }, t("conversationImpressions"));
  }
  const groups = [...grouped.values()];
  if (qq.publicMemory?.entries?.length) groups.unshift({ id: "", title: t("publicMemory"), entries: qq.publicMemory.entries, scope: "qqPublicMemory" });
  return renderGroupedMemory(groups, "qq");
}

function renderGroupedMemory(groups, fallbackScope) {
  const query = app.memoryQuery.trim().toLowerCase();
  const visible = groups.map((group) => {
    const groupMatches = !query || `${group.title || ""} ${group.id || ""}`.toLowerCase().includes(query);
    return { ...group, entries: groupMatches ? group.entries || [] : filterMemoryEntries(group.entries || []) };
  }).filter((group) => group.entries.length > 0);
  if (!visible.length) return emptyState(t("noMemory"));
  return `<div class="memory-groups">${visible.map((group) => {
    const key = `${group.scope || fallbackScope}:${group.id}`;
    return `<details class="memory-group" data-memory-key="${escapeHtml(key)}" ${app.openMemoryGroups.has(key) ? "open" : ""}>
      <summary><strong>${escapeHtml(group.title || group.id)}</strong><span>${escapeHtml(t("entriesCount", { count: group.entries.length }))}</span><button class="button small ghost text-danger" type="button" data-clear-memory="${escapeHtml(group.scope || fallbackScope)}" data-memory-id="${escapeHtml(group.id || "")}" data-memory-title="${escapeHtml(group.clearTitle || group.title || group.id)}">${escapeHtml(t("clear"))}</button></summary>
      <div class="memory-entries">${group.entries.slice().reverse().map(renderMemoryEntry).join("")}</div>
    </details>`;
  }).join("")}</div>`;
}

function renderMemoryEntry(entry) {
  return `<article class="memory-entry"><div class="meta">${escapeHtml(formatRole(entry.role))}${entry.at ? ` · ${escapeHtml(formatTime(entry.at))}` : ""}</div><p>${escapeHtml(entry.text || entry.summary || "")}</p></article>`;
}

function formatRole(role) {
  if (role === "assistant") return t("roleAssistant");
  if (role === "user") return t("roleUser");
  return role || "";
}

function filterMemoryEntries(entries) {
  const query = app.memoryQuery.trim().toLowerCase();
  if (!query) return entries;
  return entries.filter((entry) => `${entry.role || ""} ${entry.text || ""} ${entry.summary || ""} ${entry.topic || ""}`.toLowerCase().includes(query));
}

function rememberOpenMemoryGroups() {
  $$(".memory-group[data-memory-key]", $("#memoryView")).forEach((group) => {
    if (group.open) app.openMemoryGroups.add(group.dataset.memoryKey); else app.openMemoryGroups.delete(group.dataset.memoryKey);
  });
}

function countUnifiedEntries(entries) {
  const counts = { handoff: 0, idea: 0, projectNote: 0, openLoop: 0, dailyState: 0, note: 0 };
  entries.forEach((entry) => { counts[entry.type] = (counts[entry.type] || 0) + 1; });
  return counts;
}

function formatUnifiedType(type) {
  return { handoff: t("handoffs"), idea: t("ideas"), projectNote: t("projects"), openLoop: t("todos"), dailyState: t("recentState"), note: t("notes") }[type] || type || t("notes");
}

// ---------- Knowledge ----------
function getKnowledgeStore() {
  return app.memory?.qq?.knowledgeBase || { entries: [], reviewHistory: [], groups: {}, people: {} };
}

function knowledgeScopeLabel(scope = {}) {
  const unknown = t("knowledgeUnknownName");
  if (scope.type === "global") return t("knowledgeScopeGlobal");
  if (scope.type === "group") return t("knowledgeScopeGroup", { name: scope.groupName || unknown, id: scope.groupId || "—" });
  if (scope.type === "member") return t("knowledgeScopeMember", { name: scope.userName || unknown, id: scope.userId || "—" });
  if (scope.type === "group-member") return t("knowledgeScopeGroupMember", { group: scope.groupName || unknown, groupId: scope.groupId || "—", user: scope.userName || unknown, userId: scope.userId || "—" });
  return unknown;
}

function knowledgeScopeName(type) {
  return { global: t("knowledgeGlobal"), group: t("knowledgeGroup"), member: t("knowledgeMember"), "group-member": t("knowledgeGroupMember") }[type] || t("knowledgeScope");
}

function knowledgeVariantMatches(entry, variant, query) {
  if (app.knowledgeScope !== "all" && variant.scope?.type !== app.knowledgeScope) return false;
  if (!query) return true;
  const scope = variant.scope || {};
  return [entry.title, ...(entry.aliases || []), variant.content, scope.type, scope.groupId, scope.groupName, scope.userId, scope.userName]
    .filter(Boolean).join(" ").toLocaleLowerCase().includes(query);
}

function visibleKnowledgeEntries() {
  const query = app.knowledgeQuery.trim().toLocaleLowerCase();
  const visible = (getKnowledgeStore().entries || [])
    .filter((entry) => app.knowledgeKind === "all" || entry.kind === app.knowledgeKind)
    .map((entry) => ({ ...entry, visibleVariants: (entry.variants || []).filter((variant) => knowledgeVariantMatches(entry, variant, query)) }))
    .filter((entry) => entry.visibleVariants.length > 0);
  visible.sort((left, right) => {
    if (app.knowledgeSort === "title") return left.title.localeCompare(right.title, app.language === "en" ? "en" : "zh-CN");
    if (app.knowledgeSort === "frequency") return knowledgeEntryHits(right) - knowledgeEntryHits(left) || Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || "");
    return Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || "");
  });
  return visible;
}

function knowledgeEntryHits(entry) {
  return (entry.visibleVariants || entry.variants || []).reduce((total, variant) => total + Number(variant.usage?.hitCount || 0), 0);
}

function knowledgeNeedsReview(variant) {
  const requested = Date.parse(variant.usage?.review?.lastRequestedAt || "");
  const reviewed = Date.parse(variant.usage?.review?.lastReviewedAt || "");
  return Number.isFinite(requested) && (!Number.isFinite(reviewed) || requested > reviewed);
}

function resolveKnowledgeSelection(entries) {
  const entry = entries.find((item) => item.id === app.selectedKnowledgeEntryId) || entries[0] || null;
  const variant = entry?.visibleVariants.find((item) => item.id === app.selectedKnowledgeVariantId) || entry?.visibleVariants[0] || null;
  app.selectedKnowledgeEntryId = entry?.id || "";
  app.selectedKnowledgeVariantId = variant?.id || "";
  return { entry, variant };
}

function renderKnowledge() {
  if (!app.memory) return;
  const store = getKnowledgeStore();
  const allEntries = store.entries || [];
  const variants = allEntries.flatMap((entry) => entry.variants || []);
  const reviews = store.reviewHistory || [];
  setHtml($("#knowledgeMetrics"), [
    { label: t("knowledgeTitles"), value: formatNumber(allEntries.length), icon: icons.knowledge },
    { label: t("knowledgeVariants"), value: formatNumber(variants.length), icon: icons.trace },
    { label: t("knowledgeSlang"), value: formatNumber(allEntries.filter((entry) => entry.kind === "slang").length), icon: icons.channels },
    { label: t("knowledgeReviews"), value: formatNumber(reviews.length), icon: icons.shieldCheck }
  ].map(statCard).join(""));
  const entries = visibleKnowledgeEntries();
  const selected = resolveKnowledgeSelection(entries);
  renderKnowledgeIndex(allEntries, variants);
  renderKnowledgeList(entries, selected);
  renderKnowledgeInspector(selected.entry, selected.variant, reviews);
}

function renderKnowledgeIndex(entries, variants) {
  const kindCounts = { all: entries.length, slang: entries.filter((entry) => entry.kind === "slang").length, note: entries.filter((entry) => entry.kind === "note").length };
  const scopeCounts = Object.fromEntries(["global", "group", "member", "group-member"].map((type) => [type, variants.filter((variant) => variant.scope?.type === type).length]));
  const item = (value, label, count, selected, attribute) => `<button class="index-item ${selected ? "active" : ""}" type="button" ${attribute}="${escapeHtml(value)}"><span>${escapeHtml(label)}</span><em>${escapeHtml(formatNumber(count))}</em></button>`;
  setHtml($("#knowledgeIndex"), `
    <div class="index-group"><span class="index-label">${escapeHtml(t("knowledgeKind"))}</span>
      ${item("all", t("knowledgeAll"), kindCounts.all, app.knowledgeKind === "all", "data-knowledge-kind")}
      ${item("slang", t("knowledgeKindSlang"), kindCounts.slang, app.knowledgeKind === "slang", "data-knowledge-kind")}
      ${item("note", t("knowledgeNotes"), kindCounts.note, app.knowledgeKind === "note", "data-knowledge-kind")}
    </div>
    <div class="index-group"><span class="index-label">${escapeHtml(t("knowledgeScope"))}</span>
      ${item("all", t("knowledgeAllScopes"), variants.length, app.knowledgeScope === "all", "data-knowledge-scope")}
      ${["global", "group", "member", "group-member"].map((type) => item(type, knowledgeScopeName(type), scopeCounts[type], app.knowledgeScope === type, "data-knowledge-scope")).join("")}
    </div>
    <div class="review-note"><strong>${escapeHtml(formatNumber(variants.filter(knowledgeNeedsReview).length))}</strong>${escapeHtml(t("knowledgePendingReview"))}</div>`);
}

function renderKnowledgeList(entries, selected) {
  const root = $("#knowledgeList");
  if (!entries.length) {
    setHtml(root, `<div class="knowledge-empty"><strong>${escapeHtml(t("knowledgeNoEntries"))}</strong><p>${escapeHtml(t("knowledgeEmptyHint"))}</p><button class="button primary small" type="button" data-new-knowledge>${escapeHtml(t("knowledgeCreateFirst"))}</button></div>`);
    return;
  }
  setHtml(root, `<div class="list-head"><span>${escapeHtml(t("knowledgeResults", { count: entries.length }))}</span></div><div class="knowledge-entry-list">${entries.map((entry) => {
    const variants = entry.visibleVariants;
    const scopes = [...new Set(variants.map((variant) => knowledgeScopeName(variant.scope?.type)))];
    return `<button class="knowledge-card ${entry.id === selected.entry?.id ? "active" : ""}" type="button" data-knowledge-entry="${escapeHtml(entry.id)}" data-knowledge-variant="${escapeHtml(variants[0]?.id || "")}">
      <span class="knowledge-card-top"><span class="kind-tag ${escapeHtml(entry.kind)}">${escapeHtml(entry.kind === "slang" ? t("knowledgeKindSlang") : t("knowledgeKindNote"))}</span><time>${escapeHtml(formatRelative(entry.updatedAt))}</time></span>
      <strong>${escapeHtml(entry.title)}</strong>
      <p>${escapeHtml(variants[0]?.content || "")}</p>
      <span class="knowledge-card-foot"><span>${scopes.map((scope) => `<span class="kind-tag">${escapeHtml(scope)}</span>`).join("")}</span><span>${escapeHtml(t("knowledgeHitValue", { count: knowledgeEntryHits(entry) }))}</span></span>
    </button>`;
  }).join("")}</div>`);
}

function renderKnowledgeInspector(entry, variant, reviewHistory) {
  const root = $("#knowledgeInspector");
  if (!entry || !variant) {
    setHtml(root, `<div class="inspector-empty">${escapeHtml(t("knowledgeNoSelection"))}</div>`);
    return;
  }
  const usage = variant.usage || {};
  const occurrences = usage.occurrences || [];
  const review = reviewHistory.filter((item) => item.entryId === entry.id && item.variantId === variant.id).at(-1);
  setHtml(root, `<article class="inspector">
    <header class="inspector-head">
      <div><span class="kind-tag ${escapeHtml(entry.kind)}">${escapeHtml(entry.kind === "slang" ? t("knowledgeKindSlang") : t("knowledgeKindNote"))}</span><h3>${escapeHtml(entry.title)}</h3></div>
      <div class="inspector-actions"><button class="button small ghost" type="button" data-edit-knowledge="${escapeHtml(entry.id)}" data-knowledge-variant="${escapeHtml(variant.id)}">${escapeHtml(t("editKnowledge"))}</button><button class="button small ghost text-danger" type="button" data-delete-knowledge="${escapeHtml(entry.id)}" data-knowledge-variant="${escapeHtml(variant.id)}">${escapeHtml(t("deleteKnowledge"))}</button></div>
    </header>
    ${(entry.variants || []).length > 1 ? `<div class="variant-tabs" aria-label="${escapeHtml(t("knowledgeVariants"))}">${entry.variants.map((item) => `<button class="${item.id === variant.id ? "active" : ""}" type="button" data-knowledge-entry="${escapeHtml(entry.id)}" data-knowledge-variant="${escapeHtml(item.id)}">${escapeHtml(knowledgeScopeName(item.scope?.type))}</button>`).join("")}</div>` : ""}
    <section><h4>${escapeHtml(t("knowledgeDefinition"))}</h4><p class="definition">${escapeHtml(variant.content)}</p></section>
    <section><h4>${escapeHtml(t("knowledgeScope"))}</h4><p>${escapeHtml(knowledgeScopeLabel(variant.scope))}</p></section>
    <section><h4>${escapeHtml(t("knowledgeStatistics"))}</h4>
      <div class="stat-pair"><div><strong>${escapeHtml(formatNumber(usage.hitCount || 0))}</strong><span>${escapeHtml(t("knowledgeHitCount"))}</span></div><div><strong>${escapeHtml(usage.lastSeenAt ? formatRelative(usage.lastSeenAt) : "—")}</strong><span>${escapeHtml(t("knowledgeLastSeen"))}</span></div></div>
      ${renderKnowledgeFrequency(occurrences)}
    </section>
    ${entry.aliases?.length ? `<section><h4>${escapeHtml(t("knowledgeAliases"))}</h4><div class="aliases">${entry.aliases.map((alias) => `<span class="chip">${escapeHtml(alias)}</span>`).join("")}</div></section>` : ""}
    ${renderKnowledgeEvidence(occurrences.at(-1))}
    <section><h4>${escapeHtml(t("knowledgeReviewState"))}</h4>${review ? `<p><strong>${escapeHtml(t("knowledgeReviewDecision", { decision: review.decision, time: formatTime(review.reviewedAt) }))}</strong></p><p>${escapeHtml(review.reason || t("knowledgeReviewHealthy"))}</p>` : `<p>${escapeHtml(t("knowledgeReviewHealthy"))}</p>`}</section>
    <footer>${escapeHtml(t("knowledgeUpdated", { time: formatTime(variant.updatedAt) }))} · ${escapeHtml(t("knowledgeSourceCount", { count: variant.sources?.length || 0 }))}</footer>
  </article>`);
}

function renderKnowledgeFrequency(occurrences) {
  const bucketCount = 12;
  const weekMs = 7 * 24 * 60 * 60 * 1_000;
  const now = Date.now();
  const buckets = Array.from({ length: bucketCount }, () => 0);
  for (const occurrence of occurrences || []) {
    const offset = Math.floor((now - Date.parse(occurrence.at || "")) / weekMs);
    if (offset >= 0 && offset < bucketCount) buckets[bucketCount - 1 - offset] += 1;
  }
  const max = Math.max(1, ...buckets);
  const barWidth = 100 / bucketCount;
  return `<svg class="frequency-chart" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">${buckets.map((value, index) => {
    const height = Math.max(2, (value / max) * 38);
    return `<rect x="${(index * barWidth + 0.8).toFixed(2)}" y="${(40 - height).toFixed(2)}" width="${(barWidth - 1.6).toFixed(2)}" height="${height.toFixed(2)}" rx="1" />`;
  }).join("")}</svg>`;
}

function renderKnowledgeEvidence(occurrence) {
  if (!occurrence) return `<section><h4>${escapeHtml(t("knowledgeEvidence"))}</h4><p class="muted">${escapeHtml(t("knowledgeNeverSeen"))}</p></section>`;
  const contextRow = (label, items) => items?.length ? `<div class="knowledge-context-row"><span>${escapeHtml(label)}</span><div>${items.map((item) => `<p><b>${escapeHtml(item.senderName || item.senderId || "")}</b>${escapeHtml(item.text)}</p>`).join("")}</div></div>` : "";
  return `<section><h4>${escapeHtml(t("knowledgeEvidence"))}</h4>
    ${contextRow(t("knowledgeContextBefore"), occurrence.before)}
    <blockquote class="evidence-quote"><span>${escapeHtml(t("knowledgeOccurrenceMessage", { sender: occurrence.senderName || occurrence.senderId || t("unknown"), time: formatTime(occurrence.at) }))}</span><p>${escapeHtml(occurrence.text)}</p></blockquote>
    ${contextRow(t("knowledgeContextAfter"), occurrence.after)}
  </section>`;
}

// ---------- Logs ----------
function renderLogs() {
  if (!app.logs) return;
  const summary = app.logs.summary || {};
  const byEngine = summary.byEngine || {};
  const engineHint = Object.entries(byEngine).map(([engine, count]) => t("engineLogs", { engine: engineNames[engine] || engine, count })).join(" · ");
  setHtml($("#logSummary"), [
    { label: t("totalLogs"), value: formatNumber(summary.total || 0), hint: engineHint, icon: icons.logs },
    { label: t("traces"), value: formatNumber(summary.traceCount || 0), icon: icons.trace },
    { label: t("p95Latency"), value: formatMs(summary.duration?.p95Ms), icon: icons.clock },
    { label: t("maxLatency"), value: formatMs(summary.duration?.maxMs), tone: Number(summary.duration?.maxMs) >= 10_000 ? "warn" : "", icon: icons.activity }
  ].map(statCard).join(""));
  $("#logMatchText").textContent = t("matchedLogs", { visible: app.logs.entries?.length || 0, matched: app.logs.matched || 0 });
  updateLogCategories(summary.byCategory || {});
  const entries = app.logs.entries || [];
  const signature = `${app.language}|${app.logExpand}|${entries.map(logEntryKey).join("|")}`;
  const stream = $("#logStream");
  if (signature === app.lastLogSignature && stream.childElementCount > 0) return;
  app.lastLogSignature = signature;
  const previousScrollTop = stream.childElementCount > 0 ? stream.scrollTop : app.logScrollTop;
  stream.innerHTML = entries.length ? entries.map((entry, index) => renderLogEntry(entry, index)).join("") : emptyState(t("noLogs"));
  if (app.logFollow) stream.scrollTop = stream.scrollHeight;
  else {
    stream.scrollTop = previousScrollTop;
    app.logScrollTop = stream.scrollTop;
  }
}

function logEntryKey(entry) {
  return entry.id || `${entry.ts}:${entry.traceId || ""}:${entry.message || ""}`;
}

function renderLogEntry(entry, index) {
  const duration = getLogDuration(entry);
  const level = logClassToken(entry.level, "info");
  const category = logClassToken(entry.category, "system");
  const message = app.language === "en" ? entry.message : (entry.messageZh || entry.message);
  const error = app.language === "en" ? formatLogFieldValue(entry.details?.error || entry.details?.modelError || entry.details?.diagnostic || "") : String(entry.errorZh || "");
  const trace = entry.traceId ? String(entry.traceId).slice(0, 8) : "";
  const durationClass = duration >= 10_000 ? "bad" : duration >= 2_000 ? "slow" : "";
  const open = app.logExpand || app.openLogIds.has(logEntryKey(entry));
  const engineTag = entry.engine ? `<span class="engine-tag ${logClassToken(entry.engine, "codex")}">${escapeHtml(engineNames[entry.engine] || entry.engine)}</span>` : "";
  return `<div class="log-entry level-${level} category-${category}${open ? " open" : ""}" data-log-key="${escapeHtml(logEntryKey(entry))}">
    <button class="log-row" type="button" data-log-index="${index}" aria-expanded="${open}">
      <time class="log-time">${escapeHtml(formatClock(entry.ts))}</time>
      <span class="level-badge ${level}">${escapeHtml(formatLogLevel(level))}</span>
      <span class="log-origin"><span class="log-category">${escapeHtml(formatLogCategory(category))}</span>${engineTag}</span>
      <span class="log-copy"><span class="log-message">${escapeHtml(message || "")}${trace ? `<span class="log-trace">${escapeHtml(trace)}</span>` : ""}</span>${error ? `<span class="log-error">${escapeHtml(error)}</span>` : ""}</span>
      <span class="log-duration ${durationClass}">${escapeHtml(duration == null ? "" : formatMs(duration))}</span>
    </button>
    ${open ? renderLogDetails(entry, index) : ""}
  </div>`;
}

function renderLogDetails(entry, index) {
  const excluded = new Set(["ts", "level", "category", "message", "messageZh", "errorZh", "details", "detailsZh", "traceId", "engine"]);
  const fields = [];
  if (entry.traceId) fields.push(["traceId", entry.traceId]);
  for (const [key, value] of Object.entries(entry)) {
    if (!excluded.has(key) && value != null && value !== "") fields.push([key, value]);
  }
  const localizedDetails = app.language === "en" ? entry.details : (entry.detailsZh || entry.details);
  for (const [key, value] of Object.entries(localizedDetails || {})) {
    if (value != null && value !== "") fields.push([key, value]);
  }
  return `<div class="log-details"><div class="log-detail-grid">${fields.map(([key, value]) => {
    const text = formatLogFieldValue(value);
    return `<div class="log-detail ${logDetailClass(key)}${text.length > 160 ? " is-wide" : ""}"><b>${escapeHtml(formatLogFieldLabel(key))}</b><span>${escapeHtml(text)}</span></div>`;
  }).join("")}</div><div class="log-detail-actions"><button class="button small ghost" type="button" data-log-json="${index}">${escapeHtml(t("viewJson"))}</button></div></div>`;
}

function logDetailClass(key) {
  const text = String(key || "").toLowerCase();
  if (text.includes("error") || text.includes("diagnostic") || text === "code" || text.includes("错误") || text.includes("诊断")) return "is-error";
  if (text.includes("duration") || text.endsWith("ms") || text.includes("timeout") || text.includes("耗时") || text.includes("超时")) return "is-time";
  if (text.endsWith("id") || text.includes("trace") || text.includes("span") || text.includes("链路")) return "is-id";
  if (text.includes("status") || text.includes("outcome") || text.includes("result") || text.includes("结果") || text.includes("状态")) return "is-result";
  return "";
}

function formatLogFieldLabel(key) {
  if (app.language === "en") return key;
  return { id: "日志 ID", schemaVersion: "结构版本", traceId: "链路", spanId: "片段", parentSpanId: "父片段" }[key] || key;
}

function formatLogFieldValue(value) {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return app.language === "en" ? String(value) : (value ? t("yes") : t("no"));
  if (typeof value === "number") return String(value);
  try { return JSON.stringify(value, null, 1); } catch { return String(value); }
}

function formatLogLevel(level) {
  if (app.language === "en") return String(level || "info").toUpperCase();
  return { debug: "调试", info: "信息", success: "成功", warn: "警告", error: "错误" }[level] || level;
}

function formatLogCategory(category) {
  const key = { system: "catSystem", qq: "catQq", onebot: "catOnebot", agent: "catAgent", codex: "catCodex", web: "catWeb", search: "catSearch", interest: "catInterest", learning: "catLearning", memory: "catMemory", command: "catCommand", lifecycle: "catLifecycle" }[category];
  return key ? t(key) : category;
}

function logClassToken(value, fallback) {
  return String(value || fallback).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 40) || fallback;
}

function updateLogCategories(categories) {
  const select = $("#logCategory");
  const current = select.value || app.logFilters.category || "";
  for (const name of Object.keys(categories)) app.logCategories.add(name);
  if (current) app.logCategories.add(current);
  const names = [...app.logCategories].sort((left, right) => formatLogCategory(left).localeCompare(formatLogCategory(right)));
  select.innerHTML = `<option value="">${escapeHtml(t("allCategories"))}</option>${names.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(formatLogCategory(name))}${categories[name] == null ? "" : ` (${escapeHtml(categories[name])})`}</option>`).join("")}`;
  if (names.includes(current)) select.value = current;
  app.logFilters.category = select.value;
}

function getLogDuration(entry) {
  const details = entry.details || {};
  const values = [details.totalDurationMs, details.durationMs, details.generationDurationMs, details.sendDurationMs].map(Number).filter(Number.isFinite);
  return values.length ? Math.max(...values) : null;
}

function toggleLogEntry(index) {
  const entry = app.logs?.entries?.[index];
  if (!entry) return;
  const key = logEntryKey(entry);
  const node = $(`.log-entry[data-log-key="${CSS.escape(key)}"]`);
  if (!node) return;
  const open = !node.classList.contains("open");
  if (open) app.openLogIds.add(key); else app.openLogIds.delete(key);
  node.classList.toggle("open", open);
  node.querySelector(".log-row").setAttribute("aria-expanded", String(open));
  node.querySelector(".log-details")?.remove();
  if (open) node.insertAdjacentHTML("beforeend", renderLogDetails(entry, index));
}

function openLogJson(index) {
  const entry = app.logs?.entries?.[index];
  if (!entry) return;
  $("#logDetailTitle").textContent = t("logDetail");
  $("#logDetailContent").textContent = JSON.stringify(entry, null, 2);
  $("#logDetailDialog").showModal();
}

// ---------- Settings ----------
function renderSettings() {
  setTheme(app.theme);
  $("#autoRefreshToggle").checked = app.autoRefresh;
  $("#refreshInterval").value = String(app.refreshSeconds);
  const endpoint = HUB || location.origin;
  $("#hubEndpointValue").textContent = endpoint;
  $("#sidebarEndpoint").textContent = endpoint.replace(/^https?:\/\//, "");
  const state = app.state || {};
  const network = state.network || {};
  const localBrowser = isLoopbackBrowser();
  const lanEnabled = Boolean(network.allowLanAccess);
  const lanToggle = $("#lanAccessToggle");
  const lanBusy = app.busyKeys.has("network:lan");
  if (!lanBusy && document.activeElement !== lanToggle) lanToggle.checked = lanEnabled;
  lanToggle.disabled = lanBusy || !app.state || network.editable === false;
  $("#lanAccessHint").textContent = network.editable === false ? t("lanManagedByEnvironment") : t("lanAccessHint");
  const lanUrls = Array.isArray(network.lanUrls) ? network.lanUrls : [];
  $("#lanAccessUrls").textContent = lanEnabled ? (lanUrls.join("\n") || t("lanNoAddress")) : t("lanLocalOnly");
  $("#copyLanToken").disabled = !lanEnabled || !network.apiTokenConfigured || !localBrowser;
  const publicTunnel = network.publicTunnel || {};
  const tunnelEnabled = Boolean(publicTunnel.enabled);
  const tunnelRunning = Boolean(publicTunnel.running && publicTunnel.publicUrl);
  const tunnelToggle = $("#publicTunnelToggle");
  const tunnelBusy = app.busyKeys.has("network:tunnel");
  if (!tunnelBusy && document.activeElement !== tunnelToggle) tunnelToggle.checked = tunnelEnabled;
  tunnelToggle.disabled = tunnelBusy || !app.state || !localBrowser || Boolean(publicTunnel.starting);
  $("#publicTunnelHint").textContent = !localBrowser
    ? t("publicTunnelRemoteManaged")
    : publicTunnel.lastError
      ? t("publicTunnelError", { error: publicTunnel.lastError })
      : publicTunnel.available === false
        ? t("publicTunnelUnavailable")
        : tunnelRunning ? t("publicTunnelRunningHint") : t("publicTunnelHint");
  $("#publicTunnelUrl").textContent = tunnelRunning ? publicTunnel.publicUrl : publicTunnel.starting ? t("publicTunnelStarting") : t("publicTunnelOff");
  $("#copyPublicTunnelUrl").disabled = !tunnelRunning;
  $("#copyPublicTunnelToken").disabled = !tunnelRunning || !network.apiTokenConfigured || !localBrowser;
  const engine = getEngineInfo();
  const maintenance = app.maintenance || {};
  setHtml($("#runtimeFacts"), [
    [t("factEngine"), engine.engine ? `${engine.name}${engine.cliVersion ? ` ${engine.cliVersion}` : ""}` : "—"],
    [t("factModel"), engine.model || "—"],
    [t("factEffort"), engine.reasoningEffort || "—"],
    [t("factStarted"), maintenance.startedAt ? formatTime(maintenance.startedAt) : "—"]
  ].map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd title="${escapeHtml(value)}">${escapeHtml(value)}</dd></div>`).join(""));
}

// ---------- Mutations ----------
async function mutate(action, { control, success = t("saved"), busyKey = "" } = {}) {
  if (busyKey) app.busyKeys.add(busyKey);
  if (control) control.disabled = true;
  try {
    const result = await action();
    showToast(success, "success");
    return result;
  } catch (error) {
    showToast(error.message, "error");
    throw error;
  } finally {
    if (busyKey) app.busyKeys.delete(busyKey);
    if (control) control.disabled = false;
  }
}

async function setChannel(channel, enabled, control) {
  try {
    await mutate(() => api("/api/channel", { method: "POST", body: JSON.stringify({ channel, enabled }) }), { control, success: t("channelUpdated"), busyKey: `channel:${channel}` });
    await refreshState({ quiet: true });
  } catch {
    control.checked = !enabled;
  }
}

async function setLanAccess(enabled, control) {
  if (enabled && !await confirmAction(t("lanEnableTitle"), t("lanEnableMessage"))) {
    control.checked = !enabled;
    return;
  }
  try {
    app.state = await mutate(() => api("/api/network/lan-access", { method: "POST", body: JSON.stringify({ enabled }) }), { control, success: t("lanAccessUpdated"), busyKey: "network:lan" });
    app.lastFetch.state = Date.now();
    renderState();
  } catch {
    control.checked = !enabled;
  }
}

async function setPublicTunnel(enabled, control) {
  if (enabled && !await confirmAction(t("publicTunnelEnableTitle"), t("publicTunnelEnableMessage"))) {
    control.checked = !enabled;
    return;
  }
  try {
    app.state = await mutate(() => api("/api/network/public-tunnel", { method: "POST", body: JSON.stringify({ enabled }) }), { control, success: t("publicTunnelUpdated"), busyKey: "network:tunnel" });
    app.lastFetch.state = Date.now();
    renderState();
  } catch {
    control.checked = !enabled;
    await refreshState({ quiet: true }).catch(() => undefined);
  }
}

async function saveGroups(groups, control) {
  await mutate(() => api("/api/qq/groups", { method: "POST", body: JSON.stringify({ allowedGroups: groups }) }), { control, busyKey: "groups" });
  await refreshState({ quiet: true });
}

function findKnowledgeVariant(entryId, variantId) {
  const entry = getKnowledgeStore().entries?.find((item) => item.id === entryId);
  const variant = entry?.variants?.find((item) => item.id === variantId);
  return entry && variant ? { entry, variant } : null;
}

function syncKnowledgeEditorScope() {
  const type = $("#knowledgeScopeType").value;
  $$(".knowledge-group-field").forEach((field) => { field.hidden = !["group", "group-member"].includes(type); });
  $$(".knowledge-member-field").forEach((field) => { field.hidden = !["member", "group-member"].includes(type); });
  $("#knowledgeGroupId").required = ["group", "group-member"].includes(type);
  $("#knowledgeUserId").required = ["member", "group-member"].includes(type);
}

function openKnowledgeEditor(entryId = "", variantId = "") {
  const found = entryId && variantId ? findKnowledgeVariant(entryId, variantId) : null;
  $("#knowledgeEditorForm").reset();
  $("#knowledgeEntryId").value = found?.entry.id || "";
  $("#knowledgeVariantId").value = found?.variant.id || "";
  $("#knowledgeKind").value = found?.entry.kind || "slang";
  $("#knowledgeTitleField").value = found?.entry.title || "";
  $("#knowledgeContent").value = found?.variant.content || "";
  $("#knowledgeAliases").value = (found?.entry.aliases || []).join("，");
  $("#knowledgeScopeType").value = found?.variant.scope?.type || "global";
  $("#knowledgeGroupId").value = found?.variant.scope?.groupId || "";
  $("#knowledgeGroupName").value = found?.variant.scope?.groupName || "";
  $("#knowledgeUserId").value = found?.variant.scope?.userId || "";
  $("#knowledgeUserName").value = found?.variant.scope?.userName || "";
  $("#knowledgeKind").disabled = Boolean(found);
  $("#knowledgeScopeType").disabled = Boolean(found);
  $("#knowledgeGroupId").readOnly = Boolean(found);
  $("#knowledgeUserId").readOnly = Boolean(found);
  $("#knowledgeEditorTitle").textContent = t(found ? "knowledgeEditorTitleEdit" : "knowledgeEditorTitleNew");
  syncKnowledgeEditorScope();
  $("#knowledgeEditorDialog").showModal();
  requestAnimationFrame(() => $("#knowledgeTitleField").focus());
}

async function deleteKnowledge(entryId, variantId, control) {
  const found = findKnowledgeVariant(entryId, variantId);
  if (!found) return;
  if (!await confirmAction(t("deleteKnowledgeTitle"), t("deleteKnowledgeMessage", { value: found.entry.title }))) return;
  const response = await mutate(() => api("/api/qq/knowledge", { method: "POST", body: JSON.stringify({ action: "delete", entryId, variantId }) }), { control, success: t("knowledgeDeleted"), busyKey: "knowledge" }).catch(() => null);
  if (!response) return;
  app.memory = response;
  app.selectedKnowledgeEntryId = "";
  app.selectedKnowledgeVariantId = "";
  persistDashboardUiState();
  renderKnowledge();
}

function confirmAction(title, message) {
  const dialog = $("#confirmDialog");
  $("#confirmTitle").textContent = title;
  $("#confirmMessage").textContent = message;
  dialog.returnValue = "";
  dialog.showModal();
  return new Promise((resolve) => dialog.addEventListener("close", () => resolve(dialog.returnValue === "confirm"), { once: true }));
}

function showToast(message, type = "info") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  $("#toastRegion").append(toast);
  setTimeout(() => toast.remove(), 3_500);
}

// ---------- Formatting ----------
function setHtml(node, markup) {
  if (node && node.innerHTML !== markup) node.innerHTML = markup;
}
function emptyState(message) { return `<div class="empty-state">${escapeHtml(message)}</div>`; }
function formatTime(value) {
  if (value == null || value === "") return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(app.language === "en" ? "en" : "zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}
function formatClock(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString(app.language === "en" ? "en-GB" : "zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }); }
function formatRelative(value) {
  const ms = Date.now() - Date.parse(value || "");
  if (!Number.isFinite(ms)) return "—";
  if (ms < 60_000) return app.language === "en" ? "just now" : "刚刚";
  if (ms < 3_600_000) return app.language === "en" ? `${Math.floor(ms / 60_000)}m ago` : `${Math.floor(ms / 60_000)} 分钟前`;
  if (ms < 86_400_000) return app.language === "en" ? `${Math.floor(ms / 3_600_000)}h ago` : `${Math.floor(ms / 3_600_000)} 小时前`;
  return formatTime(value);
}
function formatReset(seconds) { const date = new Date(Number(seconds) * 1000); return Number.isNaN(date.getTime()) ? "—" : formatTime(date); }
function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${Math.max(1, minutes)}m`;
}
function formatMs(value) { const number = Number(value); if (value == null || !Number.isFinite(number)) return "—"; return number >= 1000 ? `${(number / 1000).toFixed(number >= 10_000 ? 0 : 1)}s` : `${Math.round(number)}ms`; }
function formatNumber(value) { return Number(value || 0).toLocaleString(app.language === "en" ? "en-US" : "zh-CN"); }
function isLoopbackBrowser() { return location.protocol === "file:" || ["localhost", "127.0.0.1", "::1", "[::1]"].includes(location.hostname); }
function sumValues(value) { return Object.values(value || {}).reduce((sum, item) => sum + (Number(item) || 0), 0); }
function clampPercent(value) { return Math.max(0, Math.min(100, Math.round(Number(value) || 0))); }
function compactUiText(value, maxLength = 180) { const text = String(value || "").replace(/\s+/g, " ").trim(); return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text; }
function initial(value) { return [...String(value || "?").trim()][0]?.toUpperCase() || "?"; }
function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }

const icons = {
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/></svg>',
  pulse: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12.5h4l2.5-6 4 12 2.5-6H21"/></svg>',
  activity: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 19v-7m5 7V5m5 14v-9m5 9V8"/></svg>',
  logs: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14M5 11h14M5 16h9M5 21h6"/></svg>',
  trace: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 6h4a3 3 0 0 1 3 3v6m-6 3h7"/></svg>',
  shieldCheck: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 6v5c0 4.8-3.1 8.3-8 10-4.9-1.7-8-5.2-8-10V6l8-3Z"/><path d="m8.5 12 2.2 2.2 4.8-5"/></svg>',
  hub: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="7" rx="2"/><rect x="4" y="13" width="16" height="7" rx="2"/><path d="M8 7.5h.01M8 16.5h.01"/></svg>',
  qq: '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M10.5 22.5c-2.6-1.8-3.2-5.4-1.3-7.7-.2-5.1 2.4-8.8 6.8-8.8s7 3.7 6.8 8.8c1.9 2.3 1.3 5.9-1.3 7.7M11 18c.7 5.6 9.3 5.6 10 0M12.5 26l1.8-3m5.2 3-1.8-3"/></svg>',
  oneBot: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="7" width="16" height="12" rx="4"/><path d="M9 7V5m6 2V5M8.5 12h.01m7 0h.01M9 16h6"/></svg>',
  agent: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v3m0 12v3M3 12h3m12 0h3M6.3 6.3l2.1 2.1m7.2 7.2 2.1 2.1M6.3 17.7l2.1-2.1m7.2-7.2 2.1-2.1"/><circle cx="12" cy="12" r="3"/></svg>',
  globe: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.3 2.5 3.5 5.5 3.5 9S14.3 18.5 12 21c-2.3-2.5-3.5-5.5-3.5-9S9.7 5.5 12 3Z"/></svg>',
  overview: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="8" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="5" rx="1.8"/><rect x="3.5" y="14.5" width="7" height="6" rx="1.8"/><rect x="13.5" y="11.5" width="7" height="9" rx="1.8"/></svg>',
  channels: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 5.5h15v10h-9l-4.5 3.5v-3.5h-1.5z"/><path d="M8.5 9.5h7M8.5 12h4"/></svg>',
  memory: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6.5" rx="7" ry="2.8"/><path d="M5 6.5v11c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-11"/></svg>',
  knowledge: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H19v15H7.5A2.5 2.5 0 0 0 5 20.5z"/><path d="M9 7.5h6"/></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 8.5A8 8 0 1 0 20 14M20 4v4.5h-4.5"/></svg>',
  theme: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/></svg>',
  raw: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 5-5 7 5 7m8-14 5 7-5 7"/></svg>',
  add: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v8m-4-4h8"/></svg>'
};

// ---------- Command palette ----------
function getCommands() {
  const engine = getEngineInfo();
  return [
    { id: "view-overview", label: t("navOverview"), hint: t("actionOverviewHint"), icon: icons.overview, keywords: "dashboard home status 总览 首页 状态" },
    { id: "view-channels", label: t("navChannels"), hint: t("actionChannelsHint"), icon: icons.channels, keywords: "qq onebot group 通道 群 白名单" },
    { id: "view-intelligence", label: t("navIntelligence"), hint: t("actionIntelligenceHint"), icon: icons.activity, keywords: "bot behavior proactive learning 行为 主动 学习" },
    { id: "view-memory", label: t("navMemory"), hint: t("actionMemoryHint"), icon: icons.memory, keywords: "context recall search 记忆 上下文" },
    { id: "view-knowledge", label: t("navKnowledge"), hint: t("actionKnowledgeHint"), icon: icons.knowledge, keywords: "knowledge slang 知识 黑话" },
    { id: "view-activity", label: t("navActivity"), hint: t("actionLogsHint"), icon: icons.logs, keywords: "logs trace debug 日志 追踪" },
    { id: "view-settings", label: t("navSettings"), hint: t("actionSettingsHint"), icon: icons.settings, keywords: "preferences language 设置 主题 语言" },
    ...(engine.engine ? [{ id: "engine-logs", label: t("actionEngineLogs", { engine: engine.name }), hint: t("actionEngineLogsHint"), icon: icons.agent, keywords: "engine agent codex claude 引擎 智能体" }] : []),
    { id: "refresh", label: t("actionRefresh"), hint: t("actionRefreshHint"), icon: icons.refresh, keywords: "reload sync 刷新 同步" },
    { id: "health", label: t("actionHealth"), hint: t("actionHealthHint"), icon: icons.pulse, keywords: "diagnose service status 检查 健康" },
    { id: "theme", label: t("actionTheme"), hint: t("actionThemeHint"), icon: icons.theme, keywords: "dark light 深色 浅色" },
    { id: "raw", label: t("actionApi"), hint: t("actionApiHint"), icon: icons.raw, keywords: "api json state raw 原始" },
    { id: "add-group", label: t("actionAddGroup"), hint: t("actionAddGroupHint"), icon: icons.add, keywords: "qq allowlist 群 白名单 添加" }
  ];
}

function filteredCommands() {
  const query = $("#commandSearch").value.trim().toLowerCase();
  if (!query) return getCommands();
  return getCommands().filter((command) => `${command.label} ${command.hint} ${command.keywords}`.toLowerCase().includes(query));
}

function renderCommands() {
  const commands = filteredCommands();
  app.commandIndex = Math.max(0, Math.min(app.commandIndex, Math.max(0, commands.length - 1)));
  $("#commandResults").innerHTML = commands.length ? commands.map((command, index) => `
    <button id="command-${escapeHtml(command.id)}" class="command-item ${index === app.commandIndex ? "active" : ""}" type="button" role="option" aria-selected="${index === app.commandIndex}" data-command-id="${escapeHtml(command.id)}">
      <span class="command-icon">${command.icon}</span>
      <span class="command-copy"><strong>${escapeHtml(command.label)}</strong><span>${escapeHtml(command.hint)}</span></span>
    </button>`).join("") : `<div class="command-empty">${escapeHtml(t("noMatchingActions"))}</div>`;
  const active = commands[app.commandIndex];
  if (active) $("#commandSearch").setAttribute("aria-activedescendant", `command-${active.id}`); else $("#commandSearch").removeAttribute("aria-activedescendant");
}

function openCommands() {
  const dialog = $("#commandDialog");
  if (dialog.open) return;
  $("#commandSearch").value = "";
  app.commandIndex = 0;
  renderCommands();
  dialog.showModal();
  requestAnimationFrame(() => $("#commandSearch").focus());
}

function moveCommandSelection(direction) {
  const commands = filteredCommands();
  if (!commands.length) return;
  app.commandIndex = (app.commandIndex + direction + commands.length) % commands.length;
  renderCommands();
  $("#commandResults").querySelector(".command-item.active")?.scrollIntoView({ block: "nearest" });
}

async function openFeatureLogs({ category = "", engine = "", query = "" } = {}) {
  setView("activity", { focus: false });
  if (category) app.logCategories.add(category);
  updateLogCategories({});
  $("#logCategory").value = category;
  $("#logEngine").value = engine;
  $("#logLevel").value = "";
  $("#logSlow").value = "";
  $("#logQuery").value = query;
  persistDashboardUiState();
  await refreshLogs().catch(() => undefined);
}

async function runCommand(id) {
  $("#commandDialog").close();
  if (id.startsWith("view-")) { setView(id.slice(5), { focus: true }); return; }
  if (id === "engine-logs") { await openFeatureLogs({ category: "agent", engine: getEngineInfo().engine }); return; }
  if (id === "refresh") { await refreshView().catch(() => undefined); return; }
  if (id === "health") {
    setView("overview", { focus: false });
    await refreshMaintenance({ force: true }).catch(() => undefined);
    $("#serviceList").scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
    return;
  }
  if (id === "theme") { setTheme(isDarkTheme() ? "light" : "dark"); return; }
  if (id === "raw") { await openApi(); return; }
  if (id === "add-group") {
    setView("channels", { focus: false });
    requestAnimationFrame(() => $("#groupInput").focus());
  }
}

function renderInitialShell() {
  if (app.state || app.maintenance) return;
  $("#overviewStats").innerHTML = Array.from({ length: 4 }, () => `<article class="stat"><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-value"></span></article>`).join("");
  renderServiceList();
}

// ---------- Events ----------
document.addEventListener("click", async (event) => {
  const nav = event.target.closest("[data-view]");
  if (nav) { setView(nav.dataset.view, { focus: true }); return; }
  const go = event.target.closest("[data-go-view]");
  if (go) { setView(go.dataset.goView, { focus: true }); return; }
  const featureLogs = event.target.closest("[data-open-feature-logs]");
  if (featureLogs) { await openFeatureLogs({ category: featureLogs.dataset.openFeatureLogs || "", query: featureLogs.dataset.logQuery || "" }); return; }
  const removeGroup = event.target.closest("[data-remove-group]");
  if (removeGroup && app.state) {
    const id = removeGroup.dataset.removeGroup;
    if (await confirmAction(t("removeGroupTitle"), t("removeGroupMessage", { value: id }))) {
      await saveGroups((app.state.qq?.allowedGroups || []).filter((item) => item !== id), removeGroup).catch(() => undefined);
    }
    return;
  }
  const clear = event.target.closest("[data-clear-memory]");
  if (clear) {
    event.preventDefault();
    const title = clear.dataset.memoryTitle || clear.dataset.memoryId || clear.dataset.clearMemory;
    if (await confirmAction(t("clearMemoryTitle"), t("clearMemoryMessage", { value: title }))) {
      await mutate(() => api("/api/memory/clear", { method: "POST", body: JSON.stringify({ scope: clear.dataset.clearMemory, id: clear.dataset.memoryId || "" }) }), { control: clear, success: t("memoryCleared"), busyKey: "memory" }).catch(() => undefined);
      await refreshMemory({ quiet: true });
    }
    return;
  }
  if (event.target.closest("[data-new-knowledge]")) { openKnowledgeEditor(); return; }
  const knowledgeKind = event.target.closest("[data-knowledge-kind]");
  if (knowledgeKind) {
    app.knowledgeKind = knowledgeKind.dataset.knowledgeKind;
    $("#knowledgeKindFilter").value = app.knowledgeKind;
    persistDashboardUiState();
    renderKnowledge();
    return;
  }
  const knowledgeScope = event.target.closest("[data-knowledge-scope]");
  if (knowledgeScope) {
    app.knowledgeScope = knowledgeScope.dataset.knowledgeScope;
    $("#knowledgeScopeFilter").value = app.knowledgeScope;
    persistDashboardUiState();
    renderKnowledge();
    return;
  }
  const editKnowledge = event.target.closest("[data-edit-knowledge]");
  if (editKnowledge) { openKnowledgeEditor(editKnowledge.dataset.editKnowledge, editKnowledge.dataset.knowledgeVariant); return; }
  const removeKnowledge = event.target.closest("[data-delete-knowledge]");
  if (removeKnowledge) { await deleteKnowledge(removeKnowledge.dataset.deleteKnowledge, removeKnowledge.dataset.knowledgeVariant, removeKnowledge); return; }
  const knowledgeEntry = event.target.closest("[data-knowledge-entry][data-knowledge-variant]");
  if (knowledgeEntry) {
    app.selectedKnowledgeEntryId = knowledgeEntry.dataset.knowledgeEntry;
    app.selectedKnowledgeVariantId = knowledgeEntry.dataset.knowledgeVariant;
    persistDashboardUiState();
    renderKnowledge();
    return;
  }
  const logJson = event.target.closest("[data-log-json]");
  if (logJson) { openLogJson(Number(logJson.dataset.logJson)); return; }
  const logRow = event.target.closest("[data-log-index]");
  if (logRow && app.logs) toggleLogEntry(Number(logRow.dataset.logIndex));
});

$("#commandTrigger").addEventListener("click", openCommands);
$("#commandClose").addEventListener("click", () => $("#commandDialog").close());
$("#commandDialog").addEventListener("click", (event) => { if (event.target === event.currentTarget) event.currentTarget.close(); });
$("#commandSearch").addEventListener("input", () => { app.commandIndex = 0; renderCommands(); });
$("#commandSearch").addEventListener("keydown", (event) => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    moveCommandSelection(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.key === "Enter") {
    const command = filteredCommands()[app.commandIndex];
    if (command) { event.preventDefault(); void runCommand(command.id); }
  }
});
$("#commandResults").addEventListener("click", (event) => {
  const command = event.target.closest("[data-command-id]");
  if (command) void runCommand(command.dataset.commandId);
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    if ($("#commandDialog").open) $("#commandDialog").close(); else openCommands();
  }
});

$("#refreshButton").addEventListener("click", () => refreshView().catch(() => undefined));
$("#offlineRetry").addEventListener("click", () => refreshView().catch(() => undefined));
$("#refreshHealth").addEventListener("click", () => refreshMaintenance({ force: true }).catch(() => undefined));
$("#refreshMemory").addEventListener("click", () => refreshMemory().catch(() => undefined));
$("#refreshLogs").addEventListener("click", () => refreshLogs().catch(() => undefined));
$("#qqToggle").addEventListener("change", (event) => setChannel("qq", event.target.checked, event.target));
$("#lanAccessToggle").addEventListener("change", (event) => { void setLanAccess(event.target.checked, event.target); });
$("#publicTunnelToggle").addEventListener("change", (event) => { void setPublicTunnel(event.target.checked, event.target); });
$("#groupInput").addEventListener("input", (event) => {
  event.target.removeAttribute("aria-invalid");
  app.groupDraft = event.target.value;
  persistDashboardUiState();
});
$("#addGroupForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = $("#groupInput");
  const value = input.value.trim();
  if (!/^\d{4,20}$/.test(value)) { input.setAttribute("aria-invalid", "true"); showToast(t("groupInvalid"), "error"); input.focus(); return; }
  input.removeAttribute("aria-invalid");
  const groups = [...new Set([...(app.state?.qq?.allowedGroups || []), value])];
  await saveGroups(groups, event.submitter).then(() => {
    input.value = "";
    app.groupDraft = "";
    persistDashboardUiState();
  }).catch(() => undefined);
});

$("#botSettingsForm").addEventListener("input", markBotSettingsDirty);
$("#botJudgeProvider").addEventListener("change", (event) => {
  const providers = app.state?.qq?.botSettings?.judgeProviders || [];
  const selected = providers.find((provider) => provider.id === event.target.value);
  if (selected?.defaultModel) $("#botJudgeModel").value = selected.defaultModel;
  markBotSettingsDirty();
});
$("#botSettingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveBotSettings(event.submitter);
});
for (const selector of ["#botEnhancerToggle", "#botWebLookupToggle", "#botProactiveToggle", "#botJudgeToggle"]) {
  $(selector).addEventListener("change", async (event) => {
    if (event.target === $("#botEnhancerToggle") && !event.target.checked) $("#botProactiveToggle").checked = false;
    if (event.target === $("#botProactiveToggle") && event.target.checked) $("#botEnhancerToggle").checked = true;
    await saveBotSettings(event.target);
  });
}

$("#memoryTabs").addEventListener("click", (event) => {
  const tab = event.target.closest("[data-memory-tab]");
  if (!tab) return;
  app.activeMemoryTab = tab.dataset.memoryTab;
  persistDashboardUiState();
  renderMemory();
});
$("#memoryTabs").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const tabs = $$("[data-memory-tab]", event.currentTarget);
  const index = tabs.indexOf(document.activeElement);
  const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[nextIndex].focus();
  tabs[nextIndex].click();
});
let memorySearchTimer = null;
$("#memorySearch").addEventListener("input", (event) => {
  app.memoryQuery = event.target.value;
  persistDashboardUiState();
  clearTimeout(memorySearchTimer);
  memorySearchTimer = setTimeout(renderMemory, 100);
});
let knowledgeSearchTimer = null;
$("#knowledgeSearch").addEventListener("input", (event) => {
  app.knowledgeQuery = event.target.value;
  persistDashboardUiState();
  clearTimeout(knowledgeSearchTimer);
  knowledgeSearchTimer = setTimeout(renderKnowledge, 100);
});
$("#knowledgeKindFilter").addEventListener("change", (event) => { app.knowledgeKind = event.target.value; persistDashboardUiState(); renderKnowledge(); });
$("#knowledgeScopeFilter").addEventListener("change", (event) => { app.knowledgeScope = event.target.value; persistDashboardUiState(); renderKnowledge(); });
$("#knowledgeSort").addEventListener("change", (event) => { app.knowledgeSort = event.target.value; persistDashboardUiState(); renderKnowledge(); });
$("#knowledgeScopeType").addEventListener("change", syncKnowledgeEditorScope);
$("#knowledgeEditorDialog").addEventListener("click", (event) => { if (event.target === event.currentTarget) event.currentTarget.close(); });
$$("[data-close-knowledge-editor]").forEach((button) => button.addEventListener("click", () => $("#knowledgeEditorDialog").close()));
$("#knowledgeEditorForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const entryId = $("#knowledgeEntryId").value;
  const variantId = $("#knowledgeVariantId").value;
  const body = {
    action: "upsert",
    entryId: entryId || undefined,
    variantId: variantId || undefined,
    kind: $("#knowledgeKind").value,
    title: $("#knowledgeTitleField").value,
    content: $("#knowledgeContent").value,
    aliases: $("#knowledgeAliases").value,
    scopeType: $("#knowledgeScopeType").value,
    groupId: $("#knowledgeGroupId").value,
    groupName: $("#knowledgeGroupName").value,
    userId: $("#knowledgeUserId").value,
    userName: $("#knowledgeUserName").value
  };
  const response = await mutate(() => api("/api/qq/knowledge", { method: "POST", body: JSON.stringify(body) }), { control: event.submitter, success: t("knowledgeSaved"), busyKey: "knowledge" }).catch(() => null);
  if (!response) return;
  app.memory = response;
  app.selectedKnowledgeEntryId = response.mutation?.entryId || entryId;
  app.selectedKnowledgeVariantId = response.mutation?.variantId || variantId;
  persistDashboardUiState();
  $("#knowledgeEditorDialog").close();
  renderKnowledge();
});
$("#memoryView").addEventListener("change", async (event) => {
  const input = event.target.closest("[data-unified-setting]");
  if (!input || !app.memory?.unified) return;
  const settings = { ...app.memory.unified.settings, [input.dataset.unifiedSetting]: input.checked };
  await mutate(() => api("/api/unified-memory/settings", { method: "POST", body: JSON.stringify(settings) }), { control: input, busyKey: "memory" }).catch(() => { input.checked = !input.checked; });
  await refreshMemory({ quiet: true });
});
$("#memoryView").addEventListener("toggle", () => { rememberOpenMemoryGroups(); persistDashboardUiState(); }, true);
$("#qqAdaptiveLearning").addEventListener("toggle", () => { rememberOpenAdaptiveLearningGroups(); persistDashboardUiState(); }, true);

const rememberLogFilters = () => {
  app.logFilters = readLogFilters();
  persistDashboardUiState();
};
$("#logFilterForm").addEventListener("input", rememberLogFilters);
$("#logFilterForm").addEventListener("change", rememberLogFilters);
$("#logFilterForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  rememberLogFilters();
  if (await refreshLogs()) showToast(t("filterApplied"), "success");
});
$("#clearLogFilters").addEventListener("click", () => {
  $("#logFilterForm").reset();
  rememberLogFilters();
  refreshLogs().catch(() => undefined);
});
for (const selector of ["#logLevel", "#logCategory", "#logEngine", "#logSlow", "#logLimit"]) {
  $(selector).addEventListener("change", () => { app.lastLogSignature = ""; void refreshLogs({ quiet: true }); });
}
$("#liveLogsToggle").addEventListener("change", (event) => {
  app.liveLogs = event.target.checked;
  persistDashboardUiState();
  setLiveLogState(app.liveLogs ? "active" : "paused");
  if (app.liveLogs) void refreshLogs({ quiet: true });
});
$("#logFollowToggle").addEventListener("change", (event) => {
  app.logFollow = event.target.checked;
  persistDashboardUiState();
  if (app.logFollow) $("#logStream").scrollTop = $("#logStream").scrollHeight;
});
$("#logExpandToggle").addEventListener("change", (event) => {
  app.logExpand = event.target.checked;
  if (!app.logExpand) app.openLogIds.clear();
  persistDashboardUiState();
  renderLogs();
});
$("#logStream").addEventListener("scroll", (event) => {
  const stream = event.currentTarget;
  app.logScrollTop = stream.scrollTop;
  if (!app.logFollow) return;
  if (stream.scrollHeight - stream.scrollTop - stream.clientHeight > 120) {
    app.logFollow = false;
    $("#logFollowToggle").checked = false;
    persistDashboardUiState();
  }
});

$("#languageSelect").addEventListener("change", (event) => { app.language = event.target.value === "en" ? "en" : "zh"; writeStorage(localStorage, "language", app.language); applyI18n(); });
$("#themeOptions").addEventListener("click", (event) => { const button = event.target.closest("[data-theme-choice]"); if (button) setTheme(button.dataset.themeChoice); });
$("#themeOptions").addEventListener("keydown", (event) => {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const choices = $$("[data-theme-choice]", event.currentTarget);
  const index = choices.indexOf(document.activeElement);
  const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? choices.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + choices.length) % choices.length;
  choices[nextIndex].focus();
  choices[nextIndex].click();
});
$("#quickTheme").addEventListener("click", () => setTheme(isDarkTheme() ? "light" : "dark"));
$("#autoRefreshToggle").addEventListener("change", (event) => { app.autoRefresh = event.target.checked; writeStorage(localStorage, "autoRefresh", app.autoRefresh ? "1" : "0"); });
$("#refreshInterval").addEventListener("change", (event) => { app.refreshSeconds = Number(event.target.value) || 10; writeStorage(localStorage, "refreshSeconds", String(app.refreshSeconds)); });

async function openApi(path = "/api/state") {
  if (app.apiToken) {
    try {
      const payload = await api(path);
      $("#logDetailTitle").textContent = t("rawState");
      $("#logDetailContent").textContent = JSON.stringify(payload, null, 2);
      $("#logDetailDialog").showModal();
    } catch (error) {
      showToast(error.message, "error");
    }
    return;
  }
  if (window.webkit?.messageHandlers?.codexRemoteContactNative) window.webkit.messageHandlers.codexRemoteContactNative.postMessage({ action: "openHub" });
  else window.open(`${HUB}${path}`, "_blank", "noopener");
}
$("#openHubApi").addEventListener("click", () => { void openApi(); });
$("#openRawState").addEventListener("click", () => { void openApi(); });
$("#copyEndpoint").addEventListener("click", () => { void copyText($("#hubEndpointValue").textContent); });
async function copyNetworkAccessToken(button) {
  button.disabled = true;
  try {
    const payload = await api("/api/network/access-token");
    await copyText(payload.token, t("lanTokenCopied"));
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    renderSettings();
  }
}
$("#copyLanToken").addEventListener("click", (event) => { void copyNetworkAccessToken(event.currentTarget); });
$("#copyPublicTunnelToken").addEventListener("click", (event) => { void copyNetworkAccessToken(event.currentTarget); });
$("#copyPublicTunnelUrl").addEventListener("click", () => { void copyText($("#publicTunnelUrl").textContent, t("publicTunnelUrlCopied")); });
$("#copyLogDetail").addEventListener("click", () => { void copyText($("#logDetailContent").textContent); });

async function copyText(value, success = t("copied")) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
    await navigator.clipboard.writeText(String(value || ""));
    showToast(success, "success");
  } catch {
    const input = document.createElement("textarea");
    input.className = "copy-buffer";
    input.value = String(value || "");
    document.body.append(input);
    input.select();
    const copied = document.execCommand("copy");
    input.remove();
    showToast(copied ? success : t("copyFailed"), copied ? "success" : "error");
  }
}

window.addEventListener("hashchange", () => setView(location.hash.slice(1), { updateHash: false }));
window.addEventListener("pagehide", persistDashboardUiState);
document.addEventListener("visibilitychange", () => { if (!document.hidden && app.autoRefresh) void refreshView({ quiet: true }); });
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => setTheme(app.theme));

setInterval(() => {
  if (document.hidden) return;
  const now = Date.now();
  const base = app.refreshSeconds * 1_000;
  if (app.view === "activity" && app.liveLogs && !app.controllers.has("logs") && now - app.lastFetch.logs >= 1_000) void refreshLogs({ quiet: true }).catch(() => undefined);
  if (!app.autoRefresh) return;
  if (!app.controllers.has("state") && now - app.lastFetch.state >= base) void refreshState({ quiet: true }).catch(() => undefined);
  if (!app.controllers.has("maintenance") && now - app.lastFetch.maintenance >= base) void refreshMaintenance({ quiet: true }).catch(() => undefined);
  if (["memory", "knowledge"].includes(app.view) && !app.controllers.has("memory") && now - app.lastFetch.memory >= base) void refreshMemory({ quiet: true }).catch(() => undefined);
}, 1_000);

restoreDashboardUiState();
setTheme(app.theme);
applyI18n();
if (app.dirtyForms.has("botSettingsForm")) setBotControlStatus("dirty", "settingsUnsaved");
renderInitialShell();
setView(app.view, { updateHash: true, quiet: false });
