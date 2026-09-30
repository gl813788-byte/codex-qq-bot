import assert from "node:assert/strict";
import test from "node:test";
import { getQqCommand, qqCommandCatalog, qqCommandCategories } from "../src/qq-command-catalog.js";
import {
  formatQqCard,
  formatQqCommandUsage,
  formatQqDone,
  formatQqWarning
} from "../src/qq-command-reply.js";
import {
  formatQqManualAiTaskResult,
  parseQqManualAiTaskCommand,
  qqManualAiTaskCatalog
} from "../src/qq-manual-ai-task.js";
import { formatQqVisualMenu } from "../src/qq-menu.js";

test("QQ cards render header fields, sections and hints in one fixed layout", () => {
  const card = formatQqCard({
    icon: "🛠️",
    title: "运行状态",
    notes: ["说明"],
    fields: [["QQ 通道", "开启"], null, ["白名单群", []], ["管理员", ["1", "2"]]],
    sections: [
      { icon: "📋", title: "列表", rows: ["a", { text: "b", detail: ["b1", "", "b2"] }] },
      { title: "空分区", rows: [] },
      { rows: [], empty: "暂无记录。" }
    ],
    hints: ["提示", null]
  });
  assert.equal(card, [
    "╭─ 🛠️ 运行状态",
    "│ 说明",
    "│ QQ 通道：开启",
    "│ 白名单群：无",
    "│ 管理员：1、2",
    "╰────────────────",
    "",
    "📋 列表",
    "  a",
    "  b",
    "    b1",
    "    b2",
    "",
    "  暂无记录。",
    "",
    "💡 提示"
  ].join("\n"));
});

test("QQ single-step results use one success or warning prefix", () => {
  assert.equal(formatQqDone("已加入群白名单：10001"), "✅ 已加入群白名单：10001");
  assert.equal(formatQqDone("已暂停当前回复", ["会话和上下文已保留。", ""]), "✅ 已暂停当前回复\n会话和上下文已保留。");
  assert.equal(formatQqWarning("不能封禁 Bot 自己。"), "⚠️ 不能封禁 Bot 自己。");
});

test("usage help comes from the command catalog", () => {
  const usage = formatQqCommandUsage(getQqCommand("groupAdmin"), { notice: "请 @ 目标成员。" });
  assert.match(usage, /^⚠️ 请 @ 目标成员。\n\n╭─ 👥 \/群管理\n│ 禁言、踢人、全员禁言与禁言列表\n╰─/);
  assert.match(usage, /^📖 用法$/m);
  assert.match(usage, /^  \/禁言 @用户 \[时长\]\n    默认 10 分钟，最长 30 天$/m);
  assert.equal(formatQqCommandUsage(null), "⚠️ 没有找到这个指令。");
});

test("every catalog command has the same complete shape", () => {
  const categoryIds = new Set(qqCommandCategories.map((category) => category.id));
  const keys = new Set();
  for (const command of qqCommandCatalog) {
    assert.equal(keys.has(command.key), false, `duplicate key ${command.key}`);
    keys.add(command.key);
    assert.ok(categoryIds.has(command.category), `${command.key} category`);
    assert.match(command.menuLine, /^\/\S+$/, `${command.key} menuLine`);
    assert.ok(command.description, `${command.key} description`);
    assert.ok(command.icon, `${command.key} icon`);
    assert.equal("menuLines" in command, false, `${command.key} uses menuLine only`);
    assert.equal(typeof command.defaultPublic, "boolean");
    assert.equal(typeof command.configurable, "boolean");
    assert.ok(Array.isArray(command.aliases) && command.aliases.length > 0, `${command.key} aliases`);
    assert.ok(command.usage.length > 0, `${command.key} usage`);
    for (const [syntax, note] of command.usage) {
      assert.match(syntax, /^\//, `${command.key} usage syntax`);
      assert.equal(typeof note, "string");
    }
  }
});

test("the privileged menu lists every catalog command in catalog order", () => {
  const menu = formatQqVisualMenu({
    owner: true,
    commands: qqCommandCatalog.map((command) => ({ ...command, public: command.defaultPublic }))
  });
  let cursor = -1;
  for (const category of qqCommandCategories) {
    for (const command of qqCommandCatalog.filter((item) => item.category === category.id)) {
      const index = menu.indexOf(`\n  ${command.menuLine}`);
      assert.ok(index > cursor, `${command.menuLine} is listed in order`);
      cursor = index;
    }
  }
  assert.match(menu, /^  \/思考强度$/m);
});

test("every AI task usage example parses back to its own task", () => {
  for (const task of qqManualAiTaskCatalog) {
    const example = task.usage.replace("[强制] ", "").replace(/ \[[^\]]+\]$/, "");
    assert.equal(parseQqManualAiTaskCommand(example)?.taskId, task.id, task.usage);
    const optional = task.usage.match(/ \[([^\]]+)\]$/)?.[1];
    if (optional) {
      assert.equal(parseQqManualAiTaskCommand(`${example} ${optional}`)?.taskId, task.id, task.usage);
    }
  }
});

test("AI task results share the success and warning prefixes", () => {
  assert.match(formatQqManualAiTaskResult({ taskId: "global-persona", ok: true, revision: 3, summarizedScopes: 2 }),
    /^✅ ✨ 全局人设刷新：完成\n全局人设已更新到第 3 版，使用 2 个范围摘要。$/);
  assert.match(formatQqManualAiTaskResult({ taskId: "style-review", ok: false, reason: "样本不足" }),
    /^⚠️ 🎨 群风格复盘：未运行\n样本不足$/);
  assert.match(formatQqManualAiTaskResult({ taskId: "scope-summary", accepted: true, jobId: "job-7" }),
    /^✅ 🧩 范围记忆总结：已提交后台，尚未完成\n任务编号：job-7/);
  const all = formatQqManualAiTaskResult({
    taskId: "all",
    results: [{ taskId: "global-persona", ok: true }, { taskId: "chat-summary", ok: true, summary: "总结正文" }]
  });
  assert.match(all, /^╭─ 🚀 全部适用任务已处理\n│ ✅ ✨ 全局人设刷新：完成\n│ ✅ 📝 聊天总结：完成\n╰─/);
  assert.match(all, /\n\n📝 聊天总结\n总结正文$/);
});
