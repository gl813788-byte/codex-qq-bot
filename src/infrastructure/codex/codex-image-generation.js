import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runCodexAppServerTurn } from "../../codex-app-server-turn.js";
import { buildIsolatedCodexChildEnv } from "../../codex-child-env.js";
import { buildCodexLeanQqConfig } from "./codex-lean-config.js";
import { importRecentCodexGeneratedImages } from "./qq-agent-attachments.js";

// One Codex image-generation turn for an engine that cannot draw itself
// (Claude Code). It runs `codex app-server` on the machine's Codex login with
// no QQ tools, no web search and a read-only sandbox; the only thing the
// model is asked to do is call its native image generation tool. Pictures
// are imported from ~/.codex/generated_images/<thread> into the caller's
// output directory (signature and size checked); if Codex did not save a
// file, the PNG/JPEG/WebP data echoed in the imageGeneration item is used.

const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export const CODEX_DRAWING_DEVELOPER_INSTRUCTIONS = [
  "你是一个只负责画图的组件，替另一个不会画图的 Agent 出图。",
  "用你的原生图片生成能力，按用户给的描述画图；有参考图时把它们当作要修改或参照的原图。",
  "不要写代码、不要运行命令、不要联网、不要读写文件，也不要把图片编码成文本：调用图片生成，画好就结束。",
  "描述违反内容政策或无法完成时不要画，用一句中文说明原因。画好后只回一句简短的中文，说明画了什么。"
].join("\n");

export function formatCodexDrawingPrompt({ prompt = "", referenceCount = 0, count = 1 } = {}) {
  const description = String(prompt || "").trim();
  return [
    count > 1 ? `请画 ${count} 张图。` : "请画一张图。",
    referenceCount > 0 ? `附带了 ${referenceCount} 张参考图，按描述在它们的基础上修改或参照它们来画。` : null,
    "画面描述：",
    description
  ].filter(Boolean).join("\n");
}

export async function runCodexImageGeneration({
  prompt,
  referenceImagePaths = [],
  outputDir,
  generatedImagesDir,
  cwd,
  codexPath = "codex",
  model = null,
  reasoningEffort = "low",
  timeoutMs = 240_000,
  maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
  count = 1,
  signal,
  onSpawn,
  onExit,
  runTurn = runCodexAppServerTurn,
  buildEnv = buildIsolatedCodexChildEnv,
  now = Date.now
} = {}) {
  const description = String(prompt || "").trim();
  if (!description) throw Object.assign(new Error("画面描述是空的"), { code: "CODEX_DRAWING_EMPTY_PROMPT" });
  if (!outputDir) throw new TypeError("outputDir is required");
  const limit = Math.max(1, Math.min(2, Math.trunc(Number(count)) || 1));
  const references = (Array.isArray(referenceImagePaths) ? referenceImagePaths : []).filter(Boolean).slice(0, 3);
  const drawnItems = [];
  const startedAt = now();
  const result = await runTurn({
    codexPath,
    cwd: cwd || outputDir,
    env: buildEnv({}),
    model,
    reasoningEffort,
    prompt: formatCodexDrawingPrompt({ prompt: description, referenceCount: references.length, count: limit }),
    imagePaths: references,
    developerInstructions: CODEX_DRAWING_DEVELOPER_INSTRUCTIONS,
    dynamicTools: [],
    outputSchema: null,
    // The lean config keeps image generation and drops the rest.
    config: buildCodexLeanQqConfig(null, { enabled: true, keepProjectDocs: false }),
    webSearchMode: "disabled",
    sandbox: "read-only",
    ephemeral: true,
    timeoutMs,
    signal,
    onSpawn,
    onExit,
    onItem: (notification) => {
      const item = notification?.item;
      if (notification?.method === "item/completed" && item?.type === "imageGeneration") drawnItems.push(item);
    }
  });
  const items = drawnItems.length
    ? drawnItems
    : (Array.isArray(result?.items) ? result.items : []).filter((item) => item?.type === "imageGeneration");
  await mkdir(outputDir, { recursive: true });
  let imagePaths = await importRecentCodexGeneratedImages({
    threadId: result?.threadId || "",
    generatedImagesDir,
    outputDir,
    generatedAfterMs: startedAt,
    maxImageBytes,
    limit
  }).catch(() => []);
  if (!imagePaths.length) imagePaths = await writeEchoedImages(items, { outputDir, maxImageBytes, limit });
  return {
    imagePaths,
    threadId: result?.threadId || null,
    revisedPrompt: String(items.find((item) => item?.revisedPrompt)?.revisedPrompt || "").trim(),
    text: String(result?.finalResponse || "").trim().slice(0, 500)
  };
}

// The picture data Codex echoes in its imageGeneration item, written only
// when it really is a PNG, JPEG or WebP within the size limit.
async function writeEchoedImages(items, { outputDir, maxImageBytes, limit }) {
  const written = [];
  for (const item of items) {
    if (written.length >= limit) break;
    const data = decodeImageData(item?.result);
    if (!data || data.length > maxImageBytes) continue;
    const extension = detectImageExtension(data);
    if (!extension) continue;
    const path = join(outputDir, `codex-generated-${written.length + 1}-${randomUUID()}${extension}`);
    await writeFile(path, data, { mode: 0o600 });
    written.push(path);
  }
  return written;
}

function decodeImageData(value) {
  const text = String(value || "").trim().replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
  if (!text || !/^[A-Za-z0-9+/=\s]+$/.test(text.slice(0, 256))) return null;
  try {
    const data = Buffer.from(text, "base64");
    return data.length ? data : null;
  } catch {
    return null;
  }
}

export function detectImageExtension(data) {
  if (!Buffer.isBuffer(data) || data.length < 12) return "";
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return ".jpg";
  if (data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return ".webp";
  return "";
}
