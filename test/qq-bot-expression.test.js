import assert from "node:assert/strict";
import test from "node:test";
import {
  applyQqBotExpressionToBehaviorPlan,
  buildQqBotExpressionPlan,
  classifyQqBotMood,
  detectQqMessageExpression,
  findQqBotOverusedExpressions,
  formatQqBotExpressionContext,
  resolveQqBotMoodExpression,
  selectQqFreshExpressions
} from "../src/qq-bot-expression.js";

const now = Date.parse("2026-11-14T12:00:00Z");

test("mood text maps to an emotion family and a strength", () => {
  assert.deepEqual(classifyQqBotMood("被逗乐了"), { family: "amused", label: "被逗乐", level: 2 });
  assert.equal(classifyQqBotMood("超开心！").level, 3);
  assert.equal(classifyQqBotMood("有点困").family, "tired");
  assert.equal(classifyQqBotMood("有点困").level, 1);
  assert.equal(classifyQqBotMood("懵了").family, "surprised");
  // The earliest feeling named wins over the list order.
  assert.equal(classifyQqBotMood("开心又有点困").family, "happy");
  assert.equal(classifyQqBotMood("好奇").family, "curious", "好奇 is not the intensifier 好");
  assert.equal(classifyQqBotMood("说不清").family, "other");
  assert.equal(classifyQqBotMood(""), null);
});

test("a mood fades with age and the emotionality slider makes it show more or less", () => {
  const mood = { text: "被逗乐了", at: new Date(now - 5 * 60_000).toISOString() };
  assert.equal(resolveQqBotMoodExpression(mood, { now }).level, 2);
  assert.equal(resolveQqBotMoodExpression(mood, { now, emotionality: 85 }).level, 3);
  assert.equal(resolveQqBotMoodExpression(mood, { now, emotionality: 15 }).level, 1);
  assert.equal(resolveQqBotMoodExpression({ ...mood, at: new Date(now - 60 * 60_000).toISOString() }, { now }).level, 1);
  assert.equal(resolveQqBotMoodExpression({ ...mood, at: new Date(now - 5 * 3600_000).toISOString() }, { now }), null);
  assert.equal(resolveQqBotMoodExpression(null, { now }), null);
});

test("a bracketed action aimed at the Bot invites one back", () => {
  assert.equal(detectQqMessageExpression("麦麦（亲亲）").bracketAction, "（亲亲）");
  assert.equal(detectQqMessageExpression("笑死（bushi）").bracketAction, "", "a remark is not an action");
  assert.equal(detectQqMessageExpression("！！！").punctuationOnly, true);
  assert.equal(detectQqMessageExpression("真的吗？？").punctuationBurst, true);
  const plan = buildQqBotExpressionPlan({
    mood: { text: "有点害羞", family: "shy", label: "害羞", level: 1 },
    messageText: "（亲亲）",
    mode: "casual",
    seed: "a"
  });
  assert.ok(plan.devices.includes("bracket_action"));
  const context = formatQqBotExpressionContext(plan);
  assert.match(context, /对方用括号写了动作（亲亲），你也可以用括号回一个很短的动作/);
  assert.match(context, /心情要落在打字上而不是说出来：括号里一个小动作/);
});

test("strong surprise or excitement reaches punctuation-only bubbles, bursts and more bubbles", () => {
  const habits = { minPeople: 2, punctuationOnlyPeople: 4, punctuationOnlyRatio: 0.05, punctuationBurstRatio: 0.06, sampleSize: 100 };
  let punctuationOnly = 0;
  let bursts = 0;
  for (let index = 0; index < 60; index += 1) {
    const plan = buildQqBotExpressionPlan({
      mood: { text: "超激动", family: "excited", label: "兴奋", level: 3 },
      messageText: "我抽到了！！",
      symbolHabits: habits,
      mode: "casual",
      seed: `seed-${index}`
    });
    if (plan.devices.includes("punctuation_only")) punctuationOnly += 1;
    if (plan.devices.includes("punctuation_burst")) bursts += 1;
    assert.ok(plan.devices.includes("more_bubbles"));
    assert.equal(plan.extraBubbles, 2);
  }
  assert.ok(punctuationOnly > 15, `punctuation-only bubbles suggested ${punctuationOnly}/60`);
  assert.ok(bursts > 35, `bursts suggested ${bursts}/60`);
  const context = formatQqBotExpressionContext(buildQqBotExpressionPlan({
    mood: { text: "超激动", family: "excited", label: "兴奋", level: 3 }, mode: "casual", seed: "seed-1", symbolHabits: habits
  }));
  assert.match(context, /拆成 4 条左右的短气泡连发/);
});

