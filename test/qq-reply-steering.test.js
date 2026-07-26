import assert from "node:assert/strict";
import test from "node:test";
import {
  createQqReplySteeringCoordinator,
  fuseCompletedQqReplyFollowUps,
  QQ_FOLLOW_UP_WINDOW_MS
} from "../src/qq-reply-steering.js";

test("uses a resettable five-second follow-up quiet window without a fixed maximum", () => {
  const coordinator = createQqReplySteeringCoordinator();
  assert.equal(QQ_FOLLOW_UP_WINDOW_MS, 5_000);
  assert.deepEqual(coordinator.snapshot(), {
    scheduled: 0,
    closed: false,
    delayMs: 5_000,
    maxDelayMs: null
  });
  coordinator.close();
});

test("coalesces pending entries into one replacement and consumes only the accepted snapshot", async () => {
  const pending = {
    group: [
      { id: "one", text: "first" },
      { id: "two", text: "second" }
    ]
  };
  const restarted = [];
  const generation = {
    id: "generation-1",
    restart: async (input) => {
      restarted.push(input);
      pending.group.push({ id: "three", text: "arrived during restart" });
      return { threadId: "thread-1", turnId: "turn-1" };
    }
  };
  const coordinator = createQqReplySteeringCoordinator({
    delayMs: 0,
    getActiveGeneration: () => generation,
    getPendingEntries: (scopeId) => pending[scopeId] || [],
    buildSteeringInput: (entries) => entries.map((entry) => entry.text).join("\n"),
    consumeEntries: (scopeId, entries) => {
      const ids = new Set(entries.map((entry) => entry.id));
      const before = pending[scopeId].length;
      pending[scopeId] = pending[scopeId].filter((entry) => !ids.has(entry.id));
      return before - pending[scopeId].length;
    }
  });

  const result = await coordinator.schedule("group");
  assert.equal(result.ok, true);
  assert.equal(result.consumedCount, 2);
  assert.equal(result.deliveryMode, "restarted");
  assert.equal(restarted[0], "first\nsecond");

  await waitFor(() => restarted.length === 2);
  assert.equal(restarted[1], "arrived during restart");
  assert.deepEqual(pending.group, []);
  coordinator.close();
});

test("keeps pending entries when the active turn cannot restart", async () => {
  const pending = { group: [{ id: "one", text: "first" }] };
  const generation = {
    id: "generation-1",
    restart: async () => {
      const error = new Error("too late");
      error.code = "CODEX_TURN_NOT_ACTIVE";
      throw error;
    }
  };
  const coordinator = createQqReplySteeringCoordinator({
    delayMs: 0,
    getActiveGeneration: () => generation,
    getPendingEntries: (scopeId) => pending[scopeId] || [],
    buildSteeringInput: (entries) => entries.map((entry) => entry.text).join("\n"),
    consumeEntries: () => {
      throw new Error("must not consume failed restart");
    }
  });

  const result = await coordinator.schedule("group");
  assert.equal(result.ok, false);
  assert.equal(result.reason, "CODEX_TURN_NOT_ACTIVE");
  assert.equal(pending.group.length, 1);
  coordinator.close();
});

test("cuts the active turn directly after the quiet window and starts a replacement answer", async () => {
  const pending = {
    group: [
      { id: "one", text: "first" },
      { id: "two", text: "second" }
    ]
  };
  const restarted = [];
  const generation = {
    id: "generation-1",
    restart: async (input) => {
      restarted.push(input);
      if (restarted.length === 1) {
        pending.group.push({ id: "three", text: "arrived during restart" });
      }
      return {
        threadId: "thread-1",
        turnId: `turn-${restarted.length + 1}`,
        interruptedTurnId: `turn-${restarted.length}`
      };
    }
  };
  const coordinator = createQqReplySteeringCoordinator({
    delayMs: 0,
    getActiveGeneration: () => generation,
    getPendingEntries: (scopeId) => pending[scopeId] || [],
    buildSteeringInput: (entries) => entries.map((entry) => entry.text).join("\n"),
    consumeEntries: (scopeId, entries) => {
      const ids = new Set(entries.map((entry) => entry.id));
      const before = pending[scopeId].length;
      pending[scopeId] = pending[scopeId].filter((entry) => !ids.has(entry.id));
      return before - pending[scopeId].length;
    }
  });

  const result = await coordinator.schedule("group");
  assert.equal(result.ok, true);
  assert.equal(result.deliveryMode, "restarted");
  assert.equal(result.interruptedTurnId, "turn-1");
  assert.equal(result.consumedCount, 2);
  assert.equal(restarted[0], "first\nsecond");

  await waitFor(() => restarted.length === 2);
  assert.equal(restarted[1], "arrived during restart");
  assert.deepEqual(pending.group, []);
  coordinator.close();
});

