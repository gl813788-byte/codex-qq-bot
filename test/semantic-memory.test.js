import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createSemanticMemoryIndex } from "../src/unified-memory/semantic-index.js";
import { formatSemanticMemoryPrompt } from "../src/unified-memory/qq-memory-items.js";

test("hybrid semantic memory searches by meaning while enforcing QQ scope", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "qq-semantic-memory-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const index = await createSemanticMemoryIndex({ dbPath: path.join(directory, "memory.sqlite") });
  t.after(() => index.close());
  await index.replaceLayer("short-term", [{
    id: "short:deploy",
    scopeType: "group",
    scopeId: "10001",
    groupId: "10001",
    title: "部署窗口",
    summary: "服务安排在周五晚上上线",
    detail: "维护从晚上十点开始"
  }, {
    id: "short:other-group",
    scopeType: "group",
    scopeId: "20002",
    groupId: "20002",
    title: "部署窗口",
    summary: "另一个群周一上线",
    detail: "不应跨群出现"
  }]);

  const hits = await index.search({
    query: "什么时候部署",
    layers: ["short-term"],
    scope: { groupId: "10001", userIds: [] },
    limit: 5
  });
  assert.deepEqual(hits.map((item) => item.id), ["short:deploy"]);
  assert.equal(hits[0].detail, "维护从晚上十点开始");
});

test("layer replacement removes stale vectors and prompt injects each summary only once", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "qq-semantic-replace-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const index = await createSemanticMemoryIndex({ dbPath: path.join(directory, "memory.sqlite") });
  t.after(() => index.close());
  await index.replaceLayer("impression", [{
    id: "impression:qq:group:10001",
    scopeType: "group",
    scopeId: "10001",
    groupId: "10001",
    title: "测试群",
    summary: "喜欢直接讨论技术方案",
    detail: "这段详细描述不应自动进入提示词"
  }]);
  await index.replaceLayer("impression", [{
    id: "impression:qq:group:10001",
    scopeType: "group",
    scopeId: "10001",
    groupId: "10001",
    title: "测试群",
    summary: "新版简述覆盖旧版",
    detail: "新版完整描述"
  }]);
  const hits = await index.search({
    query: "",
    layers: ["impression"],
    scope: { groupId: "10001", userIds: [] },
    minScore: 0
  });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].summary, "新版简述覆盖旧版");

  const prompt = formatSemanticMemoryPrompt([hits[0], hits[0]]);
  assert.equal(prompt.match(/新版简述覆盖旧版/g)?.length, 1);
  assert.doesNotMatch(prompt, /新版完整描述/);
  assert.match(prompt, /印象详细/);
});

test("local vectors rank Chinese paraphrases, time expressions and preferences", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "qq-semantic-quality-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const index = await createSemanticMemoryIndex({ dbPath: path.join(directory, "memory.sqlite") });
  t.after(() => index.close());
  await index.replaceLayer("knowledge", [{
    id: "knowledge:release",
    scopeType: "group",
    scopeId: "10001",
    groupId: "10001",
    title: "生产发版窗口",
    summary: "新版本定在周五晚上十点上线",
    detail: "运维会先备份，然后逐步更新服务。"
  }, {
    id: "knowledge:meeting",
    scopeType: "group",
    scopeId: "10001",
    groupId: "10001",
    title: "产品例会",
    summary: "周五下午讨论下一阶段需求",
    detail: "参会者准备产品反馈。"
  }, {
    id: "knowledge:voice",
    scopeType: "group",
    scopeId: "10001",
    groupId: "10001",
    title: "小林的联系偏好",
    summary: "小林不喜欢接电话，优先给他发文字消息",
    detail: "非紧急情况不要直接通话。"
  }, {
    id: "knowledge:android",
    scopeType: "group",
    scopeId: "10001",
    groupId: "10001",
    title: "Android 客户端故障",
    summary: "安卓客户端的闪退问题已经修好",
    detail: "升级到新版本后不再崩溃。"
  }]);

  const cases = [
    ["什么时候发布新版本", "knowledge:release"],
    ["周五夜里几点上线", "knowledge:release"],
    ["别给小林打语音", "knowledge:voice"],
    ["安卓崩溃修复了吗", "knowledge:android"]
  ];
  for (const [query, expectedId] of cases) {
    const hits = await index.search({
      query,
      layers: ["knowledge"],
      scope: { groupId: "10001", userIds: [] },
      limit: 4,
      minScore: 0
    });
    assert.equal(hits[0]?.id, expectedId, `${query}: ${hits.map((hit) => `${hit.id}=${hit.score}`).join(", ")}`);
  }
});

test("SQLite rebuilds vectors when the local embedding model changes", async (t) => {
  const sqlite = await import("node:sqlite").catch(() => null);
  if (!sqlite?.DatabaseSync) {
    t.skip("node:sqlite is unavailable on this Node runtime");
    return;
  }
  const directory = await mkdtemp(path.join(tmpdir(), "qq-semantic-migration-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const dbPath = path.join(directory, "memory.sqlite");
  const original = await createSemanticMemoryIndex({ dbPath });
  await original.replaceLayer("knowledge", [{
    id: "knowledge:migrated",
    scopeType: "group",
    scopeId: "10001",
    groupId: "10001",
    title: "部署安排",
    summary: "服务会在周五晚上发布",
    detail: "这是需要重新生成向量的原文。"
  }]);
  original.close();

  const legacy = new sqlite.DatabaseSync(dbPath);
  legacy.prepare("UPDATE semantic_memory_meta SET value = ? WHERE key = ?")
    .run("local-hybrid-ngrams-v2", "embeddingModel");
  legacy.prepare(`
    UPDATE semantic_memory_items
    SET embedding_model = ?, embedding = ?
  `).run("local-hybrid-ngrams-v2", Buffer.alloc(384 * Float32Array.BYTES_PER_ELEMENT));
  legacy.close();

  const migrated = await createSemanticMemoryIndex({ dbPath });
  t.after(() => migrated.close());
  const status = await migrated.status();
  assert.equal(status.dimensions, 1024);
  assert.equal(status.embeddingModel, "local-hybrid-zh-concepts-v3");
  const hits = await migrated.search({
    query: "什么时候上线",
    layers: ["knowledge"],
    scope: { groupId: "10001", userIds: [] }
  });
  assert.equal(hits[0]?.id, "knowledge:migrated");
});
