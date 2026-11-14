// Validation for the dashboard's advanced settings: the main agent model,
// the Bot's identity and roles, and which commands ordinary users may run.
// Each function validates a patch against the current values and returns the
// complete next values; the caller applies, persists and rolls back.
import {
  isValidCodexPersonality,
  isValidCodexServiceTier,
  isValidReasoningEffort,
  isValidReasoningSummary
} from "./app/qq-codex-runtime-settings.js";
import { applyClaudeSettingsPatch } from "./infrastructure/claude/claude-settings.js";

const QQ_ID_PATTERN = /^[1-9][0-9]{4,12}$/;

export function normalizeDashboardAiSettingsPatch(input, current = {}, { models = [] } = {}) {
  assertObject(input, "AI settings");
  const next = {
    model: String(current.model || ""),
    reasoningEffort: String(current.reasoningEffort || ""),
    reasoningSummary: String(current.reasoningSummary || "auto"),
    personality: String(current.personality || "none"),
    serviceTier: String(current.serviceTier || ""),
    ...(current.claude ? { claude: { ...current.claude } } : {})
  };
  // Claude Code's own model and effort, checked by the Claude validator.
  if (Object.hasOwn(input, "claude")) next.claude = applyClaudeSettingsPatch(input.claude, current.claude || {});
  const catalog = Array.isArray(models) ? models : [];
  let selected = catalog.find((item) => item.model === next.model) || null;
  if (Object.hasOwn(input, "model")) {
    const model = String(input.model || "").trim();
    if (!model || model.length > 120 || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(model)) {
      throw new RangeError("model must be a valid model id");
    }
    if (catalog.length) {
      selected = catalog.find((item) => item.model === model || item.id === model) || null;
      if (!selected) throw new RangeError("model is not in this account's model list");
      next.model = selected.model;
      if (!selected.supportedReasoningEfforts?.includes(next.reasoningEffort)) {
        next.reasoningEffort = selected.defaultReasoningEffort || next.reasoningEffort;
      }
      if (next.serviceTier && !(selected.serviceTiers || []).some((tier) => tier.id === next.serviceTier)) {
        next.serviceTier = selected.defaultServiceTier || "";
      }
    } else {
      next.model = model;
    }
  }
  if (Object.hasOwn(input, "reasoningEffort")) {
    const effort = String(input.reasoningEffort || "").trim().toLowerCase();
    if (!isValidReasoningEffort(effort)) throw new RangeError("reasoningEffort is not a valid level");
    if (selected?.supportedReasoningEfforts?.length && !selected.supportedReasoningEfforts.includes(effort)) {
      throw new RangeError(`reasoningEffort must be one of: ${selected.supportedReasoningEfforts.join(", ")}`);
    }
    next.reasoningEffort = effort;
  }
  if (Object.hasOwn(input, "reasoningSummary")) {
    const summary = String(input.reasoningSummary || "").trim().toLowerCase();
    if (!isValidReasoningSummary(summary)) throw new RangeError("reasoningSummary must be auto, concise, detailed or none");
    next.reasoningSummary = summary;
  }
  if (Object.hasOwn(input, "personality")) {
    const personality = String(input.personality || "").trim().toLowerCase();
    if (!isValidCodexPersonality(personality)) throw new RangeError("personality must be none, friendly or pragmatic");
    next.personality = personality;
  }
  if (Object.hasOwn(input, "serviceTier")) {
    const tier = String(input.serviceTier || "").trim();
    if (tier && !isValidCodexServiceTier(tier)) throw new RangeError("serviceTier is not valid");
    if (tier && selected && !(selected.serviceTiers || []).some((item) => item.id === tier)) {
      throw new RangeError("serviceTier is not offered by this model");
    }
    next.serviceTier = tier;
  }
  return next;
}

export function normalizeDashboardIdentityPatch(input, current = {}) {
  assertObject(input, "Identity settings");
  const next = {
    ownerUserIds: [...(current.ownerUserIds || [])],
    adminUserIds: [...(current.adminUserIds || [])],
    assistantName: String(current.assistantName || ""),
    ownerLabel: String(current.ownerLabel || "主人"),
    assistantMentions: [...(current.assistantMentions || [])]
  };
  if (Object.hasOwn(input, "ownerUserIds")) {
    next.ownerUserIds = parseQqIdList(input.ownerUserIds, "ownerUserIds");
    if (!next.ownerUserIds.length) throw new RangeError("At least one owner QQ number is required");
  }
  if (Object.hasOwn(input, "adminUserIds")) next.adminUserIds = parseQqIdList(input.adminUserIds, "adminUserIds");
  // An owner is never also listed as an administrator.
  next.adminUserIds = next.adminUserIds.filter((id) => !next.ownerUserIds.includes(id));
  if (Object.hasOwn(input, "assistantName")) next.assistantName = boundedName(input.assistantName, "assistantName", 40);
  if (Object.hasOwn(input, "ownerLabel")) next.ownerLabel = boundedName(input.ownerLabel, "ownerLabel", 20);
  if (Object.hasOwn(input, "assistantMentions")) {
    const values = Array.isArray(input.assistantMentions) ? input.assistantMentions : String(input.assistantMentions || "").split(/[\n,，]+/);
    next.assistantMentions = [...new Set(values.map((item) => String(item || "").trim()).filter(Boolean))]
      .filter((item) => item.length <= 30)
      .slice(0, 20);
  }
  return next;
}

export function normalizeDashboardCommandPermissionsPatch(input, current = {}, catalog = []) {
  assertObject(input, "Command permissions");
  const source = input.publicCommands;
  assertObject(source, "publicCommands");
  const next = { ...current };
  const configurable = new Set(catalog.filter((command) => command.configurable).map((command) => command.key));
  for (const [key, value] of Object.entries(source)) {
    if (!configurable.has(key)) throw new RangeError(`Unknown or fixed command: ${key}`);
    if (typeof value !== "boolean") throw new TypeError(`${key} must be a boolean`);
    next[key] = value;
  }
  return next;
}

function parseQqIdList(value, key) {
  const items = Array.isArray(value) ? value : String(value || "").split(/[\s,，、]+/);
  const ids = [...new Set(items.map((item) => String(item || "").trim()).filter(Boolean))];
  for (const id of ids) {
    if (!QQ_ID_PATTERN.test(id)) throw new RangeError(`${key} contains an invalid QQ number: ${id}`);
  }
  if (ids.length > 50) throw new RangeError(`${key} allows at most 50 QQ numbers`);
  return ids;
}

function boundedName(value, key, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || [...text].length > maxLength) throw new RangeError(`${key} must be 1-${maxLength} characters`);
  return text;
}

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError(`${label} must be a JSON object`);
}
