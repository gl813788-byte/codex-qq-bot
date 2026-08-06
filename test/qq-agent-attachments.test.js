import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, symlink, writeFile } from "node:fs/promises";
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
