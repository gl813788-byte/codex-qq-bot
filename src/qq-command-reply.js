// One text layout for every QQ command reply. Menus, settings, lists and usage
// help render as a card; single-step results render as one prefixed line.
//
// ╭─ 🛠️ 标题
// │ 标签：值
// ╰────────────────
//
// 📖 分区
//   行
//     说明
//
// 💡 提示

const cardRule = "╰────────────────";

export function formatQqCard({ icon = "", title = "", notes = [], fields = [], sections = [], hints = [] } = {}) {
  const lines = [`╭─ ${[icon, title].filter(Boolean).join(" ")}`];
  for (const note of notes) {
    if (note) lines.push(`│ ${note}`);
  }
  for (const field of fields) {
    if (!field) continue;
    const [label, value] = field;
    lines.push(`│ ${label}：${formatQqValue(value)}`);
  }
  lines.push(cardRule);

  for (const section of sections) {
    if (!section) continue;
    const rows = (Array.isArray(section.rows) ? section.rows : []).filter((row) => row != null && row !== "");
    if (rows.length === 0 && !section.empty) continue;
    lines.push("");
    if (section.title) lines.push([section.icon, section.title].filter(Boolean).join(" "));
    if (rows.length === 0) lines.push(`  ${section.empty}`);
    for (const row of rows) {
      if (typeof row === "string") {
        lines.push(`  ${row}`);
        continue;
      }
      lines.push(`  ${row.text}`);
      for (const detail of [row.detail].flat()) {
        if (detail) lines.push(`    ${detail}`);
      }
    }
  }

  const hintLines = hints.filter(Boolean);
  if (hintLines.length > 0) {
    lines.push("");
    for (const hint of hintLines) lines.push(`💡 ${hint}`);
  }
  return lines.join("\n");
}

export function formatQqDone(message, details = []) {
  return [`✅ ${message}`, ...details.filter(Boolean)].join("\n");
}

export function formatQqWarning(message, details = []) {
  return [`⚠️ ${message}`, ...details.filter(Boolean)].join("\n");
}

export function formatQqUsageSection(command) {
  const usage = Array.isArray(command?.usage) ? command.usage : [];
  return {
    icon: "📖",
    title: "用法",
    rows: usage.map(([syntax, note]) => ({ text: syntax, detail: note || "" }))
  };
}

export function formatQqCommandUsage(command, { notice = "" } = {}) {
  if (!command) return formatQqWarning(notice || "没有找到这个指令。");
  const card = formatQqCard({
    icon: command.icon,
    title: command.menuLine,
    notes: [command.description],
    sections: [formatQqUsageSection(command)]
  });
  return notice ? `${formatQqWarning(notice)}\n\n${card}` : card;
}

export function formatQqValue(value) {
  if (Array.isArray(value)) return value.length > 0 ? value.join("、") : "无";
  if (value == null || value === "") return "无";
  return String(value);
}

export function formatQqSwitch(enabled) {
  return enabled ? "开启" : "关闭";
}
