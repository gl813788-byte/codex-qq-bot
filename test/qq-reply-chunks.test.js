import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQqReplySendPlan,
  splitBubbleAtNaturalBoundaries
} from "../src/qq-reply-chunks.js";

test("keeps short and explicitly separated QQ replies unchanged", () => {
  assert.deepEqual(buildQqReplySendPlan("短回复").bubbles, ["短回复"]);
  assert.deepEqual(
    buildQqReplySendPlan("第一条\n---\n第二条", { separator: "---" }).bubbles,
    ["第一条", "第二条"]
  );
});

test("automatically splits a long answer at natural boundaries without losing content", () => {
  const source = `${"第一步：建立坐标系。".repeat(30)}\n${"第二步：代入并化简。".repeat(30)}`;
  const plan = buildQqReplySendPlan(source, {
    maxChars: 200,
    maxBubbles: 24
  });
  assert.ok(plan.bubbles.length > 1);
  assert.equal(plan.autoSplit, true);
  assert.equal(plan.truncated, false);
  assert.ok(plan.bubbles.every((bubble) => [...bubble].length <= 200));
  assert.equal(plan.bubbles.join("").replace(/\s+/g, ""), source.replace(/\s+/g, ""));
});

test("hard-splits an unbroken long token and exposes bounded overflow", () => {
  const chunks = splitBubbleAtNaturalBoundaries("甲".repeat(450), 200);
  assert.deepEqual(chunks.map((chunk) => [...chunk].length), [200, 200, 50]);

  const plan = buildQqReplySendPlan("甲".repeat(900), {
    maxChars: 200,
    maxBubbles: 2
  });
  assert.equal(plan.bubbles.length, 2);
  assert.equal(plan.truncated, true);
  assert.ok(plan.omittedChars > 0);
  assert.match(plan.bubbles[1], /安全上限/);
  assert.ok(plan.bubbles.every((bubble) => [...bubble].length <= 200));
});
