import assert from "node:assert/strict";
import test from "node:test";
import {
  createQqChatSendSession,
  formatQqChatSendResult,
  normalizeQqChatSendArguments,
  QQ_CHAT_SEND_MAX_PER_TURN,
  summarizeQqChatSendDeliveries,
  toQqAgentOutputValue
} from "../src/app/qq-chat-send-tool.js";
import { parseQqAgentOutput } from "../src/infrastructure/codex/qq-agent-output.js";

const delivered = (bubbles) => ({
  reply: bubbles.join("\n|||\n"),
  send: { ok: true, bubbles, results: bubbles.map(() => ({ ok: true })) },
  receipt: {
    attemptedBubbleCount: bubbles.length,
    deliveredBubbleCount: bubbles.length,
    failedBubbleCount: 0,
    deliveredBubbles: [...bubbles],
    failedBubbles: [],
    error: ""
  }
});

test("send arguments are cleaned into the final output's visible fields", () => {
  const message = normalizeQqChatSendArguments({
    bubbles: ["  笑死 ", "", "真的假的"],
    reply: { mode: "quote", targetUserId: "123456" },
    attachments: [{ path: "/tmp/out/a.png" }, { kind: "file", path: "/tmp/out/b.txt", name: "b" }, { kind: "image", path: "" }],
    sticker: " #3 "
  });
  assert.deepEqual(message.bubbles, ["笑死", "真的假的"]);
  assert.deepEqual(message.reply, { mode: "quote", targetUserId: "123456" });
  assert.deepEqual(message.attachments, [
    { kind: "image", path: "/tmp/out/a.png", name: "" },
    { kind: "file", path: "/tmp/out/b.txt", name: "b" }
  ]);
  assert.equal(message.sticker, "#3");
  // A target only matters for quote/mention, and a bad mode falls back to automatic.
  assert.deepEqual(normalizeQqChatSendArguments({ bubbles: ["x"], reply: { mode: "shout", targetUserId: "123456" } }).reply, {
    mode: "automatic",
    targetUserId: ""
  });
  // Some models name the field text.
  assert.deepEqual(normalizeQqChatSendArguments({ text: "在的" }).bubbles, ["在的"]);
  const many = normalizeQqChatSendArguments({ bubbles: Array.from({ length: 15 }, (_, index) => `b${index}`) });
  assert.equal(many.bubbles.length, 12);
  assert.equal(many.droppedBubbleCount, 3);
});

test("a send-tool message goes through the same marker pipeline as a structured reply", () => {
  const message = normalizeQqChatSendArguments({
    bubbles: ["给你", "[[qq_reply:quote:999999]]看这个"],
    reply: { mode: "mention", targetUserId: "123456" },
    attachments: [{ kind: "image", path: "/w/out/pic.png" }],
    sticker: "#2"
  });
  const parsed = parseQqAgentOutput(JSON.stringify(toQqAgentOutputValue(message)));
  assert.equal(parsed.structured, true);
  assert.equal(parsed.output, "给你\n|||\n看这个\n|||\n[[qq_sticker:#2]]\n[[qq_reply:mention:123456]]\n[[qq_image:/w/out/pic.png]]");
});

test("sends are delivered in order and report receipts the model can trust", async () => {
  const calls = [];
  const session = createQqChatSendSession({
    deliver: async (message, context) => {
      calls.push({ bubbles: message.bubbles, ...context });
      await new Promise((resolve) => setTimeout(resolve, message.bubbles[0] === "先" ? 20 : 0));
      return delivered(message.bubbles);
    }
  });
  const [first, second] = await Promise.all([
    session.send({ bubbles: ["先"] }, { threadId: "t1" }),
    session.send({ bubbles: ["后"] }, { threadId: "t1" })
  ]);
  assert.deepEqual(calls.map((call) => [call.bubbles[0], call.sendIndex, call.threadId]), [["先", 0, "t1"], ["后", 1, "t1"]]);
  assert.equal(first.ok, true);
  assert.match(first.reply, /已送达 1 条/);
  assert.match(second.reply, /别重发/);
  assert.equal(session.deliveredBubbleCount, 2);
});

