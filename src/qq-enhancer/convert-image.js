import { randomUUID } from "node:crypto";
import { copyFile, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { runProcess } from "../process-runner.js";

// QQ shows PNG/JPEG/GIF/WebP pictures. Everything else a model may produce
// as a picture (SVG, BMP, TIFF, ICO, AVIF, HEIC) is rendered to PNG first;
// a picture that only carries the wrong extension is copied under the right
// one. The file's signature, never its name, decides what it is.

export const QQ_NATIVE_IMAGE_EXTENSIONS = Object.freeze({
  png: ".png",
  jpeg: ".jpg",
  gif: ".gif",
  webp: ".webp"
});

const MAGICK_CODERS = Object.freeze({
  bmp: "bmp",
  tiff: "tiff",
  ico: "ico",
  avif: "avif",
  heic: "heic"
});

export const QQ_CONVERTIBLE_IMAGE_FORMATS = Object.freeze(["svg", ...Object.keys(MAGICK_CODERS)]);

const DEFAULT_MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const DEFAULT_MAX_SVG_BYTES = 4 * 1024 * 1024;
const HEADER_BYTES = 4096;
const AVIF_BRANDS = new Set(["avif", "avis"]);
const HEIC_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);
const BMP_HEADER_SIZES = new Set([12, 40, 52, 56, 64, 108, 124]);

export function detectQqImageFormat(header) {
  const bytes = Buffer.isBuffer(header) ? header : Buffer.from(header || []);
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  const ascii6 = bytes.subarray(0, 6).toString("latin1");
  if (ascii6 === "GIF87a" || ascii6 === "GIF89a") return "gif";
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (bytes.length >= 12 && bytes.subarray(4, 8).toString("latin1") === "ftyp") {
    const brand = bytes.subarray(8, 12).toString("latin1");
    if (AVIF_BRANDS.has(brand)) return "avif";
    if (HEIC_BRANDS.has(brand)) return "heic";
  }
  if (bytes.length >= 4 && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00)
    || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))) return "tiff";
  if (bytes.length >= 6 && bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00 && bytes[4] > 0) return "ico";
  if (bytes.length >= 18 && bytes[0] === 0x42 && bytes[1] === 0x4d
    && bytes.readUInt32LE(6) === 0 && BMP_HEADER_SIZES.has(bytes.readUInt32LE(14))) return "bmp";
  if (looksLikeSvg(bytes)) return "svg";
  return "";
}

