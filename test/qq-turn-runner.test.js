import test from "node:test";
import assert from "node:assert/strict";
import { formatLogMessage } from "../src/log-presentation.js";
import { runClaudeCodeTurn } from "../src/infrastructure/claude/claude-code-turn.js";
import { runCodexAppServerTurn } from "../src/codex-app-server-turn.js";
import { createQqCodexTurnRunner, selectQqAgentEngine } from "../src/infrastructure/codex/qq-turn-runner.js";
import { runAgentToolCall } from "../src/infrastructure/agent/agent-tool-context.js";
import { CODEX_LEAN_QQ_FEATURE_OVERRIDES } from "../src/infrastructure/codex/codex-lean-config.js";

const claudeThreadId = "claude:11111111-2222-4333-8444-555555555555";

test("engine table selects Codex by default and never resumes a Claude session with it", () => {
  const codex = selectQqAgentEngine("codex");
  assert.equal(selectQqAgentEngine("unknown"), codex);
  assert.equal(selectQqAgentEngine(undefined), codex);
  assert.equal(codex.runTurn, runCodexAppServerTurn);
  assert.equal(codex.canResume("019f-thread"), true);
  assert.equal(codex.canResume(claudeThreadId), false);
  assert.equal(codex.reportsQuota, true);
  assert.equal(codex.selectModel({ ai: { model: "gpt" }, claudeModel: "opus" }), "gpt");
});

test("engine table routes Claude Code settings and keeps Claude sessions resumable", () => {
  const claude = selectQqAgentEngine("claude");
  assert.equal(claude.runTurn, runClaudeCodeTurn);
  assert.equal(claude.canResume(claudeThreadId), true);
  assert.equal(claude.reportsQuota, false);
  const ai = { model: "gpt", reasoningEffort: "low" };
  assert.equal(claude.selectModel({ ai, claudeModel: "opus" }), "opus");
  assert.equal(claude.selectReasoningEffort({ ai, claudeReasoningEffort: null }), "low");
  assert.equal(claude.selectReasoningEffort({ ai, claudeReasoningEffort: "high" }), "high");
});

test("Codex QQ turns get lean config; explicit settings and owner project docs win", () => {
  const codex = selectQqAgentEngine("codex");
  const lean = codex.buildConfig(null, { leanContext: true, keepProjectDocs: false });
  assert.equal(lean["features.browser_use"], false);
  assert.equal(lean["features.multi_agent"], false);
  assert.equal(lean["skills.include_instructions"], false);
  assert.equal(lean.project_doc_max_bytes, 0);
  // Image generation stays available to QQ replies.
  assert.equal(Object.hasOwn(lean, "features.image_generation"), false);
  const owner = codex.buildConfig({ "features.goals": true }, { leanContext: true, keepProjectDocs: true });
  assert.equal(Object.hasOwn(owner, "project_doc_max_bytes"), false);
  assert.equal(owner["features.goals"], true);
  assert.equal(codex.buildConfig(null, { leanContext: false }), null);
  assert.equal(selectQqAgentEngine("claude").buildConfig(null, { leanContext: true }), null);
  assert.ok(Object.keys(CODEX_LEAN_QQ_FEATURE_OVERRIDES).length >= 10);
});

test("every engine's turn log message has a Chinese presentation", () => {
  for (const name of ["codex", "claude"]) {
    const { logLabel } = selectQqAgentEngine(name);
    for (const suffix of ["turn finished", "turn failed"]) {
      const message = `${logLabel} ${suffix}`;
      assert.notEqual(formatLogMessage(message, "zh"), message, message);
    }
  }
});

test("nested Agent turns are rejected before entering the model queue for either engine", async () => {
  for (const engine of ["codex", "claude"]) {
    let queued = false;
    const noop = () => null;
    const runner = createQqCodexTurnRunner({
      engine, limiter: { run() { queued = true; } },
      getReplyScope: noop, createStoppedError: noop, trackGeneration: noop,
      attachSteering: noop, clearGeneration: noop
    });
    await assert.rejects(runAgentToolCall(() => runner("nested summary")), { code: "CODEX_NESTED_TURN_BLOCKED" });
    assert.equal(queued, false);
  }
});

test("turn startup failures preserve the actual error and record model settings", async () => {
  const errors = [];
  const noop = () => null;
  const state = { ai: { model: "test-model", reasoningEffort: "low" }, maintenance: { codex: { quota: null }, agent: {} } };
  const runner = createQqCodexTurnRunner({
    limiter: { run: (operation) => operation() }, state,
    codexPath: "/nonexistent/qq-agent-regression", activeChildren: new Set(),
    stoppedGenerationIds: new Set(), getReplyScope: noop,
    createStoppedError: noop, trackGeneration: noop, attachSteering: noop,
    clearGeneration: noop, logContext: noop, logger: { error: (message, details) => errors.push(details) }
  });
  await assert.rejects(runner("test", { cwd: "/tmp", timeout: 1000 }), (error) => {
    assert.notEqual(error.name, "ReferenceError");
    assert.match(error.message, /ENOENT|spawn|start/i);
    return true;
  });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].model, "test-model");
  assert.equal(state.maintenance.agent.lastOk, false);
});
