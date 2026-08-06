import crypto from "node:crypto";
import { copyFile, mkdir, open, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { parseQqAgentOutput } from "./qq-agent-output.js";
import { isPathInside } from "../../qq-output-policy.js";

const DEFAULT_MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export async function parseQqAgentOutputWithAttachmentImport(value, {
  bubbleSeparator = "|||",
  threadId = "",
  generatedImagesDir = "",
  outputDir = "",
  generatedAfterMs = 0,
  maxImageBytes = DEFAULT_MAX_IMAGE_BYTES
} = {}) {
  const parsed = parseQqAgentOutput(value, { bubbleSeparator });
  if (!parsed.structured || !parsed.value) {
    return {
      ...parsed,
      importedImageCount: 0,
      rejectedGeneratedImageCount: 0
    };
  }

  const materialized = await materializeCodexGeneratedImageAttachments(parsed.value, {
    threadId,
    generatedImagesDir,
    outputDir,
    generatedAfterMs,
    maxImageBytes
  });
  const normalized = materialized.changed
    ? parseQqAgentOutput(JSON.stringify(materialized.value), { bubbleSeparator })
    : parsed;
  return {
    ...normalized,
    importedImageCount: materialized.importedImageCount,
    rejectedGeneratedImageCount: materialized.rejectedGeneratedImageCount
  };
}

export async function materializeCodexGeneratedImageAttachments(value, {
  threadId = "",
  generatedImagesDir = "",
  outputDir = "",
  generatedAfterMs = 0,
  maxImageBytes = DEFAULT_MAX_IMAGE_BYTES
} = {}) {
  const attachments = Array.isArray(value?.attachments) ? value.attachments.slice(0, 8) : [];
  if (!value || typeof value !== "object" || attachments.length === 0) {
    return unchanged(value);
  }

  const importContext = await buildImportContext({
    threadId,
    generatedImagesDir,
    outputDir,
    generatedAfterMs,
    maxImageBytes
  });
  let importedImageCount = 0;
  let rejectedGeneratedImageCount = 0;
  let changed = false;
  const nextAttachments = [];

  for (const [index, attachment] of attachments.entries()) {
    if (attachment?.kind !== "image") {
      nextAttachments.push(attachment);
      continue;
    }
    const imported = await importGeneratedImageAttachment(attachment, index, importContext);
    if (imported.path) {
      nextAttachments.push({ ...attachment, path: imported.path });
      importedImageCount += 1;
      changed = true;
      continue;
    }
    if (imported.rejected) rejectedGeneratedImageCount += 1;
    nextAttachments.push(attachment);
  }

  return {
    value: changed ? { ...value, attachments: nextAttachments } : value,
    changed,
    importedImageCount,
    rejectedGeneratedImageCount
  };
}

async function buildImportContext({ threadId, generatedImagesDir, outputDir, generatedAfterMs, maxImageBytes }) {
  const generatedRoot = absolutePath(generatedImagesDir);
  const outputRoot = absolutePath(outputDir);
  const safeThreadId = normalizeThreadId(threadId);
  const threadRoot = generatedRoot && safeThreadId
    ? join(generatedRoot, safeThreadId)
    : "";
  if (outputRoot) await mkdir(outputRoot, { recursive: true });
  return {
    generatedRoot,
    realOutputRoot: outputRoot ? await realpath(outputRoot).catch(() => "") : "",
    realThreadRoot: threadRoot ? await realpath(threadRoot).catch(() => "") : "",
    outputRoot,
    generatedAfterMs: normalizeTimestamp(generatedAfterMs),
    maxImageBytes: normalizeMaxBytes(maxImageBytes)
  };
}

async function importGeneratedImageAttachment(attachment, index, context) {
  const candidate = absolutePath(attachment?.path);
  if (!candidate) return { path: "", rejected: false };
  const realCandidate = await realpath(candidate).catch(() => "");
  if (realCandidate && context.realOutputRoot && isPathInside(realCandidate, context.realOutputRoot)) {
    return { path: "", rejected: false };
  }
  if (!context.generatedRoot || !isPathInside(candidate, context.generatedRoot)) {
    return { path: "", rejected: false };
  }
  if (!realCandidate || !context.realThreadRoot || !isPathInside(realCandidate, context.realThreadRoot)) {
    return { path: "", rejected: true };
  }

  const info = await stat(realCandidate).catch(() => null);
  if (!info?.isFile()
    || info.size <= 0
    || info.size > context.maxImageBytes
    || (context.generatedAfterMs > 0 && info.mtimeMs < context.generatedAfterMs - 2000)) {
    return { path: "", rejected: true };
  }
  const extension = await detectImageExtension(realCandidate);
  if (!extension || !context.outputRoot) return { path: "", rejected: true };

  const outputPath = join(
    context.outputRoot,
    `codex-generated-${index + 1}-${crypto.randomUUID()}${extension}`
  );
  await copyFile(realCandidate, outputPath);
  return { path: outputPath, rejected: false };
}

async function detectImageExtension(filePath) {
  const handle = await open(filePath, "r").catch(() => null);
  if (!handle) return "";
  try {
    const header = Buffer.alloc(12);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    const bytes = header.subarray(0, bytesRead);
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return ".png";
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
      return ".jpg";
    }
    const prefix = bytes.subarray(0, 6).toString("ascii");
    if (prefix === "GIF87a" || prefix === "GIF89a") return ".gif";
    if (bytes.length >= 12
      && bytes.subarray(0, 4).toString("ascii") === "RIFF"
      && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
      return ".webp";
    }
    return "";
  } finally {
    await handle.close();
  }
}

function absolutePath(value) {
  const path = String(value || "").trim();
  return path && isAbsolute(path) && !path.includes("\0") ? resolve(path) : "";
}

function normalizeThreadId(value) {
  const id = String(value || "").trim();
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id) ? id : "";
}

function normalizeMaxBytes(value) {
  const bytes = Number(value);
  return Number.isFinite(bytes) && bytes > 0
    ? Math.floor(bytes)
    : DEFAULT_MAX_IMAGE_BYTES;
}

function normalizeTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : 0;
}

function unchanged(value) {
  return {
    value,
    changed: false,
    importedImageCount: 0,
    rejectedGeneratedImageCount: 0
  };
}
