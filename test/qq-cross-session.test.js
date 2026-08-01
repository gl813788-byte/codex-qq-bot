import assert from "node:assert/strict";
import test from "node:test";
import {
  createQqCrossSessionEvent,
  listQqCrossSessionScopes,
  resolveQqCrossSessionScope
} from "../src/qq-cross-session.js";

const source = {
  allowedGroups: ["10001", "20002"],
  recentMessages: {
    "10001": [{ at: "2026-08-01T08:00:00.000Z", text: "当前群" }],
    "private:30003": [{ at: "2026-08-01T09:00:00.000Z", text: "私聊" }]
  },
  exchanges: {},
  shortTermNotes: {},
  privateChats: { "30003": { aliases: ["小王"] } },
  threads: { "20002": { threadId: "thread-2" } },
  getGroupName: (groupId) => ({ "10001": "当前群", "20002": "项目群" })[groupId] || ""
};

test("cross-session catalog lists groups and private chats with stable selectors", () => {
  const scopes = listQqCrossSessionScopes(source, { currentScopeId: "10001" });
  assert.equal(scopes[0].scopeId, "10001");
  assert.equal(scopes.find((scope) => scope.scopeId === "20002").selector, "group:20002");
  assert.equal(scopes.find((scope) => scope.scopeId === "private:30003").label, "私聊 小王");
});

test("cross-session scope resolution rejects ambiguous bare QQ ids", () => {
  const ambiguous = {
    ...source,
    allowedGroups: [...source.allowedGroups, "30003"]
  };
  assert.equal(resolveQqCrossSessionScope(ambiguous, "30003", { currentScopeId: "10001" }), "");
  assert.equal(resolveQqCrossSessionScope(ambiguous, "private:30003"), "private:30003");
  assert.equal(resolveQqCrossSessionScope(ambiguous, "group:30003"), "30003");
});

test("cross-session events preserve the verified role without copying message context", () => {
  const rootEvent = {
    groupId: "10001",
    senderId: "90009",
    isOwner: false,
    isBotAdmin: true,
    text: "把消息发去另一个群",
    replyContext: { text: "不要复制" }
  };
  const event = createQqCrossSessionEvent({ ...source, currentScopeId: "10001" }, "20002", rootEvent);
  assert.equal(event.groupId, "20002");
  assert.equal(event.groupName, "项目群");
  assert.equal(event.isOwner, false);
  assert.equal(event.isBotAdmin, true);
  assert.equal(event.text, "");
  assert.equal(event.replyContext, null);
  assert.equal(event.qqCrossSessionRootEvent, rootEvent);
});
