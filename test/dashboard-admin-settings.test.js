import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeDashboardAiSettingsPatch,
  normalizeDashboardCommandPermissionsPatch,
  normalizeDashboardIdentityPatch
} from "../src/dashboard-admin-settings.js";

const models = [
  { id: "a", model: "gpt-a", supportedReasoningEfforts: ["low", "medium"], defaultReasoningEffort: "low", serviceTiers: [{ id: "fast" }], defaultServiceTier: null },
  { id: "b", model: "gpt-b", supportedReasoningEfforts: ["medium", "high"], defaultReasoningEffort: "medium", serviceTiers: [] }
];

test("AI settings follow the live model catalog", () => {
  const current = { model: "gpt-a", reasoningEffort: "low", reasoningSummary: "auto", personality: "none", serviceTier: "fast" };
  const next = normalizeDashboardAiSettingsPatch({ model: "gpt-b" }, current, { models });
  assert.equal(next.model, "gpt-b");
  assert.equal(next.reasoningEffort, "medium", "an unsupported effort falls back to the model default");
  assert.equal(next.serviceTier, "", "an unsupported tier is cleared");
  assert.throws(() => normalizeDashboardAiSettingsPatch({ model: "gpt-z" }, current, { models }), /model list/);
  assert.throws(() => normalizeDashboardAiSettingsPatch({ reasoningEffort: "high" }, current, { models }), /low, medium/);
  assert.throws(() => normalizeDashboardAiSettingsPatch({ reasoningSummary: "loud" }, current, { models }), RangeError);
  assert.equal(normalizeDashboardAiSettingsPatch({ personality: "friendly" }, current, { models }).personality, "friendly");
});

test("Claude Code model settings are edited beside the Codex ones", () => {
  const current = {
    model: "gpt-a", reasoningEffort: "low", reasoningSummary: "auto", personality: "none", serviceTier: "",
    claude: { model: "opus", reasoningEffort: "" }
  };
  const next = normalizeDashboardAiSettingsPatch({ claude: { model: "sonnet[1m]", reasoningEffort: "HIGH" } }, current, { models });
  assert.deepEqual(next.claude, { model: "sonnet[1m]", reasoningEffort: "high" });
  // Codex fields are untouched and the current object is not mutated.
  assert.equal(next.model, "gpt-a");
  assert.deepEqual(current.claude, { model: "opus", reasoningEffort: "" });
  // Only the given field changes; an empty effort follows Codex.
  assert.deepEqual(normalizeDashboardAiSettingsPatch({ claude: { reasoningEffort: "" } }, next, { models }).claude, { model: "sonnet[1m]", reasoningEffort: "" });
  assert.deepEqual(normalizeDashboardAiSettingsPatch({ claude: { model: "claude-opus-4-5@20251101" } }, current, { models }).claude.model, "claude-opus-4-5@20251101");
  assert.throws(() => normalizeDashboardAiSettingsPatch({ claude: { model: "opus; rm -rf /" } }, current, { models }), RangeError);
  assert.throws(() => normalizeDashboardAiSettingsPatch({ claude: { reasoningEffort: "ultra" } }, current, { models }), /low, medium, high, xhigh, max/);
  assert.throws(() => normalizeDashboardAiSettingsPatch({ claude: "opus" }, current, { models }), TypeError);
  // A patch without claude keeps it as it was.
  assert.deepEqual(normalizeDashboardAiSettingsPatch({ personality: "friendly" }, current, { models }).claude, current.claude);
});

test("identity settings validate QQ numbers and keep owners out of admins", () => {
  const current = { ownerUserIds: ["10001"], adminUserIds: ["10002"], assistantName: "bot", ownerLabel: "主人", assistantMentions: [] };
  const next = normalizeDashboardIdentityPatch({ adminUserIds: "10002, 10001 10003", assistantMentions: "小助手，bot\nbot" }, current);
  assert.deepEqual(next.adminUserIds, ["10002", "10003"]);
  assert.deepEqual(next.assistantMentions, ["小助手", "bot"]);
  assert.throws(() => normalizeDashboardIdentityPatch({ ownerUserIds: [] }, current), /At least one owner/);
  assert.throws(() => normalizeDashboardIdentityPatch({ ownerUserIds: ["abc"] }, current), /invalid QQ/);
  assert.throws(() => normalizeDashboardIdentityPatch({ ownerLabel: "" }, current), RangeError);
});

test("command permissions only toggle configurable commands", () => {
  const catalog = [{ key: "menu", configurable: true }, { key: "fixed", configurable: false }];
  assert.deepEqual(normalizeDashboardCommandPermissionsPatch({ publicCommands: { menu: false } }, { menu: true }, catalog), { menu: false });
  assert.throws(() => normalizeDashboardCommandPermissionsPatch({ publicCommands: { fixed: true } }, {}, catalog), /fixed/);
  assert.throws(() => normalizeDashboardCommandPermissionsPatch({ publicCommands: { menu: "yes" } }, {}, catalog), TypeError);
});
