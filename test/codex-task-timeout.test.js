import assert from "node:assert/strict";
import test from "node:test";
import {
  CODEX_REASONING_TIMEOUT_MULTIPLIERS,
  CODEX_TASK_TIMEOUT_DEFAULTS,
  CODEX_TASK_TYPES,
  getCodexTaskTimeoutMs,
  getCodexTaskTimeoutPolicy
} from "../src/codex-task-timeout.js";

test("scales each configured task timeout with the current reasoning effort", () => {
  const timeouts = {
    [CODEX_TASK_TYPES.QQ_REPLY]: 30_000,
    [CODEX_TASK_TYPES.QQ_IMAGE_GENERATION]: 900_000
  };

  assert.equal(getCodexTaskTimeoutMs(timeouts, CODEX_TASK_TYPES.QQ_REPLY, "low"), 30_000);
  assert.equal(getCodexTaskTimeoutMs(timeouts, CODEX_TASK_TYPES.QQ_REPLY, "medium"), 45_000);
  assert.equal(getCodexTaskTimeoutMs(timeouts, CODEX_TASK_TYPES.QQ_REPLY, "high"), 60_000);
  assert.equal(getCodexTaskTimeoutMs(timeouts, CODEX_TASK_TYPES.QQ_REPLY, "xhigh"), 90_000);
  assert.equal(getCodexTaskTimeoutMs(timeouts, CODEX_TASK_TYPES.QQ_REPLY, "max"), 120_000);
  assert.equal(getCodexTaskTimeoutMs(timeouts, CODEX_TASK_TYPES.QQ_REPLY, "ultra"), 150_000);
  assert.equal(getCodexTaskTimeoutMs(timeouts, CODEX_TASK_TYPES.QQ_IMAGE_GENERATION, "medium"), 1_350_000);
  assert.deepEqual(CODEX_REASONING_TIMEOUT_MULTIPLIERS, {
    low: 1,
    medium: 1.5,
    high: 2,
    xhigh: 3,
    max: 4,
    ultra: 5
  });
});

test("falls back to the task default for missing or invalid values", () => {
  assert.equal(
    getCodexTaskTimeoutMs({}, CODEX_TASK_TYPES.QQ_VISION_REPLY),
    CODEX_TASK_TIMEOUT_DEFAULTS[CODEX_TASK_TYPES.QQ_VISION_REPLY]
  );
  assert.equal(
    getCodexTaskTimeoutMs({ [CODEX_TASK_TYPES.QQ_FILE_TASK]: 0 }, CODEX_TASK_TYPES.QQ_FILE_TASK),
    CODEX_TASK_TIMEOUT_DEFAULTS[CODEX_TASK_TYPES.QQ_FILE_TASK]
  );
  assert.equal(
    getCodexTaskTimeoutMs({}, "unknown"),
    CODEX_TASK_TIMEOUT_DEFAULTS[CODEX_TASK_TYPES.QQ_REPLY]
  );
  assert.equal(
    getCodexTaskTimeoutMs({}, CODEX_TASK_TYPES.QQ_REPLY, "unknown"),
    CODEX_TASK_TIMEOUT_DEFAULTS[CODEX_TASK_TYPES.QQ_REPLY]
  );
});

test("reports the effective policy and caps scaled deadlines at the task maximum", () => {
  const policy = getCodexTaskTimeoutPolicy({
    [CODEX_TASK_TYPES.QQ_REPLY]: 29 * 60_000
  }, CODEX_TASK_TYPES.QQ_REPLY, "ultra");
  assert.equal(policy.reasoningEffort, "ultra");
  assert.equal(policy.multiplier, 5);
  assert.equal(policy.baseTimeoutMs, 29 * 60_000);
  assert.equal(policy.timeoutMs, 30 * 60_000);
  assert.equal(policy.maximumMs, 30 * 60_000);
});