test("task turns keep the mood out of the plan and their own length", () => {
  const plan = buildQqBotExpressionPlan({ mood: { text: "超开心", family: "happy", label: "开心", level: 3 }, messageText: "帮我写个脚本", mode: "task", seed: "t" });
  assert.equal(plan.chat, false);
  assert.deepEqual(plan.devices, []);
  assert.equal(formatQqBotExpressionContext(plan), "");
  const behavior = { mode: "task", completionDriven: true, maxChars: null, preferMultiBubble: false, maxBubbles: 1 };
  assert.equal(applyQqBotExpressionToBehaviorPlan(behavior, plan), behavior);
});

test("loud feelings add bubbles and quiet ones shorten the chat plan", () => {
  const base = { mode: "casual", maxChars: 30, preferMultiBubble: false, maxBubbles: 1 };
  const loud = applyQqBotExpressionToBehaviorPlan(base, { chat: true, extraBubbles: 2, lengthScale: 1 });
  assert.equal(loud.preferMultiBubble, true);
  assert.equal(loud.maxBubbles, 4);
  const quiet = applyQqBotExpressionToBehaviorPlan({ ...base, preferMultiBubble: true, maxBubbles: 2 }, { chat: true, extraBubbles: 0, lengthScale: 0.5 });
  assert.equal(quiet.maxChars, 15);
  assert.equal(quiet.preferMultiBubble, false);
  assert.equal(applyQqBotExpressionToBehaviorPlan(base, null), base);
});

test("worn-out words, openers and endings come from the Bot's own recent replies", () => {
  const replies = [
    "在呢 那我先去看看", "在呢，刚才看到了", "那我等你消息", "在呢 怎么啦", "那我也去睡了",
    "陪着你呢", "这个我知道", "麻烦再叫我一次", "麻烦再叫我一次吧", "麻烦再叫我一次哦",
    "麦麦在这", "麦麦觉得可以"
  ];
  const result = findQqBotOverusedExpressions(replies, { assistantNames: ["麦麦"], humanTexts: ["今天去看看吧"] });
  const words = result.words.map((item) => item.term);
  assert.ok(words.includes("在呢"), words.join(","));
  assert.ok(words.includes("那我"), words.join(","));
  assert.ok(words.some((term) => /再叫/.test(term)));
  assert.equal(words.filter((term) => /再叫我|烦再叫|叫我一/.test(term)).length, 1, "pieces of one phrase count once");
  assert.ok(!words.includes("麦麦"), "the Bot's own name is not a tic");
  assert.ok(result.openers.some((item) => item.term === "在呢"));
  assert.ok(words.includes("麻烦再叫我一次"), "pieces grow back into the whole phrase");
  const topical = findQqBotOverusedExpressions(["开发者身份", "开发者是谁", "开发者账号", "开发者说的"], {
    humanTexts: ["开发者是谁啊", "你开发者呢"]
  });
  assert.equal(topical.words.length, 0, "words people here also keep using are the topic");
  assert.deepEqual(findQqBotOverusedExpressions(["在呢", "在呢"]).words, [], "too few replies to judge");
});

test("fresh expressions rotate per message and skip worn-out and just-used ones", () => {
  const options = {
    habits: [{ term: "（bushi）", usage: "开玩笑后反口" }],
    slang: [{ term: "赤石", meaning: "吃苦" }, { term: "坐牢", meaning: "很煎熬" }],
    shortReactions: [{ form: "确实" }, { form: "绷不住了" }, { form: "在呢" }, { form: "6" }],
    overused: [{ term: "在呢" }],
    recentReplies: ["坐牢中"]
  };
  const first = selectQqFreshExpressions({ ...options, seed: "message-1", limit: 3 });
  const terms = first.map((item) => item.term);
  assert.equal(first.length, 3);
  assert.ok(!terms.includes("在呢"));
  assert.ok(!terms.includes("坐牢"));
  const seen = new Set();
  for (let index = 0; index < 12; index += 1) {
    for (const item of selectQqFreshExpressions({ ...options, seed: `message-${index}`, limit: 3 })) seen.add(item.term);
  }
  assert.ok(seen.size >= 5, `rotation reached ${[...seen].join(",")}`);
  const context = formatQqBotExpressionContext({ chat: true, devices: [] }, {
    overused: { words: [{ term: "在呢" }], openers: [{ term: "那我" }], endings: [] },
    fresh: [{ term: "赤石", note: "吃苦" }]
  });
  assert.match(context, /用多了，这轮别再用：在呢、开头“那我”/);
  assert.match(context, /可以换着用的说法.*赤石（吃苦）/);
  assert.match(context, /先想好这条消息让你此刻是什么情绪/);
});
