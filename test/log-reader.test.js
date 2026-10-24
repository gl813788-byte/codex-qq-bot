import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { listLogFiles, readRecentLogEntries } from "../src/log-reader.js";

function line(index, extra = {}) {
  return JSON.stringify({ id: `entry-${index}`, ts: new Date(Date.UTC(2026, 9, 1, 0, 0, index)).toISOString(), level: "debug", ...extra });
}

test("log reader finds sparse matches in the middle of every rotated file", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-log-reader-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "hub.jsonl");
  // Three files of 300 lines each, oldest in .2. One error sits in the middle
  // of each file, far from any tail chunk.
  let index = 0;
  for (const name of ["hub.jsonl.2", "hub.jsonl.1", "hub.jsonl"]) {
    const lines = [];
    for (let row = 0; row < 300; row += 1) {
      lines.push(line(index, row === 150 ? { level: "error", message: `middle of ${name}` } : { message: "noise ".repeat(20) }));
      index += 1;
    }
    await writeFile(join(directory, name), `${lines.join("\n")}\n`, "utf8");
  }

  const errors = await readRecentLogEntries(filePath, {
    limit: 10,
    chunkBytes: 4096,
    match: (entry) => entry.level === "error"
  });
  assert.deepEqual(errors.map((entry) => entry.message), [
    "middle of hub.jsonl.2",
    "middle of hub.jsonl.1",
    "middle of hub.jsonl"
  ]);

  const latest = await readRecentLogEntries(filePath, { limit: 3, chunkBytes: 4096 });
  assert.deepEqual(latest.map((entry) => entry.id), ["entry-897", "entry-898", "entry-899"]);
});

test("log reader keeps lines and multi-byte text intact across chunk boundaries", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-log-reader-utf8-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "hub.jsonl");
  const lines = [];
  for (let index = 0; index < 120; index += 1) lines.push(line(index, { text: `中文消息${index}：${"你好呀".repeat(index % 7 + 1)}` }));
  // No trailing newline: the last line is still read.
  await writeFile(filePath, lines.join("\n"), "utf8");

  const entries = await readRecentLogEntries(filePath, { limit: 500, chunkBytes: 1024 });
  assert.equal(entries.length, 120);
  entries.forEach((entry, index) => {
    assert.equal(entry.id, `entry-${index}`);
    assert.equal(entry.text, `中文消息${index}：${"你好呀".repeat(index % 7 + 1)}`);
  });
});

test("log reader skips malformed lines, duplicate ids and unrelated files", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-log-reader-files-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "hub.jsonl");
  await writeFile(join(directory, "hub.jsonl.1"), `${line(1)}\n${line(2)}\n`, "utf8");
  await writeFile(filePath, `${line(2)}\n{broken\n${line(3)}\n`, "utf8");
  await writeFile(join(directory, "hub.jsonl.bak"), `${line(99)}\n`, "utf8");
  await writeFile(join(directory, "hub.jsonl.10"), `${line(0)}\n`, "utf8");

  assert.deepEqual((await listLogFiles(filePath)).map((file) => file.slice(directory.length + 1)), [
    "hub.jsonl",
    "hub.jsonl.1",
    "hub.jsonl.10"
  ]);
  const entries = await readRecentLogEntries(filePath, { limit: 10 });
  assert.deepEqual(entries.map((entry) => entry.id), ["entry-0", "entry-1", "entry-2", "entry-3"]);
  assert.deepEqual(await readRecentLogEntries(join(directory, "missing", "hub.jsonl")), []);
});
