import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  materializeCodexGeneratedImageAttachments,
  parseQqAgentOutputWithAttachmentImport
} from "../src/infrastructure/codex/qq-agent-attachments.js";
import { resolveAllowedQqMarkerPath } from "../src/qq-output-policy.js";

const pngBytes = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from("generated-image")
]);

test("imports a current-thread Codex generated image while preserving a valid output file", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codex-qq-agent-attachments-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const generatedImagesDir = join(root, "generated_images");
  const threadDir = join(generatedImagesDir, "thread-1");
  const outputDir = join(root, "task", "output");
  await Promise.all([threadDir, outputDir].map((path) => mkdir(path, { recursive: true })));
  const generatedImage = join(threadDir, "tool-result");
  const outputFile = join(outputDir, "report.txt");
  await Promise.all([
    writeFile(generatedImage, pngBytes),
    writeFile(outputFile, "report")
  ]);

  const parsed = await parseQqAgentOutputWithAttachmentImport(JSON.stringify({
    status: "reply",
    text: "成品好了",
    bubbles: [],
    reply: { mode: "plain", targetUserId: "" },
    attachments: [
      { kind: "image", path: generatedImage, name: "" },
      { kind: "file", path: outputFile, name: "报告.txt" }
    ]
  }), {
    threadId: "thread-1",
    generatedImagesDir,
    outputDir,
    generatedAfterMs: Date.now() - 1000,
    maxImageBytes: 1024
  });

  assert.equal(parsed.importedImageCount, 1);
  assert.equal(parsed.rejectedGeneratedImageCount, 0);
  const importedImage = parsed.value.attachments[0].path;
  assert.notEqual(importedImage, generatedImage);
  assert.equal(importedImage.startsWith(`${outputDir}/`), true);
  assert.equal(importedImage.endsWith(".png"), true);
  assert.match(parsed.output, new RegExp(`\\[\\[qq_image:${escapeRegExp(importedImage)}\\]\\]`));
  assert.match(parsed.output, /\[\[qq_file:.*report\.txt\|报告\.txt\]\]/);

  const policy = { event: { qqTaskWorkspace: { outputDir } }, projectDir: root };
  assert.equal(await resolveAllowedQqMarkerPath(importedImage, { ...policy, kind: "image" }), importedImage);
  assert.equal(await resolveAllowedQqMarkerPath(outputFile, { ...policy, kind: "file" }), outputFile);
});

test("rejects generated images from another thread and symlink escapes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codex-qq-agent-attachments-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const generatedImagesDir = join(root, "generated_images");
  const currentThreadDir = join(generatedImagesDir, "thread-current");
  const otherThreadDir = join(generatedImagesDir, "thread-other");
  const outputDir = join(root, "task", "output");
  const outsideImage = join(root, "outside.png");
  await Promise.all([currentThreadDir, otherThreadDir, outputDir].map((path) => mkdir(path, { recursive: true })));
  const otherThreadImage = join(otherThreadDir, "other.png");
  const escapedImage = join(currentThreadDir, "escape.png");
  const staleImage = join(currentThreadDir, "stale.png");
  await Promise.all([
    writeFile(otherThreadImage, pngBytes),
    writeFile(outsideImage, pngBytes),
    writeFile(staleImage, pngBytes)
  ]);
  await symlink(outsideImage, escapedImage);

  const result = await materializeCodexGeneratedImageAttachments({
    attachments: [
      { kind: "image", path: otherThreadImage, name: "" },
      { kind: "image", path: escapedImage, name: "" },
      { kind: "image", path: staleImage, name: "" }
    ]
  }, {
    threadId: "thread-current",
    generatedImagesDir,
    outputDir,
    generatedAfterMs: Date.now() + 5000,
    maxImageBytes: 1024
  });

  assert.equal(result.changed, false);
  assert.equal(result.importedImageCount, 0);
  assert.equal(result.rejectedGeneratedImageCount, 3);
  assert.deepEqual(await readdir(outputDir), []);
});

test("does not import arbitrary generated files or fake image payloads", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codex-qq-agent-attachments-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const generatedImagesDir = join(root, "generated_images");
  const threadDir = join(generatedImagesDir, "thread-1");
  const outputDir = join(root, "task", "output");
  await Promise.all([threadDir, outputDir].map((path) => mkdir(path, { recursive: true })));
  const generatedFile = join(threadDir, "report.pdf");
  const fakeImage = join(threadDir, "fake.png");
  await Promise.all([
    writeFile(generatedFile, "%PDF-1.7"),
    writeFile(fakeImage, "not an image")
  ]);

  const result = await materializeCodexGeneratedImageAttachments({
    attachments: [
      { kind: "file", path: generatedFile, name: "report.pdf" },
      { kind: "image", path: fakeImage, name: "" }
    ]
  }, {
    threadId: "thread-1",
    generatedImagesDir,
    outputDir,
    maxImageBytes: 1024
  });

  assert.equal(result.changed, false);
  assert.equal(result.importedImageCount, 0);
  assert.equal(result.rejectedGeneratedImageCount, 1);
  assert.equal(result.value.attachments[0].path, generatedFile);
  assert.deepEqual(await readdir(outputDir), []);
  assert.equal(await resolveAllowedQqMarkerPath(generatedFile, {
    kind: "file",
    event: { qqTaskWorkspace: { outputDir } },
    projectDir: root
  }), "");
});

