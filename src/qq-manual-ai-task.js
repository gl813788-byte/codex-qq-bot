import { getQqCommand } from "./qq-command-catalog.js";
import { formatQqCard, formatQqDone, formatQqUsageSection, formatQqWarning } from "./qq-command-reply.js";

const scopePattern = /^(?:private:)?[1-9][0-9]{4,12}$/;

export const qqManualAiTaskCatalog = [
  {
    id: "chat-summary",
    label: "聊天总结",
    icon: "📝",
    scope: "chat",
    aliases: ["chat-summary", "summary", "聊天总结", "聊天记录", "总结聊天", "总结记录"],
    usage: "/AI任务 [强制] 聊天总结 [全部]",
    description: "总结当前群聊或私聊，并提取可复用知识"
  },
  {
    id: "scope-summary",
    label: "范围记忆总结",
    icon: "🧩",
    scope: "chat",
    aliases: ["scope-summary", "scope", "范围总结", "范围记忆", "记忆总结", "会话记忆"],
    usage: "/AI任务 [强制] 范围总结",
    description: "强制更新当前范围的人设证据与长期知识"
  },
  {
    id: "style-review",
    label: "群风格复盘",
    icon: "🎨",
    scope: "group",
    aliases: ["style-review", "style", "风格复盘", "群风格", "风格总结", "群总结"],
    usage: "/AI任务 [强制] 风格复盘",
    description: "比较群友与 Bot 的表达习惯并更新适应规则"
  },
  {
    id: "global-persona",
    label: "全局人设刷新",
    icon: "✨",
    scope: "global",
    aliases: ["global-persona", "persona", "人设刷新", "全局人设", "人格刷新", "自我总结"],
    usage: "/AI任务 [强制] 人设刷新",
    description: "用各范围摘要重新生成 Bot 的全局人格"
  },
  {
    id: "knowledge-review",
    label: "知识库审核",
    icon: "🧠",
    scope: "global",
    aliases: ["knowledge-review", "knowledge", "知识审核", "记忆审核", "知识清理", "记忆清理"],
    usage: "/AI任务 [强制] 知识审核",
    description: "审核一个到期的低频黑话，先初筛再由主模型终审"
  },
  {
    id: "all",
    label: "全部适用任务",
    icon: "🚀",
    scope: "chat",
    aliases: ["all", "全部", "全部任务", "一键总结", "全部总结"],
    usage: "/AI任务 [强制] 全部",
    description: "按当前范围依次运行全部适用的总结、复盘与审核"
  }
];

export function normalizeQqManualAiTaskId(value) {
  const normalized = String(value || "").trim().toLowerCase().replace(/[_\s]+/g, "-");
  if (!normalized) return "";
  return qqManualAiTaskCatalog.find((task) => task.id === normalized
    || task.aliases.some((alias) => alias.toLowerCase().replace(/[_\s]+/g, "-") === normalized))?.id || "";
}

export function parseQqManualAiTaskCommand(value) {
  const normalized = String(value || "").trim().replace(/^\/+/, "");
  const match = normalized.match(/^(?:ai\s*任务|ai-task(?:s)?|手动触发|任务中心)(?:\s+(.+))?$/i);
  if (!match) return null;
  const tail = String(match[1] || "").trim();
  if (!tail || /^(?:列表|菜单|帮助|list|help)$/i.test(tail)) {
    return { action: "list", taskId: "", fullHistory: false, force: false };
  }
  const background = /(?:^|\s)(?:后台|background|--background)(?:\s|$)/i.test(tail);
  const optionsTail = tail.replace(/(?:^|\s)(?:后台|background|--background)(?=\s|$)/ig, " ").trim();
  const force = /(?:^|\s)(?:强制|立即|force)(?:\s|$)/i.test(optionsTail);
  const withoutForce = optionsTail
    .replace(/(?:^|\s)(?:强制|立即|force)(?=\s|$)/ig, " ")
    .trim();
  const fullHistory = /(?:^|\s)(?:全部记录|完整记录|全部历史|完整历史|full)(?:\s|$)/i.test(withoutForce)
    || /^(?:聊天总结|聊天记录|总结聊天|总结记录)\s+全部$/i.test(withoutForce);
  const taskText = withoutForce
    .replace(/(?:^|\s)(?:全部记录|完整记录|全部历史|完整历史|full)(?=\s|$)/ig, " ")
    .replace(/^(聊天总结|聊天记录|总结聊天|总结记录)\s+全部$/i, "$1")
    .trim();
  const taskId = normalizeQqManualAiTaskId(taskText);
  return taskId
    ? { action: "run", taskId, fullHistory, force, ...(background ? { background: true } : {}) }
    : { action: "unknown", taskId: "", input: tail, fullHistory, force, ...(background ? { background: true } : {}) };
}

export function normalizeQqManualAiTaskScope(value, { currentScopeId = "" } = {}) {
  const raw = String(value || currentScopeId || "").trim();
  if (!raw) return "";
  if (!scopePattern.test(raw)) return "";
  if (raw.startsWith("private:")) return raw;
  return raw;
}

