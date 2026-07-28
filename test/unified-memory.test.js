import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createUnifiedMemory } from "../src/unified-memory/index.js";

test("serializes concurrent unified-memory writes without losing entries", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-memory-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const memoryPath = join(directory, "unified-memory.json");
  const memory = createUnifiedMemory({ memoryPath });

  await Promise.all(Array.from({ length: 10 }, (_, index) => memory.write({
    type: "projectNote",
    source: "test",
    topic: `topic-${index}`,
    summary: `summary-${index}`
  })));

  const snapshot = await memory.read({ limit: 20 });
  assert.equal(snapshot.entries.length, 10);
  assert.deepEqual(
    new Set(snapshot.entries.map((entry) => entry.summary)),
    new Set(Array.from({ length: 10 }, (_, index) => `summary-${index}`))
  );

  const stored = JSON.parse(await readFile(memoryPath, "utf8"));
  assert.equal(stored.entries.length, 10);
});

test("refuses to overwrite malformed unified-memory data", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-memory-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const memoryPath = join(directory, "unified-memory.json");
  await writeFile(memoryPath, "{not-json", "utf8");
  const memory = createUnifiedMemory({ memoryPath });

  await assert.rejects(
    memory.write({ summary: "should not replace corrupted data" }),
    /Unable to read unified memory/
  );
  assert.equal(await readFile(memoryPath, "utf8"), "{not-json");
});

test("upserts promoted QQ people by stable id and scopes them by QQ identity", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-person-memory-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const memoryPath = join(directory, "unified-memory.json");
  const semanticMemoryPath = join(directory, "semantic-memory.sqlite");
  const memory = createUnifiedMemory({ memoryPath, semanticMemoryPath });
  t.after(() => memory.close());

  await memory.writeMany([{
    id: "qq-person-profile:20002",
    type: "personProfile",
    source: "test",
    channel: "qq",
    topic: "小林的人物印象",
    summary: "重视可靠记忆",
    detail: "重视可靠记忆，也会持续检查跨会话检索是否真正工作。",
    subjectChannel: "qq",
    subjectUserId: "20002",
    subjectAliases: ["A群小林", "私聊小林"],
    sourceScopeType: "person",
    sourceScopeId: "member:20002"
  }, {
    id: "global-note",
    type: "projectNote",
    source: "test",
    topic: "项目",
    summary: "只有主人能自动召回的全局项目记忆"
  }]);
  await memory.writeMany([{
    id: "qq-person-profile:20002",
    type: "personProfile",
    source: "test",
    channel: "qq",
    topic: "小林的人物印象",
    summary: "重视可靠记忆和稳定身份",
    detail: "新版完整画像原位覆盖旧画像。",
    subjectChannel: "qq",
    subjectUserId: "20002",
    subjectAliases: ["A群小林", "私聊小林"]
  }]);

  const snapshot = await memory.read({ limit: 10 });
  assert.equal(snapshot.entries.length, 2);
  assert.equal(
    snapshot.entries.find((entry) => entry.id === "qq-person-profile:20002")?.summary,
    "重视可靠记忆和稳定身份"
  );

  const personHits = await memory.semanticSearch({
    query: "",
    layers: ["unified"],
    kinds: ["personProfile"],
    scope: { userIds: ["20002"], includeGlobal: false },
    minScore: 0
  });
  assert.deepEqual(personHits.map((item) => item.id), ["unified:qq-person-profile:20002"]);
  assert.equal(personHits[0].detail, "新版完整画像原位覆盖旧画像。");

  const unrelatedHits = await memory.semanticSearch({
    query: "",
    layers: ["unified"],
    scope: { userIds: ["30003"], includeGlobal: false },
    minScore: 0
  });
  assert.deepEqual(unrelatedHits, []);
});
