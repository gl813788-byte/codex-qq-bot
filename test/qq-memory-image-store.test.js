import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createQqMemoryImageStore,
  detectQqImageMimeType,
  normalizeQqMemoryImageId
} from "../src/qq-memory-image-store.js";

const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("png-body")]);
const jpeg = Buffer.concat([Buffer.from([255, 216, 255, 224]), Buffer.from("jpeg-body")]);

async function createStore() {
  const root = await mkdtemp(join(tmpdir(), "qq-memory-images-"));
  return { root, directory: join(root, "store"), store: createQqMemoryImageStore({ directory: join(root, "store") }) };
}

test("memory images are content addressed and revalidated on read", async () => {
  const { directory, store } = await createStore();
  const first = await store.importBuffer(png);
  const second = await store.importBuffer(Buffer.from(png));
  assert.equal(first.id, second.id);
  assert.equal(first.mimeType, "image/png");
  assert.equal(first.bytes, png.length);
  assert.deepEqual(await readdir(directory), [`${first.id}.png`]);
  assert.deepEqual((await store.read(first.id)).data, png);
  assert.equal(await store.has(first.id.toUpperCase()), true);

  await assert.rejects(store.importBuffer(Buffer.from("not an image")), /signature/);
  await assert.rejects(store.importBuffer(png, { maxBytes: 4 }), /budget/);
  await assert.rejects(store.read("../../etc/passwd"), /not found/);
  assert.equal(normalizeQqMemoryImageId("../x"), "");
  assert.equal(detectQqImageMimeType(jpeg), "image/jpeg");

  // A file swapped on disk no longer matches its content address.
  await writeFile(join(directory, `${first.id}.png`), jpeg);
  await assert.rejects(store.read(first.id), /hash mismatch/);
});

test("memory image file imports stay inside the allowed root", async () => {
  const { root, store } = await createStore();
  const inputDir = join(root, "task", "input");
  await mkdir(inputDir, { recursive: true });
  await writeFile(join(inputDir, "ok.png"), png);
  await writeFile(join(root, "outside.png"), png);
  await symlink(join(root, "outside.png"), join(inputDir, "link.png"));

  const imported = await store.importFile(join(inputDir, "ok.png"), { rootDir: inputDir });
  assert.equal(imported.mimeType, "image/png");
  await assert.rejects(store.importFile(join(root, "outside.png"), { rootDir: inputDir }), /outside/);
  await assert.rejects(store.importFile(join(inputDir, "link.png"), { rootDir: inputDir }), /outside/);
  await assert.rejects(store.importFile(join(inputDir, "ok.png")), /rootDir/);

  const exported = await store.exportToDirectory(imported.id, join(root, "task", "input"));
  assert.match(exported.path, /memory-image-[a-f0-9]{16}-[a-f0-9]{8}\.png$/);
  assert.deepEqual(exported.data, png);
});

test("pruning removes only old, unreferenced files created by the store", async () => {
  const { directory, store } = await createStore();
  const kept = await store.importBuffer(png);
  const removed = await store.importBuffer(jpeg);
  await writeFile(join(directory, "notes.txt"), "keep");
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  for (const name of await readdir(directory)) await utimes(join(directory, name), old, old);

  const young = await store.importBuffer(Buffer.concat([png, Buffer.from("young")]));
  const result = await store.prune([kept.id]);
  assert.equal(result.removed, 1);
  const names = await readdir(directory);
  assert.ok(names.includes(`${kept.id}.png`));
  assert.ok(names.includes(`${young.id}.png`));
  assert.ok(names.includes("notes.txt"));
  assert.equal(names.includes(`${removed.id}.jpg`), false);
});
