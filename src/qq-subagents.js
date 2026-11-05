import { randomBytes } from "node:crypto";

// Background sub-agents the Bot opens for long work: a task someone asked
// for, or one of its own routine activities. Each job runs as its own agent
// turn in a dedicated slot pool (never the reply limiter), can receive
// messages while it runs (steered into the live turn) or after it finished
// (a follow-up turn on the same thread), and reports back once through
// onFinished. Jobs live in memory and are bounded; a Hub restart drops them.

const TERMINAL = new Set(["done", "failed", "cancelled"]);
const MAX_MESSAGES = 12;
const MAX_PROGRESS = 8;

export function createQqSubagentManager({
  maxConcurrent = 1,
  maxQueued = 2,
  maxHistory = 30,
  runTask,
  onFinished,
  onStateChange,
  runDetached = (operation) => operation(),
  now = Date.now
} = {}) {
  if (typeof runTask !== "function") throw new TypeError("runTask must be a function");
  const slots = Math.max(0, Math.floor(Number(maxConcurrent) || 0));
  const queueLimit = Math.max(0, Math.floor(Number(maxQueued) || 0));
  const jobs = new Map();
  const queue = [];
  let running = 0;

  const changed = (job, change) => {
    try {
      onStateChange?.(snapshot(job), change);
    } catch {
      // observers never affect job state
    }
  };

  function spawn({
    title = "",
    task = "",
    kind = "task",
    scopeId = "",
    requester = {},
    context = {}
  } = {}) {
    if (slots === 0) return { ok: false, code: "SUBAGENT_DISABLED", error: "这台机器没有开启子代理。" };
    const cleanTask = compact(task, 6000);
    if (!cleanTask) return { ok: false, code: "SUBAGENT_EMPTY", error: "子代理任务内容不能为空。" };
    const waiting = queue.length;
    if (running >= slots && waiting >= queueLimit) {
      return { ok: false, code: "SUBAGENT_BUSY", error: `子代理都在忙（${running} 个运行、${waiting} 个排队），先等一个做完。` };
    }
    const id = createJobId(jobs);
    const job = {
      id,
      kind: kind === "life" ? "life" : "task",
      title: compact(title || cleanTask, 40),
      task: cleanTask,
      scopeId: String(scopeId || ""),
      requester: {
        userId: String(requester.userId || ""),
        name: compact(requester.name, 40),
        isOwner: Boolean(requester.isOwner),
        isBotAdmin: Boolean(requester.isBotAdmin)
      },
      context,
      status: "queued",
      createdAt: iso(now()),
      startedAt: null,
      finishedAt: null,
      threadId: null,
      runs: 0,
      inbox: [],
      messages: [],
      progress: [],
      result: null,
      error: null,
      controller: null,
      controls: null
    };
    jobs.set(id, job);
    prune();
    queue.push(job);
    changed(job, "queued");
    pump();
    return { ok: true, id, status: job.status, position: job.status === "queued" ? queue.indexOf(job) + 1 : 0 };
  }

  function pump() {
    while (running < slots && queue.length) {
      const job = queue.shift();
      if (job.status !== "queued") continue;
      running += 1;
      runDetached(() => execute(job));
    }
  }

  async function execute(job) {
    job.status = "running";
    job.startedAt ||= iso(now());
    job.runs += 1;
    job.controller = new AbortController();
    const followUps = job.inbox.splice(0);
    changed(job, "running");
    try {
      const outcome = await runTask(snapshot(job), {
        signal: job.controller.signal,
        followUps,
        threadId: job.threadId,
        onControls: (controls) => { job.controls = controls || null; },
        onProgress: (text) => {
          const value = compact(text, 200);
          if (!value) return;
          job.progress.push({ at: iso(now()), text: value });
          job.progress = job.progress.slice(-MAX_PROGRESS);
        }
      });
      job.threadId = outcome?.threadId || job.threadId;
      if (job.controller.signal.aborted) {
        job.status = "cancelled";
      } else if (outcome?.ok === false) {
        job.status = "failed";
        job.error = compact(outcome.error || "子代理失败", 300);
      } else {
        job.status = "done";
        job.result = normalizeResult(outcome?.result);
      }
    } catch (error) {
      job.status = job.controller.signal.aborted ? "cancelled" : "failed";
      job.error = compact(error?.message || error, 300);
    } finally {
      job.controls = null;
      job.controller = null;
      job.finishedAt = iso(now());
      running = Math.max(0, running - 1);
      changed(job, job.status);
      // Messages that arrived after the live turn ended start one follow-up.
      if (job.inbox.length && job.status === "done") {
        job.status = "queued";
        queue.push(job);
        changed(job, "queued");
      } else {
        notifyFinished(job);
      }
      pump();
    }
  }

  function notifyFinished(job) {
    try {
      const value = onFinished?.(snapshot(job));
      if (value && typeof value.catch === "function") value.catch(() => undefined);
    } catch {
      // reporting never changes job state
    }
  }

  async function message(id, text, { scopeId = "", privileged = false, from = "" } = {}) {
    const job = visibleJob(id, { scopeId, privileged });
    if (!job) return { ok: false, error: "找不到这个子代理（编号不对，或者不是在这个会话开的）。" };
    const value = compact(text, 2000);
    if (!value) return { ok: false, error: "要发给子代理的话不能为空。" };
    job.messages.push({ at: iso(now()), text: value, from: compact(from, 40) });
    job.messages = job.messages.slice(-MAX_MESSAGES);
    if (job.status === "running" && typeof job.controls?.steer === "function") {
      try {
        await job.controls.steer(formatSteer(value, from));
        changed(job, "steered");
        return { ok: true, delivered: "steered", status: job.status };
      } catch {
        // the live turn just ended; fall through to a follow-up
      }
    }
    if (job.status === "cancelled") return { ok: false, error: "这个子代理已经取消了。" };
    if (job.status === "failed" && !job.threadId) return { ok: false, error: "这个子代理失败了，没有可继续的线程；可以重新开一个。" };
    job.inbox.push(value);
    if (job.status === "running") return { ok: true, delivered: "queued_for_next_turn", status: job.status };
    if (job.status === "queued") return { ok: true, delivered: "queued", status: job.status };
    if (running >= slots && queue.length >= queueLimit) {
      job.inbox.pop();
      return { ok: false, error: "子代理都在忙，晚点再补充。" };
    }
    job.status = "queued";
    job.result = job.result ? { ...job.result, superseded: true } : null;
    queue.push(job);
    changed(job, "queued");
    pump();
    return { ok: true, delivered: "follow_up", status: job.status };
  }

  function cancel(id, { scopeId = "", privileged = false } = {}) {
    const job = visibleJob(id, { scopeId, privileged });
    if (!job) return { ok: false, error: "找不到这个子代理。" };
    if (TERMINAL.has(job.status)) return { ok: true, status: job.status, already: true };
    if (job.status === "queued") {
      const index = queue.indexOf(job);
      if (index >= 0) queue.splice(index, 1);
      job.status = "cancelled";
      job.finishedAt = iso(now());
      changed(job, "cancelled");
      return { ok: true, status: job.status };
    }
    job.controller?.abort(new Error("cancelled by the Bot"));
    return { ok: true, status: "cancelling" };
  }

  function list({ scopeId = "", privileged = false, includeLife = false } = {}) {
    return [...jobs.values()]
      .filter((job) => (privileged || job.scopeId === scopeId) && (includeLife || job.kind !== "life"))
      .map(snapshot)
      .reverse();
  }

  function get(id, { scopeId = "", privileged = false } = {}) {
    const job = visibleJob(id, { scopeId, privileged });
    return job ? snapshot(job) : null;
  }

  function visibleJob(id, { scopeId, privileged }) {
    const job = jobs.get(String(id || "").trim().toLowerCase());
    if (!job) return null;
    return privileged || job.scopeId === scopeId ? job : null;
  }

  function prune() {
    const finished = [...jobs.values()].filter((job) => TERMINAL.has(job.status));
    for (const job of finished.slice(0, Math.max(0, jobs.size - maxHistory))) jobs.delete(job.id);
  }

  function stats() {
    return { running, queued: queue.length, slots, total: jobs.size };
  }

  function abortAll() {
    for (const job of jobs.values()) job.controller?.abort(new Error("Hub shutting down"));
    queue.length = 0;
  }

  return { spawn, message, cancel, list, get, stats, abortAll };
}

