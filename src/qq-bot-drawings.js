import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { readValidatedQqImageFile } from "./qq-memory-image-store.js";

// The Bot's own drawings: pictures it really drew (native image generation)
// during a routine "draw" activity or in a chat, kept so it can show or post
// them later. Files are content-addressed under data/qq-bot-drawings/; the
// index lives in the bot-life state. Routine drawings are the Bot's own and
// visible everywhere; chat drawings stay visible only in the conversation
// that asked for them.

export const QQ_BOT_DRAWINGS_LIMIT = 30;
const extensions = Object.freeze({ "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp" });

export function normalizeQqBotDrawings(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [])
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const id = String(entry.id || "").trim();
      const file = String(entry.file || "").trim();
      const at = String(entry.at || "");
      if (!/^d-[0-9a-f]{8}$/.test(id) || !/^[0-9a-f]{16}\.(?:png|jpg|gif|webp)$/.test(file) || !Number.isFinite(Date.parse(at))) return null;
      if (seen.has(id)) return null;
      seen.add(id);
      const source = entry.source === "chat" ? "chat" : "routine";
      return {
        id,
        file,
        at,
        title: compact(entry.title, 30) || "没起名的画",
        description: compact(entry.description, 240),
        source,
        scopeId: source === "chat" ? String(entry.scopeId || "").trim() || null : null,
        postedAt: Number.isFinite(Date.parse(entry.postedAt || "")) ? String(entry.postedAt) : null
      };
    })
    .filter(Boolean)
    .slice(-QQ_BOT_DRAWINGS_LIMIT);
}

export function recordQqBotDrawing(drawings, entry) {
  const current = normalizeQqBotDrawings(drawings);
  const next = normalizeQqBotDrawings([entry])[0];
  if (!next) return current;
  return normalizeQqBotDrawings([...current.filter((item) => item.id !== next.id), next]);
}

export function markQqBotDrawingPosted(drawings, id, at = new Date().toISOString()) {
  return normalizeQqBotDrawings(drawings).map((item) => (item.id === id ? { ...item, postedAt: at } : item));
}

export function listQqBotDrawingsForScope(drawings, scopeId = "") {
  return normalizeQqBotDrawings(drawings).filter((item) => item.source === "routine" || item.scopeId === String(scopeId || ""));
}

export function formatQqBotDrawingsContext(drawings, { scopeId = "", now = Date.now(), limit = 3 } = {}) {
  const visible = listQqBotDrawingsForScope(drawings, scopeId).slice(-limit).reverse();
  if (!visible.length) return "";
  return [
    "【你最近画的画】（你真画出来的，可以用 qq_context.images 拿出来看、发到聊天里或配进说说）：",
    ...visible.map((item) => `- ${item.id}《${item.title}》${formatAge(now - Date.parse(item.at))}${item.postedAt ? "，发过说说" : ""}`)
  ].join("\n");
}

export function formatQqBotDrawingsList(drawings, { scopeId = "", now = Date.now() } = {}) {
  const visible = listQqBotDrawingsForScope(drawings, scopeId).slice().reverse();
  if (!visible.length) return "你还没有存下来的画；以后画好的图会自动存进来。";
  return [
    "你存下来的画（新的在前）：",
    ...visible.map((item) => `- ${item.id}《${item.title}》${formatAge(now - Date.parse(item.at))}${item.source === "chat" ? "（在这里聊天时画的）" : "（按作息自己画的）"}${item.postedAt ? "，发过说说" : ""}${item.description ? `：${item.description.slice(0, 80)}` : ""}`),
    "inspect 看图，use 拿到本轮输出目录（放进 attachments 发出去，或发说说时 target=输出）。"
  ].join("\n");
}

// Validates the source as a real image inside sourceRoot and stores it by
// content hash; storing the same picture twice yields the same id.
export async function storeQqBotDrawingFile(sourcePath, { directory, sourceRoot, maxBytes = 20 * 1024 * 1024 } = {}) {
  if (!directory || !sourceRoot) throw new TypeError("directory and sourceRoot are required");
  const root = await realpath(sourceRoot);
  const { data, mimeType } = await readValidatedQqImageFile(sourcePath, root, maxBytes);
  const extension = extensions[mimeType];
  if (!extension) throw new Error("unsupported drawing type");
  const hash = createHash("sha256").update(data).digest("hex");
  const file = `${hash.slice(0, 16)}${extension}`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const target = join(directory, file);
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  await writeFile(temporary, data, { mode: 0o600 });
  await rename(temporary, target);
  return { id: `d-${hash.slice(0, 8)}`, file, mimeType, bytes: data.length };
}

export async function readQqBotDrawingFile(drawing, { directory, maxBytes = 20 * 1024 * 1024 } = {}) {
  const root = await realpath(directory);
  return readValidatedQqImageFile(join(root, drawing.file), root, maxBytes);
}

export async function copyQqBotDrawingTo(drawing, { directory, outputDir, maxBytes } = {}) {
  const { data } = await readQqBotDrawingFile(drawing, { directory, maxBytes });
  await mkdir(outputDir, { recursive: true });
  const target = join(outputDir, `drawing-${drawing.id}${extname(drawing.file)}`);
  await writeFile(target, data);
  return target;
}

// Removes stored files no index entry references.
export async function pruneQqBotDrawingFiles(drawings, { directory } = {}) {
  const keep = new Set(normalizeQqBotDrawings(drawings).map((item) => item.file));
  const entries = await readdir(directory).catch(() => []);
  let removed = 0;
  for (const name of entries) {
    if (!/^[0-9a-f]{16}\.(?:png|jpg|gif|webp)$/.test(name) || keep.has(name)) continue;
    await rm(join(directory, name), { force: true });
    removed += 1;
  }
  return removed;
}

export function parseQqBotDrawingIdFromPath(path = "") {
  return String(path).match(/drawing-(d-[0-9a-f]{8})\.(?:png|jpg|gif|webp)$/)?.[1] || "";
}

function formatAge(ms) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 2) return "，刚画的";
  if (minutes < 60) return `，${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `，${hours} 小时前` : `，${Math.round(hours / 24)} 天前`;
}

function compact(value, max) {
  return [...String(value ?? "").replace(/\s+/g, " ").trim()].slice(0, max).join("");
}
