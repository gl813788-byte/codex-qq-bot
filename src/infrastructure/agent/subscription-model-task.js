import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Runs short structured classifier tasks (the interest model on a Codex or
// Claude subscription) through the local agent CLI. Every task spawns a CLI
// child, so tasks share a small dedicated slot pool with a bounded queue: a
// burst of judgments waits or is refused instead of piling up processes on a
// memory-constrained host, and the reply limiter is never touched.

const DEFAULT_MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const imageExtensions = Object.freeze({ png: "png", jpeg: "jpg", gif: "gif", webp: "webp" });

export function createSubscriptionModelTaskRunner({
  runTask,
  workspaceDir,
  maxConcurrent = 1,
  maxQueued = 3,
  maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
  onSpawn,
  onExit,
  now = Date.now
} = {}) {
  if (typeof runTask !== "function") throw new TypeError("runTask must be a function");
  if (!workspaceDir) throw new TypeError("workspaceDir is required");
  const slots = Math.max(1, Math.floor(Number(maxConcurrent) || 1));
  const queueLimit = Math.max(0, Math.floor(Number(maxQueued) || 0));
  const waiting = [];
  let active = 0;
  let completed = 0;
  let failed = 0;
  let refused = 0;
  let last = null;

  const acquire = () => {
    if (active < slots) {
      active += 1;
      return Promise.resolve();
    }
    if (waiting.length >= queueLimit) return null;
    return new Promise((resolve) => waiting.push(resolve));
  };
  const release = () => {
    const next = waiting.shift();
    if (next) next();
    else active = Math.max(0, active - 1);
  };

  async function run({
    engine,
    model = null,
    reasoningEffort = null,
    systemPrompt = "",
    userText = "",
    images = [],
    outputSchema = null,
    timeoutMs = 90_000,
    signal
  } = {}) {
    const queuedAt = now();
    const slot = acquire();
    if (!slot) {
      refused += 1;
      return { ok: false, code: "SUBSCRIPTION_TASK_BUSY", reason: "subscription model queue is full", durationMs: 0, queuedMs: 0 };
    }
    await slot;
    const startedAt = now();
    let dir = null;
    try {
      if (signal?.aborted) {
        return { ok: false, code: "SUBSCRIPTION_TASK_ABORTED", reason: "subscription task aborted", durationMs: 0, queuedMs: startedAt - queuedAt };
      }
      await mkdir(workspaceDir, { recursive: true });
      dir = await mkdtemp(join(workspaceDir, "task-"));
      const imagePaths = await writeTaskImages(dir, images, maxImageBytes);
      const result = await runTask(engine, {
        cwd: dir,
        model,
        reasoningEffort,
        prompt: String(userText || ""),
        imagePaths,
        developerInstructions: String(systemPrompt || "") || null,
        baseInstructions: "你是一个后台结构化判断组件。只完成开发者说明中的唯一任务，只返回符合输出 Schema 的 JSON 对象。不要调用工具、读取文件或联网。",
        outputSchema,
        timeoutMs,
        signal,
        onSpawn,
        onExit
      });
      completed += 1;
      last = { ok: true, engine, model, at: new Date(now()).toISOString(), durationMs: now() - startedAt };
      return {
        ok: true,
        content: String(result?.finalResponse || "").trim(),
        imageCount: imagePaths.length,
        durationMs: now() - startedAt,
        queuedMs: startedAt - queuedAt
      };
    } catch (error) {
      failed += 1;
      const reason = String(error?.message || error || "subscription task failed").slice(0, 500);
      last = { ok: false, engine, model, at: new Date(now()).toISOString(), durationMs: now() - startedAt, error: reason };
      return {
        ok: false,
        code: String(error?.code || "SUBSCRIPTION_TASK_FAILED"),
        reason,
        durationMs: now() - startedAt,
        queuedMs: startedAt - queuedAt
      };
    } finally {
      if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      release();
    }
  }

  run.snapshot = () => ({
    active,
    waiting: waiting.length,
    maxConcurrent: slots,
    maxQueued: queueLimit,
    completed,
    failed,
    refused,
    last: last ? { ...last } : null
  });
  return run;
}

// Pictures arrive as validated data URLs from the interest-vision preview
// step; only known raster types within the byte limit become task files.
export function decodeTaskImageDataUrl(value, maxBytes = DEFAULT_MAX_IMAGE_BYTES) {
  const match = String(value || "").match(/^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) return null;
  const data = Buffer.from(match[2], "base64");
  if (!data.length || data.length > maxBytes) return null;
  return { extension: imageExtensions[match[1]], data };
}

async function writeTaskImages(dir, images, maxBytes) {
  const paths = [];
  for (const [index, image] of (Array.isArray(images) ? images : []).slice(0, 4).entries()) {
    const decoded = decodeTaskImageDataUrl(image?.dataUrl, maxBytes);
    if (!decoded) continue;
    const path = join(dir, `image-${index + 1}.${decoded.extension}`);
    await writeFile(path, decoded.data, { mode: 0o600 });
    paths.push(path);
  }
  return paths;
}
