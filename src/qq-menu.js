const categoryOrder = ["conversation", "intelligence", "operations", "authority"];

const categoryMeta = {
  conversation: { icon: "💬", label: "会话与上下文" },
  intelligence: { icon: "🧠", label: "AI 与学习" },
  operations: { icon: "🛠️", label: "运行与群管理" },
  authority: { icon: "🔐", label: "权限" }
};

export function formatQqVisualMenu({
  owner = false,
  assistantName = "Bot",
  model = "",
  reasoningEffort = "",
  allowedGroups = [],
  commands = []
} = {}) {
  const visible = (Array.isArray(commands) ? commands : []).filter((command) => command?.menuLine);
  const sections = categoryOrder
    .map((category) => ({
      category,
      commands: visible.filter((command) => (command.category || "operations") === category)
    }))
    .filter((section) => section.commands.length > 0);
  const lines = [
    `╭─ ${owner ? "👑" : "✨"} ${compact(assistantName, 24)} · QQ 控制台`,
    owner && model ? `│ 🤖 ${compact(model, 40)} · ${compact(reasoningEffort || "default", 12)}` : null,
    owner ? `│ 👥 白名单 ${allowedGroups.length} 个${allowedGroups.length ? ` · ${allowedGroups.join("、")}` : ""}` : null,
    "╰────────────────",
    ""
  ].filter((line) => line != null);

  for (const [sectionIndex, section] of sections.entries()) {
    const meta = categoryMeta[section.category];
    lines.push(`${meta.icon} ${meta.label}`);
    for (const command of section.commands) {
      const publicTag = owner && command.public ? "  ◦ 公开" : "";
      lines.push(`  ${command.menuLine}${publicTag}`);
      if (command.description) lines.push(`    ${command.description}`);
    }
    if (sectionIndex < sections.length - 1) lines.push("");
  }
  lines.push(
    "",
    owner
      ? "💡 发送 /菜单权限 调整“公开”项目；发送 /AI任务 查看全部模型任务。"
      : "💡 直接发送上面的命令即可使用。"
  );
  return lines.join("\n");
}

function compact(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}
