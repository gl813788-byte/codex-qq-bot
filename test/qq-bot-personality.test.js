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

test("finer persona options normalize, render and bias expression", async () => {
  const {
    QQ_PERSONALITY_SOCIAL,
    QQ_PERSONALITY_SPEECH,
    formatQqPersonaLoreContext,
    getQqPersonalityExpressionBias,
    selectQqPersonaLore
  } = await import("../src/qq-bot-personality.js");
  assert.equal(QQ_PERSONALITY_SPEECH.length, 7);
  assert.ok(QQ_PERSONALITY_SOCIAL.some((item) => item.id === "comfort"));
  const lazy = applyQqPersonalityPreset({ likes: ["猫"], social: { ownerRelation: "从小一起长大" } }, "lazy");
  assert.equal(lazy.traits.energy, 12);
  assert.equal(lazy.speech.brevity, 80);
  assert.equal(lazy.social.teased, "ignore");
  assert.equal(lazy.social.ownerRelation, "从小一起长大", "presets keep the owner relation");
  assert.deepEqual(lazy.likes, ["猫"]);
  const state = normalizeQqPersonality({
    profile: {
      ...lazy,
      name: "懒懒",
      selfReference: "咱",
      age: "二十出头",
      occupation: "大学生",
      speech: { ...lazy.speech, emoji: 0, sticker: 100 },
      social: { ...lazy.social, praised: "not-an-option" },
      lore: [
        { keys: ["宿舍"], content: "{{char}}住四人间" },
        { keys: ["食堂"], content: "食堂三楼最好吃", enabled: false },
        { keys: [], content: "常驻设定", constant: true }
      ]
    }
  });
  assert.equal(state.profile.social.praised, "", "unknown options are dropped");
  const core = formatQqPersonalityCoreContext(state, { assistantName: "麦麦" });
  assert.match(core, /自称“咱”；年龄感：二十出头；身份：大学生/);
  assert.match(core, /懒洋洋的/);
  assert.match(core, /极简，常常就几个字|回复偏短/);
  assert.match(core, /被调侃懒得理/);
  assert.match(core, /和主人的关系：从小一起长大/);
  assert.match(core, /设定：常驻设定/);
  assert.match(formatQqPersonaLoreContext(state, { text: "你宿舍几个人", assistantName: "麦麦" }), /懒懒住四人间/);
  assert.equal(selectQqPersonaLore(state, "食堂好吃吗").length, 0, "disabled lore never fires");
  assert.equal(formatQqPersonaLoreContext(state, { text: "" }), "");
  const bias = getQqPersonalityExpressionBias(state);
  assert.equal(bias.emojiScale, 0);
  assert.equal(bias.stickerScale, 2);
  assert.ok(bias.lengthScale < 1);
  assert.equal(getQqPersonalityExpressionBias(normalizeQqPersonality({ profile: { enabled: false } })), null);
  const judge = summarizeQqPersonalityForJudge(state);
  assert.equal(judge.initiative, "很少主动搭话，被叫到才出声");
  const summary = summarizeQqPersonality(state);
  assert.equal(summary.speech.length, 7);
  assert.ok(summary.social.find((item) => item.id === "teased").options.length >= 3);
  assert.equal(summary.textLimits.description, 6000);
});

test("version 1 profiles load unchanged into the finer profile", () => {
  const legacy = normalizeQqPersonality({
    version: 1,
    profile: { preset: "cool", identity: "老设定", traits: { extraversion: 18 }, speechHabits: ["话少"], likes: ["猫"] }
  });
  assert.equal(legacy.version, 2);
  assert.equal(legacy.profile.identity, "老设定");
  assert.equal(legacy.profile.traits.extraversion, 18);
  assert.equal(legacy.profile.traits.energy, 50);
  assert.equal(legacy.profile.speech.brevity, 50);
  assert.deepEqual(legacy.profile.lore, []);
  assert.equal(legacy.profile.description, "");
});

