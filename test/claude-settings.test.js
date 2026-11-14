import assert from "node:assert/strict";
import test from "node:test";
import {
  CLAUDE_REASONING_EFFORTS,
  applyClaudeSettingsPatch,
  isValidClaudeModel,
  normalizeClaudeSettings
} from "../src/infrastructure/claude/claude-settings.js";
import { createInitialState } from "../src/app/create-initial-state.js";
import { createEnvironmentConfig } from "../src/config/environment.js";
import { describeAgentEngine } from "../src/infrastructure/agent/agent-engines.js";

test("Claude model names accept aliases and full ids but nothing shell-like", () => {
  for (const model of ["opus", "sonnet", "haiku", "opus[1m]", "claude-opus-4-5", "claude-sonnet-4-5@20250929"]) {
    assert.equal(isValidClaudeModel(model), true, model);
  }
  for (const model of ["", " ", "opus x", "-opus", "opus;ls", "$(id)", "a".repeat(121)]) {
    assert.equal(isValidClaudeModel(model), false, model);
  }
  assert.deepEqual(CLAUDE_REASONING_EFFORTS, ["low", "medium", "high", "xhigh", "max"]);
});

test("saved Claude settings fall back to the environment defaults field by field", () => {
  assert.deepEqual(normalizeClaudeSettings(null, { model: "sonnet", reasoningEffort: "high" }), { model: "sonnet", reasoningEffort: "high" });
  assert.deepEqual(normalizeClaudeSettings({ model: "haiku" }, { model: "sonnet", reasoningEffort: "high" }), { model: "haiku", reasoningEffort: "high" });
  // A saved empty effort means "follow Codex" and wins over the default.
  assert.deepEqual(normalizeClaudeSettings({ reasoningEffort: "" }, { model: "opus", reasoningEffort: "high" }), { model: "opus", reasoningEffort: "" });
  assert.deepEqual(normalizeClaudeSettings({ model: "bad name", reasoningEffort: "ultra" }, { model: "opus" }), { model: "opus", reasoningEffort: "" });
  assert.throws(() => applyClaudeSettingsPatch({ model: "" }, {}), RangeError);
});

test("the initial state takes Claude settings from the environment and the engine reads them", () => {
  const state = createInitialState({
    config: createEnvironmentConfig({ CODEX_REMOTE_CONTACT_CLAUDE_MODEL: "sonnet", CODEX_REMOTE_CONTACT_CLAUDE_EFFORT: "max" }),
    codexWorkspaceDir: "/tmp/workspace",
    qqProactiveInterestPreset: {}
  });
  assert.deepEqual(state.ai.claude, { model: "sonnet", reasoningEffort: "max" });
  const engine = describeAgentEngine("claude", {
    ai: state.ai,
    claudeModel: state.ai.claude.model,
    claudeReasoningEffort: state.ai.claude.reasoningEffort || null
  });
  assert.equal(engine.model, "sonnet");
  assert.equal(engine.reasoningEffort, "max");
  const following = describeAgentEngine("claude", { ai: { ...state.ai, reasoningEffort: "low" }, claudeModel: "opus", claudeReasoningEffort: null });
  assert.equal(following.reasoningEffort, "low");
});