export function validateQqManualAiTaskRequest({
  taskId,
  scopeId = "",
  currentScopeId = "",
  allowedGroups = [],
  knownPrivateScopes = []
} = {}) {
  const id = normalizeQqManualAiTaskId(taskId);
  const task = qqManualAiTaskCatalog.find((item) => item.id === id);
  if (!task) return { ok: false, status: 400, error: "unknown AI task" };
  const normalizedScopeId = task.scope === "global"
    ? ""
    : normalizeQqManualAiTaskScope(scopeId, { currentScopeId });
  if (task.scope !== "global" && !normalizedScopeId) {
    return { ok: false, status: 400, error: "this AI task requires a QQ group id or private:<QQ id>" };
  }
  if (task.scope === "group" && normalizedScopeId.startsWith("private:")) {
    return { ok: false, status: 400, error: "this AI task can only run for a QQ group" };
  }
  if (normalizedScopeId && !normalizedScopeId.startsWith("private:")
    && !allowedGroups.map(String).includes(normalizedScopeId)) {
    return { ok: false, status: 403, error: "the QQ group is not in the allowlist" };
  }
  if (normalizedScopeId.startsWith("private:")
    && !knownPrivateScopes.map(String).includes(normalizedScopeId)) {
    return { ok: false, status: 404, error: "the private QQ scope has no saved conversation history" };
  }
  return { ok: true, task, taskId: id, scopeId: normalizedScopeId };
}

export function formatQqManualAiTaskCenter({
  running = [],
  jobs = [],
  includeNccHint = false
} = {}) {
  const runningSet = new Set((Array.isArray(running) ? running : []).map(String));
  return formatQqCard({
    icon: "🤖",
    title: "AI 手动任务中心",
    notes: ["后台模型任务可随时手动运行；自动周期仍会继续。"],
    sections: [
      {
        icon: "📋",
        title: "任务",
        rows: qqManualAiTaskCatalog.map((task, index) => ({
          text: `${index + 1}. ${task.icon} ${task.label}${runningSet.has(task.id) ? " 〔运行中〕" : ""}`,
          detail: [task.description, task.usage]
        }))
      },
      {
        icon: "🗂️",
        title: "最近任务",
        rows: (Array.isArray(jobs) ? jobs : []).slice(-5).map((job) => [
          `${job.jobId}：${job.taskId}`,
          jobStateLabels[job.state] || job.state,
          job.reason
        ].filter(Boolean).join(" · "))
      },
      formatQqUsageSection(getQqCommand("aiTasks"))
    ],
    hints: [
      "强制只跳过到期、冷却和常规样本门槛，不绕过权限与数据安全。",
      "任务会真实调用当前配置的模型，并受并发与超时保护。",
      includeNccHint ? "本机：ncc ai-tasks / ncc ai-run <任务> [范围]" : null
    ]
  });
}

export function formatQqManualAiTaskResult(result) {
  if (!result) return formatQqWarning("AI 手动任务没有返回结果。");
  const task = qqManualAiTaskCatalog.find((item) => item.id === result.taskId);
  const prefix = `${task?.icon || "🤖"} ${task?.label || result.taskId || "AI 任务"}`;
  if (result.accepted) {
    return formatQqDone(`${prefix}：已提交后台，尚未完成`, [
      `任务编号：${result.jobId}`,
      "💡 发送 /AI任务 或在本机运行 ncc ai-tasks 查看进度。"
    ]);
  }
  if (result.taskId === "all" && Array.isArray(result.results)) {
    const chatSummary = result.results.find((item) => item.taskId === "chat-summary" && item.summary)?.summary;
    const card = formatQqCard({
      icon: "🚀",
      title: "全部适用任务已处理",
      notes: result.results.map((item) => (item.taskId === "chat-summary" && item.summary
        ? formatQqManualAiTaskResult({ ...item, summary: "" })
        : formatQqManualAiTaskResult(item)).split("\n")[0])
    });
    return chatSummary ? `${card}\n\n📝 聊天总结\n${chatSummary}` : card;
  }
  if (result.taskId === "chat-summary" && result.summary) return result.summary;
  if (!result.ok) {
    return formatQqWarning(`${prefix}：${result.busy ? "正在运行" : "未运行"}`, [
      result.reason || result.error || "没有满足执行条件。"
    ]);
  }
  return formatQqDone(`${prefix}：完成`, [formatQqManualAiTaskOutcome(result)]);
}

function formatQqManualAiTaskOutcome(result) {
  if (result.taskId === "scope-summary") {
    return `复盘 ${result.historyMessageCount || 0} 条记录，范围摘要第 ${result.summaryRevision || 0} 版，更新 ${result.knowledgePatchCount || 0} 条知识、${result.socialMemoryUpdated ? "已融合" : "未新增"}社交印象，提升 ${result.promotedPersonCount || 0} 位深刻印象人物到统一记忆。`;
  }
  if (result.taskId === "style-review") {
    return `样本 ${result.humanSamples || 0} 条真人 / ${result.botSamples || 0} 条 Bot，生成 ${result.guidanceCount || 0} 条适应规则，融合 ${result.knowledgePatchCount || 0} 条词语/标点黑话知识。`;
  }
  if (result.taskId === "global-persona") {
    return `全局人设已更新到第 ${result.revision || 0} 版，使用 ${result.summarizedScopes || 0} 个范围摘要。`;
  }
  if (result.taskId === "knowledge-review") {
    return `“${result.title || "知识条目"}”已${result.decision === "deleted" ? "删除" : "保留"}。`;
  }
  return "";
}

const jobStateLabels = {
  running: "运行中",
  completed: "已完成",
  failed: "失败",
  skipped: "已跳过",
  busy: "繁忙"
};
