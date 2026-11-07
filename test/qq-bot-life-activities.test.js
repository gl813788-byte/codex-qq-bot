import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQqLifeActivityTask,
  consumeQqLifeSocialAllowance,
  formatQqLifeExperienceContext,
  markQqLifeActivityStarted,
  recordQqLifeExperience,
  selectQqLifeActivityDue
} from "../src/qq-bot-life-activities.js";
import { normalizeQqBotLifeState, normalizeQqBotRoutine } from "../src/qq-bot-life-state.js";
import { executeQqCardAction, createNeteaseMusicSearch } from "../src/app/qq-card-tools.js";

// 2026-11-05 14:40 in Asia/Shanghai.
const now = Date.parse("2026-11-05T06:40:00Z");
const routine = {
  date: "2026-11-05",
  segments: [
    { start: "07:00", end: "14:00", activity: "上课", state: "犯困", kind: "none", plan: "" },
    { start: "14:00", end: "16:00", activity: "刷视频", state: "放松", kind: "video", plan: "刷B站看看猫猫视频" },
    { start: "16:00", end: "07:00", activity: "打游戏", state: "兴奋", kind: "qzone", plan: "" }
  ]
};

test("routine segments keep a plan only for real online activities", () => {
  const normalized = normalizeQqBotRoutine(routine);
  assert.deepEqual(normalized.segments.map((segment) => segment.kind ?? "none"), ["none", "video", "none"]);
  assert.equal(normalized.segments[1].plan, "刷B站看看猫猫视频");
});

// Loading normalizes the daily ledger against the wall clock, so tests that
// pass a fixed `now` pin Date.now to it; otherwise they only pass on that date.
test("a planned segment becomes due once, some minutes in, within the daily budget", (t) => {
  t.mock.method(Date, "now", () => now);
  const life = normalizeQqBotLifeState({ routine });
  const due = selectQqLifeActivityDue(life, { now, dailyLimit: 3, minGapMinutes: 30 });
  assert.equal(due.segment.start, "14:00");
  assert.equal(selectQqLifeActivityDue(life, { now: Date.parse("2026-11-05T06:01:00Z") }), null);
  const started = markQqLifeActivityStarted(life, due.segment, { now });
  assert.equal(started.activity.runs, 1);
  assert.equal(selectQqLifeActivityDue(started, { now: now + 3_600_000 }), null);
  assert.equal(selectQqLifeActivityDue(life, { now, enabled: false }), null);
  assert.equal(selectQqLifeActivityDue(life, { now, dailyLimit: 0 }), null);
});

test("experiences are recorded, bounded in time and shown as real things the Bot did", () => {
  let life = normalizeQqBotLifeState({ routine });
  life = recordQqLifeExperience(life, { kind: "video", activity: "刷视频", summary: "刷到一个猫猫迷惑行为合集，笑死", detail: "BV1… UP 某某" }, { now });
  assert.equal(life.experiences.length, 1);
  const context = formatQqLifeExperienceContext(life, { now: now + 30 * 60_000 });
  assert.match(context, /你最近真实做过的事/);
  assert.match(context, /30 分钟前：刷到一个猫猫迷惑行为合集/);
  assert.equal(formatQqLifeExperienceContext(life, { now: now + 20 * 3_600_000 }), "");
  const reloaded = normalizeQqBotLifeState(JSON.parse(JSON.stringify(life)));
  assert.equal(reloaded.experiences[0].summary, "刷到一个猫猫迷惑行为合集，笑死");
});

test("the Bot's own Qzone writes and friend requests are capped per day", (t) => {
  t.mock.method(Date, "now", () => now);
  let life = normalizeQqBotLifeState({});
  const limits = { qzone_post: 1, qzone_comment: 2 };
  const first = consumeQqLifeSocialAllowance(life, "qzone_post", { limits, now });
  assert.equal(first.ok, true);
  life = first.life;
  assert.equal(consumeQqLifeSocialAllowance(life, "qzone_post", { limits, now }).ok, false);
  assert.equal(consumeQqLifeSocialAllowance(life, "qzone_post", { limits, now: now + 86_400_000 }).ok, true);
  assert.equal(consumeQqLifeSocialAllowance(life, "unknown", { limits, now }).ok, false);
});

test("activity tasks describe the real thing to do and the remaining caps", () => {
  const task = buildQqLifeActivityTask({
    segment: { start: "16:00", end: "18:00", activity: "逛空间", state: "无聊", kind: "qzone", plan: "看看朋友们最近在干嘛" },
    now,
    friends: [{ userId: "123456", name: "小明" }],
    limits: { postsLeft: 1, commentsLeft: 0 }
  });
  assert.match(task, /你给这段时间定的具体打算：看看朋友们最近在干嘛/);
  assert.match(task, /qzone_recent/);
  assert.match(task, /小明（QQ 123456）/);
  assert.match(task, /评论还剩 0 次/);
});

test("cards: dice, music search and contact shares are bounded real sends", async () => {
  const sent = [];
  const event = { groupId: "123456" };
  const deps = {
    event,
    sendSegments: async (segments, { label }) => {
      sent.push({ segments, label });
      return { ok: true };
    },
    callOneBotAction: async (action) => (action === "ArkSharePeer" ? { ok: true, body: { data: { arkJson: "{\"app\":\"com.tencent.contact.lua\"}" } } } : { ok: false }),
    searchMusic: async () => [{ id: "186016", name: "晴天", artists: "周杰伦" }],
    allowedContactIds: new Set(["22222"])
  };
  assert.equal((await executeQqCardAction({ action: "dice" }, deps)).ok, true);
  const music = await executeQqCardAction({ action: "music", query: "晴天 周杰伦" }, deps);
  assert.match(music.reply, /《晴天》- 周杰伦/);
  // The signing service needs the title; sending it keeps the card on the found song.
  assert.deepEqual(sent[1].segments, [{ type: "music", data: { type: "163", id: "186016", title: "晴天", singer: "周杰伦" } }]);
  assert.equal((await executeQqCardAction({ action: "contact", target: "22222" }, deps)).ok, false);
  assert.equal(event.qqCardCount, 2);
  const fresh = { ...deps, event: {} };
  assert.equal((await executeQqCardAction({ action: "contact", target: "99999" }, fresh)).ok, false);
  const contact = await executeQqCardAction({ action: "contact", target: "22222" }, fresh);
  assert.equal(contact.ok, true);
  assert.equal(sent.at(-1).segments[0].type, "json");
  const search = createNeteaseMusicSearch({
    fetchJson: async (url) => {
      assert.match(url, /^https:\/\/music\.163\.com\/api\/search\/get\/web\?s=/);
      return { result: { songs: [{ id: 1, name: "歌", artists: [{ name: "人" }] }, { id: "x" }] } };
    }
  });
  assert.deepEqual(await search("歌"), [{ id: "1", name: "歌", artists: "人" }]);
});
