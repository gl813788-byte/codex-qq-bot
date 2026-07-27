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
    ["impression", "short-term", "knowledge", "unified"]
  );
  assert.ok(calls.every((call) => call.query === "之前说过的发布安排"));
  assert.deepEqual(
    recall.items.map((item) => item.id),
    ["impression:group", "knowledge:new", "unified:one"]
  );
  assert.match(recall.context, /本轮相关知识/);
  assert.doesNotMatch(recall.context, /已经给过/);
  assert.equal(summarizeQqSemanticRecall(recall).resultCount, 3);
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
});
