export const CODEX_TASK_TYPES = Object.freeze({
  QQ_REPLY: "qq-reply",
  QQ_VISION_REPLY: "qq-vision-reply",
  QQ_CONTEXT_SUMMARY: "qq-context-summary",
  QQ_SELF_PERSONA: "qq-self-persona",
  QQ_FILE_TASK: "qq-file-task",
  QQ_IMAGE_GENERATION: "qq-image-generation"
});

export const CODEX_TASK_TIMEOUT_DEFAULTS = Object.freeze({
  [CODEX_TASK_TYPES.QQ_REPLY]: 120_000,
  [CODEX_TASK_TYPES.QQ_VISION_REPLY]: 180_000,
  [CODEX_TASK_TYPES.QQ_CONTEXT_SUMMARY]: 90_000,
  [CODEX_TASK_TYPES.QQ_SELF_PERSONA]: 90_000,
  [CODEX_TASK_TYPES.QQ_FILE_TASK]: 300_000,
  [CODEX_TASK_TYPES.QQ_IMAGE_GENERATION]: 600_000
});

export const CODEX_REASONING_TIMEOUT_MULTIPLIERS = Object.freeze({
  low: 1,
  medium: 1.5,
  high: 2,
  xhigh: 3,
  max: 4,
  ultra: 5
});

export const CODEX_TASK_TIMEOUT_MAXIMUMS = Object.freeze({
  [CODEX_TASK_TYPES.QQ_REPLY]: 30 * 60_000,
  [CODEX_TASK_TYPES.QQ_VISION_REPLY]: 30 * 60_000,
  [CODEX_TASK_TYPES.QQ_CONTEXT_SUMMARY]: 30 * 60_000,
  [CODEX_TASK_TYPES.QQ_SELF_PERSONA]: 30 * 60_000,
  [CODEX_TASK_TYPES.QQ_FILE_TASK]: 30 * 60_000,
  [CODEX_TASK_TYPES.QQ_IMAGE_GENERATION]: 60 * 60_000
});

export function normalizeCodexReasoningEffort(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[-_\s]+/g, "");
  const aliases = {
    低: "low",
    中: "medium",
    高: "high",
    最高: "xhigh",
    极高: "max",
    极致: "ultra",
    extra: "xhigh",
    extrahigh: "xhigh"
  };
  const effort = aliases[normalized] || normalized;
  return Object.hasOwn(CODEX_REASONING_TIMEOUT_MULTIPLIERS, effort) ? effort : "low";
}

export function getCodexTaskTimeoutPolicy(timeouts, taskType, reasoningEffort = "low") {
  const fallback = CODEX_TASK_TIMEOUT_DEFAULTS[CODEX_TASK_TYPES.QQ_REPLY];
  const defaultValue = CODEX_TASK_TIMEOUT_DEFAULTS[taskType] || fallback;
  const configured = Number(timeouts?.[taskType]);
  const baseTimeoutMs = Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : defaultValue;
  const effort = normalizeCodexReasoningEffort(reasoningEffort);
  const multiplier = CODEX_REASONING_TIMEOUT_MULTIPLIERS[effort];
  const maximumMs = CODEX_TASK_TIMEOUT_MAXIMUMS[taskType]
    || CODEX_TASK_TIMEOUT_MAXIMUMS[CODEX_TASK_TYPES.QQ_REPLY];
  return {
    taskType: CODEX_TASK_TIMEOUT_DEFAULTS[taskType] ? taskType : CODEX_TASK_TYPES.QQ_REPLY,
    reasoningEffort: effort,
    multiplier,
    baseTimeoutMs,
    timeoutMs: Math.min(maximumMs, Math.max(10_000, Math.floor(baseTimeoutMs * multiplier))),
    maximumMs
  };
}

export function getCodexTaskTimeoutMs(timeouts, taskType, reasoningEffort = "low") {
  return getCodexTaskTimeoutPolicy(timeouts, taskType, reasoningEffort).timeoutMs;
}

export function getCodexTaskTimeoutPolicyMap(timeouts, reasoningEffort = "low") {
  return Object.fromEntries(Object.values(CODEX_TASK_TYPES).map((taskType) => {
    const policy = getCodexTaskTimeoutPolicy(timeouts, taskType, reasoningEffort);
    return [taskType, policy];
  }));
}
