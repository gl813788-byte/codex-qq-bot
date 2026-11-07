import assert from "node:assert/strict";
import test from "node:test";
import {
  collectQqPlannedChatCandidates,
  describeQqRoutineSegmentForScope,
  formatQqPlannedChatCandidates,
  formatQqPlannedChatPrompt,
  getQqPlannedChatBlocker,
  listQqPlannedChatContacts,
  normalizeQqPlannedChatContact,
  qqPlannedChatScopeId,
  summarizeQqPlannedChatForJudge
} from "../src/qq-bot-planned-chat.js";
import { formatQqBotLifeContext, formatQqBotLifeDetail, isQqBotRoutineOffline, normalizeQqBotRoutine } from "../src/qq-bot-life-state.js";
import { markQqLifeActivityStarted, selectQqLifeActivityDue } from "../src/qq-bot-life-activities.js";
import { buildQqBotRoutinePrompt, parseQqBotRoutineOutput, pickQqRoutineVariety } from "../src/qq-bot-daily-routine.js";

// 2026-11-07 15:20 in Asia/Shanghai.
const now = Date.parse("2026-11-07T07:20:00Z");
const hoursAgo = (hours) => new Date(now - hours * 3_600_000).toISOString();

const recentMessages = {
  "private:3784642920": [
    { at: hoursAgo(5), senderId: "3784642920", senderLabel: "流光", text: "我今天要拔牙zwz" },
    { at: hoursAgo(4.9), senderId: "assistant", isAssistant: true, text: "加油" }
  ],
  "private:22222": [{ at: hoursAgo(1), senderId: "22222", senderLabel: "被封的人", text: "hi" }],
  "private:33333": [{ at: hoursAgo(24 * 40), senderId: "33333", senderLabel: "很久以前", text: "old" }],
  "private:44444": [{ at: hoursAgo(2), senderId: "assistant", isAssistant: true, text: "only bot" }],
  1084253274: [{ at: hoursAgo(0.5), senderId: "1", senderLabel: "群友", text: "群里的话" }],
  999999: [{ at: hoursAgo(0.5), senderId: "1", senderLabel: "群友", text: "not allowed" }]
};

test("planned-chat candidates carry names, relationship and timing but never message text", () => {
  const candidates = collectQqPlannedChatCandidates({
    recentMessages,
    allowedGroups: ["1084253274"],
    bannedUserIds: ["22222"],
    groupName: () => "清九的海边小店",
    relationship: (userId) => (userId === "3784642920" ? { levelLabel: "亲近", familiarityLabel: "很熟", affinity: 40 } : null),
    activeHours: () => "9-23 点",
    now
  });
  assert.deepEqual(candidates.privates.map((item) => item.contact), ["private:3784642920"]);
  assert.deepEqual(candidates.groups.map((item) => item.contact), ["group:1084253274"]);
  const text = formatQqPlannedChatCandidates(candidates, { now });
  assert.match(text, /private:3784642920 流光（私聊；你对 TA：亲近、很熟；上次聊天：5 小时前（最后一条是你发的，还没回）；常在线：9-23 点）/);
  assert.match(text, /group:1084253274 清九的海边小店/);
  assert.doesNotMatch(text, /拔牙|群里的话/);
  assert.deepEqual([...listQqPlannedChatContacts(candidates)], ["private:3784642920", "group:1084253274"]);
});

test("contacts normalize to private:/group: keys and map to memory scopes", () => {
  assert.equal(normalizeQqPlannedChatContact(" Private:3784642920 "), "private:3784642920");
  assert.equal(normalizeQqPlannedChatContact("group:12"), "");
  assert.equal(normalizeQqPlannedChatContact("private:3784642920", new Set(["group:1084253274"])), "");
  assert.equal(qqPlannedChatScopeId("private:3784642920"), "private:3784642920");
  assert.equal(qqPlannedChatScopeId("group:1084253274"), "1084253274");
});

test("hard blockers stop a planned chat; softer judgment is left to the models", () => {
  assert.equal(getQqPlannedChatBlocker({ adaptivePlan: { unansweredBotStreak: 2 } }), "unanswered_streak");
  assert.equal(getQqPlannedChatBlocker({ adaptivePlan: { reason: "private_too_soon" } }), "already_talking");
  assert.equal(getQqPlannedChatBlocker({ type: "group", adaptivePlan: { reason: "outside_social_hours" } }), "outside_social_hours");
  assert.equal(getQqPlannedChatBlocker({ adaptivePlan: { reason: "private_check_cooldown", unansweredBotStreak: 1 } }), null);
  assert.equal(getQqPlannedChatBlocker({ type: "group", adaptivePlan: { reason: "group_not_cold" } }), null);
});

