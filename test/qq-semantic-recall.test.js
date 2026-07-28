import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQqSemanticRecallQuery,
  recallQqSemanticMemory,
  summarizeQqSemanticRecall
} from "../src/unified-memory/qq-semantic-recall.js";

test("QQ semantic recall query combines current, quoted, fused, and proactive chat text", () => {
  const query = buildQqSemanticRecallQuery({
    text: "现在的问题",
    replyContext: { text: "引用的旧话题" },
    queuedEvents: [
      { text: "融合追问一" },
      { text: "融合追问一" },
      { text: "融合追问二" }
    ],
    proactiveDecision: {
      replyContext: [{ text: "兴趣判定看到的上下文" }]
    }
  });

  assert.match(query, /现在的问题/);
  assert.match(query, /引用的旧话题/);
  assert.equal(query.match(/融合追问一/g)?.length, 1);
  assert.match(query, /兴趣判定看到的上下文/);
});

test("QQ semantic recall combines scoped layers and excludes summaries already delivered", async () => {
  const calls = [];
  const semanticSearch = async (options) => {
    calls.push(options);
    const layer = options.layers[0];
    if (layer === "impression") {
      return [{ id: "impression:group", layer, summary: "群印象", score: 0 }];
    }
    if (layer === "knowledge") {
      return [
        { id: "knowledge:old", layer, summary: "已经给过", score: 0.5 },
        { id: "knowledge:new", layer, summary: "本轮相关知识", score: 0.42 }
      ];
    }
    if (layer === "unified") {
      if (options.kinds?.includes("personProfile")) {
        return [{
          id: "unified:person-profile",
          layer,
          kind: "personProfile",
          userId: "20002",
          summary: "当前人物统一简述",
          score: 0
        }];
      }
      if (options.kinds?.includes("personSession")) {
        return [{
          id: "unified:person-session",
          layer,
          kind: "personSession",
          userId: "20002",
          summary: "其他群聊形成的人物记忆",
          metadata: { sourceScopeId: "10002" },
          score: 0.25
        }];
      }
      return [{ id: "unified:one", layer, summary: "主人统一记忆", score: 0.3 }];
    }
    return [];
  };

  const recall = await recallQqSemanticMemory({
    semanticSearch,
    event: {
      groupId: "10001",
      senderId: "20002",
      selfId: "30003",
      isOwner: true
    },
    query: "之前说过的发布安排",
    excludeItemIds: ["knowledge:old"]
  });

  assert.deepEqual(
    calls.map((call) => call.layers[0]),
    ["impression", "short-term", "knowledge", "unified", "unified", "unified"]
  );
  assert.ok(calls
    .filter((call) => !call.kinds?.includes("personProfile"))
    .every((call) => call.query === "之前说过的发布安排"));
  assert.equal(calls.find((call) => call.kinds?.includes("personProfile"))?.query, "");
  assert.deepEqual(
    recall.items.map((item) => item.id),
    [
      "impression:group",
      "knowledge:new",
      "unified:person-profile",
      "unified:person-session",
      "unified:one"
    ]
  );
  assert.match(recall.context, /本轮相关知识/);
  assert.match(recall.context, /\[其他会话\].*其他群聊形成的人物记忆/);
  assert.doesNotMatch(recall.context, /已经给过/);
  assert.equal(summarizeQqSemanticRecall(recall).resultCount, 5);
});

test("fused QQ semantic recall can skip impressions and reports a failed layer", async () => {
  const recall = await recallQqSemanticMemory({
    semanticSearch: async (options) => {
      if (options.layers[0] === "knowledge") throw new Error("index unavailable");
      return [];
    },
    event: {
      groupId: "10001",
      senderId: "20002",
      isOwner: false
    },
    query: "新追问",
    includeImpressions: false
  });

  assert.equal(recall.items.length, 0);
  assert.equal(recall.errors.length, 1);
  assert.equal(recall.errors[0].layer, "knowledge");
  assert.equal(recall.layers.impression, undefined);
  assert.equal(recall.layers.unified, undefined);
  assert.equal(recall.layers["unified-person-profile"], 0);
  assert.equal(recall.layers["unified-person-session"], 0);
});
