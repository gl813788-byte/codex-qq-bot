import assert from "node:assert/strict";
import test from "node:test";
import {
  QQ_LANGUAGE_HABIT_LIMITS,
  applyQqLanguageHabitProposals,
  applyQqModelLanguageHabitChange,
  createEmptyQqLanguageHabits,
  describeQqLanguageHabitsForReview,
  formatQqLanguageHabitsContext,
  normalizeQqLanguageHabitTerm,
  normalizeQqLanguageHabits,
  recordQqLanguageHabitUsage,
  removeQqLanguageHabit,
  selectQqLanguageHabitsForScope,
  selectQqScopeSlangCandidates
} from "../src/qq-bot-language-habits.js";

const at = Date.UTC(2026, 10, 1, 8, 0);

test("terms are short single-line expressions without links, mentions or markers", () => {
  assert.equal(normalizeQqLanguageHabitTerm("  （bushi） "), "（bushi）");
  for (const bad of ["", "x".repeat(17), "https://a.b", "@某人", "[[qq_sticker:1]]", "[CQ:face,id=1]", "123456", "两行\n文字"]) {
    assert.equal(normalizeQqLanguageHabitTerm(bad), "", bad);
  }
});

test("scoped habits stay in their scope and global ones apply everywhere", () => {
  let habits = applyQqLanguageHabitProposals(createEmptyQqLanguageHabits(), {
    adopt: [{ kind: "slang", term: "饭堂刺客", usage: "吐槽食堂涨价", reason: "群里常说" }],
    drop: []
  }, { scopeId: "10001", at }).habits;
  habits = applyQqLanguageHabitProposals(habits, { adopt: [{ kind: "slang", term: "草", usage: "被逗笑", reason: "通用" }], drop: [] }, { scopeId: "global", source: "persona", at }).habits;
  assert.deepEqual(selectQqLanguageHabitsForScope(habits, "10001").map((item) => item.term).sort(), ["草", "饭堂刺客"]);
  assert.deepEqual(selectQqLanguageHabitsForScope(habits, "20002").map((item) => item.term), ["草"]);
  const context = formatQqLanguageHabitsContext({ habits, scopeId: "10001", scopeSlang: [{ term: "饭堂刺客", meaning: "x" }, { term: "补作业", meaning: "临时赶作业" }] });
  assert.match(context, /饭堂刺客（黑话，这里的）：吐槽食堂涨价/);
  assert.match(context, /草（黑话）：被逗笑/);
  assert.match(context, /补作业（临时赶作业）/);
  assert.doesNotMatch(context, /饭堂刺客（x）/, "an adopted habit is not repeated as scope slang");
  assert.match(context, /qq_self\.language_habit/);
  assert.doesNotMatch(formatQqLanguageHabitsContext({ habits, scopeId: "10001", toolsEnabled: false }), /qq_self/);
  assert.equal(formatQqLanguageHabitsContext({ habits: null, scopeId: "1" }), "");
});

test("usage is counted from delivered replies and reviews see it", () => {
  let habits = applyQqLanguageHabitProposals(createEmptyQqLanguageHabits(), {
    adopt: [{ kind: "symbol", term: "（bushi）", usage: "反口", reason: "" }], drop: []
  }, { scopeId: "10001", at }).habits;
  const used = recordQqLanguageHabitUsage(habits, "那我也去补作业（bushi）", { scopeId: "10001", at: at + 1000 });
  assert.deepEqual(used.used, ["（bushi）"]);
  assert.deepEqual(recordQqLanguageHabitUsage(used.habits, "（bushi）", { scopeId: "20002" }).used, [], "other scopes do not count");
  habits = used.habits;
  const review = describeQqLanguageHabitsForReview(habits, "10001", { now: at + 3 * 86_400_000 });
  assert.equal(review[0].uses, 1);
  assert.equal(review[0].daysSinceLastUse, 2);
  assert.equal(review[0].scope, "this-scope");
});

test("the model adopts within a daily cap and cannot drop owner habits", () => {
  let habits = applyQqLanguageHabitProposals(createEmptyQqLanguageHabits(), {
    adopt: [{ kind: "phrase", term: "主人定的", usage: "", reason: "" }], drop: []
  }, { scopeId: "10001", source: "owner", at }).habits;
  assert.equal(applyQqModelLanguageHabitChange(habits, { action: "drop", term: "主人定的", scopeId: "10001", at }).reason, "owner-locked");
  const daily = Array.from({ length: QQ_LANGUAGE_HABIT_LIMITS.modelAdoptionsPerDay }, (_, index) => `a${index + 1}`);
  for (const [index, term] of daily.entries()) {
    const result = applyQqModelLanguageHabitChange(habits, { action: "adopt", kind: "slang", term, scopeId: "10001", at: at + index });
    assert.equal(result.ok, true, term);
    assert.equal(result.habit.source, "self");
    habits = result.habits;
  }
  assert.equal(applyQqModelLanguageHabitChange(habits, { action: "adopt", kind: "slang", term: "z1", scopeId: "10001", at: at + 10 }).reason, "daily-cap");
  assert.equal(applyQqModelLanguageHabitChange(habits, { action: "adopt", kind: "slang", term: "z1", scopeId: "10001", at: at + 86_400_000 }).ok, true, "the cap resets the next day");
  assert.equal(applyQqModelLanguageHabitChange(habits, { action: "adopt", kind: "slang", term: "a1", scopeId: "10001", at }).reason, "already-adopted");
  assert.equal(applyQqModelLanguageHabitChange(habits, { action: "adopt", kind: "bad", term: "x1", scopeId: "10001", at }).reason, "invalid-kind");
  assert.equal(applyQqModelLanguageHabitChange(habits, { action: "adopt", kind: "slang", term: "x1", scopeId: "not-a-scope", at }).reason, "invalid-scope");
  const dropped = applyQqModelLanguageHabitChange(habits, { action: "drop", term: "a1", scopeId: "10001", at });
  assert.equal(dropped.ok, true);
  assert.equal(selectQqLanguageHabitsForScope(dropped.habits, "10001").some((item) => item.term === "a1"), false);
});

