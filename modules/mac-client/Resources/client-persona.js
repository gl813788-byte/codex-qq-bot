// Persona, relationships, interest-model and advanced settings for the
// dashboard. This script loads before client.js, which merges the
// translations and calls the hooks in personaExtension; every function here
// runs after client.js has defined its helpers ($, api, t, app, ...).

const personaTranslations = {
  zh: {
    navPersona: "人格", personaTitle: "人格与关系", personaSubtitle: "核心性格、好感度、心情与作息",
    personaSections: "人格分区", personaTabProfile: "性格", personaTabPeople: "关系", personaTabState: "状态",
    personaCore: "核心设定", personaCoreHint: "部署者设定的稳定性格，优先于自动学习出的人设。", personaEnabled: "启用",
    personaPreset: "性格预设", personaIdentity: "我是谁", personaIdentityHint: "例如：群里最爱研究新玩意儿的技术宅，嘴上嫌弃其实很热心",
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
    generatedPersona: "自动学习的人设", generatedPersonaHint: "从聊天摘要中学到的兴趣与风格，作为核心人格之下的补充。", generatedPersonaEmpty: "还没有学到人设。",
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
    navPersona: "Persona", personaTitle: "Persona & relationships", personaSubtitle: "Core personality, affinity, mood and routine",
    personaSections: "Persona sections", personaTabProfile: "Personality", personaTabPeople: "Relationships", personaTabState: "State",
    personaCore: "Core identity", personaCoreHint: "The stable personality you set; it outranks the learned persona.", personaEnabled: "Enabled",
    personaPreset: "Preset", personaIdentity: "Who I am", personaIdentityHint: "e.g. the group's gadget nerd who grumbles but always helps",
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
    generatedPersona: "Learned persona", generatedPersonaHint: "Interests and style learned from chat summaries, layered under the core personality.", generatedPersonaEmpty: "Nothing learned yet.",
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
  routinePollUntil: 0
};

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
  judgeProviderChanged: personaFillModelOptions
};

// ---------- Data ----------
function personaRefresh(view, { quiet = false } = {}) {
  const tasks = [];
  if (view === "persona" || view === "overview") tasks.push(refreshPersona({ quiet }));
  if (view === "settings") tasks.push(refreshAdminSettings({ quiet }));
  if (view === "intelligence" && Date.now() - personaUi.lastFetch.models > 60_000) tasks.push(refreshInterestModels({ quiet }));
  return tasks;
}

