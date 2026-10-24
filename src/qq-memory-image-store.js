import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, open, readdir, realpath, rename, stat, unlink, utimes } from "node:fs/promises";
import { join } from "node:path";
import { syncDirectory } from "./file-store.js";
import { isPathInside } from "./qq-output-policy.js";

// Avatars and knowledge pictures are stored once by content hash. Records
// keep only the id, so a file is trusted again only after its bytes pass the
// same size and signature checks on every read.
export const qqMemoryImageMaxBytes = 8 * 1024 * 1024;

const imageIdPattern = /^[a-f0-9]{64}$/;
const storedNamePattern = /^([a-f0-9]{64})\.(png|jpg|gif|webp)$/;
const temporaryNamePattern = /^\.[a-f0-9-]+\.tmp$/;
const extensionByMimeType = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

export function detectQqImageMimeType(data) {
  if (!Buffer.isBuffer(data)) return "";
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(data.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (data.length >= 12 && data.subarray(0, 4).toString("ascii") === "RIFF" && data.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  return "";
}

export function normalizeQqMemoryImageId(value) {
  const id = String(value || "").trim().toLowerCase();
  return imageIdPattern.test(id) ? id : "";
}

// Read one regular file that must stay inside rootDir. The allocation is
// bounded even if the file grows while it is being read.
export async function readValidatedQqImageFile(path, rootDir, maxBytes) {
  const realPath = await realpath(path);
  if (!isPathInside(realPath, rootDir)) throw new Error("image outside allowed directory");
  const handle = await open(realPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let data;
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size <= 0 || info.size > maxBytes) throw new Error("invalid image size or type");
    const buffer = Buffer.alloc(info.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== info.size) throw new Error("image changed during inspection");
    data = buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
  const mimeType = detectQqImageMimeType(data);
  if (!mimeType) throw new Error("unsupported image signature");
  return { data, realPath, mimeType };
}

export function createQqMemoryImageStore({ directory, maxBytes = qqMemoryImageMaxBytes } = {}) {
  if (!directory) throw new TypeError("memory image directory is required");
  const defaultMaxBytes = Math.max(1, Math.floor(Number(maxBytes) || qqMemoryImageMaxBytes));

  async function rootDir() {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    return realpath(directory);
  }

  async function locate(id) {
    const imageId = normalizeQqMemoryImageId(id);
    if (!imageId) return null;
    const root = await rootDir();
    for (const extension of Object.values(extensionByMimeType)) {
      const path = join(root, `${imageId}.${extension}`);
      if (await stat(path).then((info) => info.isFile(), () => false)) return { imageId, root, path };
    }
    return null;
  }

  return {
    directory,
    maxBytes: defaultMaxBytes,
    async importBuffer(data, { maxBytes: limit = defaultMaxBytes } = {}) {
      if (!Buffer.isBuffer(data) || data.length <= 0) throw new Error("image is empty");
      if (data.length > Math.min(limit, defaultMaxBytes)) throw new Error("image exceeds memory image budget");
      const mimeType = detectQqImageMimeType(data);
      if (!mimeType) throw new Error("unsupported image signature");
      const id = createHash("sha256").update(data).digest("hex");
      const root = await rootDir();
      const target = join(root, `${id}.${extensionByMimeType[mimeType]}`);
      if (await stat(target).then((info) => info.isFile() && info.size === data.length, () => false)) {
        // A deduplicated import refreshes the age that prune() checks.
        const now = new Date();
        await utimes(target, now, now).catch(() => undefined);
      } else {
        const temporary = join(root, `.${randomUUID()}.tmp`);
        let handle = null;
        try {
          handle = await open(temporary, "wx", 0o600);
          await handle.writeFile(data);
          await handle.sync();
          await handle.close();
          handle = null;
          await rename(temporary, target);
          await syncDirectory(root);
        } finally {
          await handle?.close().catch(() => undefined);
          await unlink(temporary).catch(() => undefined);
        }
      }
      return { id, mimeType, bytes: data.length };
    },
    async importFile(path, { rootDir: allowedRoot, maxBytes: limit = defaultMaxBytes } = {}) {
      if (!allowedRoot) throw new TypeError("rootDir is required to import an image file");
      const safeLimit = Math.min(limit, defaultMaxBytes);
      const { data } = await readValidatedQqImageFile(path, await realpath(allowedRoot), safeLimit);
      return this.importBuffer(data, { maxBytes: safeLimit });
    },
    async read(id) {
      const found = await locate(id);
      if (!found) throw Object.assign(new Error("memory image not found"), { code: "IMAGE_NOT_FOUND" });
      const { data, mimeType } = await readValidatedQqImageFile(found.path, found.root, defaultMaxBytes);
      if (createHash("sha256").update(data).digest("hex") !== found.imageId) throw new Error("memory image hash mismatch");
      return { id: found.imageId, data, mimeType, bytes: data.length };
    },
    async has(id) {
      return Boolean(await locate(id));
    },
    // Copy into a task input directory so the engine's native image reader can
    // open it when tool visual content is not shown.
    async exportToDirectory(id, outputDir) {
      const image = await this.read(id);
      await mkdir(outputDir, { recursive: true });
      const output = join(outputDir, `memory-image-${image.id.slice(0, 16)}-${randomUUID().slice(0, 8)}.${extensionByMimeType[image.mimeType]}`);
      const found = await locate(image.id);
      await copyFile(found.path, output, constants.COPYFILE_EXCL);
      return { ...image, path: output };
    },
    // Remove only files this store created that no record references. Young
    // files may belong to an import whose record has not been saved yet.
    async prune(referencedIds = [], { minAgeMs = 60 * 60 * 1000, now = Date.now() } = {}) {
      const referenced = new Set([...referencedIds].map(normalizeQqMemoryImageId).filter(Boolean));
      const root = await rootDir();
      let removed = 0;
      for (const name of await readdir(root)) {
        const match = name.match(storedNamePattern);
        if (!match && !temporaryNamePattern.test(name)) continue;
        if (match && referenced.has(match[1])) continue;
        const path = join(root, name);
        const info = await stat(path).catch(() => null);
        if (!info?.isFile() || now - info.mtimeMs < minAgeMs) continue;
        if (await unlink(path).then(() => true, () => false)) removed += 1;
      }
      return { removed, referenced: referenced.size };
    }
  };
}
