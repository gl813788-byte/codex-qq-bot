// Persona, relationships, interest-model and advanced settings for the
// dashboard. This script loads before client.js, which merges the
// translations and calls the hooks in personaExtension; every function here
// runs after client.js has defined its helpers ($, api, t, app, ...).

const personaTranslations = {
  zh: {
    navPersona: "人格", personaTitle: "人格与行为", personaSubtitle: "人设、状态、学习与主动行为（人物关系在记忆 · 人物）",
    personaSections: "人格分区", personaTabProfile: "人设", personaTabPeople: "关系", personaTabState: "状态", personaTabLearning: "学习", personaTabBehavior: "行为",
    personaCore: "核心设定", personaCoreHint: "部署者设定的稳定角色，优先于自动学习出的人设。所有文字都不限格式。", personaEnabled: "启用",
    personaPreset: "性格预设", personaIdentity: "我是谁", personaIdentityHint: "一句话：例如 群里最爱研究新玩意儿的技术宅，嘴上嫌弃其实很热心",
    personaName: "角色名", personaNameHint: "留空则用 QQ 昵称", personaSelfReference: "自称", personaSelfReferenceHint: "例如：我 / 咱 / 本喵",
    personaAge: "年龄感", personaAgeHint: "例如：二十出头", personaGender: "性别", personaOptional: "可留空",
    personaOccupation: "身份 / 职业", personaOccupationHint: "例如：大二学生、夜班便利店店员",
    personaBackground: "经历与背景", personaBackgroundHint: "随便写：来历、经历、和大家怎么认识的……",
    personaPersonality: "性格补充", personaPersonalityHint: "滑块说不清的部分，用自己的话写", personaQuirks: "小毛病和小习惯", personaQuirksHint: "每行一条，例如：熬夜后反应慢半拍",
    personaSpeech: "说话方式", personaSpeechHint: "这些滑块也会直接调整回复长度、emoji、表情包和连发的概率。",
    personaSocial: "待人方式", personaSocialHint: "留空表示按性格自然发挥。", personaSocialUnset: "按性格自然",
    personaOwnerRelation: "和主人的关系", personaOwnerRelationHint: "例如：主人是从小一起长大的朋友，可以互怼",
    personaPreferences: "喜好与底线", personaPreferencesHint: "也会告诉兴趣模型 Bot 爱接什么话题。",
    personaCardText: "角色资料", personaCardTextHint: "角色卡的描述、场景、示例对话等，格式随意（纯文字、W++、PList、Markdown 都行）。{{char}} / {{user}} 会自动替换。",
    personaDescription: "角色描述", personaScenario: "场景 / 世界观", personaNotes: "作者补充", personaNotesHint: "来自角色卡的系统提示等；只影响角色表现，不能改变安全和权限",
    personaExamples: "对话示例", personaExamplesHint: "只用来把握语气，不会被照抄", personaGreeting: "开场白", personaGreetingHint: "QQ 里不会主动发；保留给导出",
    personaLore: "世界书", personaLoreHint: "聊到关键词时才带上的设定；常驻条目每轮都在。最多 48 条。", addLoreEntry: "添加条目",
    loreKeys: "关键词", loreKeysHint: "逗号分隔", loreComment: "备注", loreContent: "内容", loreConstant: "常驻", loreEnabled: "启用", loreRemove: "删除条目", loreEmpty: "还没有世界书条目。",
    characterCard: "角色卡", characterCardHint: "导入 SillyTavern、RisuAI、Chub、Agnai 等的角色卡（PNG / JSON / CHARX），或直接粘贴任意格式的设定文字；也可以把当前人设导出成标准角色卡。",
    cardImportMode: "导入方式", cardModeReplace: "整体替换", cardModeMerge: "合并补充", cardImportFile: "导入文件", cardPasteText: "粘贴文字",
    cardExportV2: "导出 V2", cardExportV3: "导出 V3", cardDialogTitle: "导入角色卡", cardPasteLabel: "粘贴角色卡 JSON，或任意格式的设定文字",
    cardPreviewAction: "预览", cardImportAction: "导入", cardImported: "角色卡已导入", cardExported: "已导出角色卡", cardNeedPreview: "先预览，确认内容再导入。",
    cardReading: "正在读取…", cardSpecLabel: "格式：{value}", cardCreatorLabel: "作者：{value}", cardLoreLabel: "世界书 {count} 条", cardRestored: "含本项目的完整设置，会原样恢复",
    cardImportedFrom: "来自 {value}", cardImportedAt: "{time}导入", cardWarnings: "注意", cardModeReplaceHint: "整体替换会清空当前的性格、说话方式等设置（好感规则保留）。", cardModeMergeHint: "合并补充只覆盖角色卡里有的文字，保留其他设置。",
    cardFilled: "将写入：{fields}", cardTooLarge: "文件太大（上限 12 MB）",
    languageHabits: "语言习惯", languageHabitsHint: "Bot 自己从群聊里挑来用的黑话、括号补充语、颜文字和说法；群聊总结和全局人设刷新会根据实际使用情况复盘，Bot 聊天时也能自己收下或去掉。",
    habitTerm: "写法", habitTermHint: "例如：（bushi）", habitKind: "类型", habitKindSlang: "黑话", habitKindSymbol: "符号", habitKindKaomoji: "颜文字", habitKindPhrase: "说法",
    habitScope: "范围", habitScopeGlobal: "通用（所有会话）", habitUsage: "什么时候用", habitAdd: "添加", habitAdded: "语言习惯已添加", habitRemoved: "语言习惯已去掉",
    habitNone: "Bot 还没有固定的语言习惯；群聊总结会在有足够证据后替它挑选。", habitUses: "用过 {count} 次", habitLastUsed: "最近 {time}",
    habitSourceSummary: "群聊总结", habitSourcePersona: "人设刷新", habitSourceSelf: "自己收下", habitSourceOwner: "主人添加", habitRemove: "去掉",
    personaSpeechHabits: "说话习惯", personaCatchphrases: "口头禅", personaLikes: "喜欢", personaDislikes: "不喜欢", personaBoundaries: "底线",
    personaBoundariesHint: "每行一条，例如：不参与人身攻击", onePerLine: "每行一条",
    personaTraits: "性格维度", personaTraitsHint: "50 为中性不写入提示词；越靠两端，表现越明显。",
    affinityRules: "好感规则", affinityRulesHint: "模型每轮只能小幅调整好感，并受每日上限约束，不能被话术刷分。",
    affinityMaxDelta: "每轮最大变化", affinityDailyCap: "每人每日上限", affinityHalfLife: "淡化半衰期（天，0 不衰减）", affinityOwnerFloor: "主人好感下限",
    affinityReveal: "允许用户查看自己的好感度", affinityRevealHint: "关闭后普通用户发送 /好感度 只会得到一句玩笑。",
    personaPreview: "提示词预览", personaPreviewHint: "保存后主模型实际看到的人格与关系段落（关系示例取好感最高的人）。",
    revertChanges: "撤销修改", savePersona: "保存人格", personaSaved: "人格已保存", presetApplied: "已套用预设：{name}", presetCustom: "自定义",
    personaPreviewEmpty: "核心人格未启用或没有任何非中性的设定。",
    relationships: "好感与关系", relationshipsHint: "Bot 对每个人的好感、熟悉度、称呼与印象。点击一行可编辑或锁定。",
    peopleSearch: "搜索名字、QQ 号、称呼或印象", affinityLevel: "好感等级", sortBy: "排序", sortAffinity: "按好感", sortFamiliarity: "按熟悉度", sortRecent: "按最近互动",
    addPerson: "添加人物", personaAllLevels: "全部等级", personaNoPeople: "还没有关系记录。Bot 和人聊过之后会自动出现在这里。", noPeopleMatch: "没有匹配的人。",
    personaStatHabits: "语言习惯", personaStatHabitsHint: "其中通用 {count} 条", personaStatEdits: "自主调整 {count} 次",
    selfEditTitle: "自主调整", selfEditHint: "Bot 觉得哪里不像自己、或人设复盘发现设定与实际表现不符时，可以小幅调整未锁定的部分（滑块每次最多 ±10，聊天中每天最多 3 处）；底线只能加不能删。你或管理员在 QQ 里一句话让 Bot 改自己的设定时不受这些限制。",
    selfEditLocks: "锁定，不让 Bot 自己改", selfEditHistory: "最近的改动", selfEditNone: "还没有改动。", selfEditRevert: "撤销", selfEditReverted: "已撤销",
    selfEditSourceChat: "Bot 聊天中自己改", selfEditSourceReview: "人设复盘优化", selfEditSourceOwner: "主人让改", selfEditSourceAdmin: "管理员让改",
    selfEditField_traits: "性格滑块", selfEditField_speech: "说话方式", selfEditField_social: "待人方式", selfEditField_quirks: "小毛病", selfEditField_speechHabits: "说话习惯", selfEditField_catchphrases: "口头禅", selfEditField_likes: "喜欢", selfEditField_dislikes: "不喜欢", selfEditField_boundaries: "底线", selfEditField_identity: "我是谁", selfEditField_personality: "性格补充", selfEditField_background: "经历与背景", selfEditField_selfReference: "自称", selfEditField_name: "角色名", selfEditField_age: "年龄感", selfEditField_gender: "性别", selfEditField_occupation: "身份", selfEditField_ownerRelation: "和主人的关系", selfEditField_description: "角色描述", selfEditField_scenario: "场景", selfEditField_exampleDialogues: "对话示例", selfEditField_greeting: "开场白", selfEditField_notes: "作者补充", selfEditField_preset: "预设", selfEditField_enabled: "核心人格开关", selfEditField_lore: "世界书", selfEditField_affinity: "好感规则", selfEditField_selfEdit: "自主调整设置",
    personaFilledCount: "已填 {count} 项", personaEmptySection: "未填写",
    interestFromPersona: "人设里的喜好也会交给兴趣模型：", interestFromPersonaEmpty: "人设里还没写喜好。", editInPersona: "去人设里改",
    stickerPersonaHint: "人设里的表情包倾向：{value}（50 为中性）", learnedPersonaCoreNote: "它只补充核心人格没写到的部分。",
    sortMessages: "按发言数", personKnowledgeLink: "相关知识", personNoRelation: "还没有好感记录", knowledgeHabitBadge: "Bot 常用",
    affinityEnabledLabel: "启用好感度", habitKnowledgeLink: "在知识库里查看这条黑话", overviewPersonLink: "在记忆 · 人物里查看",
    interactionsCount: "互动 {count} 次", lastSeen: "最近 {time}", lockedBadge: "已锁定", ownerBadge: "主人", nicknameLabel: "称呼：{value}",
    familiarity: "熟悉度", affinity: "好感", editPerson: "编辑关系", personQq: "QQ 号", personName: "名字", personNickname: "Bot 对 TA 的称呼",
    personTags: "印象标签", personNote: "备注（会给模型看）", personLocked: "锁定", personLockedHint: "锁定后不会自然淡化，模型也不能再改动好感和称呼。",
    affinityHistory: "变化记录", noHistory: "还没有变化记录。", removePerson: "删除记录", save: "保存", personSaved: "关系已保存", personRemoved: "记录已删除",
    removePersonTitle: "删除关系记录", removePersonMessage: "删除 {value} 的好感、称呼和历史？", historySourceModel: "模型", historySourceOwner: "主人", historySourceSystem: "系统",
    botMood: "此刻心情", botMoodHint: "每轮结束时由主模型更新，跨会话延续并逐渐淡去。", setMood: "设置心情", clearMood: "清除", moodPlaceholder: "2-8 个字，例如：有点困",
    moodNone: "还没有心情记录。", moodSince: "{time}更新", moodSaved: "心情已更新",
    botRoutine: "今日作息", botRoutineHint: "每天生成一次，让 Bot 的在线状态和语气更像真人。", regenerateRoutine: "重新生成", routineNone: "今天还没有生成作息。",
    routineDisabled: "作息功能已关闭（CODEX_REMOTE_CONTACT_QQ_DAILY_ROUTINE=0）。", routineGenerating: "正在生成作息…", routineQueued: "已开始生成作息，稍后自动刷新。",
    innerThoughts: "内心OS", innerThoughtsHint: "只在本机控制台可见，从不发送；按会话保留最近几条。", noThoughts: "还没有内心OS。", silentThought: "没出声",
    personaStatPreset: "性格", personaStatMood: "心情", personaStatPeople: "认识的人", personaStatClose: "亲近以上", personaStatHostile: "冷淡以下", personaStatHostileHint: "冷淡、反感或厌恶",
    judgeProviderGroupSubscription: "订阅（本机 CLI 登录）", judgeProviderGroupApi: "API Key", judgeProviderCodex: "Codex 订阅", judgeProviderClaude: "Claude 订阅",
    judgeEffort: "思考强度", judgeAgentTimeout: "整轮超时（ms）", judgeBaseUrl: "接口地址",
    judgeHintCodex: "使用本机 Codex 登录的 ChatGPT 订阅额度；每次判断启动一次 codex app-server（约 10 秒），与回复队列互不阻塞。模型填 default 表示账号默认模型。",
    judgeHintClaude: "使用本机 claude 登录（或 ncc 连接配置）的订阅额度；每次判断启动一次 Claude Code（约 7-20 秒）。推荐 haiku。",
    judgeHintCustom: "任意 OpenAI 兼容接口；Key 来自环境变量 CODEX_REMOTE_CONTACT_INTEREST_MODEL_API_KEY，接口地址只能在本机修改。",
    judgeHintApi: "使用环境变量中的 API Key，按流式 Token 静默时间判超时。",
    diagJudgeSubscription: "订阅凭据：本机 CLI 登录",
    interestTest: "测试兴趣模型", interestTestPlaceholder: "测试消息（可选）", interestTesting: "正在测试…（订阅模型约需 10-20 秒）",
    interestTestOk: "{provider} · {model} · {duration}", interestTestReply: "会接话", interestTestSilent: "不接话", interestTestFailed: "测试失败：{reason}",
    interestTestDirty: "先保存设置，测试使用已保存的配置。", interestScore: "兴趣 {value}",
    interestPresetHeading: "兴趣偏好", interestPresetHint: "人设学习完成前，兴趣模型按这里判断 Bot 喜欢和不喜欢什么；每行一条。",
    presetLikes: "感兴趣", presetDislikes: "不感兴趣", presetStyle: "接话风格提示", savePreset: "保存兴趣偏好", presetSaved: "兴趣偏好已保存",
    aiSettings: "主模型", aiSettingsHint: "QQ 回复使用的模型与推理参数，保存后下一轮生效。", refreshModels: "刷新模型列表", reasoningSummary: "推理摘要",
    codexPersonality: "Codex 人格", serviceTier: "服务档位", saveAiSettings: "保存模型设置", aiSettingsSaved: "模型设置已保存", defaultTier: "默认",
    aiClaudeHint: "当前引擎是 Claude Code，模型由 CODEX_REMOTE_CONTACT_CLAUDE_MODEL 决定（当前：{model}）。这里的设置在切回 Codex 后生效。",
    modelsUnavailable: "读取模型列表失败：{error}",
    identitySettings: "身份与权限", identitySettingsHint: "名字、称呼和谁能管理 Bot；仅本机可修改。", assistantName: "Bot 名字", ownerLabel: "对主人的称呼",
    assistantMentions: "唤醒别名", commaSeparated: "用逗号分隔", ownerIds: "主人 QQ", adminIds: "管理员 QQ", idListHint: "空格或逗号分隔",
    saveIdentity: "保存身份设置", identitySaved: "身份设置已保存", identityRemoteOnly: "身份与权限只能在运行 Hub 的这台设备上修改。",
    bannedUsers: "封禁名单", noBans: "没有被封禁的人。", unban: "解除封禁", unbanned: "已解除封禁", bannedUntil: "到 {time}",
    commandPermissions: "指令开放范围", commandPermissionsHint: "打开后普通群友也能使用该指令；主人和管理员始终可用。", commandFixed: "固定",
    commandUsers: "另有 {count} 人单独授权", commandSaved: "指令权限已更新",
    commandCategoryConversation: "会话", commandCategoryIntelligence: "AI 与学习", commandCategoryGroup: "群与成员", commandCategoryOperations: "运行状态", commandCategoryAuthority: "权限",
    actionPersonaHint: "核心性格、好感度、心情与作息", actionRelationships: "好感排行", actionRelationshipsHint: "查看 Bot 和每个人的关系",
    actionTestInterest: "测试兴趣模型", actionTestInterestHint: "用已保存的兴趣模型判断一条示例消息",
    overviewPersona: "Bot 此刻", overviewPersonaHint: "心情、作息与最亲近的人", openPersona: "打开人格", overviewNoClose: "还没有亲近的人。", routineNow: "现在：{value}"
  },
  en: {
    navPersona: "Persona", personaTitle: "Persona & behavior", personaSubtitle: "Character, state, learning and proactive behavior (relationships live in Memory · People)",
    personaSections: "Persona sections", personaTabProfile: "Character", personaTabPeople: "Relationships", personaTabState: "State", personaTabLearning: "Learning", personaTabBehavior: "Behavior",
    personaCore: "Core identity", personaCoreHint: "The stable character you set; it outranks the learned persona. Every text field accepts any format.", personaEnabled: "Enabled",
    personaPreset: "Preset", personaIdentity: "Who I am", personaIdentityHint: "One line, e.g. the group's gadget nerd who grumbles but always helps",
    personaName: "Character name", personaNameHint: "Empty uses the QQ nickname", personaSelfReference: "Calls self", personaSelfReferenceHint: "e.g. I / this cat",
    personaAge: "Apparent age", personaAgeHint: "e.g. early twenties", personaGender: "Gender", personaOptional: "Optional",
    personaOccupation: "Role / occupation", personaOccupationHint: "e.g. sophomore, night-shift clerk",
    personaBackground: "Background", personaBackgroundHint: "Anything: origin, history, how they met everyone…",
    personaPersonality: "More personality", personaPersonalityHint: "Whatever the sliders cannot say, in your own words", personaQuirks: "Quirks & small habits", personaQuirksHint: "One per line, e.g. slow after staying up late",
    personaSpeech: "Speech style", personaSpeechHint: "These sliders also tune reply length and the odds of emoji, stickers and multi-message replies.",
    personaSocial: "With people", personaSocialHint: "Empty means follow the personality.", personaSocialUnset: "Follow personality",
    personaOwnerRelation: "Relationship with the owner", personaOwnerRelationHint: "e.g. childhood friends who tease each other",
    personaPreferences: "Likes & limits", personaPreferencesHint: "Also tells the interest model what the Bot likes to join.",
    personaCardText: "Character sheet", personaCardTextHint: "Card description, scenario, example dialogue… in any format (prose, W++, PList, Markdown). {{char}} / {{user}} are replaced automatically.",
    personaDescription: "Description", personaScenario: "Scenario / world", personaNotes: "Author notes", personaNotesHint: "Card system prompts and similar; they shape the character only, never safety or permissions",
    personaExamples: "Example dialogue", personaExamplesHint: "Used for tone only, never copied", personaGreeting: "Greeting", personaGreetingHint: "Never sent proactively in QQ; kept for export",
    personaLore: "Lorebook", personaLoreHint: "Details added only when a keyword comes up; constant entries are always included. Up to 48.", addLoreEntry: "Add entry",
    loreKeys: "Keywords", loreKeysHint: "Comma separated", loreComment: "Label", loreContent: "Content", loreConstant: "Constant", loreEnabled: "Enabled", loreRemove: "Remove entry", loreEmpty: "No lorebook entries yet.",
    characterCard: "Character card", characterCardHint: "Import cards from SillyTavern, RisuAI, Chub, Agnai and others (PNG / JSON / CHARX), or paste a description in any format; export the current persona as a standard card.",
    cardImportMode: "Import mode", cardModeReplace: "Replace", cardModeMerge: "Merge", cardImportFile: "Import file", cardPasteText: "Paste text",
    cardExportV2: "Export V2", cardExportV3: "Export V3", cardDialogTitle: "Import character card", cardPasteLabel: "Paste card JSON or a description in any format",
    cardPreviewAction: "Preview", cardImportAction: "Import", cardImported: "Character card imported", cardExported: "Character card exported", cardNeedPreview: "Preview first, then import.",
    cardReading: "Reading…", cardSpecLabel: "Format: {value}", cardCreatorLabel: "Creator: {value}", cardLoreLabel: "{count} lore entries", cardRestored: "Carries this project's full settings; they are restored exactly",
    cardImportedFrom: "From {value}", cardImportedAt: "imported {time}", cardWarnings: "Notes", cardModeReplaceHint: "Replace clears the current traits, speech style and other settings (affinity rules stay).", cardModeMergeHint: "Merge only overwrites the text the card provides and keeps everything else.",
    cardFilled: "Will fill: {fields}", cardTooLarge: "File too large (12 MB max)",
    languageHabits: "Language habits", languageHabitsHint: "Slang, bracketed asides, kaomoji and phrases the Bot picked up and made its own; group summaries and persona refreshes review them by real use, and the Bot can adopt or drop one while chatting.",
    habitTerm: "Expression", habitTermHint: "e.g. （bushi）", habitKind: "Kind", habitKindSlang: "Slang", habitKindSymbol: "Symbol", habitKindKaomoji: "Kaomoji", habitKindPhrase: "Phrase",
    habitScope: "Scope", habitScopeGlobal: "Global (every chat)", habitUsage: "When to use", habitAdd: "Add", habitAdded: "Language habit added", habitRemoved: "Language habit removed",
    habitNone: "No language habits yet; group summaries pick them once there is enough evidence.", habitUses: "used {count} times", habitLastUsed: "last {time}",
    habitSourceSummary: "Group summary", habitSourcePersona: "Persona refresh", habitSourceSelf: "Adopted itself", habitSourceOwner: "Added by owner", habitRemove: "Remove",
    personaSpeechHabits: "Speech habits", personaCatchphrases: "Catchphrases", personaLikes: "Likes", personaDislikes: "Dislikes", personaBoundaries: "Boundaries",
    personaBoundariesHint: "One per line, e.g. never joins personal attacks", onePerLine: "One per line",
    personaTraits: "Traits", personaTraitsHint: "50 is neutral and left out of the prompt; the further from 50, the stronger.",
    affinityRules: "Affinity rules", affinityRulesHint: "The model may only nudge affinity each turn, within a daily budget, so nobody can talk it up.",
    affinityMaxDelta: "Max change per turn", affinityDailyCap: "Daily cap per person", affinityHalfLife: "Fade half-life (days, 0 = never)", affinityOwnerFloor: "Owner floor",
    affinityReveal: "Users may see their own affinity", affinityRevealHint: "When off, /好感度 only gets a joke from ordinary users.",
    personaPreview: "Prompt preview", personaPreviewHint: "What the main model sees after saving (the relationship example uses the top person).",
    revertChanges: "Revert", savePersona: "Save persona", personaSaved: "Persona saved", presetApplied: "Applied preset: {name}", presetCustom: "Custom",
    personaPreviewEmpty: "The core personality is off or has no non-neutral settings.",
    relationships: "Affinity & relationships", relationshipsHint: "How the Bot feels about each person. Click a row to edit or lock it.",
    peopleSearch: "Search name, QQ, nickname or tags", affinityLevel: "Affinity level", sortBy: "Sort", sortAffinity: "By affinity", sortFamiliarity: "By familiarity", sortRecent: "By recent contact",
    addPerson: "Add person", personaAllLevels: "All levels", personaNoPeople: "No relationships yet. People appear here after the Bot talks with them.", noPeopleMatch: "Nobody matches.",
    personaStatHabits: "Language habits", personaStatHabitsHint: "{count} global", personaStatEdits: "{count} self-adjustments",
    selfEditTitle: "Self-adjustment", selfEditHint: "When the Bot feels something is not like it, or the persona review finds a setting contradicts how it really behaves, it may make small changes to unlocked parts (sliders move at most ±10, at most 3 changes a day in chat); boundaries can only be added. When you or an administrator tell the Bot in QQ to change its own settings, these limits do not apply.",
    selfEditLocks: "Locked from the Bot's own changes", selfEditHistory: "Recent changes", selfEditNone: "No changes yet.", selfEditRevert: "Undo", selfEditReverted: "Undone",
    selfEditSourceChat: "Bot, in chat", selfEditSourceReview: "Persona review", selfEditSourceOwner: "Owner asked", selfEditSourceAdmin: "Admin asked",
    selfEditField_traits: "Trait", selfEditField_speech: "Speech", selfEditField_social: "Social reaction", selfEditField_quirks: "Quirks", selfEditField_speechHabits: "Speech habits", selfEditField_catchphrases: "Catchphrases", selfEditField_likes: "Likes", selfEditField_dislikes: "Dislikes", selfEditField_boundaries: "Boundaries", selfEditField_identity: "Who I am", selfEditField_personality: "More personality", selfEditField_background: "Background", selfEditField_selfReference: "Calls self", selfEditField_name: "Character name", selfEditField_age: "Apparent age", selfEditField_gender: "Gender", selfEditField_occupation: "Role", selfEditField_ownerRelation: "Owner relationship", selfEditField_description: "Description", selfEditField_scenario: "Scenario", selfEditField_exampleDialogues: "Example dialogue", selfEditField_greeting: "Greeting", selfEditField_notes: "Author notes", selfEditField_preset: "Preset", selfEditField_enabled: "Core persona switch", selfEditField_lore: "Lorebook", selfEditField_affinity: "Affinity rules", selfEditField_selfEdit: "Self-adjustment settings",
    personaFilledCount: "{count} filled", personaEmptySection: "Empty",
    interestFromPersona: "Persona likes also reach the interest model:", interestFromPersonaEmpty: "No persona likes yet.", editInPersona: "Edit in persona",
    stickerPersonaHint: "Persona sticker tendency: {value} (50 is neutral)", learnedPersonaCoreNote: "It only fills in what the core persona leaves out.",
    sortMessages: "By messages", personKnowledgeLink: "Related knowledge", personNoRelation: "No affinity record yet", knowledgeHabitBadge: "Bot uses",
    affinityEnabledLabel: "Enable affinity", habitKnowledgeLink: "View this slang in the knowledge base", overviewPersonLink: "View in Memory · People",
    interactionsCount: "{count} interactions", lastSeen: "Last {time}", lockedBadge: "Locked", ownerBadge: "Owner", nicknameLabel: "Called: {value}",
    familiarity: "Familiarity", affinity: "Affinity", editPerson: "Edit relationship", personQq: "QQ", personName: "Name", personNickname: "What the Bot calls them",
    personTags: "Impression tags", personNote: "Note (shown to the model)", personLocked: "Locked", personLockedHint: "Locked values never fade and the model cannot change affinity or nickname.",
    affinityHistory: "History", noHistory: "No changes yet.", removePerson: "Delete record", save: "Save", personSaved: "Relationship saved", personRemoved: "Record deleted",
    removePersonTitle: "Delete relationship", removePersonMessage: "Delete affinity, nickname and history for {value}?", historySourceModel: "Model", historySourceOwner: "Owner", historySourceSystem: "System",
    botMood: "Current mood", botMoodHint: "Updated by the main model after each turn; it carries across chats and fades.", setMood: "Set mood", clearMood: "Clear", moodPlaceholder: "2-8 characters, e.g. sleepy",
    moodNone: "No mood recorded yet.", moodSince: "updated {time}", moodSaved: "Mood updated",
    botRoutine: "Today's routine", botRoutineHint: "Generated once a day so the Bot's availability and tone feel human.", regenerateRoutine: "Regenerate", routineNone: "No routine for today yet.",
    routineDisabled: "The routine is disabled (CODEX_REMOTE_CONTACT_QQ_DAILY_ROUTINE=0).", routineGenerating: "Generating a routine…", routineQueued: "Routine generation started; this page refreshes when it is ready.",
    innerThoughts: "Inner thoughts", innerThoughtsHint: "Visible only on this dashboard and never sent; a few are kept per conversation.", noThoughts: "No inner thoughts yet.", silentThought: "stayed silent",
    personaStatPreset: "Personality", personaStatMood: "Mood", personaStatPeople: "People known", personaStatClose: "Close or better", personaStatHostile: "Wary or worse", personaStatHostileHint: "Wary, disliked or hostile",
    judgeProviderGroupSubscription: "Subscription (local CLI login)", judgeProviderGroupApi: "API key", judgeProviderCodex: "Codex subscription", judgeProviderClaude: "Claude subscription",
    judgeEffort: "Reasoning effort", judgeAgentTimeout: "Turn timeout (ms)", judgeBaseUrl: "Endpoint URL",
    judgeHintCodex: "Uses the ChatGPT subscription of the local Codex login; each judgment starts one codex app-server (~10 s) and never blocks replies. \"default\" means the account's default model.",
    judgeHintClaude: "Uses the subscription of the local claude login (or ncc profile); each judgment starts Claude Code (~7-20 s). haiku is recommended.",
    judgeHintCustom: "Any OpenAI-compatible API; the key comes from CODEX_REMOTE_CONTACT_INTEREST_MODEL_API_KEY and the URL can only be changed on this machine.",
    judgeHintApi: "Uses the API key from the environment; times out on token silence.",
    diagJudgeSubscription: "Credential: local CLI login",
    interestTest: "Test interest model", interestTestPlaceholder: "Test message (optional)", interestTesting: "Testing… (subscription models take 10-20 s)",
    interestTestOk: "{provider} · {model} · {duration}", interestTestReply: "would reply", interestTestSilent: "would stay quiet", interestTestFailed: "Test failed: {reason}",
    interestTestDirty: "Save first; the test uses the saved settings.", interestScore: "Interest {value}",
    interestPresetHeading: "Interest preferences", interestPresetHint: "Until the persona is learned, the interest model uses these likes and dislikes. One per line.",
    presetLikes: "Interested in", presetDislikes: "Not interested in", presetStyle: "Chiming-in style hints", savePreset: "Save preferences", presetSaved: "Preferences saved",
    aiSettings: "Main model", aiSettingsHint: "Model and reasoning settings for QQ replies; applies from the next turn.", refreshModels: "Refresh models", reasoningSummary: "Reasoning summary",
    codexPersonality: "Codex personality", serviceTier: "Service tier", saveAiSettings: "Save model settings", aiSettingsSaved: "Model settings saved", defaultTier: "Default",
    aiClaudeHint: "The engine is Claude Code; its model comes from CODEX_REMOTE_CONTACT_CLAUDE_MODEL (now: {model}). These settings apply after switching back to Codex.",
    modelsUnavailable: "Could not load models: {error}",
    identitySettings: "Identity & roles", identitySettingsHint: "Names and who controls the Bot; editable only on this machine.", assistantName: "Bot name", ownerLabel: "Owner title",
    assistantMentions: "Wake aliases", commaSeparated: "Comma separated", ownerIds: "Owner QQ", adminIds: "Admin QQ", idListHint: "Space or comma separated",
    saveIdentity: "Save identity", identitySaved: "Identity saved", identityRemoteOnly: "Identity and roles can only be changed on the device running the Hub.",
    bannedUsers: "Banned users", noBans: "Nobody is banned.", unban: "Unban", unbanned: "Unbanned", bannedUntil: "until {time}",
    commandPermissions: "Command access", commandPermissionsHint: "Turn on to let ordinary members use a command; owners and admins always can.", commandFixed: "Fixed",
    commandUsers: "{count} more people granted individually", commandSaved: "Command access updated",
    commandCategoryConversation: "Conversation", commandCategoryIntelligence: "AI & learning", commandCategoryGroup: "Groups & members", commandCategoryOperations: "Operations", commandCategoryAuthority: "Authority",
    actionPersonaHint: "Core personality, affinity, mood and routine", actionRelationships: "Affinity ranking", actionRelationshipsHint: "See how the Bot feels about everyone",
    actionTestInterest: "Test interest model", actionTestInterestHint: "Judge a sample message with the saved interest model",
    overviewPersona: "Bot right now", overviewPersonaHint: "Mood, routine and closest people", openPersona: "Open persona", overviewNoClose: "Nobody close yet.", routineNow: "Now: {value}"
  }
};

