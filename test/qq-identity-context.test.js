import assert from "node:assert/strict";
import test from "node:test";
import {
  enrichQqMentionIdentities,
  formatQqIdentity,
  formatQqMentionIdentities
} from "../src/channels/qq/mention-identities.js";

test("enriches mentioned QQ identities from inline, cached and OneBot member data", async () => {
  const lookedUp = [];
  const event = await enrichQqMentionIdentities({
    groupId: "20001",
    selfId: "10001",
    atTargets: ["10001", "30001", "40001", "50001"],
    atMentions: [{ userId: "30001", name: "消息内昵称" }]
  }, {
    knownNameById(groupId, userId) {
      assert.equal(groupId, "20001");
      return userId === "10001" ? "麦麦" : userId === "40001" ? "缓存昵称" : "";
    },
    async lookupGroupMember(groupId, userId) {
      lookedUp.push([groupId, userId]);
      return { card: "群名片昵称", nickname: "QQ昵称" };
    }
  });

  assert.deepEqual(event.atMentions, [
    { userId: "10001", name: "麦麦" },
    { userId: "30001", name: "消息内昵称" },
    { userId: "40001", name: "缓存昵称" },
    { userId: "50001", name: "群名片昵称" }
  ]);
  assert.deepEqual(lookedUp, [["20001", "50001"]]);
});

test("formats current-scope QQ identities with both nickname and QQ number", () => {
  assert.equal(formatQqIdentity({ userId: "30001", name: "群友甲" }), "群友甲(QQ 30001)");
  assert.equal(formatQqIdentity({ userId: "30001" }), "QQ 30001");
  assert.equal(formatQqMentionIdentities([
    { userId: "30001", name: "群友甲" },
    { userId: "40001", name: "群友乙" }
  ]), "群友甲(QQ 30001)、群友乙(QQ 40001)");
});

test("keeps group-card lookup scoped when one QQ user appears in multiple groups", async () => {
  const groupCards = {
    "20001:30001": "A群名片",
    "20002:30001": "B群名片"
  };
  const enrich = (groupId) => enrichQqMentionIdentities({
    groupId,
    atTargets: ["30001"]
  }, {
    knownNameById(currentGroupId, userId) {
      return groupCards[`${currentGroupId}:${userId}`] || "";
    }
  });

  assert.deepEqual((await enrich("20001")).atMentions, [{ userId: "30001", name: "A群名片" }]);
  assert.deepEqual((await enrich("20002")).atMentions, [{ userId: "30001", name: "B群名片" }]);
});
