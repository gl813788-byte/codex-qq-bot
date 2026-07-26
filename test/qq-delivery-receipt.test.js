import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQqDeliveryReceipt,
  createQqDeliveryFailureMemoryEntry,
  formatQqDeliveryFailureContext
} from "../src/qq-delivery-receipt.js";

test("records exactly which QQ bubbles were delivered or failed", () => {
  const receipt = buildQqDeliveryReceipt("第一条\n第二条", {
    ok: false,
    bubbles: ["第一条", "第二条"],
    results: [
      { ok: true, status: 200 },
      { ok: false, status: 500, error: "send failed" }
    ]
  }, { at: "2026-07-25T12:30:00.000Z" });

  assert.deepEqual(receipt.deliveredBubbles, ["第一条"]);
  assert.deepEqual(receipt.failedBubbles, ["第二条"]);
  assert.equal(receipt.deliveredBubbleCount, 1);
  assert.equal(receipt.failedBubbleCount, 1);
  assert.equal(receipt.error, "send failed");

  const entry = createQqDeliveryFailureMemoryEntry({
    senderId: "10001",
    senderName: "甲"
  }, receipt);
  const context = formatQqDeliveryFailureContext([entry], { assistantName: "麦麦" });
  assert.match(context, /没有成功到达 QQ/);
  assert.match(context, /未送达内容：第二条/);
  assert.match(context, /不能当作已经对群友说过/);
});

test("treats a thrown single-message send as an undelivered attempt", () => {
  const receipt = buildQqDeliveryReceipt("没有发出去", {
    ok: false,
    error: "network unavailable"
  });
  assert.equal(receipt.deliveredBubbleCount, 0);
  assert.deepEqual(receipt.failedBubbles, ["没有发出去"]);
  assert.equal(receipt.error, "network unavailable");
});
