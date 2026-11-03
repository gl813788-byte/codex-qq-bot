export const INTEREST_MODEL_PROVIDER_IDS = Object.freeze(["openrouter", "deepseek", "custom", "codex", "claude"]);
// Subscription providers run one tool-free structured turn through the local
// agent CLI (the ChatGPT or Claude login) instead of an HTTP API key.
export const SUBSCRIPTION_INTEREST_PROVIDER_IDS = Object.freeze(["codex", "claude"]);
export const INTEREST_MODEL_REASONING_EFFORTS = Object.freeze(["minimal", "low", "medium", "high"]);
export const DEFAULT_INTEREST_AGENT_TIMEOUT_MS = 90_000;
export const MIN_INTEREST_AGENT_TIMEOUT_MS = 15_000;
export const MAX_INTEREST_AGENT_TIMEOUT_MS = 300_000;
// Claude Code accepts stable aliases; Codex models come from the live catalog.
export const CLAUDE_INTEREST_MODEL_SUGGESTIONS = Object.freeze(["haiku", "sonnet", "opus"]);

const definitions = Object.freeze({
  openrouter: Object.freeze({
    id: "openrouter",
    label: "OpenRouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "openrouter/free",
    structuredOutput: "json_schema"
  }),
  deepseek: Object.freeze({
    id: "deepseek",
    label: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-v4-flash",
    structuredOutput: "json_object"
  }),
  custom: Object.freeze({
    id: "custom",
    label: "自定义兼容服务",
    defaultBaseUrl: "",
    defaultModel: "gpt-4o-mini",
    structuredOutput: "json_object"
  }),
  // "default" lets Codex pick the account's default model.
  codex: Object.freeze({
    id: "codex",
    label: "Codex 订阅",
    defaultBaseUrl: "",
    defaultModel: "default",
    structuredOutput: "agent_output_schema",
    subscription: true,
    engine: "codex"
  }),
  claude: Object.freeze({
    id: "claude",
    label: "Claude 订阅",
    defaultBaseUrl: "",
    defaultModel: "haiku",
    structuredOutput: "agent_output_schema",
    subscription: true,
    engine: "claude"
  })
});

export function isSubscriptionInterestProvider(value) {
  return SUBSCRIPTION_INTEREST_PROVIDER_IDS.includes(String(value || "").trim().toLowerCase());
}

export function normalizeInterestModelReasoningEffort(value, fallback = "low") {
  const effort = String(value || "").trim().toLowerCase();
  return INTEREST_MODEL_REASONING_EFFORTS.includes(effort) ? effort : fallback;
}

export function normalizeInterestAgentTimeoutMs(value, fallback = DEFAULT_INTEREST_AGENT_TIMEOUT_MS) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(MIN_INTEREST_AGENT_TIMEOUT_MS, Math.min(MAX_INTEREST_AGENT_TIMEOUT_MS, Math.round(number)));
}

// The model id an agent CLI receives; "default" means the CLI's own default.
export function resolveInterestAgentModel(value) {
  const model = String(value || "").trim();
  return !model || model.toLowerCase() === "default" ? null : model;
}

// OpenAI-style chat messages become one agent turn: system text becomes
// developer instructions, user text the prompt, and data-URL pictures files.
export function splitInterestChatMessages(messages = []) {
  const system = [];
  const user = [];
  const images = [];
  for (const message of Array.isArray(messages) ? messages : []) {
    const parts = typeof message?.content === "string"
      ? [{ type: "text", text: message.content }]
      : Array.isArray(message?.content) ? message.content : [];
    for (const part of parts) {
      if (part?.type === "text" && part.text) {
        (message.role === "system" ? system : user).push(String(part.text));
      } else if (part?.type === "image_url" && message.role !== "system") {
        const url = String(part.image_url?.url || "");
        if (/^data:image\/(png|jpeg|gif|webp);base64,/.test(url)) images.push({ dataUrl: url });
      }
    }
  }
  return { systemPrompt: system.join("\n\n"), userText: user.join("\n\n"), images };
}

export function normalizeInterestModelProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  return INTEREST_MODEL_PROVIDER_IDS.includes(provider) ? provider : "openrouter";
}

export function getInterestModelProviderDefinition(value) {
  return definitions[normalizeInterestModelProvider(value)];
}

export function listInterestModelProviders() {
  return INTEREST_MODEL_PROVIDER_IDS.map((id) => ({ subscription: false, engine: null, ...definitions[id] }));
}

export function getDefaultInterestModel(value) {
  return getInterestModelProviderDefinition(value).defaultModel;
}

export function getDefaultInterestModelBaseUrl(value) {
  return getInterestModelProviderDefinition(value).defaultBaseUrl;
}

export function resolveInterestModelRuntimeConfig(value, config = {}) {
  const provider = normalizeInterestModelProvider(value);
  const definition = getInterestModelProviderDefinition(provider);
  if (definition.subscription) {
    // The CLI's own login is the credential; no key or URL applies.
    return { ...definition, provider, apiKey: "", baseUrl: "", apiKeyConfigured: true };
  }
  const credentials = {
    openrouter: {
      apiKey: config.openRouterApiKey,
      baseUrl: config.openRouterBaseUrl
    },
    deepseek: {
      apiKey: config.deepSeekApiKey,
      baseUrl: config.deepSeekBaseUrl
    },
    custom: {
      apiKey: config.customInterestModelApiKey,
      baseUrl: config.customInterestModelBaseUrl
    }
  }[provider];
  return {
    ...definition,
    provider,
    apiKey: String(credentials.apiKey || "").trim(),
    baseUrl: String(credentials.baseUrl || definition.defaultBaseUrl || "").trim().replace(/\/+$/, ""),
    apiKeyConfigured: Boolean(String(credentials.apiKey || "").trim())
  };
}

export function buildInterestModelChatCompletion({
  provider: providerValue,
  apiKey,
  model,
  temperature,
  maxTokens,
  stream = true,
  messages,
  responseSchema,
  taskName
}) {
  const provider = normalizeInterestModelProvider(providerValue);
  const definition = getInterestModelProviderDefinition(provider);
  const headers = {
    authorization: `Bearer ${String(apiKey || "").trim()}`,
    "content-type": "application/json"
  };
  const body = {
    model: String(model || definition.defaultModel),
    temperature,
    max_tokens: maxTokens,
    stream: Boolean(stream),
    messages
  };
  if (provider === "openrouter") {
    headers["http-referer"] = "http://localhost:3789";
    headers["x-title"] = `Codex QQ Bot ${String(taskName || "interest model")}`;
    body.reasoning = { effort: "none" };
    body.provider = { require_parameters: true };
    body.response_format = {
      type: "json_schema",
      json_schema: {
        name: String(taskName || "qq_interest_model_task"),
        strict: true,
        schema: responseSchema
      }
    };
  } else {
    body.response_format = { type: "json_object" };
  }
  return { provider, headers, body };
}
