import crypto from "node:crypto";
import { copyFile, mkdir, open, readdir, realpath, stat } from "node:fs/promises";
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
  maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
  recoverUnlistedGeneratedImage = false
} = {}) {
  const parsed = parseQqAgentOutput(value, { bubbleSeparator });
  if (!parsed.structured || !parsed.value) {
    return {
      ...parsed,
      importedImageCount: 0,
      rejectedGeneratedImageCount: 0,
      recoveredUnlistedImageCount: 0
    };
  }

  const materialized = await materializeCodexGeneratedImageAttachments(parsed.value, {
    threadId,
    generatedImagesDir,
    outputDir,
    generatedAfterMs,
    maxImageBytes,
    recoverUnlistedGeneratedImage
  });
  const reconciledValue = materialized.recoveredUnlistedImageCount > 0
    ? reconcileRecoveredImageDeliveryText(materialized.value)
    : materialized.value;
  const normalized = materialized.changed || reconciledValue !== materialized.value
    ? parseQqAgentOutput(JSON.stringify(reconciledValue), { bubbleSeparator })
    : parsed;
  return {
    ...normalized,
    importedImageCount: materialized.importedImageCount,
    rejectedGeneratedImageCount: materialized.rejectedGeneratedImageCount,
    recoveredUnlistedImageCount: materialized.recoveredUnlistedImageCount
  };
}

export async function materializeCodexGeneratedImageAttachments(value, {
  threadId = "",
  generatedImagesDir = "",
  outputDir = "",
  generatedAfterMs = 0,
  maxImageBytes = DEFAULT_MAX_IMAGE_BYTES,
  recoverUnlistedGeneratedImage = false
} = {}) {
  const attachments = Array.isArray(value?.attachments) ? value.attachments.slice(0, 8) : [];
  const shouldRecoverUnlistedImage = Boolean(recoverUnlistedGeneratedImage)
    && value?.status !== "silent"
    && !attachments.some((attachment) => attachment?.kind === "image")
    && attachments.length < 8;
  if (!value || typeof value !== "object" || (attachments.length === 0 && !shouldRecoverUnlistedImage)) {
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
  let recoveredUnlistedImageCount = 0;
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

  if (shouldRecoverUnlistedImage) {
    const recovered = await importLatestGeneratedImageAttachment(nextAttachments.length, importContext);
    if (recovered.path) {
      nextAttachments.push({ kind: "image", path: recovered.path, name: "" });
      importedImageCount += 1;
      recoveredUnlistedImageCount = 1;
      changed = true;
    }
  }

  return {
    value: changed ? { ...value, attachments: nextAttachments } : value,
    changed,
    importedImageCount,
    rejectedGeneratedImageCount,
    recoveredUnlistedImageCount
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
  const realGeneratedRoot = generatedRoot ? await realpath(generatedRoot).catch(() => "") : "";
  const candidateThreadRoot = threadRoot ? await realpath(threadRoot).catch(() => "") : "";
  const realThreadRoot = realGeneratedRoot
    && candidateThreadRoot
    && isPathInside(candidateThreadRoot, realGeneratedRoot)
    ? candidateThreadRoot
    : "";
  return {
    generatedRoot,
    realGeneratedRoot,
    realOutputRoot: outputRoot ? await realpath(outputRoot).catch(() => "") : "",
    realThreadRoot,
    threadRoot,
    outputRoot,
    generatedAfterMs: normalizeTimestamp(generatedAfterMs),
    maxImageBytes: normalizeMaxBytes(maxImageBytes)
  };
}

async function importLatestGeneratedImageAttachment(index, context) {
  if (!context.realThreadRoot || !context.threadRoot) return { path: "", rejected: false };
  const entries = await readdir(context.realThreadRoot, { withFileTypes: true }).catch(() => []);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const candidate = join(context.threadRoot, entry.name);
    const info = await stat(candidate).catch(() => null);
    if (!info?.isFile()
      || info.size <= 0
      || info.size > context.maxImageBytes
      || (context.generatedAfterMs > 0 && info.mtimeMs < context.generatedAfterMs - 2000)) {
      continue;
    }
    candidates.push({ candidate, mtimeMs: info.mtimeMs });
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs || right.candidate.localeCompare(left.candidate));
  for (const { candidate } of candidates) {
    const imported = await importGeneratedImageAttachment({ path: candidate }, index, context);
    if (imported.path) return imported;
  }
  return { path: "", rejected: false };
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
  if (!realCandidate
    || !context.realGeneratedRoot
    || !isPathInside(realCandidate, context.realGeneratedRoot)
    || !context.realThreadRoot
    || !isPathInside(realCandidate, context.realThreadRoot)) {
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

function reconcileRecoveredImageDeliveryText(value) {
  if (!value || typeof value !== "object") return value;
  const text = removeObsoleteImageDeliveryFailure(value.text);
  const bubbles = Array.isArray(value.bubbles)
    ? value.bubbles.map(removeObsoleteImageDeliveryFailure).filter(Boolean)
    : value.bubbles;
  if (text === value.text && bubbles === value.bubbles) return value;
  return { ...value, text, bubbles };
}

function removeObsoleteImageDeliveryFailure(value) {
  const text = String(value || "");
  const deliveryFailureSegment = /(?=[^。！？!?\n]{0,240}(?:沙箱|附件输出目录|QQ\s*附件))(?=[^。！？!?\n]{0,240}(?:异常|失败|无法|不能|未能|没法))[^。！？!?\n]{1,240}[。！？!?]?/gi;
  return text
    .replace(deliveryFailureSegment, (segment) => (
      /(?:图片|图像|成品)[^。！？!?\n]{0,40}(?:已生成|生成好|画好|做好)/i.test(segment)
        ? "图片已生成。"
        : ""
    ))
    .replace(/生成结果已显示在当前任务中[。！？!?]?/g, "")
    .replace(/。{2,}/g, "。")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function unchanged(value) {
  return {
    value,
    changed: false,
    importedImageCount: 0,
    rejectedGeneratedImageCount: 0,
    recoveredUnlistedImageCount: 0
  };
}
