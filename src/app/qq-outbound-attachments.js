import { randomUUID } from "node:crypto";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import {
  convertQqImageForSending,
  detectQqImageFileFormat,
  QQ_CONVERTIBLE_IMAGE_FORMATS,
  QQ_NATIVE_IMAGE_EXTENSIONS
} from "../qq-enhancer/convert-image.js";
import { isPathInside, resolveQqMarkerPath } from "../qq-output-policy.js";
import { sanitizeQqUploadFileName } from "../qq-reply-files.js";

// Outgoing attachments, prepared right before a message goes to OneBot:
//   - qq_chat.send attachments may carry their text content (a Markdown note,
//     CSV, code, an SVG drawing...). The Hub writes it into this turn's
//     output directory, so the Bot can send files even where its sandbox
//     cannot write.
//   - A picture QQ cannot show (SVG, BMP, TIFF, ICO, AVIF, HEIC, or a real
//     picture with the wrong extension) from the output directory becomes a
//     PNG next to it; a "picture" that is not one, or fails to render, is
//     sent as an ordinary file instead of being dropped.
// Path and signature checks still run afterwards in the normal senders.

export const QQ_INLINE_ATTACHMENT_MAX_BYTES = 512 * 1024;
export const QQ_INLINE_ATTACHMENTS_MAX_TOTAL_BYTES = 1024 * 1024;
const QQ_NATIVE_IMAGE_EXTENSION_SET = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

export async function writeQqInlineAttachments(attachments = [], { outputDir } = {}) {
  const list = Array.isArray(attachments) ? attachments : [];
  if (!list.some((attachment) => typeof attachment?.content === "string")) {
    return { attachments: list, notes: [] };
  }
  const output = [];
  const notes = [];
  let totalBytes = 0;
  let ready = false;
  for (const attachment of list) {
    if (typeof attachment?.content !== "string") {
      output.push(attachment);
      continue;
    }
    const name = chooseInlineAttachmentName(attachment);
    const bytes = Buffer.byteLength(attachment.content, "utf8");
    if (!outputDir) {
      notes.push(`附件「${name}」没写成：本轮没有输出目录，没有发送。`);
      continue;
    }
    if (bytes === 0) {
      notes.push(`附件「${name}」的 content 是空的，没有发送。`);
      continue;
    }
    if (bytes > QQ_INLINE_ATTACHMENT_MAX_BYTES || totalBytes + bytes > QQ_INLINE_ATTACHMENTS_MAX_TOTAL_BYTES) {
      notes.push(`附件「${name}」内容太长（单个上限 ${QQ_INLINE_ATTACHMENT_MAX_BYTES / 1024} KB，一次合计 ${QQ_INLINE_ATTACHMENTS_MAX_TOTAL_BYTES / 1024} KB），没有发送；可以拆开或精简。`);
      continue;
    }
    if (!ready) {
      await mkdir(outputDir, { recursive: true });
      ready = true;
    }
    const path = join(outputDir, `${diskStem(name)}-${randomUUID().slice(0, 8)}${extname(name)}`);
    await writeFile(path, attachment.content, { flag: "wx", mode: 0o644 });
    totalBytes += bytes;
    output.push({ kind: attachment.kind === "image" ? "image" : "file", path, name });
  }
  return { attachments: output, notes };
}

function chooseInlineAttachmentName(attachment) {
  const looksSvg = /<svg[\s>]/i.test(String(attachment.content || "").slice(0, 2048));
  const fallback = attachment.kind === "image" || looksSvg ? "image.svg" : "file.txt";
  const name = sanitizeQqUploadFileName(attachment.name).replace(/^\.+/, "").slice(0, 120);
  if (!name) return fallback;
  if (extname(name)) return name;
  return `${name}${looksSvg ? ".svg" : ".txt"}`;
}

function diskStem(name) {
  const stem = basename(name, extname(name)).replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^[._]+/, "");
  return (stem || "file").slice(0, 60);
}

export async function prepareQqOutboundReplyMarkers(reply, {
  outputDir = "",
  projectDir,
  signal,
  convert = convertQqImageForSending,
  detect = detectQqImageFileFormat
} = {}) {
  let text = String(reply || "");
  const notes = [];
  const conversions = [];
  const markers = [...new Set([...text.matchAll(/\[\[qq_image:([^\]\n]+)\]\]/g)].map((match) => match[0]))];
  if (!markers.length || !outputDir) return { reply: text, notes, conversions };
  const realOutput = await realpath(outputDir).catch(() => "");
  if (!realOutput) return { reply: text, notes, conversions };

  for (const marker of markers) {
    const candidate = resolveQqMarkerPath(marker.slice("[[qq_image:".length, -2), { projectDir });
    if (!candidate || QQ_NATIVE_IMAGE_EXTENSION_SET.has(extname(candidate).toLowerCase())) continue;
    const real = await realpath(candidate).catch(() => "");
    // Only this turn's own output is touched; anything else keeps its marker
    // and meets the normal rejection.
    if (!real || !isPathInside(real, realOutput) || /[|\]\n]/.test(real)) continue;
    const info = await stat(real).catch(() => null);
    if (!info?.isFile() || info.size <= 0) continue;
    const label = basename(real);
    const asFile = `[[qq_file:${real}|${sanitizeQqUploadFileName(label)}]]`;
    const format = await detect(real);
    if (!QQ_NATIVE_IMAGE_EXTENSIONS[format] && !QQ_CONVERTIBLE_IMAGE_FORMATS.includes(format)) {
      text = text.split(marker).join(asFile);
      notes.push(`「${label}」不是 QQ 能显示的图片，已按文件发送。`);
      conversions.push({ format: format || "unknown", outcome: "sent-as-file" });
      continue;
    }
    try {
      const converted = await convert(real, { outputDir: realOutput, format, signal });
      text = text.split(marker).join(`[[qq_image:${converted.path}]]`);
      conversions.push({ format, outcome: converted.converted ? "converted" : "renamed" });
    } catch (error) {
      if (signal?.aborted) throw error;
      text = text.split(marker).join(asFile);
      const reason = describeConversionFailure(error);
      notes.push(`「${label}」没能转成图片（${reason}），已按文件发送。`);
      conversions.push({ format, outcome: "convert-failed" });
    }
  }
  return { reply: text, notes, conversions };
}

// Renderer output can carry local paths; only the Hub's own reasons are shown.
function describeConversionFailure(error) {
  if (error?.code === "QQ_IMAGE_CONVERT_REJECTED") {
    return String(error.message || "转换失败").replace(/\s+/g, " ").trim().slice(0, 80);
  }
  if (error?.code === "ENOENT") return "本机没有安装图片转换工具";
  return "渲染出错或超时";
}
