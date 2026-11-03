import {
  DEFAULT_INTEREST_AGENT_TIMEOUT_MS,
  getDefaultInterestModel,
  getDefaultInterestModelBaseUrl,
  INTEREST_MODEL_PROVIDER_IDS,
  INTEREST_MODEL_REASONING_EFFORTS,
  isSubscriptionInterestProvider,
  listInterestModelProviders,
  MAX_INTEREST_AGENT_TIMEOUT_MS,
  MIN_INTEREST_AGENT_TIMEOUT_MS,
  normalizeInterestModelProvider,
  normalizeInterestModelReasoningEffort
} from "./interest-model-provider.js";

const BOT_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/;

export function readDashboardBotSettings(state) {
  const qq = state?.qq || {};
  const proactive = qq.proactive || {};
  const judge = proactive.judge || {};
  return {
    enhancerEnabled: qq.enhancer?.enabled !== false,
    webLookupEnabled: qq.webLookup?.enabled !== false,
    proactiveEnabled: proactive.enabled === true,
    judgeEnabled: judge.enabled !== false,
    judgeEveryMessages: boundedInteger(proactive.judgeEveryMessages, 1, 1000, 20),
    judgeEveryMinutes: boundedInteger(proactive.judgeEveryMinutes, 0, 1440, 5),
    judgeModel: String(judge.model || ""),
    judgeTimeoutMs: boundedInteger(judge.timeoutMs, 1500, 20000, 6500),
    judgeMaxRecentMessages: boundedInteger(judge.maxRecentMessages, 1, 12, 8),
    judgeProvider: normalizeInterestModelProvider(judge.provider),
    judgeApiKeyConfigured: Boolean(judge.apiKeyConfigured),
    judgeProviders: listInterestModelProviders().map(({ id, label, defaultModel }) => ({ id, label, defaultModel }))
  };
}

// Everything the dashboard's interest-model and preset editors need; kept
// apart from readDashboardBotSettings so its long-standing shape is stable.
export function readDashboardInterestSettings(state) {
  const judge = state?.qq?.proactive?.judge || {};
  const provider = normalizeInterestModelProvider(judge.provider);
  const preset = judge.preset && typeof judge.preset === "object" ? judge.preset : {};
  return {
    provider,
    subscription: isSubscriptionInterestProvider(provider),
    model: String(judge.model || ""),
    baseUrl: isSubscriptionInterestProvider(provider) ? "" : String(judge.baseUrl || ""),
    apiKeyConfigured: Boolean(judge.apiKeyConfigured),
    reasoningEffort: normalizeInterestModelReasoningEffort(judge.reasoningEffort),
    agentTimeoutMs: boundedInteger(judge.agentTimeoutMs, MIN_INTEREST_AGENT_TIMEOUT_MS, MAX_INTEREST_AGENT_TIMEOUT_MS, DEFAULT_INTEREST_AGENT_TIMEOUT_MS),
    reasoningEfforts: [...INTEREST_MODEL_REASONING_EFFORTS],
    providers: listInterestModelProviders().map(({ id, label, defaultModel, subscription }) => ({ id, label, defaultModel, subscription: Boolean(subscription) })),
    preset: {
      name: String(preset.name || "default"),
      likes: listOf(preset.likes),
      dislikes: listOf(preset.dislikes),
      style: listOf(preset.style)
    }
  };
}