export async function detectQqImageFileFormat(filePath) {
  const handle = await open(filePath, "r").catch(() => null);
  if (!handle) return "";
  try {
    const header = Buffer.alloc(HEADER_BYTES);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    return detectQqImageFormat(header.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

function looksLikeSvg(bytes) {
  const text = bytes.toString("utf8").replace(/^﻿/, "").trimStart();
  if (!text.startsWith("<")) return false;
  return /<svg[\s>]/i.test(stripSvgProlog(text).slice(0, 512));
}

function stripSvgProlog(text) {
  let rest = String(text || "").trimStart();
  for (;;) {
    const next = rest
      .replace(/^<\?xml[\s\S]*?\?>/i, "")
      .replace(/^<!--[\s\S]*?-->/, "")
      .replace(/^<!DOCTYPE[^>[]*>/i, "")
      .trimStart();
    if (next === rest) return rest;
    rest = next;
  }
}

// librsvg already refuses files outside the SVG's own folder; the Hub also
// refuses anything that could reach beyond the document itself: entities,
// external stylesheets, and references other than #fragments or inline
// raster data. A refused SVG is still sent as an ordinary file.
export function inspectQqSvgSafety(text) {
  const source = String(text || "").replace(/^﻿/, "");
  if (/<!ENTITY/i.test(source) || /<!DOCTYPE[^>]*\[/i.test(source)) {
    return { ok: false, reason: "SVG 里有 DOCTYPE/ENTITY 定义" };
  }
  if (/<\?xml-stylesheet/i.test(source) || /@import/i.test(source)) {
    return { ok: false, reason: "SVG 引用了外部样式表" };
  }
  for (const match of source.matchAll(/\s(?:[\w-]+:)?(?:href|src)\s*=\s*("([^"]*)"|'([^']*)')/gi)) {
    const value = (match[2] ?? match[3] ?? "").trim();
    if (!isSafeSvgReference(value)) return { ok: false, reason: "SVG 引用了外部文件或网址" };
  }
  for (const match of source.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
    const value = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    if (!isSafeSvgReference(value)) return { ok: false, reason: "SVG 引用了外部文件或网址" };
  }
  if (!/<svg[\s>]/i.test(stripSvgProlog(source).slice(0, 512))) {
    return { ok: false, reason: "不是 SVG 文档" };
  }
  return { ok: true, reason: "", sanitized: source.replace(/<!DOCTYPE[^>[]*>/gi, "") };
}

function isSafeSvgReference(value) {
  const reference = String(value || "").trim();
  if (!reference || reference.startsWith("#")) return true;
  return /^data:image\/(?:png|jpe?g|gif|webp);base64,[a-z0-9+/=\s]*$/i.test(reference);
}

const SVG_UNIT_PX = { "": 1, px: 1, pt: 4 / 3, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, em: 16, ex: 8 };

// The root element's declared size in CSS pixels, from width/height or the
// viewBox; null when it declares neither (percentages count as undeclared).
export function readQqSvgIntrinsicSize(text) {
  const root = stripSvgProlog(String(text || "").replace(/^﻿/, "")).match(/<svg\b[^>]*>/i)?.[0] || "";
  const length = (name) => {
    const value = root.match(new RegExp(`\\s${name}\\s*=\\s*["']\\s*([0-9.]+(?:e[+-]?[0-9]+)?)\\s*([a-z%]*)\\s*["']`, "i"));
    if (!value || value[2] === "%") return 0;
    const factor = SVG_UNIT_PX[value[2].toLowerCase()];
    const number = Number(value[1]) * (factor || 0);
    return Number.isFinite(number) && number > 0 ? number : 0;
  };
  const viewBox = root.match(/\sviewBox\s*=\s*["']\s*([^"']+)["']/i)?.[1]
    ?.trim().split(/[\s,]+/).map(Number) || [];
  const boxWidth = viewBox.length === 4 && viewBox[2] > 0 ? viewBox[2] : 0;
  const boxHeight = viewBox.length === 4 && viewBox[3] > 0 ? viewBox[3] : 0;
  let width = length("width");
  let height = length("height");
  if (!width && !height) {
    width = boxWidth;
    height = boxHeight;
  } else if (!width) {
    width = boxWidth && boxHeight ? height * boxWidth / boxHeight : height;
  } else if (!height) {
    height = boxWidth && boxHeight ? width * boxHeight / boxWidth : width;
  }
  return width > 0 && height > 0 ? { width, height } : null;
}

// Render box for rsvg-convert: the longest edge lands between minEdge and
// maxEdge (vectors scale up losslessly; huge declared sizes scale down), and
// -a keeps the aspect ratio inside it.
export function chooseQqSvgRenderBox(size, { minEdge = 768, maxEdge = 2048 } = {}) {
  if (!size) return { width: 1024, height: 1024 };
  const longest = Math.max(size.width, size.height);
  const target = Math.min(maxEdge, Math.max(minEdge, longest));
  const scale = target / longest;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale))
  };
}

export function imageToolEnv(source = process.env) {
  return Object.fromEntries(["PATH", "HOME", "LANG", "LD_LIBRARY_PATH", "PREFIX", "TMPDIR", "ANDROID_ROOT", "ANDROID_DATA", "FONTCONFIG_FILE", "FONTCONFIG_PATH"]
    .filter((key) => source[key] != null).map((key) => [key, source[key]]));
}

// Returns a new sendable picture in outputDir; throws when the source cannot
// become one (the caller then sends it as an ordinary file).
export async function convertQqImageForSending(sourcePath, {
  outputDir,
  format = "",
  maxSourceBytes = DEFAULT_MAX_SOURCE_BYTES,
  maxSvgBytes = DEFAULT_MAX_SVG_BYTES,
  maxEdge = 2048,
  signal,
  run = runProcess
} = {}) {
  if (!outputDir) throw rejected("没有输出目录");
  const info = await stat(sourcePath);
  if (!info.isFile() || info.size <= 0) throw rejected("文件为空或不可读");
  const detected = format || await detectQqImageFileFormat(sourcePath);
  const stem = safeStem(sourcePath);
  const id = randomUUID().slice(0, 8);

  if (QQ_NATIVE_IMAGE_EXTENSIONS[detected]) {
    const output = join(outputDir, `${stem}-${id}${QQ_NATIVE_IMAGE_EXTENSIONS[detected]}`);
    await copyFile(sourcePath, output);
    return { path: output, format: detected, converted: false };
  }
  if (info.size > (detected === "svg" ? maxSvgBytes : maxSourceBytes)) {
    throw rejected("图片太大，没法转换");
  }

  const output = join(outputDir, `${stem}-${id}.png`);
  const env = imageToolEnv();
  try {
    if (detected === "svg") {
      const svg = await readFile(sourcePath, "utf8");
      const safety = inspectQqSvgSafety(svg);
      if (!safety.ok) throw rejected(safety.reason);
      const box = chooseQqSvgRenderBox(readQqSvgIntrinsicSize(safety.sanitized), { maxEdge });
      const staged = join(outputDir, `.render-${id}.svg`);
      await writeFile(staged, safety.sanitized, { flag: "wx", mode: 0o600 });
      try {
        await run("rsvg-convert", [
          "--width", String(box.width), "--height", String(box.height), "--keep-aspect-ratio",
          "--background-color", "white", "--format", "png", "--output", output, staged
        ], { timeoutMs: 20_000, maxOutputBytes: 64 * 1024, killProcessGroup: true, signal, env, cwd: outputDir });
      } finally {
        await rm(staged, { force: true });
      }
    } else if (MAGICK_CODERS[detected]) {
      await run("magick", [
        "-limit", "memory", "128MiB", "-limit", "map", "0", "-limit", "disk", "0",
        "-limit", "thread", "1", "-limit", "width", "16384", "-limit", "height", "16384",
        `${MAGICK_CODERS[detected]}:${sourcePath}[0]`, "-auto-orient",
        "-resize", `${maxEdge * 2}x${maxEdge * 2}>`, "-strip", `png:${output}`
      ], { timeoutMs: 20_000, maxOutputBytes: 64 * 1024, killProcessGroup: true, signal, env, cwd: outputDir });
    } else {
      throw rejected("不是图片");
    }
    const result = await stat(output);
    if (!result.isFile() || result.size <= 0) throw rejected("转换没有生成图片");
    if (await detectQqImageFileFormat(output) !== "png") throw rejected("转换结果不是 PNG");
    return { path: output, format: detected, converted: true };
  } catch (error) {
    await rm(output, { force: true });
    throw error;
  }
}

function rejected(message) {
  return Object.assign(new Error(message), { code: "QQ_IMAGE_CONVERT_REJECTED" });
}

function safeStem(filePath) {
  const stem = basename(filePath, extname(filePath)).replace(/[^\p{L}\p{N}._-]+/gu, "_").replace(/^[._]+/, "");
  return (stem || "image").slice(0, 60);
}
