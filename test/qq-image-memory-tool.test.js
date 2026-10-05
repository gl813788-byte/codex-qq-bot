import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeQqImageMemoryTool } from "../src/app/qq-image-memory-tool.js";
import { collectQqImageMemoryCandidates } from "../src/qq-enhancer/context-images.js";
import { prepareQqModelImages } from "../src/qq-enhancer/index.js";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "qq-image-memory-"));
  const inputDir = join(root, "input");
  await mkdir(inputDir);
  const candidates = collectQqImageMemoryCandidates([], { scopeId: "group", event: { images: [{ file: "photo.png", url: `data:image/png;base64,${png}` }] } });
  return { taskWorkspace: { root, inputDir }, candidates };
}

test("selected prior image is downloaded to the active workspace and returned as actual visual input", async () => {
  const context = await fixture();
  let downloads = 0;
  const prepareImage = async (image, options) => {
    downloads += 1;
    return (await prepareQqModelImages([image], options))[0];
  };
  const listed = await executeQqImageMemoryTool({ action: "list" }, { ...context, prepareImage });
  assert.equal(listed.ok, true);
  assert.equal(downloads, 0);
  const result = await executeQqImageMemoryTool({ action: "inspect", selector: context.candidates[0].selector }, { ...context, prepareImage });
  assert.equal(result.ok, true);
  assert.equal(downloads, 1);
  assert.deepEqual(result.contentItems[1], { type: "inputImage", imageUrl: `data:image/png;base64,${png}` });
  assert.match(result.contentItems[0].text, /视觉输入重新识别/);
});

test("unknown, expired, and other-scope selectors cannot initiate downloads", async () => {
  const context = await fixture();
  const prepareImage = async () => { assert.fail("must not download"); };
  const other = collectQqImageMemoryCandidates([], { scopeId: "other", event: { images: [context.candidates[0].image] } });
  for (const selector of ["/etc/passwd", "https://example.test/x.png", other[0].selector]) {
    assert.equal((await executeQqImageMemoryTool({ action: "inspect", selector }, { ...context, prepareImage })).ok, false);
  }
  assert.equal((await executeQqImageMemoryTool({ action: "inspect", selector: context.candidates[0].selector }, { ...context, candidates: [], prepareImage })).ok, false);
});

test("image inspection rejects escaped paths, symlinks, non-images, oversized files and failed downloads", async () => {
  const context = await fixture();
  const outside = join(context.taskWorkspace.root, "outside.png");
  const inside = join(context.taskWorkspace.inputDir, "bad.png");
  const link = join(context.taskWorkspace.inputDir, "link.png");
  await writeFile(outside, Buffer.from(png, "base64"));
  await writeFile(inside, "not an image");
  await symlink(outside, link);
  const args = { action: "inspect", selector: context.candidates[0].selector };
  for (const path of [outside, inside, link, context.taskWorkspace.inputDir]) {
    const result = await executeQqImageMemoryTool(args, { ...context, prepareImage: async () => path });
    assert.equal(result.ok, false);
    assert.equal(result.contentItems, undefined);
  }
  await writeFile(inside, Buffer.from(png, "base64"));
  assert.equal((await executeQqImageMemoryTool(args, { ...context, maxBytes: 10, prepareImage: async () => inside })).ok, false);
  assert.equal((await executeQqImageMemoryTool(args, { ...context, prepareImage: async () => { throw new Error("secret URL"); } })).ok, false);
});

test("a cancelled reply cannot deliver a downloaded image", async () => {
  const context = await fixture();
  let active = true;
  await assert.rejects(executeQqImageMemoryTool({ action: "inspect", selector: context.candidates[0].selector }, {
    ...context,
    prepareImage: async () => { active = false; return "unused"; },
    assertActive: () => { if (!active) throw new Error("cancelled"); }
  }), /cancelled/);
});
