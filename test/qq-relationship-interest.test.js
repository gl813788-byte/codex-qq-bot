import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseQqReplyAddressing,
  getQqRelationshipInterestPlan
} from "../src/qq-relationship-interest.js";

const now = Date.UTC(2026, 6, 15, 12, 0);

test("recent direct interaction lowers cadence to one and decays back to configured intervals", () => {
  const recent = [
    { senderId: "10001", text: "上一句", at: new Date(now - 30_000).toISOString() },
    { senderId: "assistant", isAssistant: true, replyTargetId: "10001", text: "上一条回复", at: new Date(now - 20_000).toISOString() },
    { senderId: "10001", text: "接着说", at: new Date(now - 10_000).toISOString() }
  ];
  const close = getQqRelationshipInterestPlan(recent, {
    senderId: "10001",
    now,
    baseMessages: 20,
    baseMinutes: 5
  });
  assert.equal(close.judgeEveryMessages, 1);
  assert.equal(close.judgeEveryMinutes, 1);
  assert.ok(close.interestBoost > 20);

  const distantEntries = [...recent];
  for (let index = 0; index < 24; index += 1) {
    distantEntries.push({ senderId: `2${String(index).padStart(4, "0")}`, text: `消息${index}`, at: new Date(now + index * 60_000).toISOString() });
  }
  const distant = getQqRelationshipInterestPlan(distantEntries, {
    senderId: "10001",
    now: now + 30 * 60_000,
    baseMessages: 20,
    baseMinutes: 5
  });
  assert.equal(distant.judgeEveryMessages, 20);
  assert.equal(distant.judgeEveryMinutes, 5);
  assert.equal(distant.interestBoost, 0);
});

test("unanswered bot messages suppress relationship interest", () => {
  const entries = [
    { senderId: "10001", text: "在吗", at: new Date(now - 60_000).toISOString() },
    { senderId: "assistant", isAssistant: true, replyTargetId: "10001", text: "在", at: new Date(now - 50_000).toISOString() }
  ];
  const normal = getQqRelationshipInterestPlan(entries, { senderId: "10001", now, unansweredBotStreak: 0 });
  const suppressed = getQqRelationshipInterestPlan(entries, { senderId: "10001", now, unansweredBotStreak: 4 });
  assert.ok(suppressed.interestMultiplier < normal.interestMultiplier);
  assert.ok(suppressed.interestBoost < normal.interestBoost);
});

test("reply addressing becomes more likely with message and time distance and can choose quote, mention, or plain", () => {
  const event = {
    type: "group_at",
    groupId: "20001",
    senderId: "10001",
    hasSelfAtSegment: true,
    text: "帮我看看",
    raw: { message_id: "30001" }
  };
  const closeEntries = [
    { senderId: "assistant", isAssistant: true, replyTargetId: "10001", text: "刚回过", at: new Date(now - 10_000).toISOString() },
    { senderId: "10001", text: "帮我看看", at: new Date(now).toISOString() }
  ];
  const closePlain = chooseQqReplyAddressing(event, closeEntries, {
    now,
    baseMessages: 20,
    baseMinutes: 5,
    random: () => 0.5
  });
  assert.equal(closePlain.mode, "plain");

  const distantEntries = [
    { senderId: "assistant", isAssistant: true, replyTargetId: "10001", text: "很久前", at: new Date(now - 60 * 60_000).toISOString() },
    ...Array.from({ length: 25 }, (_, index) => ({ senderId: "10002", text: `路过${index}`, at: new Date(now - (25 - index) * 60_000).toISOString() }))
  ];
  const quoted = chooseQqReplyAddressing(event, distantEntries, { now, random: () => 0.1 });
  const mentioned = chooseQqReplyAddressing(event, distantEntries, {
    now,
    random: (seed) => seed.endsWith(":mode") ? 0.9 : 0.1
  });
  assert.ok(quoted.probability > closePlain.probability);
  assert.equal(quoted.mode, "quote");
  assert.equal(mentioned.mode, "mention");
});
