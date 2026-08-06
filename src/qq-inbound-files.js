import crypto from "node:crypto";
import { basename, join } from "node:path";
import { stat } from "node:fs/promises";
import { writeResponseBodyToFile } from "./bounded-stream.js";

const maxInboundFilesPerMessage = 8;

export function extractOneBotFileInputs(payload, { maxFiles = maxInboundFilesPerMessage } = {}) {
  const files = [];
  const segments = Array.isArray(payload?.message) ? payload.message : [];
  for (const segment of segments) {
    if (String(segment?.type || "").toLowerCase() !== "file") continue;
    const data = segment?.data && typeof segment.data === "object" ? segment.data : {};
    files.push(normalizeOneBotFile(data, payload));
  }

  for (const match of String(payload?.raw_message || "").matchAll(/\[CQ:file,([^\]]*)\]/gi)) {
    const data = {};
    for (const field of String(match[1] || "").split(",")) {
      const separator = field.indexOf("=");
      if (separator <= 0) continue;
      data[field.slice(0, separator)] = decodeCqValue(field.slice(separator + 1));
    }
    files.push(normalizeOneBotFile(data, payload));
  }

  const seen = new Set();
  return files
    .filter((file) => file.name || file.fileId || file.url)
    .filter((file) => {
      const key = `${file.fileId}\0${file.url}\0${file.name}\0${file.fileSize || 0}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, Math.max(1, Number(maxFiles) || maxInboundFilesPerMessage));
}

export function redactQqFileCqCodes(value) {
  return String(value || "").replace(/\[CQ:file,[^\]]*\]/gi, "[文件]");
}

export function collectQqInboundFileCandidates(event, { maxFiles = 16 } = {}) {
  const sources = [
    ...(Array.isArray(event?.files) ? event.files.map((file) => ({ file, origin: file.origin || "当前消息" })) : []),
    ...(Array.isArray(event?.replyContext?.files)
      ? event.replyContext.files.map((file) => ({ file, origin: "引用消息" }))
      : [])
  ];
  const seen = new Set();
  const candidates = [];
  for (const source of sources) {
    const file = source.file || {};
    const key = `${file.fileId || ""}\0${file.url || ""}\0${file.name || ""}\0${file.messageId || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push({
      selector: `file-${candidates.length + 1}`,
      name: safeInboundFileName(file.name),
      fileSize: normalizeFileSize(file.fileSize),
      origin: compactText(source.origin, 24) || "当前消息",
      fileId: compactText(file.fileId, 1_024),
      url: normalizeHttpUrl(file.url),
      messageType: file.messageType === "private"
        || (!file.messageType && (event?.type === "private_message" || !event?.groupId))
        ? "private"
        : "group",
      groupId: compactIdentifier(file.groupId || event?.groupId),
      senderId: compactIdentifier(file.senderId || event?.senderId),
      messageId: compactText(file.messageId, 128)
    });
    if (candidates.length >= Math.max(1, Number(maxFiles) || 16)) break;
  }
  return candidates;
}

export function formatQqInboundFileCandidates(candidates, { maxBytes = 0 } = {}) {
  const files = Array.isArray(candidates) ? candidates : [];
  if (files.length === 0) return "";
  const limit = Number(maxBytes) > 0 ? `；单文件下载上限 ${formatByteSize(maxBytes)}` : "";
  return [
    `触发消息中检测到 ${files.length} 个文件${limit}：`,
    ...files.map((file) => `- ${file.selector} · ${file.name || "未命名文件"} · ${file.fileSize ? formatByteSize(file.fileSize) : "大小未知"} · ${file.origin}`),
    "文件尚未下载。只有确实需要读取内容时才调用 qq_context.download_file；不要根据文件名假装已经看过内容。"
  ].join("\n");
}

export function buildOneBotInboundFileUrlRequest(candidate) {
  const fileId = compactText(candidate?.fileId, 1_024);
  if (!fileId) return null;
  if (candidate?.messageType === "private") {
    return {
      endpoint: "get_private_file_url",
      payload: { file_id: fileId }
    };
  }
  const groupId = compactIdentifier(candidate?.groupId);
  if (!groupId) return null;
  return {
    endpoint: "get_group_file_url",
    payload: { group_id: Number(groupId), file_id: fileId }
  };
}

export async function downloadQqInboundFile(candidate, {
  inputDir,
  maxBytes,
  resolveDownloadUrl,
  fetchDownload
} = {}) {
  if (!candidate?.selector) throw new TypeError("A detected QQ file candidate is required");
  if (!inputDir) throw new TypeError("QQ task input directory is required");
  if (typeof resolveDownloadUrl !== "function") throw new TypeError("resolveDownloadUrl must be a function");
  if (typeof fetchDownload !== "function") throw new TypeError("fetchDownload must be a function");
  const limit = Math.max(1, Number(maxBytes) || 1);
  if (candidate.fileSize && candidate.fileSize > limit) {
    const error = new Error(`文件大小 ${formatByteSize(candidate.fileSize)} 超过本轮下载上限 ${formatByteSize(limit)}。`);
    error.code = "QQ_FILE_TOO_LARGE";
    throw error;
  }

  const url = normalizeHttpUrl(await resolveDownloadUrl(candidate));
  if (!url) {
    const error = new Error("QQ 没有返回可用的文件下载地址。");
    error.code = "QQ_FILE_URL_UNAVAILABLE";
    throw error;
  }
  const response = await fetchDownload(url, candidate);
  if (!response?.ok) {
    const error = new Error(`QQ 文件下载返回 HTTP ${response?.status || "未知"}。`);
    error.code = "QQ_FILE_DOWNLOAD_FAILED";
    throw error;
  }
  const safeName = safeInboundFileName(candidate.name) || "qq-file";
  const outputPath = join(inputDir, `${candidate.selector}-${crypto.randomUUID()}-${safeName}`);
  const saved = await writeResponseBodyToFile(response, outputPath, { maxBytes: limit });
  const outputStats = await stat(saved.path);
  if (!outputStats.isFile()) throw new Error("下载结果不是普通文件。");
  return {
    path: saved.path,
    bytes: saved.bytes,
    name: safeName,
    selector: candidate.selector
  };
}

export function safeInboundFileName(value) {
  const leaf = basename(String(value || "").replace(/\\/g, "/"));
  const cleaned = leaf
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/[\/:*?"<>|]+/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+$/, "");
  return cleaned.slice(0, 180);
}

function normalizeOneBotFile(data, payload) {
  return {
    name: safeInboundFileName(data.name || data.file_name || data.fileName || data.file),
    fileId: compactText(data.file_id || data.fileId || data.id, 1_024),
    fileSize: normalizeFileSize(data.file_size || data.fileSize || data.size),
    url: normalizeHttpUrl(data.url || data.src),
    messageType: payload?.message_type === "private"
      ? "private"
      : payload?.message_type === "group" ? "group" : "",
    groupId: compactIdentifier(payload?.group_id),
    senderId: compactIdentifier(payload?.user_id),
    messageId: compactText(payload?.message_id, 128)
  };
}

function normalizeFileSize(value) {
  const size = Number(value);
  return Number.isSafeInteger(size) && size > 0 ? size : 0;
}

function normalizeHttpUrl(value) {
  const text = String(value || "").trim();
  if (!/^https?:\/\//i.test(text)) return "";
  try {
    return new URL(text).href;
  } catch {
    return "";
  }
}

function compactIdentifier(value) {
  const text = String(value ?? "").trim();
  return /^\d{4,20}$/.test(text) ? text : "";
}

function compactText(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .trim()
    .slice(0, maxLength);
}

function decodeCqValue(value) {
  return String(value || "")
    .replace(/&#44;/gi, ",")
    .replace(/&#91;/gi, "[")
    .replace(/&#93;/gi, "]")
    .replace(/&amp;/gi, "&");
}

function formatByteSize(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MiB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GiB`;
}
