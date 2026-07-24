import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchQqHistoryForSummary,
  mergeQqHistoryMessages
} from "../src/qq-history-retrieval.js";

test("summary history paginates NapCat records and recognizes Bot messages", async () => {
  const pages = {
    "0": [
      historyMessage("12", 120, "20002", "最新消息"),
      historyMessage("11", 110, "99999", "Bot 回复")
    ],
    "11": [
      historyMessage("11", 110, "99999", "Bot 回复"),
      historyMessage("10", 100, "30003", "更早消息")
    ],
    "10": [
      historyMessage("10", 100, "30003", "更早消息"),
      historyMessage("9", 90, "40004", "最早消息")
    ]
  };
  const result = await fetchQqHistoryForSummary({
    event: { groupId: "10001", selfId: "99999" },
    maxMessages: 4,
    pageSize: 2,
    callAction: async (endpoint, payload) => ({
      ok: true,
      body: { data: { messages: pages[String(payload.message_seq)] || [] } },
      endpoint
    })
  });
  assert.equal(result.ok, true);
  assert.equal(result.pages, 3);
  assert.deepEqual(result.messages.map((entry) => entry.messageId), ["9", "10", "11", "12"]);
  assert.equal(result.messages.find((entry) => entry.messageId === "11").isAssistant, true);
});

test("remote and Hub-local history are merged by message id without duplicates", () => {
  const merged = mergeQqHistoryMessages([
    { messageId: "1", at: "2026-07-01T00:00:00.000Z", senderId: "1", text: "远端" }
  ], [
    { messageId: "1", at: "2026-07-01T00:00:00.000Z", senderId: "1", text: "本地补充" },
    { messageId: "2", at: "2026-07-01T00:01:00.000Z", senderId: "2", text: "第二条" }
  ]);
  assert.equal(merged.length, 2);
  assert.equal(merged[0].text, "本地补充");
});

function historyMessage(messageId, time, userId, text) {
  return {
    message_id: messageId,
    message_seq: messageId,
    time,
    user_id: userId,
    raw_message: text,
    sender: { user_id: userId, nickname: `用户${userId}` }
  };
}
