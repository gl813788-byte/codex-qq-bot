import { qqCommandCategories } from "./qq-command-catalog.js";
import { formatQqCard } from "./qq-command-reply.js";

export function formatQqVisualMenu({
  owner = false,
  administrator = false,
  assistantName = "Bot",
  model = "",
  reasoningEffort = "",
  allowedGroups = [],
  commands = []
} = {}) {
  const privileged = owner || administrator;
  const visible = (Array.isArray(commands) ? commands : []).filter((command) => command?.menuLine);
  const sections = qqCommandCategories.map((category) => ({
    icon: category.icon,
    title: category.label,
    rows: visible
      .filter((command) => (command.category || "operations") === category.id)
      .map((command) => ({
        text: `${command.menuLine}${privileged && command.public ? "  ◦ 公开" : ""}`,
        detail: command.description || ""
      }))
  }));
  return formatQqCard({
    icon: owner ? "👑" : administrator ? "🛡️" : "✨",
    title: `${compact(assistantName, 24)} · 指令菜单`,
    fields: [
      ["身份", owner ? "主人" : administrator ? "Bot 管理员" : "群友"],
      privileged && model ? ["模型", `${compact(model, 40)} · ${compact(reasoningEffort || "default", 12)}`] : null,
      privileged ? ["白名单", allowedGroups.length ? `${allowedGroups.length} 个群 · ${allowedGroups.join("、")}` : "无"] : null
    ],
    sections,
    hints: privileged
      ? ["单独发送一个指令可查看它的状态和用法；/菜单权限 调整“公开”项目。"]
      : ["直接发送上面的指令即可使用。"]
  });
}

function compact(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}
