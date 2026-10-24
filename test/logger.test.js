import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLogChangeGate, createLogger, normalizeEntry, readLogEntries, summarizeLogEntries } from "../src/logger.js";
import { writeFile } from "node:fs/promises";

test("logger stores detailed debug entries by default and still supports an explicit higher threshold", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-logger-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "hub.jsonl");
  const logger = createLogger({ filePath, consoleOutput: false });

  logger.debug("debug detail", { text: "visible by default" });
  logger.info("useful lifecycle event");
  logger.success("completed", { durationMs: 12 });
  await logger.flush();

  const entries = await readLogEntries(filePath, { limit: 10 });
  assert.deepEqual(entries.map((entry) => entry.message), ["debug detail", "useful lifecycle event", "completed"]);

  const infoFile = join(directory, "info.jsonl");
  const infoLogger = createLogger({ filePath: infoFile, minLevel: "info", consoleOutput: false });
  infoLogger.debug("filtered debug detail");
  infoLogger.info("info detail");
  await infoLogger.flush();
  assert.deepEqual((await readLogEntries(infoFile, { limit: 10 })).map((entry) => entry.message), ["info detail"]);
});

test("logger serializes concurrent writes and preserves status booleans while redacting secrets", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-logger-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "hub.jsonl");
  const logger = createLogger({ filePath, consoleOutput: false, maxBytes: 1024 * 1024 });

  await Promise.all(Array.from({ length: 100 }, (_, index) => logger.info(`entry-${index}`)));
  await logger.flush();
  const lines = (await readFile(filePath, "utf8")).trim().split("\n");
  assert.equal(lines.length, 100);
  assert.doesNotThrow(() => lines.forEach((line) => JSON.parse(line)));

  const normalized = normalizeEntry({
    details: {
      judgeApiKeyConfigured: true,
      apiKey: "secret-value",
      imageUrl: "https://example.test/image?rkey=signed-value&name=test",
      error: new Error("request failed: https://example.test/?token=signed-value")
    }
  });
  assert.equal(normalized.details.judgeApiKeyConfigured, true);
  assert.equal(normalized.details.apiKey, "[redacted]");
  assert.match(normalized.details.imageUrl, /rkey=\[redacted\]/);
  assert.match(normalized.details.error.message, /token=\[redacted\]/);

  const networkCause = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:3000"), {
    code: "ECONNREFUSED",
    address: "127.0.0.1",
    port: 3000
  });
  const fetchError = new TypeError("fetch failed", { cause: networkCause });
  const normalizedCause = normalizeEntry({ details: { error: fetchError } });
  assert.equal(normalizedCause.details.error.cause.code, "ECONNREFUSED");
  assert.equal(normalizedCause.details.error.cause.address, "127.0.0.1");
  assert.equal(normalizedCause.details.error.cause.port, 3000);
});

test("logger bounds its pending write backlog", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const persisted = [];
  const logger = createLogger({
    filePath: "/unused/hub.jsonl",
    consoleOutput: false,
    maxPendingWrites: 2,
    appendLine: async (_path, line) => {
      await gate;
      persisted.push(line);
    }
  });

  for (let index = 0; index < 10; index += 1) logger.info(`queued-${index}`);
  assert.deepEqual(logger.snapshot(), { pendingWrites: 2, maxPendingWrites: 2, droppedWrites: 8 });
  release();
  await logger.flush();
  assert.equal(persisted.length, 2);
  assert.equal(logger.snapshot().pendingWrites, 0);
});

test("logger rotates concurrent writes without corrupting retained JSONL files", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-logger-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "hub.jsonl");
  const logger = createLogger({ filePath, consoleOutput: false, maxBytes: 256, maxFiles: 3 });

  await Promise.all(Array.from({ length: 40 }, (_, index) => logger.info(`rotating-entry-${index}`, {
    payload: "x".repeat(96)
  })));
  await logger.flush();

  const files = (await readdir(directory)).filter((name) => name.startsWith("hub.jsonl"));
  assert.ok(files.length >= 2);
  for (const name of files) {
    const lines = (await readFile(join(directory, name), "utf8")).trim().split("\n").filter(Boolean);
    assert.doesNotThrow(() => lines.forEach((line) => JSON.parse(line)));
  }
});

