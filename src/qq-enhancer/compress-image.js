import { randomUUID } from "node:crypto";
import { rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runProcess } from "../process-runner.js";

export async function compressQqImage(data, {
  mimeType, outputDir, maxBytes, maxEdge = 1600, signal, run = runProcess
} = {}) {
  const format = { "image/png": "png", "image/jpeg": "jpeg", "image/gif": "gif", "image/webp": "webp" }[mimeType];
  if (!format) throw new Error("unsupported image signature");
  const id = randomUUID();
  const source = join(outputDir, `compress-source-${id}.${format}`);
  const output = join(outputDir, `compressed-${id}.jpg`);
  await writeFile(source, data, { flag: "wx", mode: 0o600 });
  const env = Object.fromEntries(["PATH", "HOME", "LANG", "LD_LIBRARY_PATH", "PREFIX", "TMPDIR", "ANDROID_ROOT", "ANDROID_DATA"]
    .filter((key) => process.env[key] != null).map((key) => [key, process.env[key]]));
  const memoryMb = Math.max(32, Math.min(128, Math.floor(maxBytes / 1024 / 1024 * 8)));
  try {
    for (const edge of [maxEdge, Math.max(256, Math.floor(maxEdge / 2))]) {
      await run("magick", [
        "-limit", "memory", `${memoryMb}MiB`, "-limit", "map", "0", "-limit", "disk", "0",
        "-limit", "thread", "1", "-limit", "width", "16384", "-limit", "height", "16384",
        `${format}:${source}[0]`, "-auto-orient", "-thumbnail", `${edge}x${edge}>`,
        "-background", "white", "-alpha", "remove", "-strip", "-quality", "80", `jpeg:${output}`
      ], { timeoutMs: 15_000, maxOutputBytes: 64 * 1024, killProcessGroup: true, signal, env });
      const info = await stat(output);
      if (info.isFile() && info.size > 0 && info.size <= maxBytes) return output;
    }
    throw new Error("compressed image exceeds its budget");
  } catch (error) {
    await rm(output, { force: true });
    throw error;
  } finally {
    await rm(source, { force: true });
  }
}
