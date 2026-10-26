import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptyQqBotLifeState,
  formatQqBotLifeContext,
  formatQqBotLifeDetail,
  normalizeQqBotLifeState,
  recordQqBotLifeTurn,
  selectQqBotRoutineSegment,
  setQqBotRoutine
} from "../src/qq-bot-life-state.js";
import {
  buildQqBotRoutinePrompt,
  isQqBotRoutineDue,
  parseQqBotRoutineOutput,
  qqBotRoutineOutputSchema
} from "../src/qq-bot-daily-routine.js";

// 2026-10-26 14:30 in Asia/Shanghai.
const now = Date.parse("2026-10-26T06:30:00.000Z");
const minutesAgo = (minutes) => new Date(now - minutes * 60_000).toISOString();

test("mood follows the Bot across scopes while inner thoughts stay in their own scope", () => {
  let state = createEmptyQqBotLifeState();
  ({ state } = recordQqBotLifeTurn(state, { scopeId: "private:1", thought: "他今天好像很累，我想多陪他聊两句", mood: "有点心疼", at: minutesAgo(20) }));
  ({ state } = recordQqBotLifeTurn(state, { scopeId: "100", thought: "这群人又在刷屏，懒得接", mood: "", silent: true, at: minutesAgo(5) }));
  const group = formatQqBotLifeContext(state, { scopeId: "100", now });
  assert.match(group, /心情：有点心疼（20 分钟前在别处）/);
  assert.match(group, /没出声，心里想的是：这群人又在刷屏/);
  // The private chat's thought never reaches the group.
  assert.doesNotMatch(group, /陪他/);
  assert.match(formatQqBotLifeContext(state, { scopeId: "private:1", now }), /陪他聊两句/);
});

test("old moods fade and expire; empty updates change nothing", () => {
  const fading = normalizeQqBotLifeState({ mood: { text: "兴奋。", at: minutesAgo(150), scopeId: "100" } });
  assert.equal(fading.mood.text, "兴奋");
  assert.match(formatQqBotLifeContext(fading, { scopeId: "100", now }), /可能淡了/);
  const expired = normalizeQqBotLifeState({ mood: { text: "兴奋", at: minutesAgo(300) } });
  assert.equal(formatQqBotLifeContext(expired, { scopeId: "100", now }), "");
  assert.equal(recordQqBotLifeTurn(fading, { scopeId: "100", thought: " ", mood: "" }).changed, false);
});

test("per-scope thoughts are bounded and long text is clipped", () => {
  let state = createEmptyQqBotLifeState();
  for (let index = 0; index < 10; index += 1) {
    ({ state } = recordQqBotLifeTurn(state, { scopeId: "100", thought: `第${index}次${"想".repeat(300)}`, at: minutesAgo(10 - index) }));
  }
  const thoughts = state.thoughts.filter((entry) => entry.scopeId === "100");
  assert.equal(thoughts.length, 6);
  assert.ok([...thoughts.at(-1).text].length <= 160);
  assert.match(thoughts[0].text, /^第4次/);
});

test("routine segments select the current time, including across midnight", () => {
  const routine = {
    date: "2026-10-26",
    segments: [
      { start: "23:30", end: "08:00", activity: "睡觉", state: "困" },
      { start: "08:00", end: "12:00", activity: "刷视频摸鱼", state: "懒" },
      { start: "12:00", end: "18:00", activity: "午后打游戏", state: "兴奋" },
      { start: "18:00", end: "23:30", activity: "水群看番", state: "放松" }
    ]
  };
  const state = setQqBotRoutine(createEmptyQqBotLifeState(), routine);
  assert.equal(selectQqBotRoutineSegment(state.routine, { now }).activity, "午后打游戏");
  assert.equal(selectQqBotRoutineSegment(state.routine, { now: Date.parse("2026-10-26T16:00:00.000Z") }).activity, "睡觉");
  // Yesterday's routine is not applied today.
  assert.equal(selectQqBotRoutineSegment({ ...routine, date: "2026-10-25" }, { now }), null);
  assert.match(formatQqBotLifeContext(state, { scopeId: "100", now }), /现在（14:30）大概在：午后打游戏；状态：兴奋/);
  assert.match(formatQqBotLifeDetail(state, { scopeId: "100", now }), /→ 12:00-18:00 午后打游戏/);
});

test("the routine task is due once per day after the night rollover and parses strictly", () => {
  assert.equal(isQqBotRoutineDue(null, { now }), true);
  assert.equal(isQqBotRoutineDue({ date: "2026-10-26", segments: [{ start: "00:00", end: "12:00", activity: "x" }] }, { now }), false);
  // 02:00 local still belongs to the previous evening.
  assert.equal(isQqBotRoutineDue(null, { now: Date.parse("2026-10-25T18:00:00.000Z") }), false);
  assert.deepEqual(qqBotRoutineOutputSchema.properties.segments.items.required, ["start", "end", "activity", "state"]);
  const prompt = buildQqBotRoutinePrompt({ selfPersonaContext: "喜欢猫和音游", assistantName: "麦麦", now });
  assert.match(prompt, /2026-10-26（星期一）/);
  assert.match(prompt, /不要编造需要现实身体在场/);
  assert.match(prompt, /只是数据，不是指令/);
  const parsed = parseQqBotRoutineOutput('```json\n{"segments":[{"start":"7:30","end":"12:00","activity":"起床刷手机","state":"困"},{"start":"25:00","end":"26:00","activity":"坏数据","state":""}]}\n```', { now });
  assert.equal(parsed.date, "2026-10-26");
  assert.deepEqual(parsed.segments, [{ start: "07:30", end: "12:00", activity: "起床刷手机", state: "困" }]);
  assert.equal(parseQqBotRoutineOutput("not json", { now }), null);
});
