import { open, readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { detectImageExtension } from "../infrastructure/codex/codex-image-generation.js";

// qq_draw.image: drawing for an engine without native image generation
// (Claude Code). Each call runs one Codex image-generation turn through an
// injected `generate` and puts the picture in this turn's output directory,
// where the ordinary attachment path sends it.
//
// Limits that keep a phone host alive: one drawing at a time with a short
// queue (refused when full), the host capacity gate for the two processes a
// Codex turn starts, and a per-turn cap. References are only pictures
// already inside this turn's task workspace (validated as real images).

export const QQ_DRAW_MAX_PER_TURN = 2;
const MAX_PROMPT_CHARS = 2000;
const MAX_REFERENCES = 3;
// Pictures larger than this go back to the model as text only.
const MAX_PREVIEW_BYTES = 3 * 1024 * 1024;

export function normalizeQqDrawArguments(args = {}) {
  const source = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  const prompt = [...String(source.prompt ?? source.description ?? "").trim()].slice(0, MAX_PROMPT_CHARS).join("");
  const references = (Array.isArray(source.references) ? source.references : typeof source.references === "string" ? [source.references] : [])
    .map((path) => String(path ?? "").trim())
    .filter(Boolean)
    .slice(0, MAX_REFERENCES);
  return { prompt, references };
}

export function createQqDrawingService({
  generate,
  processGate = null,
  processes = 2,
  capacityWaitMs = 60_000,
  maxQueued = 2
} = {}) {
  if (typeof generate !== "function") throw new TypeError("generate must be a function");
  let running = 0;
  let waiting = 0;
  let chain = Promise.resolve();
  return {
    async draw(request = {}) {
      if (running + waiting > maxQueued) {
        throw Object.assign(new Error("画图排队已满"), { code: "QQ_DRAW_BUSY" });
      }
      waiting += 1;
      const turn = chain.then(async () => {
        waiting -= 1;
        running += 1;
        let slot = null;
        try {
          if (request.signal?.aborted) throw Object.assign(new Error("画图已取消"), { code: "QQ_DRAW_CANCELLED" });
          slot = processGate
            ? await processGate.acquire({ processes, waitMs: capacityWaitMs, signal: request.signal })
            : null;
          return await generate(request);
        } finally {
          slot?.release?.();
          running -= 1;
        }
      });
      chain = turn.catch(() => undefined);
      return turn;
    },
    snapshot() {
      return { running, waiting, maxQueued };
    }
  };
}

export async function executeQqDrawTool(args = {}, {
  event = {},
  service,
  taskWorkspace,
  maxPerTurn = QQ_DRAW_MAX_PER_TURN,
  validateReference = defaultValidateReference,
  onDrawn = null,
  signal = null,
  assertActive = () => {}
} = {}) {
  assertActive();
  if (!service) return { ok: false, error: "这台机器现在不能画图（没有可用的 Codex）。如实说画不了。" };
  const outputDir = taskWorkspace?.outputDir;
  if (!outputDir) return { ok: false, error: "本轮没有输出目录，画不了。" };
  const request = normalizeQqDrawArguments(args);
  if (!request.prompt) return { ok: false, error: "prompt 要写清画面描述：主体、风格、构图、色调。" };
  const used = Number(event.qqDrawCount || 0);
  if (used >= maxPerTurn) return { ok: false, error: `这一轮已经画了 ${used} 张，先发出去，别再画了。` };

  const referenceImagePaths = [];
  for (const path of request.references) {
    try {
      referenceImagePaths.push(await validateReference(path, taskWorkspace));
    } catch {
      return { ok: false, error: `参考图 ${path} 不能用：只能用本轮输入或输出目录里的图片（先用 qq_context.images 的 use 取出来）。` };
    }
  }

  event.qqDrawCount = used + 1;
  let result;
  try {
    result = await service.draw({
      prompt: request.prompt,
      referenceImagePaths,
      outputDir,
      cwd: taskWorkspace.root || outputDir,
      signal
    });
  } catch (error) {
    event.qqDrawCount = used;
    return { ok: false, error: describeDrawError(error) };
  }
  assertActive();
  const paths = Array.isArray(result?.imagePaths) ? result.imagePaths.filter(Boolean) : [];
  if (!paths.length) {
    const said = String(result?.text || "").replace(/\s+/g, " ").trim().slice(0, 160);
    return { ok: false, error: `Codex 没有画出图${said ? `（它说：${said}）` : ""}。别说已经画好了，可以换个描述再试一次，或如实说画不了。` };
  }
  try {
    await onDrawn?.(paths, { prompt: request.prompt, revisedPrompt: result.revisedPrompt || "" });
  } catch {
    // Remembering the drawing is best effort; the picture is still here.
  }
  const reply = [
    `画好了 ${paths.length} 张，已存进本轮输出目录：${paths.join("、")}。`,
    "下面是画出来的样子，先看一眼合不合适；要发就把这个路径原样放进 qq_chat.send（或最终回复）的 attachments（kind=image），可见正文不要写路径。",
    `不满意可以改描述再画一次（本轮还能画 ${Math.max(0, maxPerTurn - event.qqDrawCount)} 张）。`
  ].join("");
  const preview = await readPreview(paths[0]);
  return {
    ok: true,
    reply,
    paths,
    ...(preview
      ? { contentItems: [{ type: "inputText", text: reply }, { type: "inputImage", imageUrl: preview }] }
      : {})
  };
}

function describeDrawError(error) {
  switch (error?.code) {
    case "QQ_DRAW_BUSY":
      return "现在已经有别的画在画了、还在排队，这张先不画；稍后再试或直说要等一会儿。";
    case "CODEX_HOST_BUSY":
      return "手机现在的进程或内存余量不够，启动不了画图；等一会儿再试，或如实说现在画不了。";
    case "QQ_DRAW_CANCELLED":
    case "ABORT_ERR":
      return "这次画图被取消了。";
    case "CODEX_TURN_TIMEOUT":
    case "CODEX_APP_SERVER_TIMEOUT":
      return "画图超时了，没有画出来；可以把描述写简单些再试，或如实说没画成。";
    default:
      return `画图失败（${String(error?.message || error || "未知错误").replace(/\s+/g, " ").slice(0, 160)}）。别说已经画好了。`;
  }
}

// A reference must be a real picture inside this turn's task workspace.
async function defaultValidateReference(path, taskWorkspace) {
  const root = taskWorkspace?.root ? await realpath(taskWorkspace.root) : "";
  if (!root || !isAbsolute(path)) throw new Error("outside workspace");
  const real = await realpath(path);
  if (!real.startsWith(`${root}/`)) throw new Error("outside workspace");
  const info = await stat(real);
  if (!info.isFile() || info.size <= 0 || info.size > 20 * 1024 * 1024) throw new Error("not a picture");
  const handle = await open(real, "r");
  try {
    const head = Buffer.alloc(16);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    if (!detectImageExtension(head.subarray(0, bytesRead))) throw new Error("not a picture");
  } finally {
    await handle.close();
  }
  return real;
}

async function readPreview(path) {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_PREVIEW_BYTES) return "";
    const data = await readFile(path);
    const extension = detectImageExtension(data);
    if (!extension) return "";
    const mimeType = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
    return `data:${mimeType};base64,${data.toString("base64")}`;
  } catch {
    return "";
  }
}
