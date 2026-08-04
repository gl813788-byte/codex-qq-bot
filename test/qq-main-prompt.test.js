import assert from "node:assert/strict";
import test from "node:test";
import {
  formatQqApprovedProactivePrompt,
  formatQqMainModelInstructions,
  formatQqMainToolGuide
} from "../src/qq-main-prompt.js";

test("main prompt delegates agent control to Codex native capabilities", () => {
  const prompt = formatQqMainModelInstructions({
    assistantName: "麦麦",
    ownerLabel: "主人",
    speaker: "小明(QQ 10000)；群聊",
    enhancerEnabled: true,
    currentDate: "2026-07-21",
    assistantProfile: "喜欢语言和工具。"
  });
  assert.match(prompt, /Codex 原生 Agent 负责推理、工具循环、文件操作、联网搜索、计划、上下文压缩/);
  assert.match(prompt, /连续调用多个原生工具/);
  assert.match(prompt, /原生 commentary 写少量可直接发给 QQ 用户的自然中文进度/);
  assert.match(prompt, /不要在 commentary 里放最终 Schema JSON/);
  assert.match(prompt, /不需要向 Hub 申请额外轮数/);
  assert.match(prompt, /结构化输出的 status 设为 silent/);
  assert.match(prompt, /reply\.mode.*automatic、plain、quote 或 mention/);
  assert.match(prompt, /输出 Schema 要求的 JSON 对象/);
  assert.match(prompt, /原生 Web Search/);
  assert.match(prompt, /原生文件能力.*task output 工作区/);
  assert.match(prompt, /主人权限仍只认 Hub 的 isOwner 验证/);
  assert.doesNotMatch(prompt, /qq_(?:command|done|progress|task_budget|task_continue)/);
  assert.doesNotMatch(prompt, /\[\[qq_/);

  const noTools = formatQqMainModelInstructions({ privateChat: true, toolsEnabled: false });
  assert.match(noTools, /本轮没有 QQ 动态工具/);
  assert.match(noTools, /不要虚构工具调用/);
});

test("approved proactive prompts use structured silence", () => {
  const ordinary = formatQqApprovedProactivePrompt({ kind: "ordinary" });
  assert.match(ordinary, /兴趣模型已经决定这段群聊值得接话/);
  assert.match(ordinary, /status 设为 silent/);
  assert.doesNotMatch(ordinary, /\[\[qq_/);

  const privatePrompt = formatQqApprovedProactivePrompt({ kind: "private" });
  assert.match(privatePrompt, /兴趣模型已经决定现在联系对方/);
  assert.match(privatePrompt, /不问“在吗”/);
  assert.match(privatePrompt, /status 设为 silent/);
});

test("tool guide describes native tools and server-bound permissions", () => {
  const ordinary = formatQqMainToolGuide({
    messageText: "这个库最近版本有什么变化",
    currentSender: "小明(QQ 10000)",
    recentCount: 20,
    knowledgeTitleCount: 3
  });
  assert.match(ordinary, /qq_context\.history/);
  assert.match(ordinary, /qq_knowledge\.manage/);
  assert.match(ordinary, /原生 Web Search/);
  assert.match(ordinary, /原始 callId 的服务端绑定上下文/);
  assert.doesNotMatch(ordinary, /qq_runtime\.configure/);
  assert.doesNotMatch(ordinary, /qq_(?:command|done|progress|task_budget|task_continue)/);

  const owner = formatQqMainToolGuide({
    messageText: "把思考强度调高并总结最近聊天",
    isOwner: true,
    currentSender: "主人(QQ 1)"
  });
  assert.match(owner, /qq_runtime\.configure/);
  assert.match(owner, /qq_runtime\.summarize/);
  assert.match(owner, /qq_session\.manage/);

  const administrator = formatQqMainModelInstructions({
    isAdministrator: true,
    speaker: "小王(QQ 2)；群聊",
    senderId: "2"
  });
  assert.match(administrator, /Bot 管理员 QQ/);
  assert.match(administrator, /删除重要文件/);
  assert.match(administrator, /必须拒绝/);

  const social = formatQqMainToolGuide({ messageText: "给他点赞，再拍回去", pokeEvent: true });
  assert.match(social, /qq_social\.act/);
  assert.match(social, /工具明确成功后/);

  const withPerson = formatQqMainToolGuide({
    memoryPeople: [{ userId: "20002", displayName: "小林", summary: "重视可靠记忆", hasDetail: true, promoted: true }]
  });
  assert.match(withPerson, /小林\(20002\)【统一人物】/);
  assert.match(withPerson, /qq_memory\.person_detail/);
  assert.match(withPerson, /qq_memory\.person_alias/);
});
