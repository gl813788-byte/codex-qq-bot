import test from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_ENGINE_IDS,
  canonicalLogCategory,
  describeAgentEngine,
  expandLogCategoryFilter,
  formatAgentEngineSummary,
  getAgentEngine,
  resolveLogEngine
} from "../src/infrastructure/agent/agent-engines.js";
import { createAgentCliVersionProbe, parseAgentCliVersion } from "../src/infrastructure/agent/agent-cli-version.js";
import { formatLogMessage, getLogCategoryLabel } from "../src/log-presentation.js";

const settings = {
  ai: { model: "gpt-5.6-sol", reasoningEffort: "low" },
  claudeModel: "opus",
  claudeReasoningEffort: null
};

test("active agent description reports what the selected engine really runs", () => {
  assert.deepEqual(describeAgentEngine("claude", settings), {
    engine: "claude",
    name: "Claude Code",
    runtime: "claude-code-stream-json",
    model: "opus",
    reasoningEffort: "low",
    reportsQuota: false,
    modelCatalog: false
  });
  const codex = describeAgentEngine("codex", settings);
  assert.equal(codex.model, "gpt-5.6-sol");
  assert.equal(codex.reportsQuota, true);
  assert.equal(codex.modelCatalog, true);
  assert.equal(getAgentEngine("unknown").id, "codex");
  assert.equal(formatAgentEngineSummary(describeAgentEngine("claude", settings)), "Claude Code · opus / low");
});

test("agent log entries resolve their engine, including legacy codex entries", () => {
  assert.equal(resolveLogEngine({ category: "agent", details: { engine: "claude" } }), "claude");
  assert.equal(resolveLogEngine({ category: "codex", message: "Codex CLI finished", details: {} }), "codex");
  assert.equal(resolveLogEngine({ category: "codex", message: "Claude Code turn finished", details: {} }), "claude");
  assert.equal(resolveLogEngine({ category: "codex", message: "QQ native Agent tool completed", details: { threadId: "claude:abc" } }), "claude");
  assert.equal(resolveLogEngine({ category: "qq", details: {} }), null);
  assert.equal(canonicalLogCategory("codex"), "agent");
  assert.equal(canonicalLogCategory("qq"), "qq");
  assert.deepEqual([...expandLogCategoryFilter(new Set(["agent"]))].sort(), ["agent", "codex"]);
  assert.deepEqual([...expandLogCategoryFilter(new Set(["codex"]))], ["codex"]);
});

test("every engine-neutral agent log message and the agent category are localized", () => {
  for (const message of [
    "Agent model output captured",
    "QQ native Agent progress",
    "QQ Agent generation stopped",
    "Agent fused replacement stalled; starting one fresh recovery",
    ...AGENT_ENGINE_IDS.flatMap((id) => [`${getAgentEngine(id).logLabel} turn finished`, `${getAgentEngine(id).logLabel} turn failed`])
  ]) {
    assert.notEqual(formatLogMessage(message, "zh"), message, message);
  }
  assert.equal(getLogCategoryLabel("agent", "zh"), "智能体");
});

test("CLI version probe answers from cache and refreshes in the background", async () => {
  assert.equal(parseAgentCliVersion("codex-cli 0.159.0\n"), "0.159.0");
  assert.equal(parseAgentCliVersion("2.1.284 (Claude Code)"), "2.1.284");
  assert.equal(parseAgentCliVersion("no version"), null);

  let clock = 0;
  const reads = [];
  const probe = createAgentCliVersionProbe({
    ttlMs: 100,
    now: () => clock,
    readVersion: async (path) => {
      reads.push(path);
      if (path === "/broken") throw new Error("spawn failed");
      return `1.0.${reads.length}`;
    }
  });
  assert.equal(probe.peek("/bin/agent"), null, "first peek starts a refresh without waiting");
  await probe.refresh("/bin/agent");
  assert.equal(probe.peek("/bin/agent"), "1.0.1");
  assert.equal(reads.length, 1, "a fresh cache entry is not re-read");
  clock = 150;
  assert.equal(probe.peek("/bin/agent"), "1.0.1", "stale value is served while refreshing");
  await probe.refresh("/bin/agent");
  assert.equal(probe.peek("/bin/agent"), "1.0.2");
  assert.equal(await probe.refresh("/broken"), null);
  assert.equal(probe.peek(""), null);
});
