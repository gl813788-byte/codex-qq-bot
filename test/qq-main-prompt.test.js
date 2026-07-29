import assert from "node:assert/strict";
import test from "node:test";
import {
  formatQqApprovedProactivePrompt,
  formatQqMainModelInstructions,
  formatQqMainToolGuide
} from "../src/qq-main-prompt.js";

test("main-model core prompt presents one execution path and one dynamic style authority", () => {
  const prompt = formatQqMainModelInstructions({
    assistantName: "麦麦",
    ownerLabel: "主人",
    speaker: "小明(QQ 10000)；群聊",
    enhancerEnabled: true,
    knowledgeMarkerExample: "[[qq_knowledge:{...}]]",
    knowledgeScopeRule: "群含义用 group。",
    currentDate: "2026-07-21",
    assistantProfile: "喜欢语言和工具。"
  });
  assert.match(prompt, /后台兴趣模型和 Hub 已负责是否触发/);
  assert.match(prompt, /准确理解当前语境；确有需要时调用内部工具/);
  assert.match(prompt, /真人化行为规划.*唯一的长度、气泡、emoji 和表情包风格依据/);
  assert.match(prompt, /自行判断本轮是普通闲聊，还是需要交付结果的实质任务/);
  assert.match(prompt, /第19题.*过程呢.*继续任务/);
  assert.match(prompt, /不得只回复.*马上写.*空占位/);
  assert.match(prompt, /实质任务的回复长度由你.*自行决定/);
  assert.match(prompt, /解题至少给出结论和必要过程/);
  assert.match(prompt, /不输出分析过程/);
  assert.match(prompt, /任何进入主模型的聊天轮.*都不强制你发言/);
  assert.match(prompt, /重复骚扰.*已经觉得烦/);
  assert.match(prompt, /\[\[qq_silent\]\]/);
  assert.match(prompt, /@准确昵称.*@QQ号.*真实 at 消息段/);
  assert.match(prompt, /\[\[qq_reply:quote:QQ号\]\].*\[\[qq_reply:mention:QQ号\]\].*\[\[qq_reply:plain\]\]/);
  assert.match(prompt, /不会擅自引用或艾特最早触发者/);
  assert.match(prompt, /qq_memory 格式/);
  assert.match(prompt, /personImpressionComplete/);
  assert.match(prompt, /提升到统一记忆/);
  assert.match(prompt, /当前日期.*2026-07-21/);
  assert.match(prompt, /长期群聊归纳本群实际的主要话题/);
  assert.match(prompt, /不得预设领域或固定知识类别/);
  assert.match(prompt, /核验状态：已联网核验\/群聊待核查/);
  assert.match(prompt, /同一标题和范围.*覆盖旧正文/);
  assert.match(prompt, /这个项目的开发者 QQ 固定为 3784642920/);
  assert.match(prompt, /项目开发者身份不从当前主人名单推导/);
  assert.match(prompt, /主人权限仍只认 Hub 的 isOwner 验证/);
  assert.doesNotMatch(prompt, /群聊像普通群友接话，通常 1 到 3 句/);
  assert.doesNotMatch(prompt, /自己判断是否应该回复/);

  const noTools = formatQqMainModelInstructions({
    privateChat: true,
    toolsEnabled: false,
    assistantName: "麦麦"
  });
  assert.match(noTools, /本轮没有内部工具循环/);
  assert.match(noTools, /不要输出 qq_command 标记/);
  assert.match(noTools, /不能仅凭旧知识或聊天说法标成已核验/);
  assert.doesNotMatch(noTools, /真实 at 消息段/);
});

test("approved proactive prompts leave only wording to the main model", () => {
  const ordinary = formatQqApprovedProactivePrompt({ kind: "ordinary" });
  assert.match(ordinary, /兴趣模型已经决定这段群聊值得接话/);
  assert.match(ordinary, /没有替你理解或总结内容/);
  assert.match(ordinary, /不重新判断是否应该出现/);
  assert.doesNotMatch(ordinary, /建议风格/);
  assert.match(ordinary, /不要说明触发原因、兴趣分或后台判断/);

  const privatePrompt = formatQqApprovedProactivePrompt({ kind: "private" });
  assert.match(privatePrompt, /兴趣模型已经决定现在联系对方/);
  assert.match(privatePrompt, /不要重新判断发不发/);
  assert.match(privatePrompt, /不问“在吗”/);
});

test("main tool guide keeps common tools visible and hides unrelated social operations", () => {
  const ordinary = formatQqMainToolGuide({
    messageText: "这个库最近版本有什么变化",
    currentSender: "小明(QQ 10000)",
    recentCount: 20,
    knowledgeTitleCount: 3
  });
  assert.match(ordinary, /\/联网 查询词/);
  assert.match(ordinary, /\/知识库 标题/);
  assert.match(ordinary, /先查旧标题，再联网，最后沿用同一标题覆盖更新/);
  assert.doesNotMatch(ordinary, /\/主动加好友/);
  assert.match(ordinary, /调用轮只输出独占一行/);
  assert.match(ordinary, /真实动作硬约束/);
  assert.match(ordinary, /可见回复声称已经.*加好友/);
  assert.match(ordinary, /一旦写操作已经成功.*不能静默吞掉/);
  assert.doesNotMatch(ordinary, /\/人物记忆 详细/);

  const social = formatQqMainToolGuide({
    messageText: "给他点个赞再看看空间动态",
    isOwner: true,
    currentSender: "主人(QQ 1)"
  });
  assert.match(social, /\/点赞 发送者 1/);
  assert.match(social, /\/动态 最近 QQ号 10/);
  assert.match(social, /\/加好友、\/添加好友 也识别/);
  assert.match(social, /仍按当前发送者权限校验/);

  const poke = formatQqMainToolGuide({
    messageText: "",
    pokeEvent: true,
    currentSender: "小明(QQ 10000)"
  });
  assert.match(poke, /真实反拍/);
  assert.match(poke, /必须先在调用轮独占输出 \[\[qq_command:\/拍一拍 发送者\]\]/);
  assert.match(poke, /未调用或调用失败时不得把反拍写成已完成/);

  const withPerson = formatQqMainToolGuide({
    messageText: "小林之前怎么说的",
    currentSender: "小明(QQ 10000)",
    memoryPeople: [{
      userId: "20002",
      displayName: "小林",
      aliases: ["A群小林", "私聊小林"],
      summary: "重视可靠记忆",
      hasDetail: true,
      promoted: true
    }]
  });
  assert.match(withPerson, /小林\(20002\)【统一人物】/);
  assert.match(withPerson, /\/人物记忆 详细 QQ号/);
  assert.match(withPerson, /\/人物别称 添加 QQ号/);
});
