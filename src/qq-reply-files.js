import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { resolveAllowedQqMarkerPath, resolveQqMarkerPath } from "./qq-output-policy.js";

export function sanitizeQqUploadFileName(name) {
  const cleaned = String(name || "").trim().replace(/[\\/:*?"<>|\r\n]+/g, "_");
  return cleaned.slice(0, 180);
}

// A display name without an extension leaves people with a file they cannot
// open, so it keeps the real file's extension.
export function withQqSourceExtension(name, filePath) {
  const display = sanitizeQqUploadFileName(name);
  const sourceExtension = extname(String(filePath || "")).toLowerCase();
  if (!display) return sanitizeQqUploadFileName(basename(String(filePath || "")));
  if (!sourceExtension || extname(display)) return display;
  return sanitizeQqUploadFileName(`${display.slice(0, 180 - sourceExtension.length)}${sourceExtension}`);
}

// NapCat strips "file://" and runs decodeURIComponent on the rest, so a
// literal "%" in a name has to reach it escaped.
export function toOneBotLocalFileUri(filePath) {
  return `file://${String(filePath || "").replace(/%/g, "%25")}`;
}

// NapCat waits baseTimeout (10 s) plus the size at 256 KB/s for an upload;
// the Hub waits a little longer so it hears NapCat's own answer instead of
// calling a slow but successful upload failed.
export function estimateOneBotTransferTimeoutMs(bytes, {
  minMs = 10_000,
  baseMs = 10_000,
  bytesPerSecond = 256 * 1024,
  marginMs = 10_000,
  maxMs = 30 * 60_000 + 10_000
} = {}) {
  const size = Math.max(0, Number(bytes) || 0);
  const estimate = baseMs + Math.ceil(size / bytesPerSecond * 1000) + marginMs;
  return Math.min(maxMs, Math.max(Number(minMs) || 0, estimate));
}

export function extractQqFileMarkers(text) {
  return [...String(text || "").matchAll(/\[\[qq_file:([^\]\n]+)\]\]/g)]
    .map((match) => {
      const [rawPath, ...nameParts] = match[1].split("|");
      return {
        path: String(rawPath || "").trim(),
        name: sanitizeQqUploadFileName(nameParts.join("|").trim())
      };
    })
    .filter((item) => item.path);
}

// Rejected files must remain failed delivery attempts. Silently dropping them
// would let a successful text send falsely confirm the whole reply.
export async function resolveQqReplyFileAttachments(reply, { event, projectDir } = {}) {
  const attachments = [];
  const failures = [];
  const seen = new Set();
  for (const marker of extractQqFileMarkers(reply)) {
    const filePath = await resolveAllowedQqMarkerPath(marker.path, { kind: "file", event, projectDir });
    if (!filePath) {
      failures.push(await describeRejectedFile(marker.path, projectDir));
      continue;
    }
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    const info = await stat(filePath).catch(() => null);
    if (!info || info.size <= 0) {
      failures.push({
        ok: false,
        errorCode: "QQ_FILE_ATTACHMENT_EMPTY",
        error: "附件是空文件，QQ 不能发送空文件，文件未发送。"
      });
      continue;
    }
    attachments.push({ path: filePath, name: withQqSourceExtension(marker.name, filePath), size: info.size });
  }
  return { attachments, failures };
}

async function describeRejectedFile(markerPath, projectDir) {
  const candidate = resolveQqMarkerPath(markerPath, { projectDir });
  const info = candidate ? await stat(candidate).catch(() => null) : null;
  return {
    ok: false,
    errorCode: "QQ_FILE_ATTACHMENT_REJECTED",
    error: info?.isFile()
      ? "附件不在本轮输出目录中，文件未发送；先把文件放进本轮输出目录再发。"
      : "附件不存在或已经不可读，文件未发送。"
  };
}
