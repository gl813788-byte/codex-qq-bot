import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { prepareQqModelImages } from "../src/qq-enhancer/index.js";
import { compressQqImage } from "../src/qq-enhancer/compress-image.js";
import { executeQqImageMemoryTool } from "../src/app/qq-image-memory-tool.js";
import { collectQqImageMemoryCandidates } from "../src/qq-enhancer/context-images.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const imageUrl = `data:image/png;base64,${png.toString("base64")}`;

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "qq-images-"));
  const inputDir = join(root, "input");
  await mkdir(inputDir);
  t.after(() => rm(root, { recursive: true, force: true }));
  const candidates = collectQqImageMemoryCandidates([], {
    scopeId: "group", event: { images: [{ file: "account-sticker.jpg", url: imageUrl }] }
  });
  return { taskWorkspace: { root, inputDir }, candidates };
}

test("image recall lists without downloading and reads a sticker through its fallback URL", async (t) => {
  const context = await fixture(t);
  let downloads = 0;
  let lookups = 0;
  const prepareImage = async (image, options) => {
    downloads++;
    return (await prepareQqModelImages([image], { ...options,
      fetchOneBotImage: async () => { lookups++; throw new Error("display filename is not resolvable"); }
    }))[0];
  };
  assert.equal((await executeQqImageMemoryTool({ action: "list" }, { ...context, prepareImage })).ok, true);
  assert.equal(downloads, 0);
  const result = await executeQqImageMemoryTool({ action: "inspect", selector: context.candidates[0].selector }, { ...context, prepareImage });
  assert.equal(result.ok, true);
  assert.equal(downloads, 1);
  assert.equal(lookups, 1);
  assert.deepEqual(result.contentItems[1], { type: "inputImage", imageUrl });
});

test("oversized local images are rejected before copying", async (t) => {
  const { taskWorkspace: { root, inputDir } } = await fixture(t);
  const source = join(root, "oversized.png");
  await writeFile(source, png);
  await truncate(source, 20 * 1024 * 1024 + 1);
  assert.deepEqual(await prepareQqModelImages([{ file: source }], { outputDir: inputDir }), []);
  assert.deepEqual(await readdir(inputDir), []);
});

test("compression fits its budget and cleans temporary files on success and failure", async (t) => {
  const { taskWorkspace: { inputDir } } = await fixture(t);
  let attempts = 0;
  const output = await compressQqImage(png, { mimeType: "image/png", outputDir: inputDir, maxBytes: 100,
    run: async (_command, args, options) => {
      attempts++;
      assert.equal(options.killProcessGroup, true);
      assert.ok(options.timeoutMs <= 15_000);
      assert.equal("OPENAI_API_KEY" in options.env, false);
      assert.deepEqual(await readFile(args.find((arg) => arg.startsWith("png:")).slice(4, -3)), png);
      await writeFile(args.at(-1).slice(5), Buffer.alloc(attempts === 1 ? 101 : 90));
    }
  });
  assert.equal(attempts, 2);
  assert.equal((await readFile(output)).length, 90);
  await assert.rejects(compressQqImage(png, { mimeType: "image/png", outputDir: inputDir, maxBytes: 100,
    run: async (_command, args) => { await writeFile(args.at(-1).slice(5), "partial"); throw new Error("decoder failed"); }
  }), /decoder failed/);
  assert.deepEqual(await readdir(inputDir), [basename(output)]);
});

test("unknown, expired and other-scope image selectors cannot initiate downloads", async (t) => {
  const context = await fixture(t);
  let downloads = 0;
  const prepareImage = async () => { downloads++; return "unused"; };
  const other = collectQqImageMemoryCandidates([], { scopeId: "other", event: { images: [context.candidates[0].image] } });
  for (const selector of ["/etc/passwd", "https://example.test/x.png", other[0].selector]) {
    assert.equal((await executeQqImageMemoryTool({ action: "inspect", selector }, { ...context, prepareImage })).ok, false);
  }
  assert.equal((await executeQqImageMemoryTool({ action: "inspect", selector: context.candidates[0].selector }, { ...context, candidates: [], prepareImage })).ok, false);
  assert.equal(downloads, 0);
});

