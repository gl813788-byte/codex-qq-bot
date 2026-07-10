import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLogger, normalizeEntry, readLogEntries } from "../src/logger.js";

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
