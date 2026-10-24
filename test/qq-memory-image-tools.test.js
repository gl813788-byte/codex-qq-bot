import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { executeQqAvatarMemoryTool } from "../src/app/qq-avatar-memory-tool.js";
import { executeQqKnowledgeImageTool } from "../src/app/qq-knowledge-image-tool.js";
import { applyQqAvatarFetchResult } from "../src/qq-avatar-memory.js";
import {
  applyQqKnowledgeImageChange,
  applyQqKnowledgePatches,
  findQqKnowledgeVariants,
  formatQqKnowledgeEntries,
  listQqKnowledgeEntries,
  listQqKnowledgeImageIds,
  normalizeQqKnowledgeBase,
  parseQqKnowledgeRange
} from "../src/qq-knowledge-base.js";
import {
  applyDashboardKnowledgeImageMutation,
  applyDashboardKnowledgeMutation,
  DashboardKnowledgeConflictError,
  parseDashboardKnowledgeImageUpload
} from "../src/dashboard-knowledge-base.js";
import { createQqMemoryImageStore } from "../src/qq-memory-image-store.js";

const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("png-body")]);
const pngData = (suffix) => Buffer.concat([png, Buffer.from(String(suffix))]);

async function createWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "qq-memory-tools-"));
  const taskWorkspace = { root: join(root, "task"), inputDir: join(root, "task", "input") };
  await mkdir(taskWorkspace.inputDir, { recursive: true });
  return { root, taskWorkspace, imageStore: createQqMemoryImageStore({ directory: join(root, "images") }) };
}

function createKnowledgeStore() {
  return applyQqKnowledgePatches(normalizeQqKnowledgeBase({}), [{
    kind: "slang", title: "猫猫拳", aliases: ["猫拳"], content: "群里用来表示撒娇式抗议", scopeType: "group"
  }], { groupId: "20001", groupName: "测试群", senderId: "10001", senderName: "Alice" }, { at: Date.parse("2026-10-24T00:00:00.000Z") }).store;
}

test("the avatar tool only records features for an avatar inspected in the same turn", async () => {
  const { taskWorkspace, imageStore } = await createWorkspace();
  const stored = await imageStore.importBuffer(png);
  const avatar = applyQqAvatarFetchResult(null, { imageId: stored.id, mimeType: stored.mimeType, bytes: stored.bytes }).record;
  const candidates = [{ userId: "10001", displayName: "Alice", role: "当前发送者", aliases: [], avatar }];
  const recorded = [];
  const inspected = new Map();
  const options = {
    candidates, imageStore, taskWorkspace, inspected,
    recordFeatures: async (input) => { recorded.push(input); return { ok: true }; }
  };

  assert.match((await executeQqAvatarMemoryTool({ action: "record", userId: "10001", summary: "银发猫耳少女" }, options)).error, /先在本轮/);
  assert.match((await executeQqAvatarMemoryTool({ action: "inspect", userId: "99999" }, options)).error, /不在当前会话/);
  const inspection = await executeQqAvatarMemoryTool({ action: "inspect", userId: "10001" }, options);
  assert.equal(inspection.ok, true);
  assert.equal(inspection.contentItems[1].imageUrl, `data:image/png;base64,${png.toString("base64")}`);
  assert.match(inspection.reply, /还没有文字特征/);
  assert.equal(inspected.get("10001"), stored.id);

  const result = await executeQqAvatarMemoryTool({ action: "record", userId: "10001", summary: "银发猫耳少女", detail: "蓝瞳" }, options);
  assert.equal(result.ok, true);
  assert.deepEqual(recorded, [{ userId: "10001", imageId: stored.id, summary: "银发猫耳少女", detail: "蓝瞳" }]);
  assert.match((await executeQqAvatarMemoryTool({ action: "search", query: "" }, options)).error, /query/);
});

