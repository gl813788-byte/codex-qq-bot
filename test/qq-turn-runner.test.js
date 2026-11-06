import test from "node:test";
import assert from "node:assert/strict";
import { formatLogMessage } from "../src/log-presentation.js";
import { runClaudeCodeTurn } from "../src/infrastructure/claude/claude-code-turn.js";
import { runCodexAppServerTurn } from "../src/codex-app-server-turn.js";
import { createQqCodexTurnRunner, runQqAgentBackgroundTask, selectQqAgentEngine } from "../src/infrastructure/codex/qq-turn-runner.js";
import { createAgentHostBusyError } from "../src/infrastructure/agent/agent-process-gate.js";
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

function capacityRunner({ engine = "claude", gate, logger = {} } = {}) {
  const noop = () => null;
  const state = { ai: { model: "m", reasoningEffort: "low" }, maintenance: { codex: { quota: null }, agent: {} } };
  return {
    state,
    runner: createQqCodexTurnRunner({
      engine,
      limiter: { run: (operation) => operation() },
      state,
      codexPath: "/nonexistent/qq-agent-capacity",
      claudePath: "/nonexistent/qq-agent-capacity",
      activeChildren: new Set(),
      stoppedGenerationIds: new Set(),
      getReplyScope: noop,
      createStoppedError: () => Object.assign(new Error("stopped"), { code: "STOPPED" }),
      trackGeneration: noop,
      attachSteering: noop,
      clearGeneration: noop,
      logContext: () => ({}),
      logger,
      processGate: gate,
      replyCapacityWaitMs: 90_000,
      backgroundCapacityWaitMs: 30_000
    })
  };
}

test("a turn refused by the host capacity gate never starts its CLI", async () => {
  const requests = [];
  const errors = [];
  const gate = {
    acquire: async (request) => {
      requests.push(request);
      request.onWait?.({ reason: "processes", processCount: 31, processLimit: 32, requestedProcesses: request.processes });
      throw createAgentHostBusyError({ reason: "processes", processCount: 31, processLimit: 32 });
    }
  };
  const warnings = [];
  const { runner, state } = capacityRunner({
    gate,
    logger: { error: (message, details) => errors.push(details), warn: (message, details) => warnings.push({ message, details }) }
  });
  await assert.rejects(runner("hi", { cwd: "/tmp", timeout: 1000, qqEvent: { groupId: "1" }, dynamicTools: [{ name: "x" }] }), {
    code: "CODEX_HOST_BUSY"
  });
  // Spawning the nonexistent CLI would have failed with ENOENT instead.
  assert.equal(errors.length, 1);
  assert.equal(errors[0].error.code, "CODEX_HOST_BUSY");
  assert.equal(state.maintenance.agent.lastOk, false);
  assert.equal(requests[0].processes, 2);
  assert.equal(requests[0].waitMs, 90_000);
  assert.equal(warnings[0].message, "Agent turn waiting for host capacity");
  assert.equal(warnings[0].details.operation, "agent.capacity");
  assert.equal(warnings[0].details.processCount, 31);
});

test("background turns wait less, and every admitted turn releases its room", async () => {
  const requests = [];
  let released = 0;
  const gate = { acquire: async (request) => { requests.push(request); return { release: () => { released += 1; } }; } };
  const { runner } = capacityRunner({ engine: "codex", gate, logger: { error() {} } });
  await assert.rejects(runner("summary", { cwd: "/tmp", timeout: 1000 }), (error) => error.code !== "CODEX_HOST_BUSY");
  await assert.rejects(runner("summary", { cwd: "/tmp", timeout: 1000, capacityWaitMs: 5 }), (error) => error.code !== "CODEX_HOST_BUSY");
  assert.deepEqual(requests.map(({ processes, waitMs }) => ({ processes, waitMs })), [
    { processes: 2, waitMs: 30_000 },
    { processes: 2, waitMs: 5 }
  ]);
  assert.equal(released, 2);
});

test("subscription background judgments use the gate without waiting", async () => {
  const requests = [];
  let released = 0;
  const allow = { acquire: async (request) => { requests.push(request); return { release: () => { released += 1; } }; } };
  await assert.rejects(runQqAgentBackgroundTask("claude", {
    claudePath: "/nonexistent/qq-agent-capacity", cwd: "/tmp", prompt: "judge", timeoutMs: 1000, processGate: allow
  }), (error) => error.code !== "CODEX_HOST_BUSY");
  assert.deepEqual(requests.map(({ processes, waitMs }) => ({ processes, waitMs })), [{ processes: 1, waitMs: 0 }]);
  assert.equal(released, 1);
  const refuse = { acquire: async () => { throw createAgentHostBusyError({ reason: "memory", availableBytes: 1, minAvailableBytes: 2 }); } };
  await assert.rejects(runQqAgentBackgroundTask("codex", {
    codexPath: "/nonexistent/qq-agent-capacity", cwd: "/tmp", prompt: "judge", timeoutMs: 1000, processGate: refuse
  }), { code: "CODEX_HOST_BUSY" });
});
