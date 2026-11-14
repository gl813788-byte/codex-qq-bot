import assert from "node:assert/strict";
import test from "node:test";
import {
  describeNativeAgentItem,
  describeQqToolActivity,
  summarizeAgentTurnTools,
  toQqToolLabel
} from "../src/infrastructure/agent/agent-tool-activity.js";

const describe = (label, args, result = { ok: true, text: "" }) => {
  const [namespace, tool] = label.split(".");
  return describeQqToolActivity({ namespace, tool, arguments: args }, result);
};

test("a chat send shows the Bot's own bubbles and the delivery receipt", () => {
  const sent = describe("qq_chat.send", {
    bubbles: ["突然mua 吓我一跳（）", "刚问完灵魂问题又来这套"],
    sticker: "#3",
    attachments: [{ kind: "image", path: "/w/out/cat.png" }],
    reply: { mode: "quote", targetUserId: "123456" }
  }, { ok: true, text: "已送达 3 条，对方已经看到；别重发。" });
  assert.equal(sent.label, "qq_chat.send");
  assert.equal(sent.verb, "发消息");
  assert.match(sent.target, /「突然mua 吓我一跳（）」「刚问完灵魂问题又来这套」/);
  assert.match(sent.target, /表情包 #3/);
  assert.match(sent.target, /附件 cat\.png/);
  assert.match(sent.target, /引用 123456/);
  assert.equal(sent.outcome, "已送达 3 条");

  const partial = describe("qq_chat.send", { bubbles: ["a", "b"] }, { ok: true, text: "送达 1 条，失败 1 条（风控）。" });
  assert.equal(partial.outcome, "已送达 1 条，失败 1 条");
  const failed = describe("qq_chat.send", { bubbles: ["a"] }, { ok: false, error: "没有发出去（OneBot timeout）。不要说已经发了" });
  assert.match(failed.outcome, /^没发出：没有发出去（OneBot timeout）/);

  // An inline file is named by its display name; its content is never quoted.
  const inline = describe("qq_chat.send", {
    bubbles: [],
    attachments: [{ kind: "file", name: "周报.md", content: "私密内容 SECRET" }]
  }, { ok: true, text: "已送达 1 条" });
  assert.match(inline.target, /附件 周报\.md/);
  assert.doesNotMatch(JSON.stringify(inline), /SECRET/);
});

test("private material stays out of the activity line", () => {
  const host = describe("qq_runtime.host_command", { command: "cat ~/.secret && rm -rf /x", reason: "owner asked" }, { ok: true, text: "退出码 0\nsecret-output" });
  assert.equal(host.verb, "执行本机命令");
  assert.doesNotMatch(JSON.stringify(host), /secret|rm -rf|owner asked/);
  assert.equal(host.outcome, "退出码 0");

  const history = describe("qq_context.history", { query: "他家地址 电话", userId: "10001" }, { ok: true, text: "line1 他家地址\nline2\nline3" });
  assert.doesNotMatch(JSON.stringify(history), /地址|电话/);
  assert.match(history.target, /按关键词搜索（关键词不记录）/);
  assert.match(history.target, /QQ 10001/);
  assert.equal(history.outcome, "返回 3 行");
  // Ranges are not private.
  assert.match(describe("qq_context.history", { query: "最近 50" }).target, /最近 50/);

  const archive = describe("qq_context.archive", { action: "read", query: "暗号", count: 40 }, { ok: true, text: "a\nb" });
  assert.doesNotMatch(JSON.stringify(archive), /暗号/);

  const habit = describe("qq_self.language_habit", { action: "adopt", kind: "slang", term: "绝绝子", scope: "here" });
  assert.doesNotMatch(JSON.stringify(habit), /绝绝子/);
  assert.match(habit.target, /slang/);

  const persona = describe("qq_self.persona", { action: "adjust", field: "catchphrases", op: "add", value: "喵呜" });
  assert.doesNotMatch(JSON.stringify(persona), /喵呜/);

  const memory = describe("qq_memory.short_term", { action: "add", value: "小明下周三去医院复查" });
  assert.doesNotMatch(JSON.stringify(memory), /医院/);
  assert.match(memory.target, /内容 \d+ 字，不记录/);

  // Only the command word of a settings change: its arguments can carry keys.
  const configure = describe("qq_runtime.configure", { command: "/联网 key tvly-abc123" }, { ok: true, text: "已更新" });
  assert.doesNotMatch(JSON.stringify(configure), /tvly/);
  assert.equal(configure.target, "/联网");
});

test("common QQ tools say what was looked at or done", () => {
  assert.equal(describe("qq_sticker.manage", { action: "search", query: "无语" }, { ok: true, text: "#3 无语\n#7 白眼\n#3 无语" }).outcome, "找到 2 张");
  assert.match(describe("qq_media.video", { action: "watch", url: "https://www.bilibili.com/video/BV1xx", from: "0:30" }).target, /www\.bilibili\.com 0:30~结尾/);
  const react = describe("qq_message.act", { action: "react", target: "quoted", emoji: "👍" }, { ok: true, text: "已给被引用的消息贴上表情回应（👍）。" });
  assert.equal(react.verb, "贴表情");
  assert.match(react.target, /被引用的消息 👍/);
  assert.match(react.outcome, /已给被引用的消息贴上表情回应/);
  assert.match(describe("qq_search.chinese_web", { query: "原神 5.2 版本" }).target, /「原神 5\.2 版本」/);
  assert.match(describe("qq_social.act", { action: "qzone_publish", value: "今天画了只猫" }).target, /「今天画了只猫」/);
  const draw = describe("qq_draw.image", { prompt: "一只橘猫在窗台晒太阳", references: ["/w/in/a.png"] }, { ok: true, text: "画好了，保存在 /w/out/codex-draw-1.png，要发就放进 attachments。" });
  assert.match(draw.target, /「一只橘猫在窗台晒太阳」 参考图 1 张/);
  assert.equal(draw.outcome, "已画好 codex-draw-1.png");
  // Unknown tools still say their name and action; failures say why.
  const unknown = describe("qq_future.thing", { action: "list", selector: "x-1" }, { ok: false, error: "QQ native tool call limit reached for this turn." });
  assert.equal(unknown.label, "qq_future.thing");
  assert.match(unknown.outcome, /^失败：QQ native tool call limit/);
});

test("engine tools are described for both Codex items and Claude Code calls", () => {
  const shell = describeNativeAgentItem({ type: "commandExecution", command: ["/bin/bash", "-lc", "npm test -- --grep x"], exitCode: 1, status: "completed" });
  assert.equal(shell.verb, "运行命令");
  assert.equal(shell.target, "`npm test -- --grep x`");
  assert.equal(shell.outcome, "失败，退出码 1");
  const patch = describeNativeAgentItem({ type: "fileChange", status: "completed", changes: [{ path: "/w/src/a.js", kind: { type: "update" } }, { path: "/w/b.md", kind: { type: "add" } }] }, { cwd: "/w" });
  assert.equal(patch.target, "修改 src/a.js、新建 b.md");
  assert.match(describeNativeAgentItem({ type: "webSearch", query: "Node 24 release" }).target, /Node 24 release/);
  assert.equal(describeNativeAgentItem({ type: "imageGeneration", revisedPrompt: "猫", savedPath: "/g/t/ig_1.png", status: "completed" }).outcome, "已保存 ig_1.png");
  // QQ tools and non-tool items are logged elsewhere or not at all.
  assert.equal(describeNativeAgentItem({ type: "mcpToolCall", server: "qq", tool: "qq_chat__send" }), null);
  assert.equal(describeNativeAgentItem({ type: "agentMessage", text: "hi" }), null);
  assert.equal(describeNativeAgentItem({ type: "claudeToolCall", tool: "mcp__qq__qq_chat__send", arguments: {} }), null);

  const read = describeNativeAgentItem({ type: "claudeToolCall", tool: "Read", arguments: { file_path: "/w/src/server.js", offset: 120, limit: 40 }, ok: true }, { cwd: "/w" });
  assert.equal(read.line, "读文件 src/server.js 第 120 行起 40 行");
  assert.equal(read.outcome, "完成");
  const search = describeNativeAgentItem({ type: "claudeToolCall", tool: "ToolSearch", arguments: { query: "select:mcp__qq__qq_sticker__manage,mcp__qq__qq_media__music" } });
  assert.equal(search.target, "qq_sticker.manage、qq_media.music");
  // A failed Bash call never echoes its output.
  const bash = describeNativeAgentItem({ type: "claudeToolCall", tool: "Bash", arguments: { command: "ls" }, ok: false, errorText: "secret stderr" });
  assert.equal(bash.outcome, "失败");
  const grep = describeNativeAgentItem({ type: "claudeToolCall", tool: "Grep", arguments: { pattern: "TODO" }, ok: false, errorText: "Path does not exist" });
  assert.equal(grep.outcome, "失败：Path does not exist");
});

test("a turn's tools fold into ordered steps", () => {
  assert.equal(toQqToolLabel("mcp__qq__qq_chat__send"), "qq_chat.send");
  assert.equal(toQqToolLabel("Read"), "Read");
  const summary = summarizeAgentTurnTools([
    { type: "agentMessage" },
    { type: "claudeToolCall", tool: "ToolSearch" },
    { type: "claudeToolCall", tool: "mcp__qq__qq_chat__send" },
    { type: "claudeToolCall", tool: "mcp__qq__qq_chat__send" },
    { type: "mcpToolCall", server: "qq", tool: "qq_sticker__manage" },
    { type: "commandExecution" },
    { type: "dynamicToolCall", namespace: "qq_context", tool: "history" }
  ]);
  assert.equal(summary.toolCallCount, 6);
  assert.equal(summary.toolSteps, "ToolSearch → qq_chat.send ×2 → qq_sticker.manage → shell → qq_context.history");
  assert.deepEqual(summarizeAgentTurnTools([]), { toolCallCount: 0, toolSteps: "" });
  const long = summarizeAgentTurnTools(Array.from({ length: 20 }, (_, index) => ({ type: "claudeToolCall", tool: `T${index}` })), { maxSteps: 3 });
  assert.equal(long.toolSteps, "T0 → T1 → T2 → …还有 17 步");
});
