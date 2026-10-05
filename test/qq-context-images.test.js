import assert from "node:assert/strict";
import test from "node:test";
import {
  appendQqRecentMessage,
  collectQqImageMemoryCandidates,
  formatQqImageMemoryCandidates,
  collectQqContextImages,
  getQqGroupRecentContextLimit,
  snapshotQqContextImages
} from "../src/qq-enhancer/context-images.js";

const memoryNow = Date.parse("2026-10-05T12:00:00Z");
const message = (index, age = 0, images = []) => ({
  messageId: String(index), at: new Date(memoryNow - age).toISOString(), text: "相同文字", images
});

test("image memory uses the union of five minutes and twenty raw messages, including exact boundaries", () => {
  const entries = [
    message("expired", 300_001, [{ file: "expired.png" }]),
    message("time-boundary", 300_000, [{ file: "time.png" }]),
    ...Array.from({ length: 20 }, (_, index) => message(index, 600_000, index === 0 ? [{ file: "count.png" }] : []))
  ];
  const candidates = collectQqImageMemoryCandidates(entries, { now: memoryNow, scopeId: "g1" });
  assert.deepEqual(candidates.map((item) => item.image.file), ["count.png", "time.png"]);
  // Bot messages count, and identical texts must not be compacted before counting.
  const afterBot = [...entries, { ...message("bot"), isAssistant: true }];
  assert.deepEqual(collectQqImageMemoryCandidates(afterBot, { now: memoryNow }).map((item) => item.image.file), ["time.png"]);
  assert.deepEqual(collectQqImageMemoryCandidates(afterBot, { now: memoryNow + 1 }), []);
});

test("a busy five-minute image window survives the configured transcript count cap and expires later", () => {
  let entries = [message("image", 240_000, [{ file: "busy.png" }])];
  for (let index = 0; index < 240; index += 1) entries = appendQqRecentMessage(entries, message(index), { limit: 200, now: memoryNow });
  assert.equal(entries.length, 241);
  assert.equal(collectQqImageMemoryCandidates(entries, { now: memoryNow }).length, 1);
  entries = appendQqRecentMessage(entries, message("later"), { limit: 200, now: memoryNow + 300_001 });
  assert.equal(entries.length, 200);
  assert.equal(collectQqImageMemoryCandidates(entries, { now: memoryNow + 300_001 }).length, 0);
  const quiet = Array.from({ length: 25 }, (_, index) => message(index, 600_000));
  assert.equal(appendQqRecentMessage(quiet, message("new"), { limit: 3, now: memoryNow }).length, 20);
});

test("image candidates work for private chat, direct/quoted inputs and earlier quotes without disclosing URLs", () => {
  const image = { file: "original.png", url: "https://example.test/private?token=secret", summary: "一张图" };
  const event = { type: "private_message", images: [image], replyContext: { images: [{ file: "quoted.png" }] } };
  const entries = [message("copy", 0, [image]), {
    ...message("reply", 600_000), replyContext: { senderName: "甲", images: [{ file: "earlier-quote.png" }] }
  }];
  const candidates = collectQqImageMemoryCandidates(entries, { event, scopeId: "private:1", now: memoryNow });
  assert.deepEqual(candidates.map((item) => item.image.file), ["original.png", "quoted.png", "earlier-quote.png"]);
  assert.equal(candidates[2].sender, "甲");
  const prompt = formatQqImageMemoryCandidates(candidates);
  assert.match(prompt, /本段对话含有图片：3 张可选/);
  assert.match(prompt, /满足任一条件即可/);
  assert.doesNotMatch(prompt, /token=secret|example.test|original.png/);
  assert.match(prompt, /qq_context\.images/);
});

