import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptyQqConversationMemory,
  extractQqConversationMemoryMarkers,
  formatQqConversationMemoryContext,
  listQqConversationMemoryProfiles,
  normalizeQqConversationMemory,
  qqConversationMemoryVersion,
  updateQqConversationMemoryFromEvent,
  updateQqConversationMemoryFromExchange,
  updateQqConversationPersonAlias
} from "../src/qq-conversation-memory.js";

test("tracks group topics, people, links, impressions and bot thoughts", () => {
  let tick = 0;
  const now = () => new Date(Date.UTC(2026, 6, 13, 10, 0, tick++));
  let memory = createEmptyQqConversationMemory();
  const event = {
    groupId: "10001",
    senderId: "20002",
    senderName: "群友甲",
    text: "最近在优化 Agent 上下文 https://example.test/design",
    contentContext: {
      displayText: "最近在优化 Agent 上下文 https://example.test/design",
      links: ["https://example.test/design"]
    }
  };

  memory = updateQqConversationMemoryFromEvent(memory, event, { now });
  memory = updateQqConversationMemoryFromExchange(memory, event, "近处完整、远处相关会更稳。", [{
    scopeImpression: "这个群常讨论 Bot 和技术优化",
    personImpression: "喜欢从体验角度改进 Agent",
    recentTopic: "上下文分层",
    botThought: "这次需求很具体，适合逐步落地"
  }], { now });

  const group = memory.groups["10001"];
  assert.equal(group.impression, "这个群常讨论 Bot 和技术优化");
  assert.equal(group.people["20002"].impression, "喜欢从体验角度改进 Agent");
  assert.equal(group.recentLinks[0].host, "example.test");
  assert.match(formatQqConversationMemoryContext(memory, event), /Bot 最近对群聊的感想/);
});

test("shares one QQ person's impression across groups while keeping group cards and group impressions scoped", () => {
  const firstGroupEvent = {
    groupId: "10001",
    senderId: "20002",
    senderName: "A群名片",
    text: "我喜欢从体验角度调整机器人"
  };
  const secondGroupEvent = {
    groupId: "10002",
    senderId: "20002",
    senderName: "B群名片",
    text: "这个群主要聊游戏"
  };
  let memory = updateQqConversationMemoryFromEvent(createEmptyQqConversationMemory(), firstGroupEvent);
  memory = updateQqConversationMemoryFromExchange(memory, firstGroupEvent, "记住了。", [{
    scopeImpression: "A 群主要讨论机器人",
    personImpression: "重视产品体验和连续上下文"
  }]);
  memory = updateQqConversationMemoryFromEvent(memory, secondGroupEvent);
  memory = updateQqConversationMemoryFromExchange(memory, secondGroupEvent, "这里确实更偏游戏。", [{
    scopeImpression: "B 群主要讨论游戏"
  }]);

  assert.equal(memory.people["20002"].impression, "重视产品体验和连续上下文");
  assert.deepEqual(memory.people["20002"].groupAliases["10001"], ["A群名片"]);
  assert.deepEqual(memory.people["20002"].groupAliases["10002"], ["B群名片"]);
  const secondGroupContext = formatQqConversationMemoryContext(memory, secondGroupEvent);
  assert.match(secondGroupContext, /B 群主要讨论游戏/);
  assert.match(secondGroupContext, /重视产品体验和连续上下文/);
  assert.doesNotMatch(secondGroupContext, /A 群主要讨论机器人/);
});

test("migrates legacy per-group people into the cross-group QQ identity layer", () => {
  const memory = normalizeQqConversationMemory({
    version: 1,
    groups: {
      "10001": {
        people: {
          "20002": {
            userId: "20002",
            aliases: ["旧群名片"],
            messageCount: 4,
            updatedAt: "2026-07-18T08:00:00.000Z",
            impression: "旧版已有的人物印象",
            botThought: "以前聊得挺顺"
          }
        }
      }
    }
  });

  assert.equal(qqConversationMemoryVersion, 4);
  assert.equal(memory.version, qqConversationMemoryVersion);
  assert.equal(memory.people["20002"].impression, "旧版已有的人物印象");
  assert.deepEqual(memory.people["20002"].groupAliases["10001"], ["旧群名片"]);
});