function snapshot(job) {
  return {
    id: job.id,
    kind: job.kind,
    title: job.title,
    task: job.task,
    scopeId: job.scopeId,
    requester: { ...job.requester },
    context: job.context,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    threadId: job.threadId,
    runs: job.runs,
    messages: job.messages.map((entry) => ({ ...entry })),
    progress: job.progress.map((entry) => ({ ...entry })),
    result: job.result ? { ...job.result, attachments: [...(job.result.attachments || [])] } : null,
    error: job.error
  };
}

function normalizeResult(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    summary: compact(source.summary, 300),
    report: String(source.report || "").trim().slice(0, 12_000),
    attachments: (Array.isArray(source.attachments) ? source.attachments : []).map((item) => String(item || "").trim()).filter(Boolean).slice(0, 8),
    needsUser: Boolean(source.needsUser),
    question: compact(source.question, 300)
  };
}

function formatSteer(text, from) {
  return `【主 Bot 转来的补充${from ? `（${from}）` : ""}】${text}\n按这条补充调整正在做的任务；最终仍只返回输出 Schema。`;
}

function createJobId(jobs) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const id = `sa-${randomBytes(2).toString("hex")}`;
    if (!jobs.has(id)) return id;
  }
  return `sa-${randomBytes(4).toString("hex")}`;
}

function iso(value) {
  return new Date(value).toISOString();
}

function compact(value, max) {
  return [...String(value ?? "").replace(/\s+/g, " ").trim()].slice(0, max).join("");
}

export function formatQqSubagentStatus(job) {
  if (!job) return "";
  const labels = { queued: "排队中", running: "进行中", done: "已完成", failed: "失败", cancelled: "已取消" };
  const lines = [`${job.id}《${job.title}》：${labels[job.status] || job.status}${job.requester?.name ? `（${job.requester.name} 要的）` : ""}`];
  if (job.progress?.length) lines.push(`  最近进展：${job.progress.at(-1).text}`);
  if (job.status === "done" && job.result?.summary) lines.push(`  结论：${job.result.summary}`);
  if (job.status === "failed" && job.error) lines.push(`  原因：${job.error}`);
  return lines.join("\n");
}