test("image selectors stay stable across refreshed catalogs and remain scoped; large directories paginate", () => {
  const entries = Array.from({ length: 25 }, (_, index) => message(index, 0, [{ file: `${index}.png` }]));
  const first = collectQqImageMemoryCandidates(entries, { scopeId: "g1", now: memoryNow });
  const refreshed = collectQqImageMemoryCandidates([...entries, message("next", 0, [{ file: "new.png" }])], { scopeId: "g1", now: memoryNow });
  assert.equal(first[0].selector, refreshed[1].selector);
  assert.notEqual(first[0].selector, collectQqImageMemoryCandidates(entries, { scopeId: "g2", now: memoryNow })[0].selector);
  assert.equal((formatQqImageMemoryCandidates(first).match(/"selector":/g) || []).length, 20);
  assert.match(formatQqImageMemoryCandidates(first), /offset=20/);
  assert.equal((formatQqImageMemoryCandidates(first, { offset: 20 }).match(/"selector":/g) || []).length, 5);
  assert.equal(formatQqImageMemoryCandidates([]), "");
  assert.deepEqual(collectQqImageMemoryCandidates([], { now: memoryNow }), []);
});

test("QQ context image snapshots are bounded, deduplicated, and strip unrelated raw fields", () => {
  const images = snapshotQqContextImages([
    {
      file: "same.png",
      url: "https://example.test/same.png",
      fileSize: "123",
      summary: "截图",
      raw: {
        sub_type: 1,
        emoji_id: "emoji-1",
        secretPayload: "must-not-persist"
      }
    },
    { file: "same.png", url: "https://example.test/same.png" },
    { file: "second.gif", raw: { isAnimated: true } }
  ], { limit: 2 });

  assert.equal(images.length, 2);
  assert.deepEqual(images[0], {
    file: "same.png",
    url: "https://example.test/same.png",
    fileSize: 123,
    summary: "截图",
    raw: { emoji_id: "emoji-1", sub_type: 1 }
  });
  assert.equal(images[1].raw.isAnimated, true);
  assert.equal("secretPayload" in images[0].raw, false);
});

test("QQ context image collection prefers the newest messages and keeps source mapping", () => {
  const images = collectQqContextImages([
    { messageId: "1", senderLabel: "甲", text: "旧图", images: [{ file: "old.png" }] },
    { messageId: "2", senderLabel: "乙", text: "新图一", images: [{ file: "new-1.png" }] },
    { messageId: "3", senderLabel: "丙", text: "当前图", images: [{ file: "current.png" }] },
    { messageId: "4", senderLabel: "丁", text: "新图二", images: [{ file: "new-2.png" }] }
  ], { limit: 2, excludeMessageId: "3" });

  assert.deepEqual(images.map((image) => image.file), ["new-1.png", "new-2.png"]);
  assert.deepEqual(images.map((image) => image.context.sender), ["乙", "丁"]);
  assert.equal(images.some((image) => image.file === "current.png"), false);
});

test("QQ context image mapping retains the compressed repeat count", () => {
  const images = collectQqContextImages([{
    messageId: "3",
    senderLabel: "丙",
    text: "同一张图",
    consecutiveRepeatCount: 3,
    images: [{ file: "same.png" }]
  }]);
  assert.equal(images[0].context.text, "同一张图（连续重复 3 条）");
});

test("QQ context image collection skips expired persisted URLs", () => {
  const now = Date.parse("2026-07-27T00:00:00.000Z");
  const images = collectQqContextImages([
    {
      messageId: "old",
      at: "2026-07-26T20:00:00.000Z",
      images: [{ file: "expired.jpg", url: "https://multimedia.nt.qq.com.cn/expired" }]
    },
    {
      messageId: "fresh",
      at: "2026-07-26T23:30:00.000Z",
      images: [{ file: "fresh.jpg", url: "https://multimedia.nt.qq.com.cn/fresh" }]
    }
  ], {
    maxAgeMs: 2 * 60 * 60 * 1000,
    now
  });

  assert.deepEqual(images.map((image) => image.file), ["fresh.jpg"]);
});

test("QQ context image freshness rejects undated persisted references", () => {
  const images = collectQqContextImages([
    { messageId: "unknown", images: [{ file: "unknown.jpg" }] }
  ], {
    maxAgeMs: 2 * 60 * 60 * 1000,
    now: Date.parse("2026-07-27T00:00:00.000Z")
  });

  assert.deepEqual(images, []);
});

test("explicit bot triggers use a larger complete recent-group window", () => {
  assert.equal(getQqGroupRecentContextLimit(), 20);
  assert.equal(getQqGroupRecentContextLimit({ explicitBotTrigger: true }), 30);
  assert.equal(getQqGroupRecentContextLimit({ explicitBotTrigger: true, expandLevel: 1 }), 48);
});
