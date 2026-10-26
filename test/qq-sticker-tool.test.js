import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { executeQqStickerTool } from "../src/app/qq-sticker-tool.js";
import { getQqStickerRef } from "../src/qq-sticker-search.js";

// 1x1 PNG.
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const catalog = [
  { identity: "account:a", name: "无语猫", tags: ["无语", "翻白眼"], description: "猫翻白眼" },
  { identity: "account:b", name: "开心狗", tags: ["开心"], description: "狗在笑" }
];

test("search returns #refs from the merged catalog and skips recent stickers", async () => {
  const result = await executeQqStickerTool({ action: "search", query: "无语" }, {
    loadCatalog: async () => catalog,
    recentRefs: []
  });
  assert.equal(result.ok, true);
  assert.match(result.reply, new RegExp(`${getQqStickerRef(catalog[0])} 无语猫`));
  assert.doesNotMatch(result.reply, /开心狗/);
});

test("inspect returns the sticker as visual input in the same tool result", async () => {
  const root = mkdtempSync(join(tmpdir(), "qq-sticker-tool-"));
  const inputDir = join(root, "input");
  mkdirSync(inputDir);
  const framePath = join(inputDir, "frame-1.png");
  writeFileSync(framePath, png);
  const outside = join(tmpdir(), `qq-sticker-outside-${process.pid}.png`);
  writeFileSync(outside, png);
  try {
    const seen = [];
    const result = await executeQqStickerTool({ action: "inspect", selector: "#abcdef", description: "均匀5帧" }, {
      inspect: async (selector, frames) => {
        seen.push({ selector, frames });
        return { ok: true, reply: "已加载 #abcdef 无语猫。", paths: [framePath, outside] };
      },
      taskWorkspace: { root, inputDir }
    });
    assert.deepEqual(seen, [{ selector: "#abcdef", frames: "均匀5帧" }]);
    assert.equal(result.ok, true);
    // Files outside the task workspace are never returned.
    assert.equal(result.contentItems.filter((item) => item.type === "inputImage").length, 1);
    assert.match(result.contentItems[1].imageUrl, /^data:image\/png;base64,/);

    const unreadable = await executeQqStickerTool({ action: "inspect", selector: "#abcdef" }, {
      inspect: async () => ({ ok: true, reply: "已加载。", paths: [outside] }),
      taskWorkspace: { root, inputDir }
    });
    assert.equal(unreadable.ok, false);
    assert.match(unreadable.error, /尚未获得视觉内容/);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { force: true });
  }
});

test("label and favorite delegate to the Hub and surface their failures", async () => {
  const labels = [];
  const labeled = await executeQqStickerTool({ action: "label", selector: "#abcdef", tags: "无语,白眼", description: "猫翻白眼" }, {
    label: async (...args) => {
      labels.push(args);
      return { ok: true, reply: "已更新标签" };
    }
  });
  assert.equal(labeled.ok, true);
  assert.deepEqual(labels, [["#abcdef", "无语,白眼", "猫翻白眼"]]);
  const favorite = await executeQqStickerTool({ action: "favorite", selector: "1" }, {
    favorite: async () => ({ ok: false, reply: "本轮已经收藏过一个表情，最多收藏一个。" })
  });
  assert.equal(favorite.ok, false);
  assert.match(favorite.error, /最多收藏一个/);
  assert.equal((await executeQqStickerTool({ action: "send" }, {})).ok, false);
});
