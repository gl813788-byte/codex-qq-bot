import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { executeQqWebImageTool } from "../src/app/qq-web-image-tool.js";
import { buildQqNativeToolSpecs } from "../src/infrastructure/codex/qq-native-tools.js";
import {
  buildQqInterestImageContent,
  createQqInterestVisionCapabilityCache,
  isQqInterestImageRejection,
  normalizeQqInterestVisionMode,
  selectQqInterestJudgeImages,
  shouldSendQqInterestImages
} from "../src/qq-enhancer/interest-vision.js";
import { createWebSearch, normalizeTavilyImages } from "../src/web-search.js";
import { createEnvironmentConfig } from "../src/config/environment.js";

const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("png-body")]);

test("interest vision mode, capability memory and rejection detection", () => {
  assert.equal(normalizeQqInterestVisionMode(undefined), "auto");
  assert.equal(normalizeQqInterestVisionMode("0"), "off");
  assert.equal(normalizeQqInterestVisionMode("always"), "on");
  assert.equal(createEnvironmentConfig({}).qqProactiveJudgeVision, "auto");
  assert.equal(createEnvironmentConfig({ CODEX_REMOTE_CONTACT_QQ_PROACTIVE_JUDGE_VISION: "off" }).qqProactiveJudgeVision, "off");

  const cache = createQqInterestVisionCapabilityCache();
  const base = { cache, provider: "deepseek", model: "m", imageCount: 1 };
  assert.equal(shouldSendQqInterestImages({ ...base, mode: "auto" }), true);
  cache.set("deepseek", "m", false);
  assert.equal(shouldSendQqInterestImages({ ...base, mode: "auto" }), false);
  assert.equal(shouldSendQqInterestImages({ ...base, mode: "on" }), true);
  assert.equal(shouldSendQqInterestImages({ ...base, mode: "off" }), false);
  assert.equal(shouldSendQqInterestImages({ ...base, mode: "on", imageCount: 0 }), false);
  assert.equal(cache.snapshot()[0].supported, false);

  assert.equal(isQqInterestImageRejection(400, "unknown variant `image_url`, expected `text`"), true);
  assert.equal(isQqInterestImageRejection(404, "No endpoints found that support image input"), true);
  assert.equal(isQqInterestImageRejection(401, "image not allowed"), false);
  assert.equal(isQqInterestImageRejection(400, "max_tokens too large"), false);
});

test("the judge gets at most two labelled pictures from the judged window", () => {
  const event = {
    raw: { message_id: 3 },
    senderLabel: "小明",
    images: [{ file: "current.png" }],
    replyContext: { senderName: "小红", images: [{ file: "quoted.png" }] }
  };
  const recent = [
    { messageId: "1", senderLabel: "老王", at: "2026-10-24T00:00:00.000Z", images: [{ file: "old.png" }] },
    { messageId: "3", images: [{ file: "current.png" }] }
  ];
  assert.deepEqual(selectQqInterestJudgeImages(event, recent).map((item) => [item.image.file, item.origin, item.sender]), [
    ["current.png", "当前消息", "小明"],
    ["quoted.png", "引用消息", "小红"]
  ]);
  assert.deepEqual(selectQqInterestJudgeImages({ raw: { message_id: 3 } }, recent).map((item) => item.image.file), ["old.png"]);
  assert.equal(buildQqInterestImageContent("text", [{ dataUrl: "data:text/html;base64,AA" }]), "text");
  assert.equal(buildQqInterestImageContent("text", [{ dataUrl: "data:image/png;base64,AA" }]).length, 2);
});

test("Tavily image search requests descriptions and keeps only web URLs", async () => {
  let requestBody = null;
  const search = createWebSearch({
    maintenance: {},
    tavilyApiKey: "tvly-test",
    fetchImpl: async (url, init) => {
      assert.equal(url, "https://api.tavily.com/search");
      requestBody = JSON.parse(init.body);
      return new Response(JSON.stringify({
        images: [{ url: "https://img.example/cat.jpg", description: "一只橘猫" }, "ftp://bad/x.png", { url: "not a url" }]
      }), { headers: { "content-type": "application/json" } });
    }
  });
  assert.equal(search.hasImageSearch(), true);
  assert.deepEqual(await search.searchImages("橘猫"), [{ url: "https://img.example/cat.jpg", host: "img.example", description: "一只橘猫", source: "tavily" }]);
  assert.equal(requestBody.include_images, true);
  assert.equal(requestBody.include_image_descriptions, true);
  assert.equal(createWebSearch({ maintenance: {} }).hasImageSearch(), false);
  assert.deepEqual(normalizeTavilyImages(null), []);
});

