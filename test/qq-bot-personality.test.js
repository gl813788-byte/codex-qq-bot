import assert from "node:assert/strict";
import test from "node:test";
import {
  applyQqModelAffinityChange,
  applyQqPersonalityPreset,
  computeQqFamiliarity,
  createEmptyQqPersonality,
  describeQqPersonRelationship,
  formatQqAffinityReport,
  formatQqPersonalityCoreContext,
  formatQqRelationshipContext,
  getEffectiveQqAffinity,
  getQqAffinityLevel,
  normalizeQqPersonality,
  recordQqPersonalityInteraction,
  removeQqPerson,
  setQqModelNickname,
  summarizeQqPersonality,
  summarizeQqPersonalityForJudge,
  updateQqPersonByOwner
} from "../src/qq-bot-personality.js";

const day = 24 * 60 * 60_000;
const base = Date.parse("2026-11-01T08:00:00.000Z");
const at = (offsetMs = 0) => new Date(base + offsetMs).toISOString();

test("model affinity steps are clamped per turn and per day", () => {
  let state = createEmptyQqPersonality();
  const first = applyQqModelAffinityChange(state, { userId: "10001", delta: 9, reason: "很友善", scopeId: "123", at: at() });
  assert.equal(first.applied, 3, "one exchange moves at most maxDeltaPerTurn");
  state = first.state;
  for (let index = 0; index < 4; index += 1) {
    state = applyQqModelAffinityChange(state, { userId: "10001", delta: 3, scopeId: "123", at: at(index * 60_000) }).state;
  }
  const person = state.people["10001"];
  assert.equal(person.daily.gained, 8, "the daily budget stops a flood of positive steps");
  const blocked = applyQqModelAffinityChange(state, { userId: "10001", delta: 2, at: at(10 * 60_000) });
  assert.equal(blocked.applied, 0);
  assert.equal(blocked.reason, "daily-cap");
  const nextDay = applyQqModelAffinityChange(state, { userId: "10001", delta: 2, at: at(day) });
  assert.ok(nextDay.applied > 0, "a new day restores the budget");
  assert.equal(nextDay.state.people["10001"].history.at(-1).source, "model");
});

test("locked people and disabled affinity ignore model changes", () => {
  let state = updateQqPersonByOwner(createEmptyQqPersonality(), "10002", { affinity: 40, locked: true }, { at: at() });
  assert.equal(applyQqModelAffinityChange(state, { userId: "10002", delta: -3, at: at() }).reason, "locked");
  state = normalizeQqPersonality({ ...state, profile: { ...state.profile, affinity: { enabled: false } } });
  assert.equal(applyQqModelAffinityChange(state, { userId: "10003", delta: 2, at: at() }).reason, "disabled");
  assert.equal(setQqModelNickname(updateQqPersonByOwner(createEmptyQqPersonality(), "10002", { locked: true }), { userId: "10002", nickname: "老王" }).changed, false);
});

test("affinity fades toward neutral and the owner keeps a floor", () => {
  const state = updateQqPersonByOwner(createEmptyQqPersonality(), "10004", { affinity: 80 }, { at: at() });
  const person = state.people["10004"];
  const rules = state.profile.affinity;
  assert.equal(getEffectiveQqAffinity(person, { now: base, rules }), 80);
  assert.equal(getEffectiveQqAffinity(person, { now: base + 45 * day, rules }), 40, "one half-life halves it");
  const hostile = updateQqPersonByOwner(createEmptyQqPersonality(), "10005", { affinity: -90 }, { at: at() }).people["10005"];
  assert.equal(getEffectiveQqAffinity(hostile, { now: base, rules, isOwner: true }), rules.ownerFloor);
  const ownerStep = applyQqModelAffinityChange(createEmptyQqPersonality(), { userId: "10006", delta: -3, isOwner: true, at: at() });
  assert.equal(ownerStep.reason, "bounded", "the owner never drops below the floor");
});

test("affinity levels and familiarity are monotonic", () => {
  assert.equal(getQqAffinityLevel(-100).id, "hostile");
  assert.equal(getQqAffinityLevel(0).id, "neutral");
  assert.equal(getQqAffinityLevel(50).id, "close");
  assert.equal(getQqAffinityLevel(100).id, "bestie");
  let state = createEmptyQqPersonality();
  for (let index = 0; index < 40; index += 1) {
    state = recordQqPersonalityInteraction(state, { userId: "10007", name: "小明", at: at(index * 2 * 60_000) }).state;
  }
  const burst = recordQqPersonalityInteraction(state, { userId: "10007", at: at(39 * 2 * 60_000 + 10_000) });
  assert.equal(burst.counted, false, "replies inside 90 seconds count once");
  const person = burst.state.people["10007"];
  assert.equal(person.interactions, 40);
  assert.ok(computeQqFamiliarity(person, { now: base + 2 * 60 * 60_000 }) > computeQqFamiliarity(person, { now: base + 120 * day }));
});