test("migrates legacy impressions into short and detailed descriptions and overwrites by stable profile id", () => {
  const event = {
    groupId: "10001",
    senderId: "20002",
    senderName: "群友甲",
    text: "继续优化记忆"
  };
  let memory = normalizeQqConversationMemory({
    version: 2,
    groups: {
      "10001": {
        impression: "旧版群印象很详细",
        people: {}
      }
    },
    people: {
      "20002": {
        aliases: ["群友甲"],
        impression: "旧版人物印象"
      }
    }
  });
  assert.equal(memory.groups["10001"].impressionSummary, "旧版群印象很详细");
  assert.equal(memory.groups["10001"].impressionDetail, "旧版群印象很详细");

  memory = updateQqConversationMemoryFromEvent(memory, event);
  memory = updateQqConversationMemoryFromExchange(memory, event, "可以", [{
    scopeImpressionSummary: "新版群简述",
    scopeImpressionDetail: "新版群详细描述，整体替代迁移前版本",
    personImpressionSummary: "新版人物简述",
    personImpressionDetail: "新版人物详细描述"
  }]);
  const profiles = listQqConversationMemoryProfiles(memory);
  const groupProfiles = profiles.filter((profile) => profile.key === "qq:group:10001");
  const personProfiles = profiles.filter((profile) => profile.key === "qq:person:20002");
  assert.equal(groupProfiles.length, 1);
  assert.equal(groupProfiles[0].shortDescription, "新版群简述");
  assert.match(groupProfiles[0].detailedDescription, /新版群详细描述/);
  assert.equal(personProfiles.length, 1);
  assert.equal(personProfiles[0].shortDescription, "新版人物简述");
  assert.doesNotMatch(personProfiles[0].detailedDescription, /旧版人物印象/);
});

test("tracks private-chat impressions and strips invisible model memory metadata", () => {
  const event = {
    type: "private_message",
    senderId: "30003",
    senderName: "私聊用户",
    text: "最近我们聊了记忆功能"
  };
  let memory = updateQqConversationMemoryFromEvent(createEmptyQqConversationMemory(), event);
  const parsed = extractQqConversationMemoryMarkers(
    "这个思路可以。\n[[qq_memory:{\"personImpression\":\"很重视连续聊天体验\",\"recentTopic\":\"私聊记忆\",\"botThought\":\"交流很顺畅\"}]]"
  );
  assert.equal(parsed.visibleText, "这个思路可以。");
  assert.equal(parsed.patches.length, 1);

  memory = updateQqConversationMemoryFromExchange(memory, event, parsed.visibleText, parsed.patches);
  assert.equal(memory.privateChats["30003"].impression, "很重视连续聊天体验");
  assert.match(formatQqConversationMemoryContext(memory, event), /最近聊过：.*私聊记忆/);

  const sensitive = extractQqConversationMemoryMarkers(
    "可见回复\n[[qq_memory:{\"botThought\":\"API_KEY=sk-secret-value-12345\"}]]"
  );
  assert.equal(sensitive.visibleText, "可见回复");
  assert.deepEqual(sensitive.patches, []);
});

test("AI can promote a complete QQ person impression and private aliases share the QQ id", () => {
  const groupEvent = {
    groupId: "10001",
    senderId: "20002",
    senderName: "一群名片",
    text: "我们又聊到记忆设计了"
  };
  const privateEvent = {
    type: "private_message",
    senderId: "20002",
    senderName: "私聊昵称",
    text: "私聊继续讨论"
  };
  let memory = updateQqConversationMemoryFromEvent(createEmptyQqConversationMemory(), groupEvent);
  memory = updateQqConversationMemoryFromExchange(memory, groupEvent, "继续。", [{
    personImpressionSummary: "重视连续上下文、可验证实现和清晰产品体验",
    personImpressionDetail: "长期关注机器人记忆、连续上下文、实际可用性和验证过程；提出需求时会补充边界，也倾向按稳定身份组织跨会话信息。",
    personImpressionComplete: false
  }]);
  assert.equal(memory.people["20002"].unifiedMemory.promotedAt, null);
  memory = updateQqConversationMemoryFromExchange(memory, groupEvent, "画像成熟度已确认。", [{
    personImpressionComplete: true,
    personImpressionPromotionReason: "多次互动已经覆盖关注点、沟通方式和稳定偏好"
  }]);
  memory = updateQqConversationMemoryFromEvent(memory, privateEvent);

  const person = memory.people["20002"];
  assert.ok(person.unifiedMemory.promotedAt);
  assert.deepEqual(person.unifiedMemory.sourceScopeIds, ["10001"]);
  assert.match(person.unifiedMemory.reason, /多次互动/);
  assert.ok(person.aliases.includes("一群名片"));
  assert.ok(person.aliases.includes("私聊昵称"));

  const aliasUpdate = updateQqConversationPersonAlias(memory, {
    userId: "20002",
    action: "replace",
    alias: "一群名片",
    replacement: "记忆哥"
  });
  assert.equal(aliasUpdate.ok, true);
  assert.ok(aliasUpdate.person.aliases.includes("记忆哥"));
  assert.ok(aliasUpdate.person.suppressedAliases.includes("一群名片"));
});

