import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSettingsRepository } from "../src/infrastructure/storage/settings-repository.js";

test("settings repository atomically round-trips snapshots and treats absence as empty", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-settings-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "nested", "settings.json");
  const repository = createSettingsRepository({ filePath });
  assert.equal(await repository.load(), null);

  const snapshot = { version: 2, ai: { personality: "pragmatic" } };
  await repository.save(snapshot);
  assert.deepEqual(await repository.load(), snapshot);
  assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), snapshot);
});

test("settings repository rejects invalid roots", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-settings-invalid-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const repository = createSettingsRepository({ filePath: join(directory, "settings.json") });
  await assert.rejects(repository.save([]), /snapshot must be an object/);
});