test("the Bot adjusts its own persona in small, logged, undoable steps", async () => {
  const { applyQqPersonaSelfEdit, describeQqPersonaSelfEditState, revertQqPersonaSelfEdit } = await import("../src/qq-bot-personality.js");
  let state = createEmptyQqPersonality();
  const day = "2026-11-05T01:00:00.000Z";
  const nudge = applyQqPersonaSelfEdit(state, { field: "traits", key: "humor", delta: 30, reason: "一直爱接梗", at: day });
  assert.equal(nudge.applied, true);
  assert.equal(nudge.state.profile.traits.humor, 60, "one change moves a slider at most 10");
  assert.equal(nudge.state.profile.preset, "custom");
  state = nudge.state;
  state = applyQqPersonaSelfEdit(state, { field: "quirks", op: "add", value: "熬夜后反应慢", at: day }).state;
  assert.equal(applyQqPersonaSelfEdit(state, { field: "boundaries", op: "remove", value: "x", at: day }).reason, "not-allowed");
  assert.equal(applyQqPersonaSelfEdit(state, { field: "name", value: "新名字", at: day }).reason, "invalid-field", "names stay operator-only");
  state = applyQqPersonaSelfEdit(state, { field: "social", key: "teased", value: "banter", at: day }).state;
  assert.equal(applyQqPersonaSelfEdit(state, { field: "likes", op: "add", value: "猫", at: day }).reason, "daily-cap");
  assert.equal(applyQqPersonaSelfEdit(state, { field: "likes", op: "add", value: "猫", source: "review", at: day }).applied, true, "the periodic review has no chat cap");
  const locked = normalizeQqPersonality({ ...state, profile: { ...state.profile, selfEdit: { enabled: true, locked: ["traits"] } } });
  assert.equal(applyQqPersonaSelfEdit(locked, { field: "traits", key: "humor", delta: 5, at: "2026-11-06T01:00:00.000Z" }).reason, "locked");
  const off = normalizeQqPersonality({ ...state, profile: { ...state.profile, selfEdit: { enabled: false } } });
  assert.equal(applyQqPersonaSelfEdit(off, { field: "traits", key: "humor", delta: 5 }).reason, "disabled");
  assert.equal(describeQqPersonaSelfEditState(off), null);
  const view = describeQqPersonaSelfEditState(locked, { now: "2026-11-06T02:00:00.000Z" });
  assert.equal(view.traits, undefined, "locked groups are not offered");
  assert.equal(view.remainingToday, 3);
  const reverted = revertQqPersonaSelfEdit(state, state.profile.selfEditLog[0].id);
  assert.equal(reverted.state.profile.traits.humor, 50);
  assert.equal(reverted.state.profile.selfEditLog[0].reverted, true);
  assert.deepEqual(revertQqPersonaSelfEdit(state, state.profile.selfEditLog[1].id).state.profile.quirks, []);
  assert.throws(() => revertQqPersonaSelfEdit(state, "missing"), RangeError);
  assert.match(formatQqPersonalityCoreContext(state), /qq_self\.persona 微调/);
});

test("owner-directed edits reach almost every setting without the small-step rules", async () => {
  const { applyQqPersonaOwnerEdit, revertQqPersonaSelfEdit, QQ_PERSONA_OWNER_EDIT_FIELDS } = await import("../src/qq-bot-personality.js");
  assert.ok(QQ_PERSONA_OWNER_EDIT_FIELDS.includes("description"));
  let state = normalizeQqPersonality({ profile: { selfEdit: { enabled: false, locked: ["traits"] } } });
  const edit = (args) => {
    const result = applyQqPersonaOwnerEdit(state, { at: "2026-11-05T01:00:00.000Z", ...args });
    if (result.applied) state = result.state;
    return result;
  };
  assert.equal(edit({ field: "traits", key: "sarcasm", value: "95" }).applied, true, "locks and the off switch only limit the Bot's own changes");
  assert.equal(state.profile.traits.sarcasm, 95);
  assert.equal(edit({ field: "name", value: "小麦" }).applied, true);
  assert.equal(edit({ field: "boundaries", op: "add", value: "不骂人" }).applied, true);
  assert.equal(edit({ field: "boundaries", op: "remove", value: "不骂人" }).applied, true);
  assert.equal(edit({ field: "catchphrases", op: "set", value: "笑死\n绝了" }).applied, true);
  assert.deepEqual(state.profile.catchphrases, ["笑死", "绝了"]);
  assert.equal(edit({ field: "description", value: "{{char}}是一只猫" }).applied, true);
  assert.equal(edit({ field: "lore", key: "煤球", value: "煤球是主人的猫" }).applied, true);
  assert.equal(state.profile.lore[0].keys[0], "煤球");
  assert.equal(edit({ field: "affinity", key: "maxDeltaPerTurn", value: "99" }).applied, true);
  assert.equal(state.profile.affinity.maxDeltaPerTurn, 10, "values are still normalized");
  assert.equal(edit({ field: "selfEdit", key: "enabled", value: "true" }).applied, true);
  assert.equal(edit({ field: "selfEdit", key: "unlock", value: "traits" }).applied, true);
  assert.deepEqual(state.profile.selfEdit, { enabled: true, locked: [] });
  assert.equal(edit({ field: "preset", value: "nope" }).reason, "invalid-value");
  assert.equal(edit({ field: "unknown", value: "x" }).reason, "invalid-field");
  assert.equal(edit({ field: "enabled", value: "false" }).applied, true);
  assert.equal(state.profile.enabled, false);
  const nameEntry = state.profile.selfEditLog.find((entry) => entry.field === "name");
  assert.equal(nameEntry.source, "owner");
  assert.equal(revertQqPersonaSelfEdit(state, nameEntry.id).state.profile.name, "");
  const loreEntry = state.profile.selfEditLog.find((entry) => entry.field === "lore");
  assert.equal(revertQqPersonaSelfEdit(state, loreEntry.id).reverted, false, "structural edits are not auto-reverted");
  assert.equal(applyQqPersonaOwnerEdit(state, { field: "name", value: "管理员改", actor: "admin" }).entry.source, "admin");
});
