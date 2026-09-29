import test from "node:test";
import assert from "node:assert/strict";
import { formatLogMessage } from "../src/log-presentation.js";
import { runClaudeCodeTurn } from "../src/infrastructure/claude/claude-code-turn.js";
import { runCodexAppServerTurn } from "../src/codex-app-server-turn.js";
import { selectQqAgentEngine } from "../src/infrastructure/codex/qq-turn-runner.js";

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

test("every engine's turn log message has a Chinese presentation", () => {
  for (const name of ["codex", "claude"]) {
    const { logLabel } = selectQqAgentEngine(name);
    for (const suffix of ["turn finished", "turn failed"]) {
      const message = `${logLabel} ${suffix}`;
      assert.notEqual(formatLogMessage(message, "zh"), message, message);
    }
  }
});