const personaUi = {
  tab: "profile",
  data: null,
  admin: null,
  interestModels: null,
  dirty: false,
  presetDirty: false,
  lastFetch: { persona: 0, admin: 0, models: 0 },
  peopleQuery: "",
  peopleLevel: "all",
  peopleSort: "affinity",
  editing: null,
  routinePollUntil: 0,
  cardPayload: null,
  lore: null
};

// Relationships live in Memory → People; the persona view keeps four tabs.
const personaTabs = ["profile", "state", "learning", "behavior"];

const personaExtension = {
  views: { persona: { title: "personaTitle", subtitle: "personaSubtitle" } },
  translations: personaTranslations,
  init: personaInit,
  refresh: personaRefresh,
  render: personaRenderAll,
  renderState: personaRenderFromState,
  commands: personaCommands,
  runCommand: personaRunCommand,
  tick: personaTick,
  judgeProviderChanged: personaFillModelOptions,
  peopleMemoryModel: personaPeopleMemoryModel,
  personCardExtra: personaPersonCardExtra,
  knowledgeBadge: personaKnowledgeBadge,
  // The old "Bot behavior" view is now the Behavior tab here.
  resolveView: (view) => {
    if (view !== "intelligence") return null;
    personaUi.tab = "behavior";
    persistPersonaTab();
    return "persona";
  }
};

