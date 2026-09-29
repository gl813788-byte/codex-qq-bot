// Facts about each agent engine shared by the turn runner, logs, the
// dashboard API and QQ status text. It imports nothing so log tooling and the
// terminal viewer can use it; code that runs turns adds the engine modules in
// the turn runner's table.

export const AGENT_LOG_CATEGORY = "agent";
// Before Claude Code support every agent log was written as "codex".
export const LEGACY_AGENT_LOG_CATEGORY = "codex";

const engines = Object.freeze({
  codex: Object.freeze({
    id: "codex",
    name: "Codex",
    logLabel: "Codex app-server",
    runtime: "codex-app-server-native",
    // The ChatGPT account feeds a usage window, and QQ /模型 switches models
    // from the Codex catalog.
    reportsQuota: true,
    modelCatalog: true,
    selectModel: ({ ai } = {}) => ai?.model || null,
    selectReasoningEffort: ({ ai } = {}) => ai?.reasoningEffort || null
  }),
  claude: Object.freeze({
    id: "claude",
    name: "Claude Code",
    logLabel: "Claude Code",
    runtime: "claude-code-stream-json",
    reportsQuota: false,
    modelCatalog: false,
    selectModel: ({ claudeModel } = {}) => claudeModel || null,
    selectReasoningEffort: ({ ai, claudeReasoningEffort } = {}) => claudeReasoningEffort || ai?.reasoningEffort || null
  })
});

export const AGENT_ENGINE_IDS = Object.freeze(Object.keys(engines));

export function isAgentEngineId(value) {
  return Object.hasOwn(engines, String(value || "").trim().toLowerCase());
}

export function getAgentEngine(id) {
  const value = String(id || "").trim().toLowerCase();
  return engines[Object.hasOwn(engines, value) ? value : "codex"];
}

// What the active engine is running with right now; settings are
// { ai, claudeModel, claudeReasoningEffort }.
export function describeAgentEngine(id, settings = {}) {
  const engine = getAgentEngine(id);
  return {
    engine: engine.id,
    name: engine.name,
    runtime: engine.runtime,
    model: engine.selectModel(settings),
    reasoningEffort: engine.selectReasoningEffort(settings),
    reportsQuota: engine.reportsQuota,
    modelCatalog: engine.modelCatalog
  };
}

export function formatAgentEngineSummary(description) {
  const settings = [description?.model, description?.reasoningEffort].filter(Boolean).join(" / ");
  return settings ? `${description.name} · ${settings}` : String(description?.name || "");
}

// Agent log entries name their engine in details.engine. Legacy "codex"
// entries came from Codex, except the first Claude Code turns, which are
// recognizable by their message or claude: thread id.
export function resolveLogEngine(entry) {
  const value = String(entry?.details?.engine || "").trim().toLowerCase();
  if (isAgentEngineId(value)) return value;
  if (String(entry?.category || "").toLowerCase() !== LEGACY_AGENT_LOG_CATEGORY) return null;
  const claudeTurn = /^Claude Code\b/.test(String(entry?.message || ""))
    || String(entry?.details?.threadId || "").startsWith("claude:");
  return claudeTurn ? "claude" : "codex";
}

export function canonicalLogCategory(category) {
  const value = String(category || "").toLowerCase();
  return value === LEGACY_AGENT_LOG_CATEGORY ? AGENT_LOG_CATEGORY : value;
}

export function expandLogCategoryFilter(categories) {
  const expanded = new Set(categories);
  if (expanded.has(AGENT_LOG_CATEGORY)) expanded.add(LEGACY_AGENT_LOG_CATEGORY);
  return expanded;
}