test("a substantive high-salience person impression can enter unified memory before a mature profile is complete", () => {
  const event = {
    groupId: "10001",
    senderId: "20003",
    senderName: "灵感群友",
    text: "提出了一个让 Bot 很感兴趣的独特记忆方案"
  };
  let memory = updateQqConversationMemoryFromEvent(createEmptyQqConversationMemory(), event);
  memory = updateQqConversationMemoryFromExchange(memory, event, "这个角度很有意思。", [{
    personImpressionSummary: "常从独特角度讨论记忆与人机关系",
    personImpressionDetail: "这次提出了一个结构清楚且很有辨识度的记忆方案，让 Bot 产生了持续兴趣；当前只确认这一鲜明特点，其他维度仍待后续互动。",
    personImpressionComplete: false,
    personImpressionMemorable: true,
    personImpressionPromotionReason: "单次互动显著且与 Bot 的长期兴趣高度相关，值得跨会话保留"
  }]);

  assert.ok(memory.people["20003"].unifiedMemory.promotedAt);
  assert.match(memory.people["20003"].unifiedMemory.reason, /长期兴趣/);
});

test("never exposes malformed invisible memory metadata to QQ", () => {
  const parsed = extractQqConversationMemoryMarkers("正常回复\n[[qq_memory:{bad json}]]");
  assert.equal(parsed.visibleText, "正常回复");
  assert.deepEqual(parsed.patches, []);
});

test("does not persist likely secrets and strips sensitive URL parameters", () => {
  const event = {
    type: "private_message",
    senderId: "40004",
    senderName: "私聊用户",
    text: "验证码: 123456 https://example.test/callback?article=8&access_token=secret123#fragment",
    contentContext: {
      displayText: "验证码: 123456 https://example.test/callback?article=8&access_token=secret123#fragment",
      links: ["https://example.test/callback?article=8&access_token=secret123#fragment"]
    }
  };
  const memory = updateQqConversationMemoryFromEvent(createEmptyQqConversationMemory(), event);
  const chat = memory.privateChats["40004"];
  assert.deepEqual(chat.recentMessages, []);
  assert.equal(chat.recentLinks[0].url, "https://example.test/callback?article=8");
});

test("rejects prototype keys from events and persisted records", () => {
  const before = Object.prototype.people;
  const memory = updateQqConversationMemoryFromEvent(createEmptyQqConversationMemory(), {
    groupId: "__proto__",
    senderId: "constructor",
    text: "malicious key"
  });

  assert.equal(Object.prototype.people, before);
  assert.equal(Object.hasOwn(memory.groups, "__proto__"), false);
  assert.equal(Object.getPrototypeOf(memory.groups), null);
});

test("bounds remembered people per group", () => {
  let memory = createEmptyQqConversationMemory();
  for (let index = 0; index < 501; index += 1) {
    memory = updateQqConversationMemoryFromEvent(memory, {
      groupId: "10001",
      senderId: String(10000 + index),
      text: `message ${index}`
    }, { now: () => new Date(index * 1_000) });
  }
  assert.equal(Object.keys(memory.groups["10001"].people).length, 500);
  assert.equal(memory.groups["10001"].people["10000"], undefined);
  assert.ok(memory.groups["10001"].people["10500"]);
});