// ---------- Data ----------
function personaRefresh(view, { quiet = false } = {}) {
  const tasks = [];
  if (view === "persona" || view === "overview") tasks.push(refreshPersona({ quiet }));
  // Memory → People shows relationships; the knowledge list marks habit slang.
  if ((view === "memory" || view === "knowledge") && Date.now() - personaUi.lastFetch.persona > 10_000) tasks.push(refreshPersona({ quiet }));
  if (view === "settings") tasks.push(refreshAdminSettings({ quiet }));
  if (view === "persona" && Date.now() - personaUi.lastFetch.models > 60_000) tasks.push(refreshInterestModels({ quiet }));
  return tasks;
}

async function refreshPersona({ quiet = true } = {}) {
  try {
    personaUi.data = await api("/api/qq/personality", {}, { key: "persona" });
    personaUi.lastFetch.persona = Date.now();
    renderPersona();
    renderOverviewPersona();
    if (app.view === "memory" && app.activeMemoryTab === "people") renderMemory();
    if (app.view === "knowledge" && typeof renderKnowledge === "function" && app.knowledge) renderKnowledge();
  } catch (error) {
    if (error.name !== "AbortError" && !quiet) showToast(error.message, "error");
  }
}

async function refreshAdminSettings({ quiet = true, refresh = false } = {}) {
  try {
    personaUi.admin = await api(`/api/settings/admin${refresh ? "?refresh=1" : ""}`, {}, { key: "admin-settings" });
    personaUi.lastFetch.admin = Date.now();
    renderAdminSettings();
  } catch (error) {
    if (error.name !== "AbortError" && !quiet) showToast(error.message, "error");
  }
}

async function refreshInterestModels({ quiet = true, refresh = false } = {}) {
  try {
    personaUi.interestModels = await api(`/api/qq/interest-models${refresh ? "?refresh=1" : ""}`, {}, { key: "interest-models" });
    personaUi.lastFetch.models = Date.now();
    personaFillModelOptions($("#botJudgeProvider").value);
  } catch (error) {
    if (error.name !== "AbortError" && !quiet) showToast(error.message, "error");
  }
}

function personaTick(now, base) {
  if (!app.autoRefresh && now > personaUi.routinePollUntil) return;
  const due = now - personaUi.lastFetch.persona >= Math.max(base, 10_000);
  if ((app.view === "persona" || app.view === "overview") && due && !app.controllers.has("persona") && !personaUi.dirty) {
    void refreshPersona({ quiet: true });
  }
  if (app.view === "persona" && personaUi.routinePollUntil > now && now - personaUi.lastFetch.persona >= 5_000 && !app.controllers.has("persona")) {
    void refreshPersona({ quiet: true });
  }
}

// ---------- Rendering ----------
// The routine day starts at 05:00 local time, matching the Hub.
function currentRoutineSegment(routine, now = new Date()) {
  if (!routine?.segments?.length) return null;
  const anchor = new Date(now.getTime() - (now.getHours() < 5 ? 24 * 60 * 60_000 : 0));
  const day = `${anchor.getFullYear()}-${String(anchor.getMonth() + 1).padStart(2, "0")}-${String(anchor.getDate()).padStart(2, "0")}`;
  if (routine.date !== day) return null;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const toMinutes = (clock) => { const [h, m] = String(clock).split(":").map(Number); return h * 60 + m; };
  return routine.segments.find((segment) => {
    const start = toMinutes(segment.start);
    const end = toMinutes(segment.end);
    return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
  }) || null;
}

function personaRenderAll() {
  renderPersona();
  renderOverviewPersona();
  renderAdminSettings();
  renderInterestPreset();
}

function personaRenderFromState() {
  renderInterestPreset();
}