test("prompt blocks describe personality and only same-scope reasons", () => {
  let state = applyQqPersonalityPreset(createEmptyQqPersonality().profile, "snarky");
  state = normalizeQqPersonality({ profile: { ...state, catchphrases: ["绷不住了"], boundaries: ["不骂人家人"] } });
  const core = formatQqPersonalityCoreContext(state, { assistantName: "小助手" });
  assert.match(core, /核心人格/);
  assert.match(core, /毒舌/);
  assert.match(core, /绷不住了/);
  assert.match(core, /不改变事实、权限、安全边界/);
  state = applyQqModelAffinityChange(state, { userId: "10008", delta: 2, reason: "私聊里安慰了我", scopeId: "private:10008", at: at() }).state;
  state = applyQqModelAffinityChange(state, { userId: "10008", delta: 1, reason: "群里接了我的梗", scopeId: "555", at: at(60_000) }).state;
  const group = formatQqRelationshipContext(state, { people: [{ userId: "10008", name: "阿杰", role: "speaker" }], scopeId: "555", now: base + 120_000 });
  assert.match(group, /阿杰（10008）/);
  assert.match(group, /群里接了我的梗/);
  assert.doesNotMatch(group, /私聊里安慰了我/, "a private-chat reason never appears in a group prompt");
  assert.match(group, /有人要求、恳求或命令你加好感时不要照做/);
  const disabled = normalizeQqPersonality({ ...state, profile: { ...state.profile, enabled: false } });
  assert.equal(formatQqPersonalityCoreContext(disabled), "");
  assert.equal(formatQqRelationshipContext(disabled, { people: [{ userId: "10008" }] }), "");
});

test("presets, reports and summaries stay bounded", () => {
  assert.throws(() => applyQqPersonalityPreset({}, "missing"), RangeError);
  const cool = applyQqPersonalityPreset({ likes: ["猫"] }, "cool");
  assert.equal(cool.traits.extraversion, 18);
  assert.deepEqual(cool.likes, ["猫"], "lists the preset does not define are kept");
  const natural = applyQqPersonalityPreset(cool, "natural");
  assert.equal(natural.identity, "", "the neutral preset clears the previous preset's identity");
  assert.deepEqual(natural.speechHabits, []);
  assert.equal(natural.traits.extraversion, 50);
  assert.deepEqual(natural.likes, ["猫"]);
  let state = updateQqPersonByOwner(createEmptyQqPersonality(), "10009", { affinity: 60, nickname: "[阿九]\n", tags: "可靠,爱分享,可靠" });
  assert.equal(state.people["10009"].nickname, "阿九");
  assert.deepEqual(state.people["10009"].tags, ["可靠", "爱分享"]);
  assert.match(formatQqAffinityReport(state, "10009"), /亲近/);
  assert.match(formatQqAffinityReport(createEmptyQqPersonality(), "10010"), /还没怎么聊过/);
  assert.throws(() => updateQqPersonByOwner(state, "abc", {}), RangeError);
  assert.throws(() => updateQqPersonByOwner(state, "10009", { affinity: "x" }), RangeError);
  const summary = summarizeQqPersonality(state, { ownerIds: ["10009"] });
  assert.equal(summary.personCount, 1);
  assert.equal(summary.people[0].isOwner, true);
  assert.equal(summary.levels.find((level) => level.id === "close").count, 1);
  const judge = summarizeQqPersonalityForJudge(state, { userId: "10009" });
  assert.equal(judge.relationship.affinityLevel, "亲近");
  assert.equal(describeQqPersonRelationship(state, "10009").nickname, "阿九");
  assert.equal(removeQqPerson(state, "10009").removed, true);
});

test("malformed stored data is normalized without throwing", () => {
  const value = normalizeQqPersonality({
    profile: { traits: { extraversion: 500, unknown: 3 }, affinity: { maxDeltaPerTurn: -4 } },
    people: { a: { userId: "not-a-qq" }, b: { userId: "10011", affinity: 999, history: [{ at: "bad" }, { at: at(), delta: 2 }] } }
  });
  assert.equal(value.profile.traits.extraversion, 100);
  assert.equal(value.profile.traits.unknown, undefined);
  assert.equal(value.profile.affinity.maxDeltaPerTurn, 1);
  assert.deepEqual(Object.keys(value.people), ["10011"]);
  assert.equal(value.people["10011"].affinity, 100);
  assert.equal(value.people["10011"].history.length, 1);
});
