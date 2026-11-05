import { formatQqSubagentStatus } from "../qq-subagents.js";

// qq_agent.manage: open, check, message or cancel background sub-agents from
// a QQ conversation. Jobs are visible only to the conversation that opened
// them (the verified owner and administrators see every job). Opening a job
// is not a result: the Bot says it is working on it and relays the report
// when the sub-agent finishes.

export async function executeQqSubagentTool(args = {}, {
  manager,
  scopeId = "",
  privileged = false,
  requester = {},
  origin = {},
  background = "",
  allowSpawn = true
} = {}) {
  if (!manager) return { ok: false, error: "子代理不可用。" };
  const action = String(args.action || "");
  const id = String(args.id || "").trim().toLowerCase();
  if (action === "spawn") {
    if (!allowSpawn) return { ok: false, error: "这一轮不能开子代理（主动发言轮或后台任务里不能再开）。" };
    const result = manager.spawn({
      title: args.title,
      task: args.task,
      kind: "task",
      scopeId,
      requester,
      context: { origin, background: String(background || "").slice(0, 4000) }
    });
    if (!result.ok) return { ok: false, error: result.error };
    return {
      ok: true,
      reply: `已在后台开了子代理 ${result.id}${result.position ? `（排队第 ${result.position} 个）` : ""}。现在像人一样简短告诉对方你在弄、弄好会回来说；结果没回来前不要编结论。做完后你会在这个会话里收到它的报告。需要补充要求就用 action=message。`
    };
  }
  if (action === "list") {
    const jobs = manager.list({ scopeId, privileged });
    return { ok: true, reply: jobs.length ? `子代理：\n${jobs.slice(0, 10).map(formatQqSubagentStatus).join("\n")}` : "这个会话现在没有子代理。" };
  }
  if (action === "status") {
    const job = manager.get(id, { scopeId, privileged });
    if (!job) return { ok: false, error: "找不到这个子代理。" };
    return {
      ok: true,
      reply: [
        formatQqSubagentStatus(job),
        `任务：${job.task.slice(0, 400)}`,
        job.messages.length ? `已转达的补充：${job.messages.map((entry) => entry.text).join("；").slice(0, 600)}` : null,
        job.status === "done" && job.result?.report ? `报告摘录：${job.result.report.slice(0, 1500)}` : null
      ].filter(Boolean).join("\n")
    };
  }
  if (action === "message") {
    const result = await manager.message(id, args.text, { scopeId, privileged, from: requester.name || "" });
    if (!result.ok) return { ok: false, error: result.error };
    const how = {
      steered: "已经实时转给正在干活的子代理。",
      queued: "子代理还在排队，开始时会一起看到。",
      queued_for_next_turn: "子代理这一步快结束了，会在下一步接着处理。",
      follow_up: "子代理之前已经做完，现在带着这条补充继续做，做完会再报告。"
    }[result.delivered] || "已转达。";
    return { ok: true, reply: how };
  }
  if (action === "cancel") {
    const result = manager.cancel(id, { scopeId, privileged });
    if (!result.ok) return { ok: false, error: result.error };
    return { ok: true, reply: result.already ? `它已经是${result.status}状态了。` : "已经叫停这个子代理。" };
  }
  return { ok: false, error: "qq_agent.manage 只支持 spawn、list、status、message、cancel。" };
}