test("original and compressed reads validate their sources and final image paths, types and sizes", async (t) => {
  const context = await fixture(t);
  const { root, inputDir } = context.taskWorkspace;
  const source = join(inputDir, "source.png");
  const outside = join(root, "outside.png");
  const invalid = join(inputDir, "bad.txt");
  const link = join(inputDir, "link.png");
  await writeFile(source, png);
  await writeFile(outside, png);
  await writeFile(invalid, "not an image");
  await symlink(outside, link);
  for (const mode of ["original", "compressed"]) {
    const args = { action: "inspect", selector: context.candidates[0].selector, mode };
    let decodes = 0;
    for (const path of [outside, invalid, link, inputDir]) {
      const result = await executeQqImageMemoryTool(args, { ...context,
        prepareImage: async () => path, compressImage: async () => { decodes++; return source; }
      });
      assert.equal(result.ok, false);
      assert.equal(result.contentItems, undefined);
    }
    assert.equal(decodes, 0);
    assert.equal((await executeQqImageMemoryTool(args, { ...context, maxBytes: 10,
      prepareImage: async () => source, compressImage: async () => source
    })).ok, false);
    assert.equal((await executeQqImageMemoryTool(args, { ...context,
      prepareImage: async () => { throw new Error("download failed"); }
    })).ok, false);
    if (mode === "compressed") {
      for (const path of [outside, invalid, link, inputDir]) {
        assert.equal((await executeQqImageMemoryTool(args, { ...context,
          prepareImage: async () => source, compressImage: async () => path
        })).ok, false);
      }
    }
  }
});

test("cancellation during download or compression prevents visual delivery", async (t) => {
  const context = await fixture(t);
  const source = join(context.taskWorkspace.inputDir, "source.png");
  await writeFile(source, png);
  for (const stage of ["download", "compression"]) {
    let active = true;
    await assert.rejects(executeQqImageMemoryTool({ action: "inspect", selector: context.candidates[0].selector,
      mode: stage === "compression" ? "compressed" : "original"
    }, { ...context,
      prepareImage: async () => { if (stage === "download") active = false; return source; },
      compressImage: async () => { active = false; return source; },
      assertActive: () => { if (!active) throw new Error("cancelled"); }
    }), /cancelled/);
  }
});

test("the model can choose compressed inspection after the original exceeds its budget", async (t) => {
  const context = await fixture(t);
  const source = join(context.taskWorkspace.inputDir, "source.png");
  const output = join(context.taskWorkspace.inputDir, "compressed.jpg");
  await writeFile(source, png);
  const jpeg = Buffer.from([255, 216, 255, 217]);
  let compressions = 0;
  const options = { ...context, maxBytes: 50, compressedMaxEdge: 1280,
    prepareImage: async () => source,
    compressImage: async (data, settings) => {
      compressions++;
      assert.deepEqual(data, png);
      assert.equal(settings.maxBytes, 50);
      assert.equal(settings.maxEdge, 1280);
      await writeFile(output, jpeg);
      return output;
    }
  };
  const args = { action: "inspect", selector: context.candidates[0].selector };
  const original = await executeQqImageMemoryTool(args, options);
  assert.equal(original.ok, false);
  assert.match(original.error, /mode="compressed"/);
  assert.equal(compressions, 0);
  const compressed = await executeQqImageMemoryTool({ ...args, mode: "compressed" }, options);
  assert.equal(compressed.ok, true);
  assert.equal(compressions, 1);
  assert.match(compressed.reply, /压缩/);
  assert.match(compressed.reply, /细节/);
  assert.equal(compressed.contentItems[1].imageUrl, `data:image/jpeg;base64,${jpeg.toString("base64")}`);
});
