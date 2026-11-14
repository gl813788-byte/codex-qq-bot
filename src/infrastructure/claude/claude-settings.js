// Claude Code's own model settings, editable from the dashboard and saved in
// data/settings.json (ai.claude). CODEX_REMOTE_CONTACT_CLAUDE_MODEL and
// CODEX_REMOTE_CONTACT_CLAUDE_EFFORT are only the defaults. An empty
// reasoning effort follows the Codex setting, the way the engine table's
// selectReasoningEffort already falls back.

export const CLAUDE_MODEL_SUGGESTIONS = Object.freeze(["opus", "sonnet", "haiku"]);
export const CLAUDE_REASONING_EFFORTS = Object.freeze(["low", "medium", "high", "xhigh", "max"]);

// Aliases (opus, sonnet[1m]) and full ids (claude-opus-4-5, …@20250929).
const CLAUDE_MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@[\]-]{0,119}$/;

export function isValidClaudeModel(value) {
  return typeof value === "string" && CLAUDE_MODEL_PATTERN.test(value.trim());
}

export function isValidClaudeReasoningEffort(value) {
  return value === "" || CLAUDE_REASONING_EFFORTS.includes(value);
}

// Saved or defaulted settings, always complete; invalid fields keep the default.
export function normalizeClaudeSettings(value, { model = "opus", reasoningEffort = "" } = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const savedModel = typeof source.model === "string" ? source.model.trim() : "";
  const savedEffort = typeof source.reasoningEffort === "string" ? source.reasoningEffort.trim().toLowerCase() : null;
  return {
    model: isValidClaudeModel(savedModel) ? savedModel : (isValidClaudeModel(model) ? String(model).trim() : "opus"),
    reasoningEffort: savedEffort !== null && isValidClaudeReasoningEffort(savedEffort)
      ? savedEffort
      : isValidClaudeReasoningEffort(String(reasoningEffort || "")) ? String(reasoningEffort || "") : ""
  };
}

// A dashboard patch: only the fields present change; invalid values throw.
export function applyClaudeSettingsPatch(input, current = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("claude settings must be an object");
  const next = normalizeClaudeSettings(current);
  if (Object.hasOwn(input, "model")) {
    const model = String(input.model ?? "").trim();
    if (!isValidClaudeModel(model)) throw new RangeError("claude.model must be a model alias such as opus or a full model id");
    next.model = model;
  }
  if (Object.hasOwn(input, "reasoningEffort")) {
    const effort = String(input.reasoningEffort ?? "").trim().toLowerCase();
    if (!isValidClaudeReasoningEffort(effort)) {
      throw new RangeError(`claude.reasoningEffort must be empty or one of: ${CLAUDE_REASONING_EFFORTS.join(", ")}`);
    }
    next.reasoningEffort = effort;
  }
  return next;
}
