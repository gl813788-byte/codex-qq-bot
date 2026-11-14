import test from "node:test";
import assert from "node:assert/strict";
import { createCodexModelCatalog, findCodexModel, normalizeCodexModels, readCodexModels } from "../src/codex-model-catalog.js";

test("normalizes visible Codex models and their reasoning efforts", () => {
  const models = normalizeCodexModels([
    {
      id: "gpt-current",
      model: "gpt-current",
      displayName: "GPT Current",
      description: "Current model",
      hidden: false,
      isDefault: true,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: [
        { reasoningEffort: "low", description: "Fast" },
        { reasoningEffort: "medium", description: "Balanced" }
      ],
      defaultServiceTier: null,
      serviceTiers: [{ id: "fast", name: "Fast", description: "Higher speed" }]
    },
    { id: "hidden", model: "hidden", hidden: true }
  ]);

  assert.deepEqual(models, [{
    id: "gpt-current",
    model: "gpt-current",
    displayName: "GPT Current",
    description: "Current model",
    isDefault: true,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium"],
    defaultServiceTier: null,
    serviceTiers: [{ id: "fast", name: "Fast", description: "Higher speed" }]
  }]);
});

test("finds a Codex model by picker number, id, or model slug", () => {
  const models = [
    { id: "first", model: "gpt-first" },
    { id: "second", model: "gpt-second" }
  ];
  assert.equal(findCodexModel(models, "2"), models[1]);
  assert.equal(findCodexModel(models, "FIRST"), models[0]);
  assert.equal(findCodexModel(models, "GPT-SECOND"), models[1]);
  assert.equal(findCodexModel(models, "3"), null);
});

test("rejects cleanly when the Codex app-server exits before reading stdin", async () => {
  await assert.rejects(
    readCodexModels({ codexPath: "/bin/false", timeoutMs: 1_000 }),
    /EPIPE|exited with|stdin closed/
  );
});

test("peek returns the cached list without starting a process", async () => {
  let spawned = 0;
  const catalog = createCodexModelCatalog({
    codexPath: "/bin/false",
    timeoutMs: 1_000,
    spawnProcess: (...args) => {
      spawned += 1;
      throw new Error(`spawn ${args[0]}`);
    }
  });
  assert.equal(catalog.peek(), null);
  assert.equal(spawned, 0);
  await assert.rejects(catalog.list());
  assert.equal(spawned, 1);
  assert.equal(catalog.peek(), null, "a failed read caches nothing");
});