export function applyDashboardBotSettings(state, input) {
  if (!state?.qq || !input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Bot settings must be a JSON object");
  }
  const previous = readDashboardBotSettings(state);
  const previousJudgeBaseUrl = String(state.qq.proactive.judge.baseUrl || "");
  const previousExtras = {
    reasoningEffort: state.qq.proactive.judge.reasoningEffort,
    agentTimeoutMs: state.qq.proactive.judge.agentTimeoutMs,
    preset: state.qq.proactive.judge.preset
  };
  const next = normalizePatch(input, { ...previous, judgeBaseUrl: previousJudgeBaseUrl });
  const extras = normalizeExtras(input, previousExtras, next);

  state.qq.enhancer.enabled = next.enhancerEnabled;
  state.qq.webLookup.enabled = next.webLookupEnabled;
  state.qq.proactive.enabled = next.proactiveEnabled;
  state.qq.proactive.judge.enabled = next.judgeEnabled;
  state.qq.proactive.judgeEveryMessages = next.judgeEveryMessages;
  state.qq.proactive.judgeEveryMinutes = next.judgeEveryMinutes;
  state.qq.proactive.judge.provider = next.judgeProvider;
  state.qq.proactive.judge.model = next.judgeModel;
  state.qq.proactive.judge.baseUrl = next.judgeBaseUrl;
  state.qq.proactive.judge.apiKeyConfigured = next.judgeApiKeyConfigured;
  state.qq.proactive.judge.timeoutMs = next.judgeTimeoutMs;
  state.qq.proactive.judge.maxRecentMessages = next.judgeMaxRecentMessages;
  state.qq.proactive.judge.reasoningEffort = extras.reasoningEffort;
  state.qq.proactive.judge.agentTimeoutMs = extras.agentTimeoutMs;
  state.qq.proactive.judge.preset = extras.preset;

  return {
    settings: readDashboardBotSettings(state),
    restore() {
      state.qq.enhancer.enabled = previous.enhancerEnabled;
      state.qq.webLookup.enabled = previous.webLookupEnabled;
      state.qq.proactive.enabled = previous.proactiveEnabled;
      state.qq.proactive.judge.enabled = previous.judgeEnabled;
      state.qq.proactive.judgeEveryMessages = previous.judgeEveryMessages;
      state.qq.proactive.judgeEveryMinutes = previous.judgeEveryMinutes;
      state.qq.proactive.judge.provider = previous.judgeProvider;
      state.qq.proactive.judge.model = previous.judgeModel;
      state.qq.proactive.judge.baseUrl = previousJudgeBaseUrl;
      state.qq.proactive.judge.apiKeyConfigured = previous.judgeApiKeyConfigured;
      state.qq.proactive.judge.timeoutMs = previous.judgeTimeoutMs;
      state.qq.proactive.judge.maxRecentMessages = previous.judgeMaxRecentMessages;
      state.qq.proactive.judge.reasoningEffort = previousExtras.reasoningEffort;
      state.qq.proactive.judge.agentTimeoutMs = previousExtras.agentTimeoutMs;
      state.qq.proactive.judge.preset = previousExtras.preset;
    }
  };
}

function normalizeExtras(input, previous, next) {
  const extras = {
    reasoningEffort: normalizeInterestModelReasoningEffort(previous.reasoningEffort),
    agentTimeoutMs: boundedInteger(previous.agentTimeoutMs, MIN_INTEREST_AGENT_TIMEOUT_MS, MAX_INTEREST_AGENT_TIMEOUT_MS, DEFAULT_INTEREST_AGENT_TIMEOUT_MS),
    preset: previous.preset
  };
  if (Object.hasOwn(input, "judgeReasoningEffort")) {
    const effort = String(input.judgeReasoningEffort || "").trim().toLowerCase();
    if (!INTEREST_MODEL_REASONING_EFFORTS.includes(effort)) {
      throw new RangeError(`judgeReasoningEffort must be one of: ${INTEREST_MODEL_REASONING_EFFORTS.join(", ")}`);
    }
    extras.reasoningEffort = effort;
  }
  extras.agentTimeoutMs = optionalInteger(input, "judgeAgentTimeoutMs", MIN_INTEREST_AGENT_TIMEOUT_MS, MAX_INTEREST_AGENT_TIMEOUT_MS, extras.agentTimeoutMs);
  if (Object.hasOwn(input, "judgeBaseUrl")) {
    if (next.judgeProvider !== "custom") throw new RangeError("judgeBaseUrl can only be changed for the custom provider");
    const url = String(input.judgeBaseUrl || "").trim().replace(/\/+$/, "");
    if (url && !/^https?:\/\/[^\s]+$/i.test(url)) throw new RangeError("judgeBaseUrl must be an http(s) URL");
    next.judgeBaseUrl = url;
  }
  if (Object.hasOwn(input, "judgePreset")) {
    const preset = input.judgePreset;
    if (!preset || typeof preset !== "object" || Array.isArray(preset)) throw new TypeError("judgePreset must be an object");
    const base = previous.preset && typeof previous.preset === "object" ? previous.preset : {};
    extras.preset = {
      name: String(preset.name || base.name || "default").trim().slice(0, 80) || "default",
      likes: Object.hasOwn(preset, "likes") ? listOf(preset.likes) : listOf(base.likes),
      dislikes: Object.hasOwn(preset, "dislikes") ? listOf(preset.dislikes) : listOf(base.dislikes),
      style: Object.hasOwn(preset, "style") ? listOf(preset.style) : listOf(base.style)
    };
  }
  return extras;
}