test("the plan reaches the judge and the main model as an intention, keeping silence possible", () => {
  const segment = { start: "15:00", end: "16:00", activity: "找朋友聊聊天", kind: "chat", plan: "问问拔牙后还疼不疼", contact: "private:3784642920" };
  assert.deepEqual(summarizeQqPlannedChatForJudge(segment), { source: "daily_routine", activity: "找朋友聊聊天", intention: "问问拔牙后还疼不疼", window: "15:00-16:00" });
  const privatePrompt = formatQqPlannedChatPrompt({ segment, type: "private" });
  assert.match(privatePrompt, /计划好的主动私聊/);
  assert.match(privatePrompt, /问问拔牙后还疼不疼/);
  assert.match(privatePrompt, /status 设为 silent/);
  assert.match(privatePrompt, /affinity\.delta 填 0/);
  assert.match(formatQqPlannedChatPrompt({ segment, type: "group", groupActive: true }), /不要打断别人正在进行的对话/);
});

test("a chat segment's target and plan stay inside the conversation it targets", () => {
  const routine = normalizeQqBotRoutine({
    date: "2026-11-07",
    segments: [
      { start: "00:00", end: "09:00", activity: "睡觉", state: "熟睡", online: false },
      { start: "09:00", end: "15:00", activity: "刷视频", state: "放松", kind: "surf", plan: "随手逛逛热搜" },
      { start: "15:00", end: "16:00", activity: "找流光聊拔牙", state: "惦记", kind: "chat", plan: "问问拔牙后还疼不疼", contact: "private:3784642920" },
      { start: "16:00", end: "00:00", activity: "发呆", state: "懒", kind: "chat", plan: "随便", contact: "nobody" }
    ]
  });
  assert.equal(routine.segments[0].online, false);
  assert.equal(routine.segments[1].kind, "surf");
  assert.equal(routine.segments[2].contact, "private:3784642920");
  // A chat without a valid contact becomes plain time.
  assert.equal(routine.segments[3].kind, undefined);
  assert.equal(describeQqRoutineSegmentForScope(routine.segments[2], "1084253274"), "找朋友聊聊天");
  assert.equal(describeQqRoutineSegmentForScope(routine.segments[2], "private:3784642920"), "找流光聊拔牙");
  const life = { routine };
  const inGroup = formatQqBotLifeDetail(life, { scopeId: "1084253274", now });
  assert.doesNotMatch(inGroup, /流光|拔牙/);
  const inPrivate = formatQqBotLifeDetail(life, { scopeId: "private:3784642920", now });
  assert.match(inPrivate, /想找这里聊：问问拔牙后还疼不疼/);
  assert.doesNotMatch(formatQqBotLifeContext(life, { scopeId: "1084253274", now }), /流光/);
  // A generic activity text must not make every conversation look like the target.
  const generic = normalizeQqBotRoutine({
    date: "2026-11-07",
    segments: [{ start: "00:00", end: "23:59", activity: "找朋友聊聊天", state: "", kind: "chat", plan: "问问拔牙后还疼不疼", contact: "private:3784642920" }]
  });
  assert.doesNotMatch(formatQqBotLifeDetail({ routine: generic }, { scopeId: "1084253274", now }), /拔牙/);
  assert.doesNotMatch(formatQqBotLifeDetail({ routine: generic }, { scopeId: "private:22222", now }), /拔牙/);
  assert.match(formatQqBotLifeDetail({ routine: generic }, { scopeId: "private:3784642920", now }), /拔牙/);
  assert.equal(isQqBotRoutineOffline(routine, { now: Date.parse("2026-11-07T00:30:00Z") }), true);
  assert.equal(isQqBotRoutineOffline(routine, { now }), false);
});

