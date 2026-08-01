import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQqOperationLogDetails,
  getQqLogActorRole,
  getQqLogScopeId
} from "../src/qq-operation-log.js";

test("QQ operation logs use stable actor and source/target session fields", () => {
  const owner = { isOwner: true, senderId: "10001", groupId: "20002" };
  const target = { isBotAdmin: false, senderId: "30003", qqCrossSessionScopeId: "private:30003" };
  assert.equal(getQqLogActorRole(owner), "owner");
  assert.equal(getQqLogScopeId(owner), "20002");
  assert.deepEqual(buildQqOperationLogDetails(owner, {
    operation: "session.send",
    outcome: "success",
    targetEvent: target,
    durationMs: 42
  }), {
    operation: "session.send",
    outcome: "success",
    actorRole: "owner",
    actorUserId: "10001",
    sourceScopeId: "20002",
    targetScopeId: "private:30003",
    targetType: "private",
    durationMs: 42
  });
});

test("QQ administrator and system roles stay distinct from owner", () => {
  assert.equal(getQqLogActorRole({ isBotAdmin: true, senderId: "10002" }), "administrator");
  assert.equal(getQqLogActorRole({ senderId: "10003" }), "user");
  assert.equal(getQqLogActorRole({}), "system");
});
