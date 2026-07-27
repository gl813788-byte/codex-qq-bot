import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFusedTurnRecovery,
  runQqCodexTurnWithFusionRecovery,
  shouldRecoverFusedTurn
} from "../src/qq-codex-turn-recovery.js";

test("retries one fused replacement timeout in a fresh thread with complete context", async () => {
  const attempts = [];
  const recoveries = [];
  const result = await runQqCodexTurnWithFusionRecovery({
    prompt: "完整原始提示",
    imagePaths: ["/tmp/original.png"],
    onRecovery: (details) => recoveries.push(details),
    runAttempt: async (options) => {
      attempts.push(options);
      if (attempts.length === 1) {
        options.onRestarted({
          input: [
            { type: "text", text: "消息一：第一批追问" },
            { type: "localImage", path: "/tmp/follow-up.png" }
          ]
        });
        options.onRestarted({
          input: [{ type: "text", text: "消息二：第二批追问" }]
        });
        const error = new Error("replacement stalled");
        error.code = "CODEX_REPLACEMENT_STALLED";
        error.deadlineRenewalCount = 1;
        throw error;
      }
      return {
        finalResponse: "统一后的回复",
        threadId: "thread-recovered",
        turnId: "turn-recovered"
      };
    }
  });

  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].threadId, null);
  assert.equal(attempts[1].resumePrompt, attempts[1].prompt);
  assert.match(attempts[1].prompt, /完整原始提示/);
  assert.match(attempts[1].prompt, /消息一：第一批追问/);
  assert.match(attempts[1].prompt, /消息二：第二批追问/);
  assert.deepEqual(attempts[1].imagePaths, ["/tmp/original.png", "/tmp/follow-up.png"]);
  assert.equal(recoveries.length, 1);
  assert.equal(result.finalResponse, "统一后的回复");
  assert.equal(result.fusionRecoveryCount, 1);
  assert.equal(result.fusionRecoveryReason, "CODEX_REPLACEMENT_STALLED");
});

test("does not retry an ordinary turn timeout that had no fused replacement", async () => {
  let attempts = 0;
  await assert.rejects(runQqCodexTurnWithFusionRecovery({
    prompt: "普通消息",
    runAttempt: async () => {
      attempts += 1;
      const error = new Error("ordinary timeout");
      error.code = "CODEX_TURN_TIMEOUT";
      error.deadlineRenewalCount = 0;
      throw error;
    }
  }), (error) => error.code === "CODEX_TURN_TIMEOUT");
  assert.equal(attempts, 1);
});

test("marks a failed recovery without starting a third attempt", async () => {
  let attempts = 0;
  await assert.rejects(runQqCodexTurnWithFusionRecovery({
    prompt: "普通消息",
    runAttempt: async (options) => {
      attempts += 1;
      if (attempts === 1) {
        options.onRestarted({ input: [{ type: "text", text: "追问" }] });
        const error = new Error("timeout");
        error.code = "CODEX_TURN_TIMEOUT";
        error.deadlineRenewalCount = 1;
        throw error;
      }
      const error = new Error("retry failed");
      error.code = "CODEX_TURN_TIMEOUT";
      throw error;
    }
  }), (error) => {
    assert.equal(error.fusionRecoveryAttempted, true);
    assert.equal(error.fusionRecoveryReason, "CODEX_TURN_TIMEOUT");
    return true;
  });
  assert.equal(attempts, 2);
});

test("recovery helpers require a replacement payload and preserve local images", () => {
  const timeout = Object.assign(new Error("timeout"), {
    code: "CODEX_TURN_TIMEOUT",
    deadlineRenewalCount: 1
  });
  assert.equal(shouldRecoverFusedTurn(timeout, []), false);
  assert.equal(shouldRecoverFusedTurn(timeout, [{ type: "text", text: "new" }]), true);

  const recovery = buildFusedTurnRecovery({
    prompt: "base",
    imagePaths: ["/tmp/same.png"],
    replacementInput: [
      { type: "text", text: "new" },
      { type: "localImage", path: "/tmp/same.png" },
      { type: "localImage", path: "/tmp/new.png" }
    ]
  });
  assert.deepEqual(recovery.imagePaths, ["/tmp/same.png", "/tmp/new.png"]);
});
