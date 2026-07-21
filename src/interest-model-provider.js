export const INTEREST_MODEL_PROVIDER_IDS = Object.freeze(["openrouter", "deepseek", "custom"]);

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
  })
});

export function normalizeInterestModelProvider(value) {
  const provider = String(value || "").trim().toLowerCase();
  return INTEREST_MODEL_PROVIDER_IDS.includes(provider) ? provider : "openrouter";
}

export function getInterestModelProviderDefinition(value) {
  return definitions[normalizeInterestModelProvider(value)];
}

export function listInterestModelProviders() {
  return INTEREST_MODEL_PROVIDER_IDS.map((id) => ({ ...definitions[id] }));
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