test("logger correlates child entries and supports diagnostic filters and summaries", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-logger-trace-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "hub.jsonl");
  const logger = createLogger({ filePath, consoleOutput: false });
  const traced = logger.child({
    traceId: "trace-qq-123456",
    spanId: "reply-span",
    details: { groupId: "10001" }
  });

  traced.debug("QQ reply lifecycle started", { senderId: "20002", durationMs: 12 }, "lifecycle");
  traced.success("QQ reply lifecycle completed", {
    senderId: "20002",
    outcome: "sent",
    totalDurationMs: 2400
  }, "lifecycle");
  logger.warn("unrelated warning", { groupId: "99999", durationMs: 50 }, "system", { traceId: "other-trace" });
  await logger.flush();

  const tracedEntries = await readLogEntries(filePath, { traceId: "trace-qq", groupId: "10001" });
  assert.equal(tracedEntries.length, 2);
  assert.ok(tracedEntries.every((entry) => entry.schemaVersion === 3 && entry.id));
  assert.ok(tracedEntries.every((entry) => entry.spanId === "reply-span"));

  const slow = await readLogEntries(filePath, {
    query: "sent",
    senderId: "20002",
    minDurationMs: 1000
  });
  assert.deepEqual(slow.map((entry) => entry.message), ["QQ reply lifecycle completed"]);
  assert.deepEqual(summarizeLogEntries(tracedEntries), {
    total: 2,
    byLevel: { debug: 1, success: 1 },
    byCategory: { lifecycle: 2 },
    byEngine: {},
    byOperation: {},
    byOutcome: { sent: 1 },
    traceCount: 1,
    firstAt: tracedEntries[0].ts,
    lastAt: tracedEntries[1].ts,
    duration: { sampleCount: 2, p50Ms: 12, p95Ms: 2400, maxMs: 2400 }
  });
});

test("log reads filter the whole retained history, not the tail of each file", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-logger-history-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "hub.jsonl");
  const noise = (index) => JSON.stringify({ ts: new Date(Date.UTC(2026, 9, 2, 0, 0, index)).toISOString(), level: "debug", category: "memory", message: "noise", details: { pad: "x".repeat(400) } });
  const older = [JSON.stringify({ ts: "2026-10-01T00:00:00.000Z", level: "success", category: "agent", message: "older agent turn", details: {} })];
  for (let index = 0; index < 3000; index += 1) older.push(noise(index));
  await writeFile(`${filePath}.1`, `${older.join("\n")}\n`, "utf8");
  await writeFile(filePath, `${Array.from({ length: 50 }, (_, index) => noise(4000 + index)).join("\n")}\n`, "utf8");

  const entries = await readLogEntries(filePath, { limit: 5, category: "agent" });
  assert.deepEqual(entries.map((entry) => entry.message), ["older agent turn"]);
  const visible = await readLogEntries(filePath, { limit: 1, match: (entry) => entry.level !== "debug" });
  assert.deepEqual(visible.map((entry) => entry.message), ["older agent turn"]);
});

test("log change gate logs repeating events only when their signature changes", () => {
  const gate = createLogChangeGate({ maxKeys: 2 });
  assert.equal(gate.changed("short-term", "synchronized:0"), true);
  assert.equal(gate.changed("short-term", "synchronized:0"), false);
  assert.equal(gate.changed("short-term", "synchronized:1"), true);
  gate.forget("short-term");
  assert.equal(gate.changed("short-term", "synchronized:1"), true);
  gate.changed("knowledge", "a");
  gate.changed("impression", "b");
  // The oldest key is evicted beyond maxKeys and logs again.
  assert.equal(gate.changed("short-term", "synchronized:1"), true);
});

test("URL redaction is idempotent and keeps the closing bracket of a CQ code", () => {
  const text = "[CQ:image,file=a.jpg,url=https://x.test/a?appid=1&rkey=SIGNED] 好";
  const once = normalizeEntry({ details: { text } }).details.text;
  assert.equal(once, "[CQ:image,file=a.jpg,url=https://x.test/a?appid=1&rkey=[redacted]] 好");
  assert.equal(normalizeEntry({ details: { text: once } }).details.text, once);
});