test("recovers the latest valid current-turn image when an explicit image task omits attachments", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codex-qq-agent-attachments-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const generatedImagesDir = join(root, "generated_images");
  const threadDir = join(generatedImagesDir, "thread-current");
  const otherThreadDir = join(generatedImagesDir, "thread-other");
  const outputDir = join(root, "task", "output");
  await Promise.all([threadDir, otherThreadDir, outputDir].map((path) => mkdir(path, { recursive: true })));

  const startedAt = Date.now() - 10_000;
  const baseImage = join(threadDir, "base.png");
  const finalImage = join(threadDir, "final.png");
  const newerFakeImage = join(threadDir, "fake.png");
  const otherThreadImage = join(otherThreadDir, "other.png");
  const finalBytes = Buffer.concat([pngBytes, Buffer.from("-final")]);
  await Promise.all([
    writeFile(baseImage, Buffer.concat([pngBytes, Buffer.from("-base")])),
    writeFile(finalImage, finalBytes),
    writeFile(newerFakeImage, "not an image"),
    writeFile(otherThreadImage, Buffer.concat([pngBytes, Buffer.from("-other")]))
  ]);
  await Promise.all([
    utimes(baseImage, new Date(startedAt + 1_000), new Date(startedAt + 1_000)),
    utimes(finalImage, new Date(startedAt + 2_000), new Date(startedAt + 2_000)),
    utimes(newerFakeImage, new Date(startedAt + 3_000), new Date(startedAt + 3_000)),
    utimes(otherThreadImage, new Date(startedAt + 4_000), new Date(startedAt + 4_000))
  ]);

  const parsed = await parseQqAgentOutputWithAttachmentImport(JSON.stringify({
    status: "reply",
    text: "图片已生成，但本轮文件沙箱异常，无法复制到 QQ 附件输出目录；生成结果已显示在当前任务中。",
    bubbles: [],
    reply: { mode: "plain", targetUserId: "" },
    attachments: []
  }), {
    threadId: "thread-current",
    generatedImagesDir,
    outputDir,
    generatedAfterMs: startedAt,
    maxImageBytes: 1024,
    recoverUnlistedGeneratedImage: true
  });

  assert.equal(parsed.importedImageCount, 1);
  assert.equal(parsed.recoveredUnlistedImageCount, 1);
  assert.equal(parsed.rejectedGeneratedImageCount, 0);
  assert.equal(parsed.value.attachments.length, 1);
  assert.match(parsed.output, /\[\[qq_image:.*codex-generated-1-.*\.png\]\]/);
  assert.doesNotMatch(parsed.output, /沙箱异常|无法复制|显示在当前任务/);
  assert.deepEqual(await readFile(parsed.value.attachments[0].path), finalBytes);
});

test("does not recover unlisted generated images unless explicitly enabled", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codex-qq-agent-attachments-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const generatedImagesDir = join(root, "generated_images");
  const threadDir = join(generatedImagesDir, "thread-1");
  const outputDir = join(root, "task", "output");
  await Promise.all([threadDir, outputDir].map((path) => mkdir(path, { recursive: true })));
  await writeFile(join(threadDir, "unlisted.png"), pngBytes);

  const parsed = await parseQqAgentOutputWithAttachmentImport(JSON.stringify({
    status: "reply",
    text: "普通回复",
    bubbles: [],
    reply: { mode: "plain", targetUserId: "" },
    attachments: []
  }), {
    threadId: "thread-1",
    generatedImagesDir,
    outputDir,
    generatedAfterMs: Date.now() - 1_000,
    maxImageBytes: 1024
  });

  assert.equal(parsed.importedImageCount, 0);
  assert.equal(parsed.recoveredUnlistedImageCount, 0);
  assert.deepEqual(parsed.value.attachments, []);
  assert.deepEqual(await readdir(outputDir), []);
});

test("unlisted-image recovery rejects stale, silent, and thread-directory escape candidates", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "codex-qq-agent-attachments-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const generatedImagesDir = join(root, "generated_images");
  const staleThreadDir = join(generatedImagesDir, "thread-stale");
  const silentThreadDir = join(generatedImagesDir, "thread-silent");
  const outsideThreadDir = join(root, "outside-thread");
  const outputDir = join(root, "task", "output");
  await Promise.all([staleThreadDir, silentThreadDir, outsideThreadDir, outputDir]
    .map((path) => mkdir(path, { recursive: true })));

  const staleImage = join(staleThreadDir, "stale.png");
  await Promise.all([
    writeFile(staleImage, pngBytes),
    writeFile(join(silentThreadDir, "silent.png"), pngBytes),
    writeFile(join(outsideThreadDir, "escape.png"), pngBytes)
  ]);
  await utimes(staleImage, new Date(Date.now() - 60_000), new Date(Date.now() - 60_000));
  await symlink(outsideThreadDir, join(generatedImagesDir, "thread-link"));

  const reply = (status = "reply") => JSON.stringify({
    status,
    text: "",
    bubbles: [],
    reply: { mode: "plain", targetUserId: "" },
    attachments: []
  });
  const common = {
    generatedImagesDir,
    outputDir,
    generatedAfterMs: Date.now() - 1_000,
    maxImageBytes: 1024,
    recoverUnlistedGeneratedImage: true
  };

  const stale = await parseQqAgentOutputWithAttachmentImport(reply(), {
    ...common,
    threadId: "thread-stale"
  });
  const silent = await parseQqAgentOutputWithAttachmentImport(reply("silent"), {
    ...common,
    threadId: "thread-silent"
  });
  const escaped = await parseQqAgentOutputWithAttachmentImport(reply(), {
    ...common,
    threadId: "thread-link"
  });

  assert.equal(stale.recoveredUnlistedImageCount, 0);
  assert.equal(silent.recoveredUnlistedImageCount, 0);
  assert.equal(escaped.recoveredUnlistedImageCount, 0);
  assert.deepEqual(await readdir(outputDir), []);
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
