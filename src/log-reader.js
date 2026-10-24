import { open, readdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

const defaultChunkBytes = 256 * 1024;
const newline = 0x0a;

// Rotated logs are hub.jsonl (newest), hub.jsonl.1, hub.jsonl.2 … Each file is
// read from its end backwards in bounded chunks and filtered before the limit
// applies, so a sparse filter sees the whole retained history instead of only
// the tail of every file. Entries come back oldest first.
export async function readRecentLogEntries(filePath, {
  limit = 100,
  parse = parseJsonLine,
  match = () => true,
  chunkBytes = defaultChunkBytes
} = {}) {
  const maxEntries = Math.max(1, Math.floor(Number(limit) || 100));
  const chunkSize = Math.max(1024, Math.floor(Number(chunkBytes) || defaultChunkBytes));
  const collected = [];
  const seenIds = new Set();
  const visit = (line) => {
    const entry = parse(line);
    if (!entry || !match(entry)) return true;
    // A rotation between listing and reading can show one file twice.
    if (entry.id) {
      if (seenIds.has(entry.id)) return true;
      seenIds.add(entry.id);
    }
    collected.push(entry);
    return collected.length < maxEntries;
  };
  for (const file of await listLogFiles(filePath)) {
    if (!await scanFileBackward(file, visit, chunkSize)) break;
  }
  return collected.reverse();
}

export async function listLogFiles(filePath) {
  const directory = dirname(filePath);
  const base = basename(filePath);
  const names = await readdir(directory).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  return names
    .map((name) => ({ name, index: rotationIndex(name, base) }))
    .filter((item) => item.index != null)
    .sort((left, right) => left.index - right.index)
    .map((item) => join(directory, item.name));
}

function rotationIndex(name, base) {
  if (name === base) return 0;
  if (!name.startsWith(`${base}.`)) return null;
  const suffix = name.slice(base.length + 1);
  return /^[1-9][0-9]{0,5}$/.test(suffix) ? Number(suffix) : null;
}

// Returns false when the visitor asked to stop.
async function scanFileBackward(file, visit, chunkSize) {
  const handle = await open(file, "r").catch(() => null);
  if (!handle) return true;
  try {
    const { size } = await handle.stat();
    let position = size;
    let carry = Buffer.alloc(0);
    while (position > 0) {
      const readSize = Math.min(chunkSize, position);
      position -= readSize;
      const chunk = Buffer.alloc(readSize);
      const { bytesRead } = await handle.read(chunk, 0, readSize, position);
      const data = carry.length > 0
        ? Buffer.concat([chunk.subarray(0, bytesRead), carry])
        : chunk.subarray(0, bytesRead);
      // 0x0a never occurs inside a UTF-8 multi-byte sequence, so byte splits
      // are safe. The bytes before the first newline may continue in the
      // previous chunk and are carried over.
      let end = data.length;
      let index = end > 0 ? data.lastIndexOf(newline, end - 1) : -1;
      while (index >= 0) {
        if (end > index + 1 && !visit(data.toString("utf8", index + 1, end))) return false;
        end = index;
        index = end > 0 ? data.lastIndexOf(newline, end - 1) : -1;
      }
      carry = Buffer.from(data.subarray(0, end));
    }
    if (carry.length > 0 && !visit(carry.toString("utf8"))) return false;
    return true;
  } finally {
    await handle.close().catch(() => null);
  }
}

function parseJsonLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