test("resets the fusion window so bursty triggers reach the model as one replacement", async () => {
  const pending = { group: [{ id: "one", text: "first" }] };
  const restarted = [];
  const generation = {
    id: "generation-1",
    restart: async (input) => {
      restarted.push(input);
      return { threadId: "thread-1", turnId: "turn-1" };
    }
  };
  const coordinator = createQqReplySteeringCoordinator({
    delayMs: 30,
    maxDelayMs: 100,
    getActiveGeneration: () => generation,
    getPendingEntries: (scopeId) => pending[scopeId] || [],
    buildSteeringInput: (entries) => entries.map((entry) => entry.text).join("\n"),
    consumeEntries: (scopeId, entries) => {
      const ids = new Set(entries.map((entry) => entry.id));
      pending[scopeId] = pending[scopeId].filter((entry) => !ids.has(entry.id));
      return entries.length;
    }
  });

  const scheduled = coordinator.schedule("group");
  await new Promise((resolve) => setTimeout(resolve, 15));
  pending.group.push({ id: "two", text: "second" });
  coordinator.schedule("group");
  await new Promise((resolve) => setTimeout(resolve, 15));
  pending.group.push({ id: "three", text: "third" });
  coordinator.schedule("group");

  const result = await scheduled;
  assert.equal(result.ok, true);
  assert.deepEqual(restarted, ["first\nsecond\nthird"]);
  assert.deepEqual(pending.group, []);
  coordinator.close();
});

test("waits for the resettable fusion window when scheduled work is explicitly drained", async () => {
  const pending = { group: [{ id: "one", text: "first" }] };
  const coordinator = createQqReplySteeringCoordinator({
    delayMs: 25,
    getActiveGeneration: () => null,
    getPendingEntries: (scopeId) => pending[scopeId] || []
  });

  const startedAt = Date.now();
  coordinator.schedule("group");
  await new Promise((resolve) => setTimeout(resolve, 15));
  pending.group.push({ id: "two", text: "second" });
  coordinator.schedule("group");
  const result = await coordinator.waitForIdle("group");

  assert.equal(result.reason, "no_restartable_generation");
  assert.ok(Date.now() - startedAt >= 30);
  assert.equal(pending.group.length, 2);
  coordinator.close();
});

test("hands a pending quiet-window batch to completed-reply fusion before send", async () => {
  const pending = { group: [{ id: "one", text: "first" }] };
  const coordinator = createQqReplySteeringCoordinator({
    delayMs: 5_000,
    getActiveGeneration: () => null,
    getPendingEntries: (scopeId) => pending[scopeId] || []
  });

  coordinator.schedule("group");
  const startedAt = Date.now();
  const result = await coordinator.handoff("group");

  assert.equal(result.reason, "handed_off");
  assert.ok(Date.now() - startedAt < 1_000);
  assert.equal(pending.group.length, 1);
  assert.equal(coordinator.snapshot().scheduled, 0);
  coordinator.close();
});

test("replaces an unsent completed reply immediately and repeats for newer follow-ups", async () => {
  const pending = {
    group: [{ id: "one", text: "first follow-up" }]
  };
  const replacements = [];
  let handoffCount = 0;

  const result = await fuseCompletedQqReplyFollowUps({
    scopeId: "group",
    initialReply: "stale completed answer",
    handoff: async () => {
      handoffCount += 1;
    },
    takePendingEntries: (scopeId) => {
      const entries = pending[scopeId] || [];
      pending[scopeId] = [];
      return entries;
    },
    replaceReply: async ({ draft, entries, fusionRound }) => {
      replacements.push({ draft, entries, fusionRound });
      if (fusionRound === 1) {
        pending.group.push({ id: "two", text: "newer follow-up" });
      }
      return `replacement ${fusionRound}`;
    }
  });

  assert.deepEqual(result, {
    reply: "replacement 2",
    fusedCount: 2,
    fusionRounds: 2
  });
  assert.equal(replacements[0].draft, "stale completed answer");
  assert.equal(replacements[1].draft, "replacement 1");
  assert.deepEqual(pending.group, []);
  assert.equal(handoffCount, 3);
});

test("restores a completed-reply fusion batch when the replacement turn fails", async () => {
  const pending = {
    group: [{ id: "one", text: "follow-up" }]
  };

  await assert.rejects(
    fuseCompletedQqReplyFollowUps({
      scopeId: "group",
      initialReply: "stale completed answer",
      takePendingEntries: (scopeId) => {
        const entries = pending[scopeId] || [];
        pending[scopeId] = [];
        return entries;
      },
      restorePendingEntries: (scopeId, entries) => {
        pending[scopeId] = [...entries, ...(pending[scopeId] || [])];
      },
      replaceReply: async () => {
        throw new Error("replacement failed");
      }
    }),
    /replacement failed/
  );

  assert.deepEqual(pending.group, [{ id: "one", text: "follow-up" }]);
});

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition was not met");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
