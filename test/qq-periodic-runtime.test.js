import test from "node:test";
import assert from "node:assert/strict";
import {
  clearQqOrdinaryInterestCycle,
  createEmptyQqPeriodicRuntime,
  normalizeQqPeriodicRuntime,
  restoreQqOrdinaryInterestCycles,
  summarizeQqPeriodicRuntime,
  updateQqOrdinaryInterestCycle
} from "../src/qq-periodic-runtime.js";

const event = {
  type: "group_message",
  groupId: "12345",
  senderId: "67890",
  senderName: "群昵称",
  text: "停机前的最后一条普通消息",
  selfId: "11111",
  atTargets: ["22222"],
  atMentions: [{ userId: "22222", name: "被艾特的人" }],
  proactiveObservedAtMs: Date.UTC(2026, 6, 18, 22, 0),
  proactiveSource: "onebot",
  raw: { message_id: "m-1" }
};

test("persists and restores an overdue ordinary-interest wall-clock cycle", () => {
  const startedAt = Date.UTC(2026, 6, 18, 21, 55);
  const saved = updateQqOrdinaryInterestCycle(createEmptyQqPeriodicRuntime(), event, {
    pendingMessageCount: 3,
    cycleStartedAt: startedAt,
    at: Date.UTC(2026, 6, 18, 22, 1)
  });
  const [restored] = restoreQqOrdinaryInterestCycles(JSON.parse(JSON.stringify(saved)));
  assert.equal(restored.groupId, "12345");
  assert.equal(restored.pendingMessageCount, 3);
  assert.equal(restored.cycleStartedAtMs, startedAt);
  assert.equal(restored.event.text, "停机前的最后一条普通消息");
  assert.equal(restored.event.proactiveRestoredCatchUp, true);
  assert.deepEqual(restored.event.atMentions, [{ userId: "22222", name: "被艾特的人" }]);
  assert.deepEqual(summarizeQqPeriodicRuntime(saved), {
    version: 1,
    ordinaryInterestPendingGroups: 1,
    ordinaryInterestPendingMessages: 3
  });
});

test("a completed or cleared cycle is not restored", () => {
  const saved = updateQqOrdinaryInterestCycle({}, event, {
    pendingMessageCount: 2,
    cycleStartedAt: Date.UTC(2026, 6, 18, 21, 55)
  });
  assert.equal(restoreQqOrdinaryInterestCycles(
    updateQqOrdinaryInterestCycle(saved, event, { pendingMessageCount: 0 })
  ).length, 0);
  assert.equal(restoreQqOrdinaryInterestCycles(clearQqOrdinaryInterestCycle(saved, "12345")).length, 0);
});

test("a remaining cycle restarts from the completed catch-up time", () => {
  const completedAt = Date.UTC(2026, 6, 19, 2, 30);
  const saved = updateQqOrdinaryInterestCycle({}, event, {
    pendingMessageCount: 1,
    cycleStartedAt: completedAt,
    at: completedAt
  });
  const [restored] = restoreQqOrdinaryInterestCycles(saved);
  assert.equal(restored.cycleStartedAtMs, completedAt);
});

test("normalization rejects malformed cycle records and bounds stored content", () => {
  const normalized = normalizeQqPeriodicRuntime({
    ordinaryInterestByGroupId: {
      nope: { pendingMessageCount: 5, cycleStartedAt: "bad", latestEvent: {} },
      12345: {
        pendingMessageCount: 9_999,
        cycleStartedAt: "2026-07-18T21:55:00.000Z",
        updatedAt: "2026-07-18T22:01:00.000Z",
        latestEvent: { ...event, text: "x".repeat(2_000) }
      }
    }
  });
  const [restored] = restoreQqOrdinaryInterestCycles(normalized);
  assert.equal(restored.pendingMessageCount, 1_000);
  assert.equal(restored.event.text.length, 1_200);
  assert.equal(Object.keys(normalized.ordinaryInterestByGroupId).length, 1);
});
