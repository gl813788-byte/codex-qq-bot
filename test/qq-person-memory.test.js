import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptyQqConversationMemory,
  updateQqConversationMemoryFromEvent,
  updateQqConversationMemoryFromExchange,
  updateQqConversationPersonAlias
} from "../src/qq-conversation-memory.js";
import {
  applyQqPersonAliasToolCommand,
  buildUnifiedPersonMemoryEntries,
  resolveQqMemoryPeople
} from "../src/unified-memory/qq-person-memory.js";

function buildPromotedPersonMemory() {
  const first = {
    groupId: "10001",
    senderId: "20002",
    senderName: "A群小林",
    text: "继续设计记忆"
  };
  const second = {
    groupId: "10002",
    senderId: "20002",
    senderName: "B群林哥",
    text: "跨群检索也要稳定"
  };
  let memory = updateQqConversationMemoryFromEvent(createEmptyQqConversationMemory(), first);
  memory = updateQqConversationMemoryFromExchange(memory, first, "明白。", [{
    personImpressionSummary: "持续关注记忆可靠性和跨会话体验",
    personImpressionDetail: "多次讨论机器人长期记忆、语义召回和跨会话体验；倾向先明确边界，再要求实现可验证且真正进入主链路。",
    personImpressionComplete: true,
    personImpressionPromotionReason: "画像已覆盖稳定关注点和沟通方式"
  }]);
  memory = updateQqConversationMemoryFromEvent(memory, second);
  memory = updateQqConversationMemoryFromExchange(memory, second, "会按 QQ 号关联。", [{
    personImpressionSummary: "持续关注记忆可靠性、身份稳定和跨会话体验",
    personImpressionDetail: "长期关注机器人记忆是否真正工作，强调以 QQ 号作为稳定身份，并要求跨群名称、私聊名称都能关联到同一人物。",
    personImpressionComplete: false
  }]);
  return memory;
}

test("promoted QQ person produces one profile and scoped memories from every conversation", () => {
  const memory = buildPromotedPersonMemory();
  const entries = buildUnifiedPersonMemoryEntries(memory, "20002");

  assert.deepEqual(
    entries.map((entry) => entry.id),
    [
      "qq-person-profile:20002",
      "qq-person-session:20002:group:10001",
      "qq-person-session:20002:group:10002"
    ]
  );
  assert.ok(entries.every((entry) => entry.subjectUserId === "20002"));
  assert.deepEqual(
    entries.slice(1).map((entry) => entry.sourceScopeId),
    ["10001", "10002"]
  );
  assert.ok(entries[0].subjectAliases.includes("A群小林"));
  assert.ok(entries[0].subjectAliases.includes("B群林哥"));
});

test("QQ id is primary and aliases only resolve when unambiguous", () => {
  let memory = buildPromotedPersonMemory();
  const direct = resolveQqMemoryPeople(memory, {
    groupId: "10003",
    senderId: "20002",
    senderName: "刚改的新群名片",
    text: "我来问个问题"
  });
  assert.deepEqual(direct.map((person) => person.userId), ["20002"]);
  assert.equal(direct[0].detectedBy, "identity");

  const qqTextHit = resolveQqMemoryPeople(memory, {
    groupId: "10003",
    senderId: "30003",
    text: "帮我看看 QQ 20002 以前的偏好"
  });
  assert.ok(qqTextHit.some((person) => (
    person.userId === "20002" && person.detectedBy === "qq-id"
  )));

  let aliasHit = resolveQqMemoryPeople(memory, {
    groupId: "10003",
    senderId: "30003",
    text: "B群林哥之前怎么说的？"
  });
  assert.ok(aliasHit.some((person) => person.userId === "20002" && person.detectedBy === "alias"));

  const aliasUpdate = updateQqConversationPersonAlias(memory, {
    userId: "20002",
    action: "replace",
    alias: "B群林哥",
    replacement: "统一记忆林"
  });
  assert.equal(aliasUpdate.ok, true);
  memory = aliasUpdate.memory;
  aliasHit = resolveQqMemoryPeople(memory, {
    groupId: "10003",
    senderId: "30003",
    text: "统一记忆林的偏好是什么？"
  });
  assert.ok(aliasHit.some((person) => person.userId === "20002"));

  const oldAliasHit = resolveQqMemoryPeople(memory, {
    groupId: "10003",
    senderId: "30003",
    text: "B群林哥的偏好是什么？"
  });
  assert.equal(oldAliasHit.some((person) => person.userId === "20002"), false);
});

test("person alias tool is limited to people detected in the current turn", () => {
  const memory = buildPromotedPersonMemory();
  const detectedPeople = resolveQqMemoryPeople(memory, {
    groupId: "10003",
    senderId: "20002",
    text: "给我加个称呼"
  });
  const denied = applyQqPersonAliasToolCommand(
    memory,
    "添加 30003 | 不应写入",
    detectedPeople
  );
  assert.equal(denied.ok, false);
  assert.equal(denied.reason, "person_not_detected");

  const updated = applyQqPersonAliasToolCommand(
    memory,
    "添加 20002 | 记忆设计者",
    detectedPeople
  );
  assert.equal(updated.ok, true);
  assert.equal(updated.changed, true);
  assert.ok(updated.person.aliases.includes("记忆设计者"));

  const listed = applyQqPersonAliasToolCommand(
    updated.memory,
    "列表 20002",
    resolveQqMemoryPeople(updated.memory, {
      groupId: "10003",
      senderId: "20002",
      text: "列一下"
    })
  );
  assert.equal(listed.ok, true);
  assert.equal(listed.changed, false);
  assert.match(listed.reply, /记忆设计者/);
});