test("caps evict the least used habits but keep the ones just adopted", () => {
  let habits = createEmptyQqLanguageHabits();
  for (let index = 0; index < QQ_LANGUAGE_HABIT_LIMITS.perScope; index += 1) {
    habits = applyQqLanguageHabitProposals(habits, { adopt: [{ kind: "slang", term: `旧${index}`, usage: "", reason: "" }], drop: [] }, { scopeId: "10001", at: at + index }).habits;
  }
  habits = recordQqLanguageHabitUsage(habits, "旧1 旧2 旧3 旧4 旧5", { scopeId: "10001", at: at + 100 }).habits;
  const result = applyQqLanguageHabitProposals(habits, { adopt: [{ kind: "slang", term: "新来的", usage: "", reason: "" }], drop: [] }, { scopeId: "10001", at: at + 200 });
  const terms = result.habits.items.map((item) => item.term);
  assert.equal(terms.length, QQ_LANGUAGE_HABIT_LIMITS.perScope);
  assert.ok(terms.includes("新来的"));
  assert.ok(!terms.includes("旧0"), "the unused habit goes first");
  assert.equal(removeQqLanguageHabit(result.habits, result.habits.items[0].id).removed, true);
  const malformed = normalizeQqLanguageHabits({ items: [{ term: "", scope: "1" }, { term: "ok", scope: "bad" }, { term: "ok", scope: "12345", kind: "weird" }] });
  assert.deepEqual(malformed.items.map((item) => [item.term, item.kind]), [["ok", "slang"]]);
});

test("scope slang comes from group-wide knowledge, never one member's meaning", () => {
  const store = {
    entries: [
      { kind: "slang", title: "饭堂刺客", variants: [{ content: "贵得离谱的食堂菜。用于吐槽", scope: { type: "group", groupId: "10001" }, usage: { hitCount: 5 } }] },
      { kind: "slang", title: "他的口头禅", variants: [{ content: "某人专属", scope: { type: "group-member", groupId: "10001", userId: "1" }, usage: { hitCount: 50 } }] },
      { kind: "slang", title: "yyds", variants: [{ content: "永远的神", scope: { type: "global" }, usage: { hitCount: 1 } }] },
      { kind: "note", title: "群规", variants: [{ content: "不发广告", scope: { type: "group", groupId: "10001" } }] },
      { kind: "slang", title: "别的群", variants: [{ content: "另一个群", scope: { type: "group", groupId: "20002" }, usage: { hitCount: 99 } }] }
    ]
  };
  const slang = selectQqScopeSlangCandidates(store, { groupId: "10001" });
  assert.deepEqual(slang.map((item) => item.term), ["饭堂刺客", "yyds"]);
  assert.equal(slang[0].meaning, "贵得离谱的食堂菜");
  assert.deepEqual(selectQqScopeSlangCandidates(store, {}), []);
});

test("owner-requested habits skip the cap and stay out of the model's reach", async () => {
  const { applyQqOwnerLanguageHabitChange } = await import("../src/qq-bot-language-habits.js");
  let habits = createEmptyQqLanguageHabits();
  for (const term of ["一", "二", "三", "四"]) {
    const result = applyQqOwnerLanguageHabitChange(habits, { action: "adopt", kind: "phrase", term, scopeId: "global", at });
    assert.equal(result.ok, true, term);
    habits = result.habits;
  }
  assert.equal(habits.items.every((item) => item.source === "owner"), true);
  assert.equal(applyQqModelLanguageHabitChange(habits, { action: "drop", term: "一", scopeId: "10001", at }).reason, "owner-locked");
  const dropped = applyQqOwnerLanguageHabitChange(habits, { action: "drop", term: "一", scopeId: "10001", at });
  assert.equal(dropped.ok, true, "the owner can drop a global habit from any conversation");
  assert.equal(applyQqOwnerLanguageHabitChange(habits, { action: "adopt", kind: "slang", term: "", scopeId: "global" }).reason, "invalid-term");
});
