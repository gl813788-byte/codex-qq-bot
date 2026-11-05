import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyQqHumanMessageActions,
  createEmptyQqHumanActionStats,
  describeQqEmojiId,
  normalizeQqHumanActionStats,
  recordQqHumanAction,
  summarizeQqHumanActionRates
} from "../src/qq-human-action-stats.js";
import { buildQqHumanActionPlan, formatQqHumanActionContext } from "../src/qq-human-behavior.js";

const DAY = 86_400_000;

test("human action counters are anonymous per scope, decay and report rates", () => {
  let stats = createEmptyQqHumanActionStats();
  const now = Date.parse("2026-11-05T00:00:00Z");
  for (let index = 0; index < 100; index += 1) stats = recordQqHumanAction(stats, { scopeId: "123456", kind: "messages", now }).stats;
  for (let index = 0; index < 5; index += 1) stats = recordQqHumanAction(stats, { scopeId: "123456", kind: "reactions", emojiIds: ["182"], now }).stats;
  stats = recordQqHumanAction(stats, { scopeId: "123456", kind: "reactions", emojiIds: ["128514"], now }).stats;
  assert.equal(recordQqHumanAction(stats, { scopeId: "123456", kind: "unknown" }).changed, false);
  const summary = summarizeQqHumanActionRates(stats, "123456", { now });
  assert.equal(summary.confidence, "medium");
  assert.equal(summary.rates.reactions, 0.06);
  assert.deepEqual(summary.topEmojis, ["笑哭", "😂"]);
  const later = summarizeQqHumanActionRates(stats, "123456", { now: now + 14 * DAY });
  assert.equal(later.sample, 50);
  assert.equal(later.rates.reactions, 0.06);
  assert.deepEqual(normalizeQqHumanActionStats({ scopes: { "../x": { messages: 3 } } }).scopes, {});
  assert.equal(describeQqEmojiId("76"), "赞");
});

test("message-borne actions are classified without reading message meaning", () => {
  const kinds = classifyQqHumanMessageActions({
    selfId: "1",
    replyMessageId: "9",
    atTargets: ["22"],
    images: [{ file: "a" }],
    contentContext: { cards: [{ kind: "video" }], forwardIds: ["f"], media: { audios: [{}], videos: [] } }
  });
  assert.deepEqual(kinds, ["messages", "quotes", "mentions", "images", "shares", "forwards", "voices"]);
});

function groupEvent(extra = {}) {
  return { groupId: "123456", senderId: "22", type: "group_at", text: "哈哈哈", raw: { message_id: 1 }, ...extra };
}

test("the action plan follows measured human rates and defaults when unmeasured", () => {
  const measured = { confidence: "high", sample: 300, rates: { reactions: 0.08, pokes: 0.02 }, topEmojis: ["笑哭"] };
  let reactions = 0;
  let reactionOnly = 0;
  for (let index = 0; index < 400; index += 1) {
    const plan = buildQqHumanActionPlan(groupEvent({ raw: { message_id: index } }), { mode: "casual" }, { actionRates: measured });
    if (plan.actions.includes("react")) reactions += 1;
    if (plan.actions.includes("reaction_only")) reactionOnly += 1;
  }
  const first = buildQqHumanActionPlan(groupEvent(), { mode: "casual" }, { actionRates: measured });
  assert.equal(first.measured, true);
  assert.equal(first.reactChance, 0.4);
  assert.ok(reactions + reactionOnly > 100 && reactions + reactionOnly < 220, `${reactions}+${reactionOnly}`);
  assert.ok(reactionOnly > 20);
  const unmeasured = buildQqHumanActionPlan(groupEvent(), { mode: "casual" }, {});
  assert.equal(unmeasured.measured, false);
  assert.equal(unmeasured.reactChance, 0.15);
  const privatePlan = buildQqHumanActionPlan({ senderId: "22", type: "private_message", raw: { message_id: 1 } }, { mode: "casual" }, { actionRates: measured });
  assert.equal(privatePlan.reactChance, 0);
  const task = buildQqHumanActionPlan(groupEvent(), { mode: "task" }, { actionRates: measured });
  assert.equal(task.reactChance, 0);
});

test("pokes, shared videos, unheard voices and new stickers suggest human actions", () => {
  const plan = buildQqHumanActionPlan(groupEvent({ type: "group_poke" }), { mode: "ping" }, {
    media: { videos: 1, audios: 1, unheardAudios: 1 },
    mediaAvailable: { video: true, audio: true },
    stickerCandidates: 1
  });
  assert.ok(plan.pokeBackChance >= 0.35);
  assert.equal(plan.watchChance, 0.85);
  assert.ok(plan.actions.includes("listen_audio"));
  const text = formatQqHumanActionContext({ ...plan, actions: ["poke_back", "watch_video", "listen_audio", "save_sticker"] });
  assert.match(text, /拍回去/);
  assert.match(text, /qq_media\.video watch/);
  assert.match(text, /工具返回成功后才算做了/);
  const withoutTools = buildQqHumanActionPlan(groupEvent(), { mode: "shared_content" }, { media: { videos: 2, audios: 0 }, mediaAvailable: { video: false } });
  assert.equal(withoutTools.watchChance, 0);
});