test("repeats, empty messages, the per-turn limit and late calls are refused without delivering", async () => {
  let deliveries = 0;
  const session = createQqChatSendSession({
    maxSends: 2,
    deliver: async (message) => {
      deliveries += 1;
      return delivered(message.bubbles);
    }
  });
  assert.equal((await session.send({ bubbles: [] })).ok, false);
  assert.equal((await session.send({ bubbles: ["哈哈"] })).ok, true);
  const repeat = await session.send({ bubbles: [" 哈哈 "] });
  assert.equal(repeat.ok, false);
  assert.match(repeat.error, /已经发出/);
  assert.equal((await session.send({ bubbles: ["第二句"] })).ok, true);
  const limited = await session.send({ bubbles: ["第三句"] });
  assert.equal(limited.ok, false);
  assert.match(limited.error, /2 次/);
  await session.close();
  const late = await session.send({ bubbles: ["迟到"] });
  assert.equal(late.ok, false);
  assert.match(late.error, /已经结束/);
  assert.equal(deliveries, 2);
  assert.equal(QQ_CHAT_SEND_MAX_PER_TURN >= 10, true);
});

test("a refused or stopped send is not recorded as a failed delivery", async () => {
  const refusing = createQqChatSendSession({ deliver: async () => ({ refused: true, reason: "刚才有人说话了" }) });
  assert.deepEqual(await refusing.send({ bubbles: ["冷场开场白"] }), { ok: false, error: "刚才有人说话了" });
  assert.equal(refusing.deliveries.length, 0);

  const stopping = createQqChatSendSession({
    deliver: async () => {
      throw Object.assign(new Error("stopped"), { code: "QQ_REPLY_STOPPED" });
    }
  });
  const stopped = await stopping.send({ bubbles: ["半句"] });
  assert.equal(stopped.ok, false);
  assert.equal(stopping.deliveries.length, 0);
  assert.equal(stopping.snapshot().closed, true);

  const failing = createQqChatSendSession({
    deliver: async () => {
      throw new Error("OneBot timeout");
    }
  });
  const failed = await failing.send({ bubbles: ["没送到"] });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /OneBot timeout/);
  assert.match(failed.error, /不要说已经发了/);
  assert.deepEqual(failing.deliveries[0].receipt.failedBubbles, ["没送到"]);
});

test("partial delivery tells the model exactly which bubbles were not seen", () => {
  const partial = formatQqChatSendResult({
    deliveredBubbleCount: 1,
    failedBubbleCount: 1,
    deliveredBubbles: ["第一句"],
    failedBubbles: ["第二句"],
    error: "风控"
  }, { remaining: 3 });
  assert.equal(partial.ok, true);
  assert.match(partial.reply, /送达 1 条，失败 1 条（风控）/);
  assert.match(partial.reply, /「第二句」/);
});

test("a turn's sends fold into one receipt-exact reply for the lifecycle", () => {
  const summary = summarizeQqChatSendDeliveries([
    { receipt: { deliveredBubbles: ["等我看看"], failedBubbles: [] } },
    { receipt: { deliveredBubbles: ["查到了", "[[qq_sticker:#1]]"], failedBubbles: ["附件说明"], error: "file rejected" } }
  ]);
  assert.equal(summary.sendCount, 2);
  assert.equal(summary.deliveredBubbleCount, 3);
  assert.equal(summary.reply, "等我看看\n|||\n查到了\n|||\n[[qq_sticker:#1]]\n|||\n附件说明");
  assert.equal(summary.deliveredReply, "等我看看\n|||\n查到了\n|||\n[[qq_sticker:#1]]");
  assert.equal(summary.send.ok, false);
  assert.equal(summary.send.toolDelivered, true);
  assert.deepEqual(summary.send.results.map((result) => result.ok), [true, true, true, false]);
  assert.equal(summary.send.error, "file rejected");
  assert.equal(summarizeQqChatSendDeliveries([]).send, null);
});
