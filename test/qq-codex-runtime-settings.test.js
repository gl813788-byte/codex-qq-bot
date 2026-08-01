import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQqCodexRuntimeSettingAction,
  isQqCodexRuntimeSettingCommand,
  isValidCodexPersonality,
  isValidCodexServiceTier,
  isValidReasoningSummary,
  normalizeReasoningEffort
} from "../src/app/qq-codex-runtime-settings.js";

const modelCatalog = {
  async list() {
    return [{
      model: "gpt-test",
      displayName: "GPT Test",
      supportedReasoningEfforts: ["low", "high"],
      serviceTiers: [{ id: "fast", name: "Fast" }]
    }];
  }
};
const findModel = (models, model) => models.find((item) => item.model === model);

test("recognizes every native Codex runtime setting command", () => {
  for (const command of ["思考强度 high", "推理摘要 concise", "人格 务实", "服务档位 priority"]) {
    assert.equal(isQqCodexRuntimeSettingCommand(command), true);
  }
  assert.equal(isQqCodexRuntimeSettingCommand("模型 1"), false);
});

test("applies native settings and exposes persistence as a before-send boundary", async () => {
  const state = { ai: {
    model: "gpt-test",
    reasoningEffort: "low",
    reasoningSummary: "auto",
    personality: "none",
    serviceTier: ""
  } };
  let persisted = 0;
  const options = { state, modelCatalog, findModel, persist: async () => { persisted += 1; } };

  const summary = await buildQqCodexRuntimeSettingAction({ ...options, command: "推理摘要 详细" });
  assert.equal(state.ai.reasoningSummary, "detailed");
  assert.equal(persisted, 0);
  await summary.beforeSend();
  assert.equal(persisted, 1);

  await (await buildQqCodexRuntimeSettingAction({ ...options, command: "人格 务实" })).beforeSend();
  await (await buildQqCodexRuntimeSettingAction({ ...options, command: "服务档位 fast" })).beforeSend();
  assert.equal(state.ai.personality, "pragmatic");
  assert.equal(state.ai.serviceTier, "fast");
  assert.equal(persisted, 3);
});

test("rejects unsupported effort without mutating or persisting", async () => {
  const state = { ai: {
    model: "gpt-test", reasoningEffort: "low", reasoningSummary: "auto", personality: "none", serviceTier: ""
  } };
  const action = await buildQqCodexRuntimeSettingAction({
    command: "思考强度 ultra", state, modelCatalog, findModel, persist: () => { throw new Error("must not persist"); }
  });
  assert.match(action.reply, /不支持 ultra/);
  assert.equal(action.beforeSend, undefined);
  assert.equal(state.ai.reasoningEffort, "low");
});

test("validates persisted native values", () => {
  assert.equal(isValidReasoningSummary("detailed"), true);
  assert.equal(isValidReasoningSummary("verbose"), false);
  assert.equal(isValidCodexPersonality("friendly"), true);
  assert.equal(isValidCodexPersonality("custom"), false);
  assert.equal(isValidCodexServiceTier(""), true);
  assert.equal(isValidCodexServiceTier("priority"), true);
});

test("maps Chinese extra-high and maximum reasoning labels in the correct order", () => {
  assert.equal(normalizeReasoningEffort("极高"), "xhigh");
  assert.equal(normalizeReasoningEffort("最高"), "max");
});

test("shows the corrected Chinese labels in the reasoning picker", async () => {
  const state = { ai: {
    model: "gpt-test", reasoningEffort: "low", reasoningSummary: "auto", personality: "none", serviceTier: ""
  } };
  const action = await buildQqCodexRuntimeSettingAction({
    command: "思考强度",
    state,
    modelCatalog: {
      async list() {
        return [{
          model: "gpt-test",
          displayName: "GPT Test",
          supportedReasoningEfforts: ["xhigh", "max"],
          serviceTiers: []
        }];
      }
    },
    findModel,
    persist: async () => {}
  });
  assert.match(action.reply, /xhigh（极高）/);
  assert.match(action.reply, /max（最高）/);
});