function listOf(value) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\n+/) : [];
  return list.map((item) => String(item || "").trim().slice(0, 200)).filter(Boolean).slice(0, 20);
}

function normalizePatch(input, current) {
  const next = {
    ...current,
    judgeBaseUrl: String(current.judgeBaseUrl || ""),
    judgeApiKeyConfigured: Boolean(current.judgeApiKeyConfigured)
  };
  assignBoolean(input, "enhancerEnabled", next);
  assignBoolean(input, "webLookupEnabled", next);
  assignBoolean(input, "proactiveEnabled", next);
  assignBoolean(input, "judgeEnabled", next);

  next.judgeEveryMessages = optionalInteger(input, "judgeEveryMessages", 1, 1000, next.judgeEveryMessages);
  next.judgeEveryMinutes = optionalInteger(input, "judgeEveryMinutes", 0, 1440, next.judgeEveryMinutes);
  next.judgeTimeoutMs = optionalInteger(input, "judgeTimeoutMs", 1500, 20000, next.judgeTimeoutMs);
  next.judgeMaxRecentMessages = optionalInteger(input, "judgeMaxRecentMessages", 1, 12, next.judgeMaxRecentMessages);

  if (Object.hasOwn(input, "judgeProvider")) {
    const requested = String(input.judgeProvider || "").trim().toLowerCase();
    if (!INTEREST_MODEL_PROVIDER_IDS.includes(requested)) {
      throw new RangeError(`judgeProvider must be one of: ${INTEREST_MODEL_PROVIDER_IDS.join(", ")}`);
    }
    if (requested !== next.judgeProvider) {
      next.judgeProvider = requested;
      next.judgeModel = getDefaultInterestModel(requested);
      next.judgeBaseUrl = getDefaultInterestModelBaseUrl(requested);
      next.judgeApiKeyConfigured = false;
    }
  }

  if (Object.hasOwn(input, "judgeModel")) {
    const model = String(input.judgeModel || "").trim();
    if (!model || model.length > 160 || !BOT_MODEL_PATTERN.test(model)) {
      throw new RangeError("judgeModel must be a valid provider model id");
    }
    next.judgeModel = model;
  }

  if (Object.hasOwn(input, "proactiveEnabled") && next.proactiveEnabled) next.enhancerEnabled = true;
  else if (!next.enhancerEnabled) next.proactiveEnabled = false;
  return next;
}

function assignBoolean(input, key, output) {
  if (!Object.hasOwn(input, key)) return;
  if (typeof input[key] !== "boolean") throw new TypeError(`${key} must be a boolean`);
  output[key] = input[key];
}

function optionalInteger(input, key, min, max, fallback) {
  if (!Object.hasOwn(input, key)) return fallback;
  const number = Number(input[key]);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new RangeError(`${key} must be an integer between ${min} and ${max}`);
  }
  return number;
}

function boundedInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}