async function refreshPersona({ quiet = true } = {}) {
  try {
    personaUi.data = await api("/api/qq/personality", {}, { key: "persona" });
    personaUi.lastFetch.persona = Date.now();
    renderPersona();
    renderOverviewPersona();
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
  $("#personaPanelPeople").hidden = personaUi.tab !== "people";
  $("#personaPanelState").hidden = personaUi.tab !== "state";
  const data = personaUi.data;
  if (!data) {
    setHtml($("#personaStats"), Array.from({ length: 4 }, () => `<article class="stat"><span class="skeleton skeleton-line"></span><span class="skeleton skeleton-value"></span></article>`).join(""));
    return;
  }
  renderPersonaStats(data);
  renderPersonaProfile(data);
  renderPeople(data);
  renderPersonaState(data);
  setPersonaSaveState(personaUi.dirty ? "dirty" : "ok", personaUi.dirty ? "settingsUnsaved" : "settingsSynced");
}

function renderPersonaStats(data) {
  const presetName = presetLabel(data.profile.preset, data.presets);
  const close = data.people.filter((person) => ["close", "bestie"].includes(person.level)).length;
  const cold = data.people.filter((person) => ["hostile", "cold", "wary"].includes(person.level)).length;
  setHtml($("#personaStats"), [
    statCard({ label: t("personaStatPreset"), value: data.profile.enabled ? presetName : t("stateOff"), hint: data.assistantName || "", tone: data.profile.enabled ? "ok" : "warn" }),
    statCard({ label: t("personaStatMood"), value: data.life?.mood?.text || "—", hint: data.life?.mood ? t("moodSince", { time: formatRelative(data.life.mood.at) }) : t("moodNone") }),
    statCard({ label: t("personaStatPeople"), value: formatNumber(data.personCount), hint: t("personaStatClose") + ` ${close}` }),
    statCard({ label: t("personaStatHostile"), value: formatNumber(cold), tone: cold ? "warn" : "", hint: data.profile.affinity.enabled ? t("personaStatHostileHint") : t("stateOff") })
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
  if (personaUi.dirty || form.contains(document.activeElement)) return;
  $("#personaEnabled").checked = profile.enabled;
  $("#personaIdentity").value = profile.identity || "";
  $("#personaSpeechHabits").value = (profile.speechHabits || []).join("\n");
  $("#personaCatchphrases").value = (profile.catchphrases || []).join("\n");
  $("#personaLikes").value = (profile.likes || []).join("\n");
  $("#personaDislikes").value = (profile.dislikes || []).join("\n");
  $("#personaBoundaries").value = (profile.boundaries || []).join("\n");
  $("#affinityEnabled").checked = profile.affinity.enabled;
  $("#affinityMaxDelta").value = profile.affinity.maxDeltaPerTurn;
  $("#affinityDailyCap").value = profile.affinity.dailyCapPerPerson;
  $("#affinityHalfLife").value = profile.affinity.halfLifeDays;
  $("#affinityOwnerFloor").value = profile.affinity.ownerFloor;
  $("#affinityReveal").checked = profile.affinity.revealToUsers;
  setHtml($("#personaTraits"), data.traits.map((trait) => {
    const value = Number(profile.traits?.[trait.id] ?? 50);
    return `<label class="trait-row">
      <span class="trait-head"><strong>${escapeHtml(app.language === "en" ? trait.labelEn : trait.label)}</strong><output class="mono" data-trait-value="${escapeHtml(trait.id)}">${value}</output></span>
      <input type="range" min="0" max="100" step="1" value="${value}" data-trait="${escapeHtml(trait.id)}" aria-label="${escapeHtml(trait.label)}" />
      <small data-trait-text="${escapeHtml(trait.id)}">${escapeHtml(describeTrait(trait, value))}</small>
    </label>`;
  }).join(""));
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
  const traits = {};
  $$("[data-trait]").forEach((input) => { traits[input.dataset.trait] = Number(input.value); });
  return {
    enabled: $("#personaEnabled").checked,
    identity: $("#personaIdentity").value.trim(),
    speechHabits: lines("#personaSpeechHabits"),
    catchphrases: lines("#personaCatchphrases"),
    likes: lines("#personaLikes"),
    dislikes: lines("#personaDislikes"),
    boundaries: lines("#personaBoundaries"),
    traits,
    affinity: {
      enabled: $("#affinityEnabled").checked,
      maxDeltaPerTurn: Number($("#affinityMaxDelta").value),
      dailyCapPerPerson: Number($("#affinityDailyCap").value),
      halfLifeDays: Number($("#affinityHalfLife").value),
      ownerFloor: Number($("#affinityOwnerFloor").value),
      revealToUsers: $("#affinityReveal").checked
    }
  };
}

function traitsChanged(profile, next) {
  return Object.keys(next.traits).some((key) => Number(profile.traits?.[key]) !== Number(next.traits[key]));
}

async function savePersona(control) {
  if (!personaUi.data) return;
  const profile = collectPersonaProfile();
  const body = { profile: { ...profile, preset: traitsChanged(personaUi.data.profile, profile) ? "custom" : personaUi.data.profile.preset } };
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

function renderPeople(data) {
  const levelSelect = $("#peopleLevelFilter");
  if (!levelSelect.options.length || levelSelect.dataset.language !== app.language) {
    levelSelect.innerHTML = `<option value="all">${escapeHtml(t("personaAllLevels"))}</option>` + data.levels.map((level) => `<option value="${escapeHtml(level.id)}">${escapeHtml(levelName(level))}</option>`).join("");
    levelSelect.dataset.language = app.language;
  }
  levelSelect.value = personaUi.peopleLevel;
  $("#peopleSort").value = personaUi.peopleSort;
  if (document.activeElement !== $("#peopleSearch")) $("#peopleSearch").value = personaUi.peopleQuery;
  $("#peopleCount").textContent = String(data.personCount);
  const total = Math.max(1, data.people.length);
  setHtml($("#affinityDistribution"), data.levels.map((level) => level.count
    ? `<span class="level-${escapeHtml(level.id)}" data-flex="${Math.max(1, Math.round((level.count / total) * 100))}" title="${escapeHtml(levelName(level))} ${level.count}"><em>${escapeHtml(levelName(level))} ${level.count}</em></span>`
    : "").join(""));
  $$("[data-flex]", $("#affinityDistribution")).forEach((node) => { node.style.flexGrow = node.dataset.flex; });
  const query = personaUi.peopleQuery.trim().toLowerCase();
  let people = data.people.filter((person) => personaUi.peopleLevel === "all" || person.level === personaUi.peopleLevel);
  if (query) {
    people = people.filter((person) => [person.name, person.userId, person.nickname, ...(person.tags || []), person.note].join(" ").toLowerCase().includes(query));
  }
  people = [...people].sort((a, b) => {
    if (personaUi.peopleSort === "familiarity") return b.familiarity - a.familiarity;
    if (personaUi.peopleSort === "recent") return Date.parse(b.lastInteractionAt || 0) - Date.parse(a.lastInteractionAt || 0);
    return b.affinity - a.affinity;
  });
  if (!data.people.length) { setHtml($("#peopleList"), emptyState(t("personaNoPeople"))); return; }
  if (!people.length) { setHtml($("#peopleList"), emptyState(t("noPeopleMatch"))); return; }
  setHtml($("#peopleList"), people.slice(0, 300).map((person) => {
    const position = Math.round(((person.affinity + 100) / 200) * 100);
    const badges = [
      person.isOwner ? `<span class="badge ok">${escapeHtml(t("ownerBadge"))}</span>` : "",
      person.locked ? `<span class="badge off">${escapeHtml(t("lockedBadge"))}</span>` : ""
    ].join("");
    return `<button type="button" class="person-row" data-edit-person="${escapeHtml(person.userId)}">
      <span class="person-avatar level-${escapeHtml(person.level)}" aria-hidden="true">${escapeHtml(initial(person.name || person.userId))}</span>
      <span class="person-main">
        <span class="person-title"><strong>${escapeHtml(person.name || person.userId)}</strong><code>${escapeHtml(person.userId)}</code>${badges}</span>
        <span class="person-meta">${escapeHtml([
          t("interactionsCount", { count: formatNumber(person.interactions) }),
          person.lastInteractionAt ? t("lastSeen", { time: formatRelative(person.lastInteractionAt) }) : "",
          person.nickname ? t("nicknameLabel", { value: person.nickname }) : ""
        ].filter(Boolean).join(" · "))}</span>
        ${person.tags?.length ? `<span class="chip-row">${person.tags.map((tag) => `<span class="chip">${escapeHtml(tag)}</span>`).join("")}</span>` : ""}
      </span>
      <span class="person-score">
        <span class="level-chip level-${escapeHtml(person.level)}">${escapeHtml(levelName(levelFor(person.affinity, data.levels)))} ${person.affinity > 0 ? "+" : ""}${escapeHtml(person.affinity)}</span>
        <span class="affinity-meter" aria-hidden="true"><i data-position="${position}"></i></span>
        <small>${escapeHtml(t("familiarity"))} ${escapeHtml(person.familiarityLabel)} · ${person.familiarity}</small>
      </span>
    </button>`;
  }).join(""));
  $$("[data-position]", $("#peopleList")).forEach((node) => { node.style.left = `${node.dataset.position}%`; });
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
  const persona = data.generatedPersona;
  if (!persona || (!persona.selfDescription && !(persona.traits || []).length)) {
    setHtml($("#generatedPersona"), emptyState(t("generatedPersonaEmpty")));
  } else {
    setHtml($("#generatedPersona"), [
      persona.name ? `<p><strong>${escapeHtml(persona.name)}</strong></p>` : "",
      persona.selfDescription ? `<p class="persona-quote">${escapeHtml(persona.selfDescription)}</p>` : "",
      (persona.traits || []).length ? `<ul class="plain-list">${persona.traits.slice(0, 8).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "",
      (persona.interestKeywords || []).length ? `<div class="chip-row">${persona.interestKeywords.slice(0, 24).map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")}</div>` : ""
    ].join(""));
  }
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
    ${close.length ? `<ul class="overview-people">${close.map((person) => `<li><span class="person-avatar small level-${escapeHtml(person.level)}" aria-hidden="true">${escapeHtml(initial(person.name || person.userId))}</span><span>${escapeHtml(person.nickname || person.name || person.userId)}</span><span class="level-chip level-${escapeHtml(person.level)}">${escapeHtml(levelName(levelFor(person.affinity, data.levels)))}</span></li>`).join("")}</ul>` : `<p class="muted small-text">${escapeHtml(t("overviewNoClose"))}</p>`}`);
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
    personaUi.tab = "people";
    persistPersonaTab();
    setView("persona", { focus: true });
    return;
  }
  if (id === "test-interest") {
    setView("intelligence", { focus: false });
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
  if (["profile", "people", "state"].includes(savedTab)) personaUi.tab = savedTab;

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
  form.addEventListener("input", (event) => {
    personaUi.dirty = true;
    setPersonaSaveState("dirty", "settingsUnsaved");
    const trait = event.target.closest("[data-trait]");
    if (trait && personaUi.data) {
      const definition = personaUi.data.traits.find((item) => item.id === trait.dataset.trait);
      $(`[data-trait-value="${trait.dataset.trait}"]`).textContent = trait.value;
      if (definition) $(`[data-trait-text="${trait.dataset.trait}"]`).textContent = describeTrait(definition, Number(trait.value));
    }
  });
  form.addEventListener("submit", (event) => { event.preventDefault(); void savePersona($("#savePersona")); });
  $("#resetPersonaForm").addEventListener("click", () => { personaUi.dirty = false; renderPersona(); });
  $("#personaPresets").addEventListener("click", (event) => {
    const chip = event.target.closest("[data-persona-preset]");
    if (chip) void applyPersonaPreset(chip.dataset.personaPreset, chip);
  });

  $("#peopleSearch").addEventListener("input", (event) => { personaUi.peopleQuery = event.target.value; if (personaUi.data) renderPeople(personaUi.data); });
  $("#peopleLevelFilter").addEventListener("change", (event) => { personaUi.peopleLevel = event.target.value; if (personaUi.data) renderPeople(personaUi.data); });
  $("#peopleSort").addEventListener("change", (event) => { personaUi.peopleSort = event.target.value; if (personaUi.data) renderPeople(personaUi.data); });
  $("#addPerson").addEventListener("click", () => openPersonDialog(""));
  $("#peopleList").addEventListener("click", (event) => {
    const row = event.target.closest("[data-edit-person]");
    if (row) openPersonDialog(row.dataset.editPerson);
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