test("the avatar tool downloads a missing avatar before showing it", async () => {
  const { taskWorkspace, imageStore } = await createWorkspace();
  const stored = await imageStore.importBuffer(png);
  const fetched = [];
  const result = await executeQqAvatarMemoryTool({ action: "inspect", userId: "10001" }, {
    candidates: [{ userId: "10001", displayName: "Alice", role: "被@", aliases: [], avatar: applyQqAvatarFetchResult(null, { imageId: stored.id, bytes: 1 }).record }],
    imageStore,
    taskWorkspace,
    now: Date.now() + 30 * 24 * 60 * 60 * 1000,
    ensureAvatar: async (userId) => {
      fetched.push(userId);
      return applyQqAvatarFetchResult(null, { imageId: stored.id, mimeType: "image/png", bytes: stored.bytes }).record;
    }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(fetched, ["10001"]);
  const unavailable = await executeQqAvatarMemoryTool({ action: "inspect", userId: "10002" }, {
    candidates: [{ userId: "10002", displayName: "Bob", role: "被@", aliases: [], avatar: { imageId: "" } }],
    imageStore,
    taskWorkspace,
    ensureAvatar: async () => null
  });
  assert.match(unavailable.error, /暂时无法获取/);
});

test("knowledge variants keep their pictures across text updates and reloads", () => {
  let store = createKnowledgeStore();
  const [{ entry, variant }] = findQqKnowledgeVariants(store, { title: "猫拳", range: { type: "all" } });
  const imageA = { id: "a".repeat(64), mimeType: "image/png", bytes: 10 };
  const imageB = { id: "b".repeat(64), mimeType: "image/jpeg", bytes: 11 };
  const change = (input) => applyQqKnowledgeImageChange(store, { entryId: entry.id, variantId: variant.id, ...input });

  let result = change({ action: "attach", image: imageA, caption: "原梗图" });
  assert.equal(result.changed, true);
  store = result.store;
  assert.equal(change({ action: "attach", image: imageA }).reason, "duplicate_image");
  assert.equal(change({ action: "remove", imageId: "abc" }).reason, "image_not_found");

  store = applyQqKnowledgePatches(store, [{ kind: "slang", title: "猫猫拳", content: "撒娇式抗议，常配猫爪表情", scopeType: "group" }],
    { groupId: "20001", senderId: "10001" }).store;
  store = normalizeQqKnowledgeBase(JSON.parse(JSON.stringify(store)));
  assert.deepEqual(listQqKnowledgeImageIds(store), [imageA.id]);
  assert.match(formatQqKnowledgeEntries(listQqKnowledgeEntries(store, { range: { type: "all" } })), /附图 1 张：#aaaaaaaaaaaa 原梗图/);

  result = change({ action: "replace", imageId: "#aaaaaaaa", image: imageB });
  assert.equal(result.image.caption, "原梗图");
  assert.equal(result.removedImage.id, imageA.id);
  store = result.store;
  store = change({ action: "caption", imageId: imageB.id, caption: "新说明" }).store;
  assert.equal(findQqKnowledgeVariants(store, { title: "猫猫拳" })[0].variant.images[0].caption, "新说明");
  store = change({ action: "remove", imageId: imageB.id }).store;
  assert.deepEqual(listQqKnowledgeImageIds(store), []);

  for (const suffix of "cdef") store = change({ action: "attach", image: { id: suffix.repeat(64), mimeType: "image/png", bytes: 1 } }).store;
  assert.equal(change({ action: "attach", image: { id: "9".repeat(64), mimeType: "image/png", bytes: 1 } }).reason, "image_limit");
});

test("dashboard knowledge image mutations validate uploads and references", () => {
  const store = createKnowledgeStore();
  const [{ entry, variant }] = findQqKnowledgeVariants(store, { title: "猫猫拳" });
  const data = parseDashboardKnowledgeImageUpload(`data:image/png;base64,${png.toString("base64")}`);
  assert.deepEqual(data, png);
  assert.throws(() => parseDashboardKnowledgeImageUpload(`data:image/png;base64,${Buffer.from("text").toString("base64")}`), /supported picture/);
  assert.throws(() => parseDashboardKnowledgeImageUpload("data:text/html;base64,PGI+"), /data URL/);
  assert.throws(() => parseDashboardKnowledgeImageUpload(`data:image/png;base64,${png.toString("base64")}`, { maxBytes: 4 }), /too large/);

  const image = { id: "c".repeat(64), mimeType: "image/png", bytes: png.length };
  const attached = applyDashboardKnowledgeImageMutation(store, { action: "attach-image", entryId: entry.id, variantId: variant.id, caption: "梗图" }, { image });
  assert.equal(attached.variant.images[0].source, "dashboard");
  assert.throws(() => applyDashboardKnowledgeImageMutation(attached.store, { action: "attach-image", entryId: entry.id, variantId: variant.id }), /uploaded image/);
  assert.throws(() => applyDashboardKnowledgeImageMutation(attached.store, { action: "remove-image", entryId: entry.id, variantId: variant.id, imageId: "d".repeat(64) }), DashboardKnowledgeConflictError);
  const captioned = applyDashboardKnowledgeImageMutation(attached.store, { action: "caption-image", entryId: entry.id, variantId: variant.id, imageId: image.id, caption: "新说明" });
  assert.equal(captioned.image.caption, "新说明");

  // Editing the text from the dashboard leaves the pictures attached.
  const edited = applyDashboardKnowledgeMutation(captioned.store, { action: "upsert", entryId: entry.id, variantId: variant.id, content: "更新后的解释" });
  assert.equal(edited.variant.images.length, 1);
});

test("the knowledge image tool writes only inside the writable scope", async () => {
  const { taskWorkspace, imageStore } = await createWorkspace();
  let store = createKnowledgeStore();
  const commits = [];
  const event = { groupId: "20001", senderId: "10001" };
  const context = { groupId: event.groupId, senderId: event.senderId };
  const options = {
    getStore: () => store,
    resolveReadRange: (scope) => ({ ok: true, value: parseQqKnowledgeRange(scope || "当前", context), label: "当前范围" }),
    resolveWriteRange: (scope) => {
      const range = parseQqKnowledgeRange(scope || "当前", context, { forWrite: true });
      return range ? { ok: true, value: range, label: "当前范围" } : { ok: false, reply: "范围无效" };
    },
    writeScopeType: (range) => range.type === "current" ? "group" : range.type,
    imageCandidates: [{ selector: "image-1", image: { file: "a.png" } }],
    prepareImage: async (_image, { outputDir }) => {
      const path = join(outputDir, "prepared.png");
      await writeFile(path, pngData("attached"));
      return path;
    },
    imageStore,
    taskWorkspace,
    maxBytes: 1024 * 1024,
    commit: async (next, change) => { store = next; commits.push(change.action); }
  };

  assert.match((await executeQqKnowledgeImageTool({ action: "attach", title: "不存在", selector: "image-1" }, options)).error, /没有知识标题/);
  assert.match((await executeQqKnowledgeImageTool({ action: "attach", title: "猫猫拳", selector: "image-9" }, options)).error, /selector/);
  assert.match((await executeQqKnowledgeImageTool({ action: "attach", title: "猫猫拳", selector: "image-1", scope: "群:30003" }, options)).error, /范围无效/);
  const attached = await executeQqKnowledgeImageTool({ action: "attach", title: "猫拳", selector: "image-1", caption: "原梗图" }, options);
  assert.equal(attached.ok, true, attached.error);
  assert.deepEqual(commits, ["attach"]);
  const [imageId] = listQqKnowledgeImageIds(store);
  assert.equal(await imageStore.has(imageId), true);

  const inspection = await executeQqKnowledgeImageTool({ action: "inspect", title: "猫猫拳" }, options);
  assert.equal(inspection.ok, true);
  assert.equal(inspection.contentItems.filter((item) => item.type === "inputImage").length, 1);
  assert.match(inspection.reply, /原梗图/);

  const removed = await executeQqKnowledgeImageTool({ action: "remove", title: "猫猫拳", imageId: imageId.slice(0, 10) }, options);
  assert.equal(removed.ok, true);
  assert.deepEqual(listQqKnowledgeImageIds(store), []);
});
