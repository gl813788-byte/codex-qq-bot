import assert from "node:assert/strict";
import test from "node:test";
import { isQqAffinityCommand, parseQqAffinityCommand } from "../src/qq-affinity-command.js";

test("affinity commands recognize self, view, rank and owner set", () => {
  assert.equal(isQqAffinityCommand("好感度"), true);
  assert.equal(isQqAffinityCommand("好感度排行"), false);
  assert.deepEqual(parseQqAffinityCommand("好感度"), { action: "self" });
  assert.deepEqual(parseQqAffinityCommand("好感度", { atTargets: ["99999", "12345"], selfId: "99999" }), { action: "view", targetUserId: "12345" });
  assert.deepEqual(parseQqAffinityCommand("好感度 12345"), { action: "view", targetUserId: "12345" });
  assert.deepEqual(parseQqAffinityCommand("好感 排行"), { action: "rank" });
  assert.deepEqual(parseQqAffinityCommand("好感度 设置 12345 -20"), { action: "set", targetUserId: "12345", value: -20 });
  assert.deepEqual(parseQqAffinityCommand("好感度 设置 12345 300"), { action: "invalid" });
  assert.deepEqual(parseQqAffinityCommand("好感度 设置 -5"), { action: "invalid" });
  assert.deepEqual(parseQqAffinityCommand("好感度 给我加满"), { action: "invalid" });
});