test("downloaded web pictures land in task output only after signature checks", async () => {
  const root = await mkdtemp(join(tmpdir(), "qq-web-images-"));
  const taskWorkspace = { root, inputDir: join(root, "input"), outputDir: join(root, "output") };
  await mkdir(taskWorkspace.inputDir);
  await mkdir(taskWorkspace.outputDir);
  const candidates = new Map();
  const downloads = [];
  const options = {
    candidates,
    taskWorkspace,
    searchImages: async () => [
      { url: "https://img.example/cat.png", host: "img.example", description: "一只橘猫" },
      { url: "https://img.example/fake.png", host: "img.example", description: "伪装成图片的网页" }
    ],
    download: async (url, { outputDir }) => {
      downloads.push(url);
      const path = join(outputDir, `raw-${downloads.length}`);
      await writeFile(path, url.endsWith("cat.png") ? png : Buffer.from("<html>"));
      return path;
    }
  };
  assert.match((await executeQqWebImageTool({ action: "download", selector: "web-image-1" }, options)).error, /先用 action="search"/);
  const listing = await executeQqWebImageTool({ action: "search", query: "橘猫" }, options);
  assert.match(listing.reply, /web-image-1：一只橘猫（来源 img\.example）/);
  assert.equal(candidates.size, 2);

  const saved = await executeQqWebImageTool({ action: "download", selector: "web-image-1" }, options);
  assert.equal(saved.ok, true);
  assert.equal(saved.contentItems[1].imageUrl, `data:image/png;base64,${png.toString("base64")}`);
  assert.deepEqual(await readdir(taskWorkspace.outputDir), ["web-image-1.png"]);
  assert.match(saved.reply, /attachments/);
  await executeQqWebImageTool({ action: "download", selector: "web-image-1" }, options);
  assert.equal(downloads.length, 1, "a picture is downloaded once per turn");

  const fake = await executeQqWebImageTool({ action: "download", selector: "web-image-2" }, options);
  assert.equal(fake.ok, false);
  assert.deepEqual(await readdir(taskWorkspace.outputDir), ["web-image-1.png"]);

  // A different candidate never overwrites an existing output file.
  const collision = await executeQqWebImageTool({ action: "download", selector: "web-image-1" }, {
    ...options, candidates: new Map([["web-image-1", { url: "https://img.example/cat.png", host: "img.example" }]])
  });
  assert.equal(collision.ok, false);

  // Large pictures are previewed through the compressor; without a preview
  // the file is still saved but no visual input is claimed.
  const second = { ...taskWorkspace, outputDir: join(root, "output-2") };
  await mkdir(second.outputDir);
  const large = await executeQqWebImageTool({ action: "download", selector: "web-image-1" }, {
    ...options,
    taskWorkspace: second,
    candidates: new Map([["web-image-1", { url: "https://img.example/cat.png", host: "img.example" }]]),
    previewMaxBytes: 4,
    compressImage: async () => { throw new Error("no magick"); }
  });
  assert.equal(large.ok, true);
  assert.equal(large.contentItems, undefined);
  assert.match(large.reply, /尚未获得视觉内容/);
  assert.deepEqual(await readdir(second.outputDir), ["web-image-1.png"]);
});

test("the image search tool is offered only when Tavily image search is available", () => {
  const names = (specs) => specs.find((item) => item.name === "qq_search").tools.map((tool) => tool.name);
  assert.deepEqual(names(buildQqNativeToolSpecs()), ["chinese_web"]);
  const spec = buildQqNativeToolSpecs({ canSearchImages: true }).find((item) => item.name === "qq_search").tools[1];
  assert.equal(spec.name, "images");
  assert.deepEqual(spec.inputSchema.properties.action.enum, ["search", "download"]);
});
