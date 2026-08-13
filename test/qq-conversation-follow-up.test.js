import assert from "node:assert/strict";
import test from "node:test";
import {
  createQqConversationFollowUpCoordinator,
  detectQqConversationFollowUp
} from "../src/qq-conversation-follow-up.js";

const now = Date.UTC(2026, 7, 13, 12, 0);
const anchor = {
  senderId: "assistant",
  isAssistant: true,
  replyTargetId: "10001",
  text: "可以，先看一下日志里的第一条报错。",
  at: new Date(now - 90_000).toISOString()
};

test("same sender after a bot reply becomes a bounded semantic follow-up candidate", () => {
  const event = {
    type: "group_message",
    groupId: "20002",
    senderId: "10001",
    text: "看了，是连接超时",
    raw: { message_id: 2 }
  };
  const result = detectQqConversationFollowUp(event, {
    now,
    recentMessages: [
      { senderId: "10001", text: "帮我看看这个报错", messageId: "1" },
      anchor,
      { senderId: "10001", text: event.text, messageId: "2" }
    ],
    adaptiveSignals: {
      member: { sampleSize: 40, medianGapSeconds: 50, burstContinuationRatio: 0.4 },
      group: { sampleSize: 200, medianGapSeconds: 30, burstContinuationRatio: 0.25 }
    }
  });

  assert.equal(result.candidate, true);
  assert.equal(result.windowSeconds, 200);
  assert.equal(result.messageLimit, 4);
  assert.equal(result.sameSenderMessageCount, 1);
  assert.equal(result.gapSeconds, 90);
  assert.equal(result.anchorText, anchor.text);
  assert.equal(result.interveningHumanCount, 0);
});

test("the adaptive message bound closes an overlong same-sender continuation", () => {
  const event = {
    type: "group_message",
    groupId: "20002",
    senderId: "10001",
    text: "第三条以外"
  };
  const result = detectQqConversationFollowUp(event, {
    now,
    recentMessages: [
      anchor,
      { senderId: "10001", text: "第一条" },
      { senderId: "10001", text: "第二条" },
      { senderId: "10001", text: event.text }
    ],
    adaptiveSignals: {
      member: { sampleSize: 30, medianGapSeconds: 40, burstContinuationRatio: 0.05 }
    }
  });

  assert.equal(result.candidate, false);
  assert.equal(result.reason, "continuation_message_limit_reached");
  assert.equal(result.messageLimit, 2);
  assert.equal(result.sameSenderMessageCount, 3);
  assert.ok(result.anchorKey);
});

test("rapid follow-ups share one quiet-window batch and intake stays closed after judging starts", async () => {
  const batches = [];
  const coordinator = createQqConversationFollowUpCoordinator({
    delayMs: 10,
    onBatch: async (batch) => {
      batches.push(batch);
      return { decision: { ok: false } };
    }
  });
  const candidate = {
    candidate: true,
    anchorKey: "20002:10001:anchor",
    messageLimit: 4,
    windowSeconds: 240
  };

  assert.equal(coordinator.offer("20002", { text: "第一条" }, candidate).accepted, true);
  assert.equal(coordinator.offer("20002", { text: "第二条" }, candidate).accepted, true);
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(batches.length, 1);
  assert.equal(batches[0].eventCount, 2);
  assert.equal(coordinator.inspect("20002", candidate.anchorKey).phase, "declined");
  const late = coordinator.offer("20002", { text: "判定后的第三条" }, candidate);
  assert.equal(late.accepted, false);
  assert.equal(late.reason, "batch_frozen");
  assert.equal(batches.length, 1);
  coordinator.close();
});

test("reaching the adaptive message limit still waits for five-second-style quiet and invokes one batch", async () => {
  let calls = 0;
  const coordinator = createQqConversationFollowUpCoordinator({
    delayMs: 10,
    onBatch: async () => {
      calls += 1;
      return { decision: { ok: true } };
    }
  });
  const candidate = {
    candidate: true,
    anchorKey: "20002:10001:short",
    messageLimit: 2,
    windowSeconds: 180
  };

  coordinator.offer("20002", { text: "第一条" }, candidate);
  const second = coordinator.offer("20002", { text: "第二条" }, candidate);
  assert.equal(second.reason, "message_limit_reached_waiting_for_quiet");
  assert.equal(calls, 0);
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(calls, 1);
  assert.equal(coordinator.inspect("20002", candidate.anchorKey).phase, "approved");
  assert.equal(coordinator.offer("20002", { text: "第三条" }, candidate).accepted, false);
  coordinator.close();
});

test("the coordinator closes intake before awaiting the interest result", async () => {
  let releaseJudge;
  const judgeFinished = new Promise((resolve) => { releaseJudge = resolve; });
  const coordinator = createQqConversationFollowUpCoordinator({
    delayMs: 0,
    onBatch: async () => {
      await judgeFinished;
      return { decision: { ok: true } };
    }
  });
  const candidate = {
    candidate: true,
    anchorKey: "20002:10001:in-flight",
    messageLimit: 4,
    windowSeconds: 240
  };

  coordinator.offer("20002", { text: "先冻结" }, candidate);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(coordinator.inspect("20002", candidate.anchorKey).phase, "judging");
  const duringJudge = coordinator.offer("20002", { text: "判定中抵达" }, candidate);
  assert.equal(duringJudge.accepted, false);
  assert.equal(duringJudge.phase, "judging");

  releaseJudge();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(coordinator.inspect("20002", candidate.anchorKey).phase, "approved");
  coordinator.close();
});

test("statistics only bound candidacy and do not accept explicit other-person traffic", () => {
  const baseEvent = {
    type: "group_message",
    groupId: "20002",
    senderId: "10001",
    text: "你看这个"
  };
  const targeted = detectQqConversationFollowUp({ ...baseEvent, hasAtSegment: true }, {
    now,
    recentMessages: [anchor]
  });
  assert.equal(targeted.candidate, false);
  assert.equal(targeted.reason, "targets_another_member");

  const stale = detectQqConversationFollowUp(baseEvent, {
    now: now + 20 * 60_000,
    recentMessages: [anchor]
  });
  assert.equal(stale.candidate, false);
  assert.equal(stale.reason, "continuation_window_elapsed");
});

test("a bot reply aimed at someone else never creates a continuation candidate", () => {
  const result = detectQqConversationFollowUp({
    type: "group_message",
    groupId: "20002",
    senderId: "10001",
    text: "继续"
  }, {
    now,
    recentMessages: [{ ...anchor, replyTargetId: "30003" }]
  });
  assert.equal(result.candidate, false);
  assert.equal(result.reason, "bot_replied_to_someone_else");
});