test("a due chat segment has its own daily cap and ignores the sub-agent gap", () => {
  const routine = {
    date: "2026-11-07",
    segments: [
      // 50 minutes in: past the stable 8-35 minute start offset.
      { start: "14:30", end: "16:00", activity: "找朋友聊聊天", state: "想说话", kind: "chat", plan: "分享下午刷到的视频", contact: "group:1084253274" },
      { start: "16:00", end: "14:30", activity: "其他", state: "" }
    ]
  };
  const busyLedger = { date: "2026-11-07", runs: 9, lastAt: hoursAgo(0.1), doneSegments: [], chats: 0 };
  const due = selectQqLifeActivityDue({ routine, activity: busyLedger }, { now, dailyLimit: 5, minGapMinutes: 60, chatLimit: 2 });
  assert.equal(due?.chat, true);
  assert.equal(selectQqLifeActivityDue({ routine, activity: busyLedger }, { now, chatLimit: 0 }), null);
  const marked = markQqLifeActivityStarted({ routine, activity: busyLedger }, due.segment, { now });
  assert.equal(marked.activity.chats, 1);
  assert.equal(marked.activity.runs, 9);
  assert.equal(selectQqLifeActivityDue(marked, { now, chatLimit: 2 }), null);
});

test("the routine planner is offered candidates, varied, and its chats are validated", () => {
  const prompt = buildQqBotRoutinePrompt({
    assistantName: "麦麦",
    now,
    chatCandidates: "- private:3784642920 流光（私聊）",
    maxChats: 2,
    variety: { flavor: "好奇心爆棚、到处乱逛的一天", suggestions: ["surf", "music"] },
    recentExperiences: [{ summary: "刷到一个老梗串烧，笑死" }]
  });
  assert.match(prompt, /- surf：上网冲浪/);
  assert.match(prompt, /0-2 段主动联系/);
  assert.match(prompt, /private:3784642920 流光/);
  assert.match(prompt, /今天可以试试：上网冲浪（surf）、听歌（music）/);
  assert.match(prompt, /刷到一个老梗串烧/);
  assert.match(prompt, /至少用 3 种不同的 kind/);
  const without = buildQqBotRoutinePrompt({ assistantName: "麦麦", now });
  assert.match(without, /不要安排 kind=chat/);
  assert.doesNotMatch(without, /- chat：/);

  const output = JSON.stringify({ segments: [
    { start: "05:00", end: "09:00", activity: "睡觉", state: "熟睡", kind: "none", plan: "", contact: "", online: false },
    { start: "09:00", end: "12:00", activity: "找朋友聊聊天", state: "想说话", kind: "chat", plan: "问问近况", contact: "private:3784642920", online: true },
    { start: "12:00", end: "13:00", activity: "找朋友聊聊天", state: "想说话", kind: "chat", plan: "问问近况", contact: "private:55555", online: true },
    { start: "13:00", end: "14:00", activity: "去群里冒个泡", state: "闲", kind: "chat", plan: "分享视频", contact: "group:1084253274", online: true },
    { start: "14:00", end: "05:00", activity: "听歌", state: "放松", kind: "music", plan: "听几首城市流行", contact: "", online: true }
  ] });
  const parsed = parseQqBotRoutineOutput(output, {
    now,
    allowedContacts: new Set(["private:3784642920", "group:1084253274"]),
    maxChats: 1
  });
  assert.deepEqual(parsed.segments.map((segment) => segment.kind || "none"), ["none", "chat", "none", "none", "music"]);
  assert.equal(parsed.segments[0].online, false);
  assert.equal(parsed.segments[2].activity, "想找人聊聊");
  assert.equal(parsed.segments[3].contact, undefined);
});

test("variety picks a flavor and prefers kinds yesterday lacked", () => {
  const sequence = [0.1, 0.9, 0.3, 0.7, 0.5, 0.2, 0.8, 0.4, 0.6, 0.05, 0.95, 0.15];
  let index = 0;
  const random = () => sequence[index++ % sequence.length];
  const previousRoutine = { date: "2026-11-06", segments: [{ start: "00:00", end: "12:00", activity: "刷视频", kind: "video", plan: "看猫" }, { start: "12:00", end: "00:00", activity: "画画", kind: "draw", plan: "画猫" }] };
  const variety = pickQqRoutineVariety({ previousRoutine, random, canDraw: true, canChat: false });
  assert.ok(variety.flavor);
  assert.ok(variety.suggestions.length >= 2 && variety.suggestions.length <= 3);
  assert.ok(variety.suggestions.every((kind) => !["video", "draw", "chat"].includes(kind)));
});