function renderPersona() {
  $$("[data-persona-tab]").forEach((button) => {
    const active = button.dataset.personaTab === personaUi.tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  $("#personaPanelProfile").hidden = personaUi.tab !== "profile";
  $$("[data-persona-form-action]").forEach((node) => { node.hidden = personaUi.tab !== "profile"; });
  $("#personaPanelState").hidden = personaUi.tab !== "state";
  $("#personaPanelLearning").hidden = personaUi.tab !== "learning";
  $("#personaPanelBehavior").hidden = personaUi.tab !== "behavior";
  const data = personaUi.data;
  if (!data) {
    setHtml($("#personaStats"), Array.from({ length: 4 }, () => `<article class="stat"><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-value"></span></article>`).join(""));
    return;
  }
  renderPersonaStats(data);
  renderPersonaProfile(data);
  renderPersonaState(data);
  renderLanguageHabits(data);
  renderPersonaLinks(data);
  setPersonaSaveState(personaUi.dirty ? "dirty" : "ok", personaUi.dirty ? "settingsUnsaved" : "settingsSynced");
}

function renderPersonaStats(data) {
  const presetName = presetLabel(data.profile.preset, data.presets);
  const close = data.people.filter((person) => ["close", "bestie"].includes(person.level)).length;
  const segment = currentRoutineSegment(data.life?.routine);
  const habits = data.languageHabits?.items || [];
  const edits = (data.profile.selfEditLog || []).filter((item) => !item.reverted);
  setHtml($("#personaStats"), [
    statCard({ label: t("personaStatPreset"), value: data.profile.enabled ? presetName : t("stateOff"), hint: data.profile.name || data.assistantName || "", tone: data.profile.enabled ? "ok" : "warn" }),
    statCard({ label: t("personaStatMood"), value: data.life?.mood?.text || "—", hint: segment ? t("routineNow", { value: segment.activity }) : data.life?.mood ? t("moodSince", { time: formatRelative(data.life.mood.at) }) : t("moodNone") }),
    statCard({ label: t("personaStatHabits"), value: formatNumber(habits.length), hint: t("personaStatHabitsHint", { count: habits.filter((item) => item.scope === "global").length }) }),
    statCard({ label: t("personaStatPeople"), value: formatNumber(data.personCount), hint: `${t("personaStatClose")} ${close}${edits.length ? ` · ${t("personaStatEdits", { count: edits.length })}` : ""}` })
  ].join(""));
}

function presetLabel(id, presets = []) {
  if (id === "custom") return t("presetCustom");
  const preset = presets.find((item) => item.id === id);
  return preset ? (app.language === "en" ? preset.labelEn : preset.label) : id;
}

function renderPersonaProfile(data) {
  const form = $("#personaForm");
  const profile = data.profile;
  setHtml($("#personaPresets"), data.presets.map((preset) => `<button type="button" class="preset-chip ${preset.id === profile.preset ? "active" : ""}" data-persona-preset="${escapeHtml(preset.id)}" aria-pressed="${preset.id === profile.preset}">${escapeHtml(app.language === "en" ? preset.labelEn : preset.label)}</button>`).join("")
    + (profile.preset === "custom" ? `<span class="preset-chip active static">${escapeHtml(t("presetCustom"))}</span>` : ""));
  const preview = [data.preview?.core, data.preview?.relationship].filter(Boolean).join("\n\n");
  $("#personaPreview").textContent = preview || t("personaPreviewEmpty");
  renderCardMeta(profile);
  renderPersonaBadges(profile);
  renderSelfEditLog(data);
  if (personaUi.dirty || form.contains(document.activeElement)) return;
  const text = (selector, value) => { $(selector).value = value || ""; };
  const lines = (selector, value) => { $(selector).value = (value || []).join("\n"); };
  $("#personaEnabled").checked = profile.enabled;
  text("#personaName", profile.name);
  text("#personaSelfReference", profile.selfReference);
  text("#personaAge", profile.age);
  text("#personaGender", profile.gender);
  text("#personaOccupation", profile.occupation);
  text("#personaIdentity", profile.identity);
  text("#personaBackground", profile.background);
  text("#personaPersonality", profile.personality);
  lines("#personaQuirks", profile.quirks);
  lines("#personaSpeechHabits", profile.speechHabits);
  lines("#personaCatchphrases", profile.catchphrases);
  lines("#personaLikes", profile.likes);
  lines("#personaDislikes", profile.dislikes);
  lines("#personaBoundaries", profile.boundaries);
  text("#personaOwnerRelation", profile.social?.ownerRelation);
  text("#personaDescription", profile.description);
  text("#personaScenario", profile.scenario);
  text("#personaNotes", profile.notes);
  text("#personaExamples", profile.exampleDialogues);
  text("#personaGreeting", profile.greeting);
  $("#selfEditEnabled").checked = profile.selfEdit?.enabled !== false;
  setHtml($("#selfEditLocks"), (data.selfEditGroups || []).map((group) => `<label class="lock-chip"><input type="checkbox" data-self-edit-lock="${escapeHtml(group.id)}" ${(profile.selfEdit?.locked || []).includes(group.id) ? "checked" : ""} /><span>${escapeHtml(app.language === "en" ? group.labelEn : group.label)}</span></label>`).join(""));
  setHtml($("#personaTraits"), renderScaleRows(data.traits, profile.traits, "trait"));
  setHtml($("#personaSpeech"), renderScaleRows(data.speech || [], profile.speech || {}, "speech"));
  setHtml($("#personaSocial"), (data.social || []).map((item) => `<label class="field"><span>${escapeHtml(app.language === "en" ? item.labelEn : item.label)}</span><select data-social="${escapeHtml(item.id)}">
    <option value="">${escapeHtml(t("personaSocialUnset"))}</option>
    ${item.options.map((entry) => `<option value="${escapeHtml(entry.id)}" ${profile.social?.[item.id] === entry.id ? "selected" : ""} title="${escapeHtml(entry.prompt)}">${escapeHtml(app.language === "en" ? entry.labelEn : entry.label)}</option>`).join("")}
  </select></label>`).join(""));
  personaUi.lore = (profile.lore || []).map((entry) => ({ ...entry, keys: [...(entry.keys || [])] }));
  renderLoreList();
}

function renderPersonaBadges(profile) {
  const filled = ["description", "scenario", "exampleDialogues", "notes", "greeting"].filter((key) => profile[key]).length;
  $("#personaCardBadge").textContent = filled ? t("personaFilledCount", { count: filled }) : t("personaEmptySection");
  $("#personaLoreBadge").textContent = String((profile.lore || []).length);
}

function renderSelfEditLog(data) {
  const sourceLabel = { chat: "selfEditSourceChat", review: "selfEditSourceReview", owner: "selfEditSourceOwner", admin: "selfEditSourceAdmin" };
  const fieldLabel = (entry) => {
    const scales = [...(data.traits || []), ...(data.speech || [])];
    const scale = scales.find((item) => item.id === entry.key);
    const social = (data.social || []).find((item) => item.id === entry.key);
    const named = scale || social;
    return named ? (app.language === "en" ? named.labelEn : named.label) : t(`selfEditField_${entry.field}`);
  };
  const describe = (entry) => entry.op === "add" ? `+ ${entry.after}` : entry.op === "remove" ? `− ${entry.before}` : `${entry.before === "" ? "—" : entry.before} → ${entry.after === "" ? "—" : entry.after}`;
  const log = (data.profile.selfEditLog || []).slice().reverse().slice(0, 12);
  setHtml($("#selfEditLog"), log.length
    ? log.map((entry) => `<li class="${entry.reverted ? "muted" : ""}"><time>${escapeHtml(formatRelative(entry.at))}</time><strong>${escapeHtml(fieldLabel(entry))}</strong><span>${escapeHtml(describe(entry))}${entry.reason ? ` · ${escapeHtml(entry.reason)}` : ""}</span><em>${escapeHtml(t(sourceLabel[entry.source] || "selfEditSourceChat"))}${entry.reverted ? ` · ${escapeHtml(t("selfEditReverted"))}` : ""}</em>${!entry.reverted && entry.revertable !== false ? `<button type="button" class="button small ghost" data-revert-self-edit="${escapeHtml(entry.id)}">${escapeHtml(t("selfEditRevert"))}</button>` : ""}</li>`).join("")
    : `<li class="muted">${escapeHtml(t("selfEditNone"))}</li>`);
}

// ---------- Links between pages ----------
function renderPersonaLinks(data) {
  const profile = data.profile;
  const likes = profile.likes || [];
  const dislikes = profile.dislikes || [];
  setHtml($("#interestPersonaLink"), `<span>${escapeHtml(t("interestFromPersona"))}</span>
    ${likes.length ? likes.slice(0, 10).map((item) => `<span class="chip ok">${escapeHtml(item)}</span>`).join("") : ""}
    ${dislikes.length ? dislikes.slice(0, 10).map((item) => `<span class="chip warn">${escapeHtml(item)}</span>`).join("") : ""}
    ${likes.length || dislikes.length ? "" : `<span class="muted">${escapeHtml(t("interestFromPersonaEmpty"))}</span>`}
    <button type="button" class="button small ghost" data-persona-goto="profile">${escapeHtml(t("editInPersona"))}</button>`);
  const sticker = Number(profile.speech?.sticker ?? 50);
  setHtml($("#stickerPersonaHint"), `${escapeHtml(t("stickerPersonaHint", { value: sticker }))} <button type="button" class="link-button" data-persona-goto="profile">${escapeHtml(t("editInPersona"))}</button>`);
}

function goToPersonaTab(tab) {
  personaUi.tab = personaTabs.includes(tab) ? tab : "profile";
  persistPersonaTab();
  setView("persona", { focus: true });
  renderPersona();
}

function goToMemoryPeople(query = "") {
  app.activeMemoryTab = "people";
  if (query) {
    app.memoryQuery = query;
    $("#memorySearch").value = query;
  }
  persistDashboardUiState();
  setView("memory", { focus: true });
}

function goToKnowledge(query = "") {
  app.knowledgeQuery = query;
  $("#knowledgeSearch").value = query;
  persistDashboardUiState();
  setView("knowledge", { focus: true });
}

// Memory → People merges relationship records into the person cards.
function personaPeopleMemoryModel(memoryPeople) {
  const data = personaUi.data;
  if (!data) return null;
  const relations = new Map((data.people || []).map((person) => [person.userId, person]));
  const seen = new Set();
  const people = memoryPeople.map((person) => {
    seen.add(String(person.userId));
    return { ...person, relation: relations.get(String(person.userId)) || null };
  });
  for (const relation of data.people || []) {
    if (!seen.has(relation.userId)) people.push({ userId: relation.userId, displayName: relation.name || "", relation, relationOnly: true });
  }
  const levelOf = (person) => person.relation?.level || "neutral";
  const close = people.filter((person) => ["close", "bestie"].includes(levelOf(person))).length;
  const cold = people.filter((person) => ["hostile", "cold", "wary"].includes(levelOf(person))).length;
  const total = Math.max(1, people.filter((person) => person.relation).length);
  const distribution = (data.levels || []).map((level) => {
    const count = people.filter((person) => person.relation && person.relation.level === level.id).length;
    return count ? `<span class="level-${escapeHtml(level.id)}" data-flex="${Math.max(1, Math.round((count / total) * 100))}" title="${escapeHtml(levelName(level))} ${count}"><em>${escapeHtml(levelName(level))} ${count}</em></span>` : "";
  }).join("");
  const sorters = {
    affinity: (a, b) => (b.relation?.affinity ?? -999) - (a.relation?.affinity ?? -999),
    familiarity: (a, b) => (b.relation?.familiarity ?? -1) - (a.relation?.familiarity ?? -1),
    recent: (a, b) => Date.parse(b.relation?.lastInteractionAt || b.updatedAt || 0) - Date.parse(a.relation?.lastInteractionAt || a.updatedAt || 0),
    messages: (a, b) => Number(b.messageCount || 0) - Number(a.messageCount || 0)
  };
  requestAnimationFrame(() => {
    $$("[data-flex]", $("#memoryView")).forEach((node) => { node.style.flexGrow = node.dataset.flex; });
    $$("[data-position]", $("#memoryView")).forEach((node) => { node.style.left = `${node.dataset.position}%`; });
  });
  return {
    people,
    filter: (person) => personaUi.peopleLevel === "all" || levelOf(person) === personaUi.peopleLevel,
    sort: sorters[personaUi.peopleSort] || sorters.affinity,
    searchText: (person) => [person.relation?.nickname, ...(person.relation?.tags || []), person.relation?.note].filter(Boolean).join(" "),
    metrics: [
      { label: t("peopleTotal"), value: formatNumber(people.length), icon: icons.channels },
      { label: t("personaStatClose"), value: formatNumber(close), icon: icons.shieldCheck },
      { label: t("personaStatHostile"), value: formatNumber(cold), icon: icons.pulse },
      { label: t("peopleWithAvatar"), value: formatNumber(people.filter((person) => person.avatar?.imageId).length), icon: icons.knowledge }
    ],
    toolbar: `<div class="people-relations">
      ${distribution ? `<div class="affinity-distribution" aria-hidden="true">${distribution}</div>` : ""}
      <div class="toolbar people-toolbar">
        <select data-people-level aria-label="${escapeHtml(t("affinityLevel"))}"><option value="all">${escapeHtml(t("personaAllLevels"))}</option>${(data.levels || []).map((level) => `<option value="${escapeHtml(level.id)}" ${personaUi.peopleLevel === level.id ? "selected" : ""}>${escapeHtml(levelName(level))}</option>`).join("")}</select>
        <select data-people-sort aria-label="${escapeHtml(t("sortBy"))}">${["affinity", "familiarity", "recent", "messages"].map((id) => `<option value="${id}" ${personaUi.peopleSort === id ? "selected" : ""}>${escapeHtml(t({ affinity: "sortAffinity", familiarity: "sortFamiliarity", recent: "sortRecent", messages: "sortMessages" }[id]))}</option>`).join("")}</select>
        <span class="grow"></span>
        <button type="button" class="button small ghost" data-affinity-rules>${escapeHtml(t("affinityRules"))}${data.profile.affinity.enabled ? "" : ` · ${escapeHtml(t("stateOff"))}`}</button>
        <button type="button" class="button small ghost" data-add-person>${escapeHtml(t("addPerson"))}</button>
      </div>
    </div>`
  };
}

function personaPersonCardExtra(person) {
  const relation = person.relation;
  const links = `<button type="button" class="link-button" data-people-knowledge="${escapeHtml(person.userId)}">${escapeHtml(t("personKnowledgeLink"))}</button>`;
  if (!relation) {
    return `<section class="person-section person-relation"><span class="muted small-text">${escapeHtml(t("personNoRelation"))}</span><div class="person-relation-actions">${links}<button type="button" class="button small ghost" data-edit-person="${escapeHtml(person.userId)}">${escapeHtml(t("editPerson"))}</button></div></section>`;
  }
  const level = levelFor(relation.affinity);
  const position = Math.round(((relation.affinity + 100) / 200) * 100);
  return `<section class="person-section person-relation">
    <div class="person-relation-head">
      <span class="level-chip level-${escapeHtml(level.id)}">${escapeHtml(levelName(level))} ${relation.affinity > 0 ? "+" : ""}${escapeHtml(relation.affinity)}</span>
      <span class="chip">${escapeHtml(t("familiarity"))} ${escapeHtml(relation.familiarityLabel)}</span>
      ${relation.isOwner ? `<span class="badge ok">${escapeHtml(t("ownerBadge"))}</span>` : ""}
      ${relation.locked ? `<span class="badge off">${escapeHtml(t("lockedBadge"))}</span>` : ""}
    </div>
    <span class="affinity-meter" aria-hidden="true"><i data-position="${position}"></i></span>
    <span class="person-meta">${escapeHtml([
      t("interactionsCount", { count: formatNumber(relation.interactions) }),
      relation.lastInteractionAt ? t("lastSeen", { time: formatRelative(relation.lastInteractionAt) }) : "",
      relation.nickname ? t("nicknameLabel", { value: relation.nickname }) : ""
    ].filter(Boolean).join(" · "))}</span>
    ${relation.tags?.length ? `<span class="chip-row">${relation.tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join("")}</span>` : ""}
    ${relation.note ? `<p class="person-detail">${escapeHtml(relation.note)}</p>` : ""}
    <div class="person-relation-actions">${links}<button type="button" class="button small ghost" data-edit-person="${escapeHtml(person.userId)}">${escapeHtml(t("editPerson"))}</button></div>
  </section>`;
}

function personaKnowledgeBadge(entry) {
  if (entry?.kind !== "slang") return "";
  const habits = personaUi.data?.languageHabits?.items || [];
  return habits.some((item) => item.term === entry.title) ? `<span class="kind-tag habit">${escapeHtml(t("knowledgeHabitBadge"))}</span>` : "";
}

function openAffinityDialog() {
  const rules = personaUi.data?.profile?.affinity;
  if (!rules) return;
  $("#affinityEnabled").checked = rules.enabled;
  $("#affinityMaxDelta").value = rules.maxDeltaPerTurn;
  $("#affinityDailyCap").value = rules.dailyCapPerPerson;
  $("#affinityHalfLife").value = rules.halfLifeDays;
  $("#affinityOwnerFloor").value = rules.ownerFloor;
  $("#affinityReveal").checked = rules.revealToUsers;
  $("#affinityDialog").showModal();
}

async function saveAffinityRules(control) {
  const affinity = {
    enabled: $("#affinityEnabled").checked,
    maxDeltaPerTurn: Number($("#affinityMaxDelta").value),
    dailyCapPerPerson: Number($("#affinityDailyCap").value),
    halfLifeDays: Number($("#affinityHalfLife").value),
    ownerFloor: Number($("#affinityOwnerFloor").value),
    revealToUsers: $("#affinityReveal").checked
  };
  try {
    personaUi.data = await mutate(() => api("/api/qq/personality", { method: "POST", body: JSON.stringify({ profile: { affinity } }) }), { control, success: t("personaSaved"), busyKey: "persona" });
    $("#affinityDialog").close();
    renderPersona();
    renderMemory();
  } catch {
    // mutate already showed the error.
  }
}

function renderScaleRows(definitions, values, kind) {
  return definitions.map((item) => {
    const value = Number(values?.[item.id] ?? 50);
    return `<label class="trait-row">
      <span class="trait-head"><strong>${escapeHtml(app.language === "en" ? item.labelEn : item.label)}</strong><output class="mono" data-scale-value="${escapeHtml(kind)}:${escapeHtml(item.id)}">${value}</output></span>
      <input type="range" min="0" max="100" step="1" value="${value}" data-${kind}="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.label)}" />
      <small data-scale-text="${escapeHtml(kind)}:${escapeHtml(item.id)}">${escapeHtml(describeTrait(item, value))}</small>
    </label>`;
  }).join("");
}

function renderLoreList() {
  const entries = personaUi.lore || [];
  setHtml($("#personaLoreList"), entries.length ? entries.map((entry, index) => `<article class="lore-entry" data-lore-index="${index}">
    <div class="lore-entry-head">
      <label class="field"><span>${escapeHtml(t("loreKeys"))}</span><input data-lore-field="keys" value="${escapeHtml((entry.keys || []).join(", "))}" placeholder="${escapeHtml(t("loreKeysHint"))}" maxlength="200" /></label>
      <label class="field"><span>${escapeHtml(t("loreComment"))}</span><input data-lore-field="comment" value="${escapeHtml(entry.comment || "")}" maxlength="60" /></label>
      <label class="switch-label"><span class="switch small"><input type="checkbox" data-lore-field="constant" ${entry.constant ? "checked" : ""} /><span aria-hidden="true"></span></span><em>${escapeHtml(t("loreConstant"))}</em></label>
      <label class="switch-label"><span class="switch small"><input type="checkbox" data-lore-field="enabled" ${entry.enabled !== false ? "checked" : ""} /><span aria-hidden="true"></span></span><em>${escapeHtml(t("loreEnabled"))}</em></label>
      <button type="button" class="icon-button" data-remove-lore="${index}" aria-label="${escapeHtml(t("loreRemove"))}">×</button>
    </div>
    <label class="field"><span class="sr-only">${escapeHtml(t("loreContent"))}</span><textarea data-lore-field="content" rows="2" maxlength="800" placeholder="${escapeHtml(t("loreContent"))}">${escapeHtml(entry.content || "")}</textarea></label>
  </article>`).join("") : `<p class="token-empty">${escapeHtml(t("loreEmpty"))}</p>`);
}

function readLoreEntry(node) {
  return {
    keys: $("[data-lore-field=keys]", node).value.split(/[,，、]+/).map((item) => item.trim()).filter(Boolean),
    comment: $("[data-lore-field=comment]", node).value.trim(),
    content: $("[data-lore-field=content]", node).value.trim(),
    constant: $("[data-lore-field=constant]", node).checked,
    enabled: $("[data-lore-field=enabled]", node).checked
  };
}

// Saved lore drops entries without content.
function collectLore() {
  return $$(".lore-entry", $("#personaLoreList")).map(readLoreEntry).filter((entry) => entry.content);
}

function renderCardMeta(profile) {
  const card = profile.card || {};
  const chips = [
    card.spec ? t("cardSpecLabel", { value: card.spec.toUpperCase() }) : "",
    card.sourceName ? t("cardImportedFrom", { value: card.sourceName }) : "",
    card.creator ? t("cardCreatorLabel", { value: card.creator }) : "",
    card.importedAt ? t("cardImportedAt", { time: formatRelative(card.importedAt) }) : "",
    ...(card.tags || []).slice(0, 8)
  ].filter(Boolean);
  setHtml($("#cardMeta"), chips.map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`).join("")
    + `<span class="muted small-text">${escapeHtml(t($("#cardImportMode").value === "merge" ? "cardModeMergeHint" : "cardModeReplaceHint"))}</span>`);
}

function describeTrait(trait, value) {
  if (value <= 20) return trait.low[0];
  if (value <= 38) return trait.low[1];
  if (value >= 80) return trait.high[1];
  if (value >= 62) return trait.high[0];
  return app.language === "en" ? "Neutral — not mentioned in the prompt" : "中性，不写入提示词";
}

function collectPersonaProfile() {
  const lines = (selector) => $(selector).value.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  const value = (selector) => $(selector).value.trim();
  const scales = (attribute) => {
    const result = {};
    $$(`[data-${attribute}]`).forEach((input) => { result[input.dataset[attribute]] = Number(input.value); });
    return result;
  };
  const social = { ownerRelation: value("#personaOwnerRelation") };
  $$("[data-social]").forEach((select) => { social[select.dataset.social] = select.value; });
  return {
    enabled: $("#personaEnabled").checked,
    name: value("#personaName"),
    selfReference: value("#personaSelfReference"),
    age: value("#personaAge"),
    gender: value("#personaGender"),
    occupation: value("#personaOccupation"),
    identity: value("#personaIdentity"),
    background: value("#personaBackground"),
    personality: value("#personaPersonality"),
    quirks: lines("#personaQuirks"),
    speechHabits: lines("#personaSpeechHabits"),
    catchphrases: lines("#personaCatchphrases"),
    likes: lines("#personaLikes"),
    dislikes: lines("#personaDislikes"),
    boundaries: lines("#personaBoundaries"),
    description: value("#personaDescription"),
    scenario: value("#personaScenario"),
    notes: value("#personaNotes"),
    exampleDialogues: value("#personaExamples"),
    greeting: value("#personaGreeting"),
    lore: collectLore(),
    traits: scales("trait"),
    speech: scales("speech"),
    social,
    selfEdit: {
      enabled: $("#selfEditEnabled").checked,
      locked: $$("[data-self-edit-lock]").filter((input) => input.checked).map((input) => input.dataset.selfEditLock)
    }
  };
}

// Editing anything a preset owns turns the preset into "custom".
function presetFieldsChanged(profile, next) {
  const differs = (left = {}, right = {}) => Object.keys(right).some((key) => String(left?.[key] ?? "") !== String(right[key] ?? ""));
  const { ownerRelation, ...social } = next.social;
  const { ownerRelation: _previous, ...currentSocial } = profile.social || {};
  return differs(profile.traits, next.traits)
    || differs(profile.speech, next.speech)
    || differs(currentSocial, social)
    || (profile.quirks || []).join("\n") !== next.quirks.join("\n")
    || (profile.speechHabits || []).join("\n") !== next.speechHabits.join("\n")
    || (profile.identity || "") !== next.identity;
}

async function savePersona(control) {
  if (!personaUi.data) return;
  const profile = collectPersonaProfile();
  const body = { profile: { ...profile, preset: presetFieldsChanged(personaUi.data.profile, profile) ? "custom" : personaUi.data.profile.preset } };
  setPersonaSaveState("saving", "settingsSaving");
  try {
    personaUi.data = await mutate(() => api("/api/qq/personality", { method: "POST", body: JSON.stringify(body) }), { control, success: t("personaSaved"), busyKey: "persona" });
    personaUi.dirty = false;
    renderPersona();
  } catch {
    setPersonaSaveState("error", "settingsSaveFailed");
  }
}

async function applyPersonaPreset(id, control) {
  if (personaUi.dirty && !(await confirmAction(t("personaPreset"), t("settingsUnsaved")))) return;
  try {
    personaUi.data = await mutate(() => api("/api/qq/personality", { method: "POST", body: JSON.stringify({ preset: id }) }), {
      control,
      success: t("presetApplied", { name: presetLabel(id, personaUi.data?.presets || []) }),
      busyKey: "persona"
    });
    personaUi.dirty = false;
    renderPersona();
  } catch {
    // mutate already showed the error.
  }
}

// ---------- Character cards ----------
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").replace(/^data:[^,]*,/, ""));
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

async function importCardFile(file) {
  if (!file) return;
  if (file.size > 12 * 1024 * 1024) { showToast(t("cardTooLarge"), "error"); return; }
  personaUi.cardPayload = { data: await readFileAsBase64(file), fileName: file.name };
  openCardDialog({ paste: false });
  await previewCard();
}

function openCardDialog({ paste = true } = {}) {
  if (paste) personaUi.cardPayload = null;
  $("#cardTextField").hidden = !paste;
  if (paste) $("#cardTextInput").value = "";
  setHtml($("#cardPreview"), paste ? "" : `<p class="muted">${escapeHtml(t("cardReading"))}</p>`);
  $("#cardDialog").showModal();
  if (paste) requestAnimationFrame(() => $("#cardTextInput").focus());
}

function currentCardPayload() {
  if (!$("#cardTextField").hidden) {
    const text = $("#cardTextInput").value;
    return text.trim() ? { text, fileName: "" } : null;
  }
  return personaUi.cardPayload;
}

async function previewCard(control) {
  const payload = currentCardPayload();
  if (!payload) return null;
  try {
    const result = await api("/api/qq/personality/card", { method: "POST", body: JSON.stringify({ ...payload, action: "preview", mode: $("#cardImportMode").value }) });
    personaUi.cardPayload = payload;
    renderCardPreview(result);
    return result;
  } catch (error) {
    setHtml($("#cardPreview"), `<p class="test-result bad">${escapeHtml(error.message)}</p>`);
    if (control) control.focus();
    return null;
  }
}

function renderCardPreview(result) {
  const profile = result.profile || {};
  const card = result.card || {};
  const labels = {
    name: t("personaName"), description: t("personaDescription"), personality: t("personaPersonality"), scenario: t("personaScenario"),
    exampleDialogues: t("personaExamples"), greeting: t("personaGreeting"), notes: t("personaNotes")
  };
  const filled = Object.keys(labels).filter((key) => profile[key]).map((key) => labels[key]);
  if (profile.lore?.length) filled.push(t("cardLoreLabel", { count: profile.lore.length }));
  setHtml($("#cardPreview"), `<article class="info-block">
    <div class="info-block-head"><strong>${escapeHtml(card.name || profile.name || "—")}</strong><small>${escapeHtml([card.spec ? t("cardSpecLabel", { value: String(card.spec).toUpperCase() }) : "", card.creator ? t("cardCreatorLabel", { value: card.creator }) : ""].filter(Boolean).join(" · "))}</small></div>
    ${card.tags?.length ? `<div class="chip-row">${card.tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
    <p>${escapeHtml(t("cardFilled", { fields: filled.join("、") || "—" }))}</p>
    ${card.restoredSettings ? `<p class="muted small-text">${escapeHtml(t("cardRestored"))}</p>` : ""}
    ${profile.description ? `<p class="persona-quote">${escapeHtml(profile.description.slice(0, 280))}${profile.description.length > 280 ? "…" : ""}</p>` : ""}
    ${result.warnings?.length ? `<h4>${escapeHtml(t("cardWarnings"))}</h4><ul class="plain-list">${result.warnings.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
    <p class="muted small-text">${escapeHtml(t($("#cardImportMode").value === "merge" ? "cardModeMergeHint" : "cardModeReplaceHint"))}</p>
  </article>`);
}

async function importCard(control) {
  const payload = currentCardPayload();
  if (!payload) return;
  if (!personaUi.cardPayload || personaUi.cardPayload !== payload && !$("#cardTextField").hidden) {
    const preview = await previewCard(control);
    if (!preview) return;
    showToast(t("cardNeedPreview"));
    return;
  }
  try {
    personaUi.data = await mutate(() => api("/api/qq/personality/card", { method: "POST", body: JSON.stringify({ ...payload, action: "import", mode: $("#cardImportMode").value }) }), { control, success: t("cardImported"), busyKey: "persona" });
    personaUi.dirty = false;
    personaUi.cardPayload = null;
    $("#cardDialog").close();
    renderPersona();
  } catch {
    // mutate already showed the error.
  }
}

async function exportCard(spec, control) {
  control.disabled = true;
  try {
    const card = await api(`/api/qq/personality/card?spec=${spec}`);
    const blob = new Blob([JSON.stringify(card, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    const name = String(card.data?.name || "character").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 60) || "character";
    link.href = URL.createObjectURL(blob);
    link.download = `${name}.${spec}.json`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    showToast(t("cardExported"), "success");
  } catch (error) {
    showToast(error.message, "error");
  } finally {
    control.disabled = false;
  }
}

// ---------- Language habits ----------
function renderLanguageHabits(data) {
  const habits = data.languageHabits || { items: [] };
  const names = habits.scopeNames || {};
  const items = habits.items || [];
  $("#languageHabitCount").textContent = String(items.length);
  const groups = new Map();
  for (const item of items) {
    const list = groups.get(item.scope) || [];
    list.push(item);
    groups.set(item.scope, list);
  }
  const kindLabel = { slang: "habitKindSlang", symbol: "habitKindSymbol", kaomoji: "habitKindKaomoji", phrase: "habitKindPhrase" };
  const sourceLabel = { summary: "habitSourceSummary", persona: "habitSourcePersona", self: "habitSourceSelf", owner: "habitSourceOwner" };
  const scopeName = (scope) => scope === "global" ? t("habitScopeGlobal") : (names[scope] || scope);
  setHtml($("#languageHabitList"), items.length ? [...groups.entries()]
    .sort(([left], [right]) => (left === "global" ? -1 : right === "global" ? 1 : left.localeCompare(right)))
    .map(([scope, list]) => `<section class="habit-group"><h4>${escapeHtml(scopeName(scope))}</h4>${list.map((item) => `<div class="habit-row">
      ${item.kind === "slang" ? `<button type="button" class="habit-term link" data-habit-knowledge="${escapeHtml(item.term)}" title="${escapeHtml(t("habitKnowledgeLink"))}">${escapeHtml(item.term)}</button>` : `<span class="habit-term">${escapeHtml(item.term)}</span>`}
      <span class="habit-copy"><small>${escapeHtml([t(kindLabel[item.kind] || "habitKindSlang"), t(sourceLabel[item.source] || "habitSourceSummary"), t("habitUses", { count: item.uses || 0 }), item.lastUsedAt ? t("habitLastUsed", { time: formatRelative(item.lastUsedAt) }) : ""].filter(Boolean).join(" · "))}</small>${item.usage ? `<span>${escapeHtml(item.usage)}</span>` : ""}</span>
      <button type="button" class="icon-button" data-remove-habit="${escapeHtml(item.id)}" aria-label="${escapeHtml(t("habitRemove"))} ${escapeHtml(item.term)}">×</button>
    </div>`).join("")}</section>`).join("") : emptyState(t("habitNone")));
  const select = $("#habitScope");
  const current = select.value || "global";
  const scopes = new Set(["global", ...Object.keys(names), ...(app.state?.qq?.allowedGroups || []).map(String)]);
  select.innerHTML = [...scopes].map((scope) => `<option value="${escapeHtml(scope)}">${escapeHtml(scope === "global" ? t("habitScopeGlobal") : (names[scope] || t("groupLabel", { value: scope })))}</option>`).join("");
  select.value = scopes.has(current) ? current : "global";
}

function setPersonaSaveState(status, key) {
  const node = $("#personaSaveState");
  node.className = `save-state ${status === "ok" ? "" : status}`;
  node.textContent = t(key);
}

function levelFor(score, levels = personaUi.data?.levels || []) {
  let level = levels[0] || { id: "neutral", label: "普通", labelEn: "Neutral" };
  for (const item of levels) if (score >= item.min) level = item;
  return level;
}

function levelName(level) {
  return app.language === "en" ? level.labelEn : level.label;
}

function openPersonDialog(userId = "") {
  const person = personaUi.data?.people.find((item) => item.userId === userId) || null;
  personaUi.editing = person ? person.userId : "";
  $("#personUserId").value = person?.userId || "";
  $("#personUserId").readOnly = Boolean(person);
  $("#personName").value = person?.name || "";
  $("#personAffinity").value = Math.round(person?.storedAffinity ?? person?.affinity ?? 0);
  $("#personNickname").value = person?.nickname || "";
  $("#personTags").value = (person?.tags || []).join(", ");
  $("#personNote").value = person?.note || "";
  $("#personLocked").checked = Boolean(person?.locked);
  $("#removePerson").hidden = !person;
  updatePersonAffinityLabel();
  const history = person?.history || [];
  setHtml($("#personHistory"), history.length
    ? history.slice().reverse().map((item) => `<li><time>${escapeHtml(formatTime(item.at))}</time><strong class="${item.delta >= 0 ? "delta-up" : "delta-down"}">${item.delta > 0 ? "+" : ""}${escapeHtml(item.delta)}</strong><span>${escapeHtml(item.reason || "—")}</span><em>${escapeHtml(t({ model: "historySourceModel", owner: "historySourceOwner" }[item.source] || "historySourceSystem"))}${item.scopeId ? ` · ${escapeHtml(item.scopeId)}` : ""}</em></li>`).join("")
    : `<li class="muted">${escapeHtml(t("noHistory"))}</li>`);
  $("#personDialog").showModal();
}

function updatePersonAffinityLabel() {
  const value = Number($("#personAffinity").value);
  $("#personAffinityValue").textContent = value > 0 ? `+${value}` : String(value);
  const level = levelFor(value);
  const label = $("#personAffinityLevel");
  label.textContent = levelName(level);
  label.className = `level-chip level-${level.id}`;
}

async function savePerson(control) {
  const form = $("#personForm");
  if (!form.reportValidity()) return;
  const userId = $("#personUserId").value.trim();
  const original = personaUi.data?.people.find((item) => item.userId === userId) || null;
  const body = {
    userId,
    name: $("#personName").value.trim(),
    nickname: $("#personNickname").value.trim(),
    tags: $("#personTags").value.split(/[,，、]+/).map((item) => item.trim()).filter(Boolean),
    note: $("#personNote").value.trim(),
    locked: $("#personLocked").checked
  };
  const affinity = Number($("#personAffinity").value);
  if (!original || Math.round(original.storedAffinity ?? original.affinity) !== affinity) body.affinity = affinity;
  try {
    personaUi.data = await mutate(() => api("/api/qq/personality/person", { method: "POST", body: JSON.stringify(body) }), { control, success: t("personSaved"), busyKey: "persona" });
    $("#personDialog").close();
    renderPersona();
    renderMemory();
  } catch {
    // mutate already showed the error.
  }
}

async function removePerson(control) {
  const userId = $("#personUserId").value.trim();
  if (!userId || !(await confirmAction(t("removePersonTitle"), t("removePersonMessage", { value: userId })))) return;
  try {
    personaUi.data = await mutate(() => api("/api/qq/personality/person", { method: "POST", body: JSON.stringify({ userId, action: "remove" }) }), { control, success: t("personRemoved"), busyKey: "persona" });
    $("#personDialog").close();
    renderPersona();
    renderMemory();
  } catch {
    // mutate already showed the error.
  }
}

function renderPersonaState(data) {
  const life = data.life || {};
  setHtml($("#moodCurrent"), life.mood
    ? `<strong>${escapeHtml(life.mood.text)}</strong><span>${escapeHtml(t("moodSince", { time: formatRelative(life.mood.at) }))}</span>`
    : `<span class="muted">${escapeHtml(t("moodNone"))}</span>`);
  const regenerate = $("#regenerateRoutine");
  regenerate.disabled = !life.routineEnabled || life.routineGenerating || !isLoopbackBrowser();
  if (!life.routineEnabled) {
    setHtml($("#routineTimeline"), emptyState(t("routineDisabled")));
  } else if (life.routineGenerating && !life.routine) {
    setHtml($("#routineTimeline"), emptyState(t("routineGenerating")));
  } else if (!life.routine?.segments?.length) {
    setHtml($("#routineTimeline"), emptyState(t("routineNone")));
  } else {
    const active = currentRoutineSegment(life.routine);
    setHtml($("#routineTimeline"), `<p class="muted small-text">${escapeHtml(life.routine.date)}${life.routineGenerating ? ` · ${escapeHtml(t("routineGenerating"))}` : ""}</p>` + life.routine.segments.map((segment) => {
      const current = active === segment;
      return `<div class="routine-item ${current ? "current" : ""}"><time class="mono">${escapeHtml(segment.start)}–${escapeHtml(segment.end)}</time><span><strong>${escapeHtml(segment.activity)}</strong>${segment.state ? `<small>${escapeHtml(segment.state)}</small>` : ""}</span></div>`;
    }).join(""));
  }
  const thoughts = (life.thoughts || []).slice().reverse();
  setHtml($("#innerThoughts"), thoughts.length
    ? thoughts.map((thought) => `<article class="thought"><header><code>${escapeHtml(thought.scopeId)}</code><time>${escapeHtml(formatRelative(thought.at))}</time></header><p>${escapeHtml(thought.text)}</p>${thought.mood || thought.silent ? `<footer>${thought.mood ? `<span class="chip">${escapeHtml(thought.mood)}</span>` : ""}${thought.silent ? `<span class="chip warn">${escapeHtml(t("silentThought"))}</span>` : ""}</footer>` : ""}</article>`).join("")
    : emptyState(t("noThoughts")));
}

function renderOverviewPersona() {
  const node = $("#overviewPersona");
  if (!node) return;
  const data = personaUi.data;
  if (!data) { setHtml(node, `<span class="skeleton skeleton-line"></span>`); return; }
  const life = data.life || {};
  const segment = currentRoutineSegment(life.routine);
  const close = data.people.filter((person) => !person.isOwner).slice(0, 4);
  setHtml(node, `
    <div class="overview-persona-head">
      <span class="mood-bubble">${escapeHtml(life.mood?.text || "—")}</span>
      <span class="muted small-text">${escapeHtml(presetLabel(data.profile.preset, data.presets))}${segment ? ` · ${escapeHtml(t("routineNow", { value: segment.activity }))}` : ""}</span>
    </div>
    ${close.length ? `<ul class="overview-people">${close.map((person) => `<li><button type="button" class="overview-person" data-memory-people="${escapeHtml(person.userId)}" title="${escapeHtml(t("overviewPersonLink"))}"><span class="person-avatar small level-${escapeHtml(person.level)}" aria-hidden="true">${escapeHtml(initial(person.name || person.userId))}</span><span>${escapeHtml(person.nickname || person.name || person.userId)}</span><span class="level-chip level-${escapeHtml(person.level)}">${escapeHtml(levelName(levelFor(person.affinity, data.levels)))}</span></button></li>`).join("")}</ul>` : `<p class="muted small-text">${escapeHtml(t("overviewNoClose"))}</p>`}`);
}

// ---------- Interest model ----------
function personaFillModelOptions(provider) {
  const list = $("#botJudgeModelOptions");
  if (!list) return;
  const models = personaUi.interestModels;
  let options = [];
  if (provider === "codex") options = ["default", ...(models?.codexModels || []).map((item) => item.model)];
  else if (provider === "claude") options = models?.claudeModels || ["haiku", "sonnet", "opus"];
  else {
    const definition = (app.state?.qq?.interestSettings?.providers || []).find((item) => item.id === provider);
    if (definition?.defaultModel) options = [definition.defaultModel];
  }
  list.innerHTML = [...new Set(options)].map((model) => `<option value="${escapeHtml(model)}"></option>`).join("");
  syncJudgeEffortOptions(provider);
}

// Codex models publish their supported efforts; offer only those.
function syncJudgeEffortOptions(provider = $("#botJudgeProvider").value) {
  const select = $("#botJudgeEffort");
  const current = select.value || app.state?.qq?.interestSettings?.reasoningEffort || "low";
  let efforts = ["minimal", "low", "medium", "high"];
  if (provider === "claude") efforts = ["low", "medium", "high"];
  if (provider === "codex") {
    const typed = $("#botJudgeModel").value.trim();
    const catalog = personaUi.interestModels?.codexModels || [];
    const model = catalog.find((item) => item.model === typed) || (typed === "default" || !typed ? catalog.find((item) => item.isDefault) : null);
    const supported = (model?.supportedReasoningEfforts || []).filter((effort) => efforts.includes(effort));
    if (supported.length) efforts = supported;
  }
  select.innerHTML = efforts.map((effort) => `<option value="${escapeHtml(effort)}">${escapeHtml(effort)}</option>`).join("");
  select.value = efforts.includes(current) ? current : (efforts.includes("low") ? "low" : efforts[0]);
}

async function testInterestModel(control) {
  const result = $("#interestTestResult");
  if (app.dirtyForms.has("botSettingsForm")) {
    result.hidden = false;
    result.className = "test-result warn";
    result.textContent = t("interestTestDirty");
    return;
  }
  result.hidden = false;
  result.className = "test-result busy";
  result.textContent = t("interestTesting");
  control.disabled = true;
  try {
    const response = await api("/api/qq/interest-models/test", { method: "POST", body: JSON.stringify({ text: $("#interestTestText").value.trim() }) });
    if (response.ok) {
      result.className = "test-result ok";
      setHtml(result, `<strong>${escapeHtml(response.value.shouldReply ? t("interestTestReply") : t("interestTestSilent"))} · ${escapeHtml(t("interestScore", { value: Math.round(Number(response.value.interest)) }))}</strong><span>${escapeHtml(response.value.reason || "")}</span><small class="mono">${escapeHtml(t("interestTestOk", { provider: response.provider, model: response.model, duration: formatMs(response.durationMs) }))}</small>`);
    } else {
      result.className = "test-result bad";
      setHtml(result, `<strong>${escapeHtml(t("interestTestFailed", { reason: response.reason || "" }))}</strong><small class="mono">${escapeHtml(t("interestTestOk", { provider: response.provider, model: response.model, duration: formatMs(response.durationMs) }))}</small>`);
    }
  } catch (error) {
    result.className = "test-result bad";
    result.textContent = t("interestTestFailed", { reason: error.message });
  } finally {
    control.disabled = false;
  }
}

function renderInterestPreset() {
  const preset = app.state?.qq?.interestSettings?.preset;
  const form = $("#interestPresetForm");
  if (!preset || !form || personaUi.presetDirty || form.contains(document.activeElement)) return;
  $("#presetLikes").value = (preset.likes || []).join("\n");
  $("#presetDislikes").value = (preset.dislikes || []).join("\n");
  $("#presetStyle").value = (preset.style || []).join("\n");
  setPresetState("ok", "settingsSynced");
}

function setPresetState(status, key) {
  const node = $("#interestPresetStatus");
  node.className = `save-state ${status === "ok" ? "" : status}`;
  node.textContent = t(key);
}

async function saveInterestPreset(control) {
  const lines = (selector) => $(selector).value.split(/\n+/).map((item) => item.trim()).filter(Boolean);
  const body = { judgePreset: { likes: lines("#presetLikes"), dislikes: lines("#presetDislikes"), style: lines("#presetStyle") } };
  setPresetState("saving", "settingsSaving");
  try {
    app.state = await mutate(() => api("/api/qq/bot-settings", { method: "POST", body: JSON.stringify(body) }), { control, success: t("presetSaved"), busyKey: "bot-settings" });
    personaUi.presetDirty = false;
    renderState();
  } catch {
    setPresetState("error", "settingsSaveFailed");
  }
}

// ---------- Advanced settings ----------
function renderAdminSettings() {
  const admin = personaUi.admin;
  if (!admin || !$("#aiSettingsForm")) return;
  renderAiSettingsForm(admin);
  renderIdentityForm(admin);
  renderBans(admin);
  renderCommandPermissions(admin);
}

function renderAiSettingsForm(admin) {
  const form = $("#aiSettingsForm");
  const usesCatalog = Boolean(admin.agent?.modelCatalog);
  $("#aiSettingsHint").textContent = usesCatalog
    ? (admin.modelError ? t("modelsUnavailable", { error: admin.modelError }) : t("aiSettingsHint"))
    : t("aiClaudeHint", { model: admin.agent?.model || "default" });
  if (form.contains(document.activeElement) || form.dataset.dirty === "1") return;
  const models = admin.models?.length ? admin.models : [{ model: admin.ai.model, displayName: admin.ai.model, supportedReasoningEfforts: [admin.ai.reasoningEffort], serviceTiers: [] }];
  $("#aiModel").innerHTML = models.map((item) => `<option value="${escapeHtml(item.model)}">${escapeHtml(item.displayName || item.model)}${item.isDefault ? " ★" : ""}</option>`).join("");
  $("#aiModel").value = admin.ai.model;
  fillAiModelDependents(admin.ai.reasoningEffort, admin.ai.serviceTier);
  $("#aiSummary").value = admin.ai.reasoningSummary || "auto";
  $("#aiPersonality").value = admin.ai.personality || "none";
}

function fillAiModelDependents(effort, tier) {
  const admin = personaUi.admin;
  const model = (admin?.models || []).find((item) => item.model === $("#aiModel").value);
  const efforts = model?.supportedReasoningEfforts?.length ? model.supportedReasoningEfforts : ["low", "medium", "high", "xhigh"];
  $("#aiEffort").innerHTML = efforts.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("");
  $("#aiEffort").value = efforts.includes(effort) ? effort : (model?.defaultReasoningEffort || efforts[0]);
  const tiers = model?.serviceTiers || [];
  $("#aiServiceTier").innerHTML = `<option value="">${escapeHtml(t("defaultTier"))}</option>` + tiers.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name || item.id)}</option>`).join("");
  $("#aiServiceTier").value = tiers.some((item) => item.id === tier) ? tier : "";
}

async function saveAiSettings(control) {
  const body = {
    model: $("#aiModel").value,
    reasoningEffort: $("#aiEffort").value,
    reasoningSummary: $("#aiSummary").value,
    personality: $("#aiPersonality").value,
    serviceTier: $("#aiServiceTier").value
  };
  try {
    personaUi.admin = await mutate(() => api("/api/settings/ai", { method: "POST", body: JSON.stringify(body) }), { control, success: t("aiSettingsSaved"), busyKey: "admin" });
    $("#aiSettingsForm").dataset.dirty = "";
    renderAdminSettings();
    void refreshState({ quiet: true }).catch(() => undefined);
    void refreshMaintenance({ quiet: true }).catch(() => undefined);
  } catch {
    // mutate already showed the error.
  }
}

function renderIdentityForm(admin) {
  const form = $("#identityForm");
  const local = isLoopbackBrowser();
  $$("input, textarea, button", form).forEach((control) => { control.disabled = !local; });
  form.title = local ? "" : t("identityRemoteOnly");
  if (form.contains(document.activeElement) || form.dataset.dirty === "1") return;
  $("#identityAssistantName").value = admin.identity.assistantName || "";
  $("#identityOwnerLabel").value = admin.identity.ownerLabel || "";
  $("#identityMentions").value = (admin.identity.assistantMentions || []).join(", ");
  $("#identityOwners").value = (admin.identity.ownerUserIds || []).join(" ");
  $("#identityAdmins").value = (admin.identity.adminUserIds || []).join(" ");
}

async function saveIdentity(control) {
  const form = $("#identityForm");
  if (!form.reportValidity()) return;
  const body = {
    assistantName: $("#identityAssistantName").value.trim(),
    ownerLabel: $("#identityOwnerLabel").value.trim(),
    assistantMentions: $("#identityMentions").value,
    ownerUserIds: $("#identityOwners").value,
    adminUserIds: $("#identityAdmins").value
  };
  try {
    personaUi.admin = await mutate(() => api("/api/settings/identity", { method: "POST", body: JSON.stringify(body) }), { control, success: t("identitySaved"), busyKey: "admin" });
    form.dataset.dirty = "";
    renderAdminSettings();
  } catch {
    // mutate already showed the error.
  }
}

function renderBans(admin) {
  const ids = admin.identity.bannedUserIds || [];
  $("#banCount").textContent = String(ids.length);
  setHtml($("#banList"), ids.length
    ? ids.map((id) => {
      const until = admin.identity.bannedUntilByUserId?.[id];
      return `<span class="token-item"><code>${escapeHtml(id)}</code>${until ? `<small>${escapeHtml(t("bannedUntil", { time: formatTime(until) }))}</small>` : ""}<button type="button" data-unban="${escapeHtml(id)}" aria-label="${escapeHtml(t("unban"))} ${escapeHtml(id)}">×</button></span>`;
    }).join("")
    : `<p class="token-empty">${escapeHtml(t("noBans"))}</p>`);
}

function renderCommandPermissions(admin) {
  const categories = ["conversation", "intelligence", "group", "operations", "authority"];
  const labelKey = { conversation: "commandCategoryConversation", intelligence: "commandCategoryIntelligence", group: "commandCategoryGroup", operations: "commandCategoryOperations", authority: "commandCategoryAuthority" };
  setHtml($("#commandPermissionList"), categories.map((category) => {
    const commands = admin.commands.filter((command) => command.category === category);
    if (!commands.length) return "";
    return `<section class="command-group"><h3>${escapeHtml(t(labelKey[category]))}</h3>${commands.map((command) => `
      <label class="command-permission ${command.configurable ? "" : "fixed"}">
        <span><code>${escapeHtml(command.menuLine)}</code><small>${escapeHtml(command.description)}${command.userCount ? ` · ${escapeHtml(t("commandUsers", { count: command.userCount }))}` : ""}</small></span>
        ${command.configurable
          ? `<span class="switch small"><input type="checkbox" data-command-public="${escapeHtml(command.key)}" ${command.public ? "checked" : ""} aria-label="${escapeHtml(command.menuLine)}" /><span aria-hidden="true"></span></span>`
          : `<span class="badge off">${escapeHtml(t("commandFixed"))}</span>`}
      </label>`).join("")}</section>`;
  }).join(""));
}

async function setCommandPublic(key, enabled, control) {
  try {
    personaUi.admin = await mutate(() => api("/api/qq/command-permissions", { method: "POST", body: JSON.stringify({ publicCommands: { [key]: enabled } }) }), { control, success: t("commandSaved"), busyKey: "admin" });
  } catch {
    control.checked = !enabled;
  }
  renderAdminSettings();
}

// ---------- Commands ----------
function personaCommands() {
  return [
    { id: "view-persona", label: t("navPersona"), hint: t("actionPersonaHint"), icon: icons.agent, keywords: "persona personality affinity mood routine 人格 性格 好感 心情 作息" },
    { id: "persona-people", label: t("actionRelationships"), hint: t("actionRelationshipsHint"), icon: icons.activity, keywords: "affinity relationship ranking 好感 关系 排行" },
    { id: "test-interest", label: t("actionTestInterest"), hint: t("actionTestInterestHint"), icon: icons.pulse, keywords: "interest model codex claude test 兴趣 测试 订阅" }
  ];
}

async function personaRunCommand(id) {
  if (id === "persona-people") {
    goToMemoryPeople();
    return;
  }
  if (id === "test-interest") {
    personaUi.tab = "behavior";
    persistPersonaTab();
    setView("persona", { focus: false });
    requestAnimationFrame(() => {
      $("#testInterestModel").scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "center" });
      $("#interestTestText").focus();
    });
  }
}

function persistPersonaTab() {
  writeStorage(localStorage, "personaTab", personaUi.tab);
}

// ---------- Events ----------
function personaInit() {
  const savedTab = readStorage(localStorage, "personaTab");
  if (personaTabs.includes(savedTab)) personaUi.tab = savedTab;

  $("#personaTabs").addEventListener("click", (event) => {
    const button = event.target.closest("[data-persona-tab]");
    if (!button) return;
    personaUi.tab = button.dataset.personaTab;
    persistPersonaTab();
    renderPersona();
  });
  $("#personaTabs").addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const tabs = $$("[data-persona-tab]");
    const index = tabs.findIndex((tab) => tab.dataset.personaTab === personaUi.tab);
    const next = tabs[(index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length];
    next.focus();
    next.click();
  });

  const form = $("#personaForm");
  const markDirty = () => {
    personaUi.dirty = true;
    setPersonaSaveState("dirty", "settingsUnsaved");
  };
  form.addEventListener("input", (event) => {
    markDirty();
    const slider = event.target.closest("[data-trait], [data-speech]");
    if (slider && personaUi.data) {
      const kind = slider.dataset.trait ? "trait" : "speech";
      const id = slider.dataset.trait || slider.dataset.speech;
      const definition = (kind === "trait" ? personaUi.data.traits : personaUi.data.speech || []).find((item) => item.id === id);
      $(`[data-scale-value="${kind}:${id}"]`).textContent = slider.value;
      if (definition) $(`[data-scale-text="${kind}:${id}"]`).textContent = describeTrait(definition, Number(slider.value));
    }
  });
  form.addEventListener("change", (event) => { if (event.target.closest("[data-social], [data-lore-field]")) markDirty(); });
  $("#addLoreEntry").addEventListener("click", () => {
    personaUi.lore = [...$$(".lore-entry", $("#personaLoreList")).map(readLoreEntry), { keys: [], comment: "", content: "", constant: false, enabled: true }].slice(0, 48);
    renderLoreList();
    markDirty();
    $$(".lore-entry", $("#personaLoreList")).at(-1)?.querySelector("[data-lore-field=keys]")?.focus();
  });
  $("#personaLoreList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-lore]");
    if (!button) return;
    const index = Number(button.dataset.removeLore);
    // Keep unsaved edits (including still-empty entries) of the other rows.
    personaUi.lore = $$(".lore-entry", $("#personaLoreList"))
      .filter((_, position) => position !== index)
      .map(readLoreEntry);
    renderLoreList();
    markDirty();
  });

  $("#importCardFile").addEventListener("click", () => $("#cardFileInput").click());
  $("#cardFileInput").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    void importCardFile(file).catch((error) => showToast(error.message, "error"));
  });
  $("#pasteCardText").addEventListener("click", () => openCardDialog({ paste: true }));
  $("#cardImportMode").addEventListener("change", () => {
    if (personaUi.data) renderCardMeta(personaUi.data.profile);
    if ($("#cardDialog").open && personaUi.cardPayload) void previewCard();
  });
  $("#cardTextInput").addEventListener("input", () => { personaUi.cardPayload = null; });
  $("#cardPreviewButton").addEventListener("click", (event) => { void previewCard(event.currentTarget); });
  $("#cardForm").addEventListener("submit", (event) => { event.preventDefault(); void importCard($("#cardImportButton")); });
  $$("[data-close-card]").forEach((button) => button.addEventListener("click", () => $("#cardDialog").close()));
  $("#exportCardV2").addEventListener("click", (event) => { void exportCard("v2", event.currentTarget); });
  $("#exportCardV3").addEventListener("click", (event) => { void exportCard("v3", event.currentTarget); });

  $("#languageHabitForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = { action: "add", term: $("#habitTerm").value.trim(), kind: $("#habitKind").value, scope: $("#habitScope").value, usage: $("#habitUsage").value.trim() };
    if (!body.term) return;
    try {
      personaUi.data = await mutate(() => api("/api/qq/language-habits", { method: "POST", body: JSON.stringify(body) }), { control: event.submitter, success: t("habitAdded"), busyKey: "persona" });
      $("#habitTerm").value = "";
      $("#habitUsage").value = "";
      renderPersona();
    } catch {
      // mutate already showed the error.
    }
  });
  $("#languageHabitList").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-remove-habit]");
    if (!button) return;
    try {
      personaUi.data = await mutate(() => api("/api/qq/language-habits", { method: "POST", body: JSON.stringify({ action: "remove", id: button.dataset.removeHabit }) }), { control: button, success: t("habitRemoved"), busyKey: "persona" });
      renderPersona();
    } catch {
      // mutate already showed the error.
    }
  });
  form.addEventListener("submit", (event) => { event.preventDefault(); void savePersona($("#savePersona")); });
  $("#resetPersonaForm").addEventListener("click", () => { personaUi.dirty = false; renderPersona(); });
  $("#personaPresets").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-persona-preset]");
    if (chip) void applyPersonaPreset(chip.dataset.personaPreset, chip);
  });

  // Relationships inside Memory → People.
  $("#memoryView").addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit-person]");
    if (edit) { openPersonDialog(edit.dataset.editPerson); return; }
    if (event.target.closest("[data-add-person]")) { openPersonDialog(""); return; }
    if (event.target.closest("[data-affinity-rules]")) { openAffinityDialog(); return; }
    const knowledge = event.target.closest("[data-people-knowledge]");
    if (knowledge) goToKnowledge(knowledge.dataset.peopleKnowledge);
  });
  $("#memoryView").addEventListener("change", (event) => {
    if (event.target.matches("[data-people-level]")) { personaUi.peopleLevel = event.target.value; renderMemory(); }
    if (event.target.matches("[data-people-sort]")) { personaUi.peopleSort = event.target.value; renderMemory(); }
  });
  $("#affinityForm").addEventListener("submit", (event) => { event.preventDefault(); void saveAffinityRules($("#saveAffinityRules")); });
  $$("[data-close-affinity]").forEach((button) => button.addEventListener("click", () => $("#affinityDialog").close()));
  $("#selfEditLog").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-revert-self-edit]");
    if (!button) return;
    try {
      personaUi.data = await mutate(() => api("/api/qq/personality", { method: "POST", body: JSON.stringify({ revertSelfEdit: button.dataset.revertSelfEdit }) }), { control: button, success: t("selfEditReverted"), busyKey: "persona" });
      personaUi.dirty = false;
      renderPersona();
    } catch {
      // mutate already showed the error.
    }
  });
  // Cross-page links.
  document.addEventListener("click", (event) => {
    const persona = event.target.closest("[data-persona-goto]");
    if (persona) { event.preventDefault(); goToPersonaTab(persona.dataset.personaGoto); return; }
    const habit = event.target.closest("[data-habit-knowledge]");
    if (habit) { event.preventDefault(); goToKnowledge(habit.dataset.habitKnowledge); return; }
    const people = event.target.closest("[data-memory-people]");
    if (people) { event.preventDefault(); goToMemoryPeople(people.dataset.memoryPeople || ""); }
  });
  $("#personAffinity").addEventListener("input", updatePersonAffinityLabel);
  $("#personForm").addEventListener("submit", (event) => { event.preventDefault(); void savePerson(event.submitter); });
  $("#removePerson").addEventListener("click", (event) => { void removePerson(event.currentTarget); });
  $$("[data-close-person]").forEach((button) => button.addEventListener("click", () => $("#personDialog").close()));

  $("#moodForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const mood = $("#moodInput").value.trim();
    if (!mood) return;
    try {
      personaUi.data = await mutate(() => api("/api/qq/bot-state", { method: "POST", body: JSON.stringify({ action: "set-mood", mood }) }), { control: event.submitter, success: t("moodSaved") });
      $("#moodInput").value = "";
      renderPersona();
    } catch {
      // mutate already showed the error.
    }
  });
  $("#clearMood").addEventListener("click", async (event) => {
    try {
      personaUi.data = await mutate(() => api("/api/qq/bot-state", { method: "POST", body: JSON.stringify({ action: "clear-mood" }) }), { control: event.currentTarget, success: t("moodSaved") });
      renderPersona();
    } catch {
      // mutate already showed the error.
    }
  });
  $("#regenerateRoutine").addEventListener("click", async (event) => {
    try {
      personaUi.data = await mutate(() => api("/api/qq/bot-state", { method: "POST", body: JSON.stringify({ action: "regenerate-routine" }) }), { control: event.currentTarget, success: t("routineQueued") });
      personaUi.routinePollUntil = Date.now() + 5 * 60_000;
      renderPersona();
    } catch {
      // mutate already showed the error.
    }
  });

  // Interest model and preset.
  $("#botJudgeProvider").addEventListener("change", (event) => {
    const provider = event.target.value;
    const definition = (app.state?.qq?.interestSettings?.providers || []).find((item) => item.id === provider);
    $("#botJudgeModel").value = definition?.defaultModel || "";
    syncJudgeProviderFields();
  });
  $("#testInterestModel").addEventListener("click", (event) => { void testInterestModel(event.currentTarget); });
  $("#botJudgeModel").addEventListener("change", () => syncJudgeEffortOptions());
  $("#interestPresetForm").addEventListener("input", () => { personaUi.presetDirty = true; setPresetState("dirty", "settingsUnsaved"); });
  $("#interestPresetForm").addEventListener("submit", (event) => { event.preventDefault(); void saveInterestPreset($("#saveInterestPreset")); });

  // Advanced settings.
  $("#aiModel").addEventListener("change", () => fillAiModelDependents($("#aiEffort").value, $("#aiServiceTier").value));
  $("#aiSettingsForm").addEventListener("input", (event) => { event.currentTarget.dataset.dirty = "1"; });
  $("#aiSettingsForm").addEventListener("submit", (event) => { event.preventDefault(); void saveAiSettings(event.submitter); });
  $("#refreshModels").addEventListener("click", (event) => {
    event.currentTarget.disabled = true;
    void refreshAdminSettings({ quiet: false, refresh: true }).finally(() => { event.currentTarget.disabled = false; });
  });
  $("#identityForm").addEventListener("input", (event) => { event.currentTarget.dataset.dirty = "1"; });
  $("#identityForm").addEventListener("submit", (event) => { event.preventDefault(); void saveIdentity(event.submitter); });
  $("#banList").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-unban]");
    if (!button) return;
    try {
      personaUi.admin = await mutate(() => api("/api/qq/bans", { method: "POST", body: JSON.stringify({ action: "unban", userId: button.dataset.unban }) }), { control: button, success: t("unbanned"), busyKey: "admin" });
      renderAdminSettings();
    } catch {
      // mutate already showed the error.
    }
  });
  $("#commandPermissionList").addEventListener("change", (event) => {
    const toggle = event.target.closest("[data-command-public]");
    if (toggle) void setCommandPublic(toggle.dataset.commandPublic, toggle.checked, toggle);
  });
}
