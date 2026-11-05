import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  formatQqBotDrawingsContext,
  listQqBotDrawingsForScope,
  markQqBotDrawingPosted,
  normalizeQqBotDrawings,
  parseQqBotDrawingIdFromPath,
  pruneQqBotDrawingFiles,
  recordQqBotDrawing,
  storeQqBotDrawingFile
} from "../src/qq-bot-drawings.js";
import { executeQqDrawingsTool } from "../src/app/qq-drawings-tool.js";
import { selectQqLifeActivityDue } from "../src/qq-bot-life-activities.js";
import { buildQqBotRoutinePrompt, qqBotRoutineOutputSchema } from "../src/qq-bot-daily-routine.js";
import { normalizeQqBotLifeState } from "../src/qq-bot-life-state.js";

const png = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489", "hex");

async function scratch() {
  const root = await mkdtemp(join(tmpdir(), "qq-drawings-"));
  const output = join(root, "output");
  const library = join(root, "library");
  await mkdir(output, { recursive: true });
  return { root, output, library };
}

test("drawings are stored by content, indexed, scoped and pruned", async () => {
  const dir = await scratch();
  try {
    await writeFile(join(dir.output, "cat.png"), png);
    const stored = await storeQqBotDrawingFile(join(dir.output, "cat.png"), { directory: dir.library, sourceRoot: dir.output });
    assert.match(stored.id, /^d-[0-9a-f]{8}$/);
    assert.match(stored.file, /^[0-9a-f]{16}\.png$/);
    assert.deepEqual(await storeQqBotDrawingFile(join(dir.output, "cat.png"), { directory: dir.library, sourceRoot: dir.output }), stored);
    await writeFile(join(dir.output, "fake.png"), "not an image");
    await assert.rejects(storeQqBotDrawingFile(join(dir.output, "fake.png"), { directory: dir.library, sourceRoot: dir.output }));

    let drawings = recordQqBotDrawing([], { ...stored, at: new Date().toISOString(), title: "趴桌的猫", source: "routine" });
    drawings = recordQqBotDrawing(drawings, { id: "d-00000001", file: "0000000000000001.png", at: new Date().toISOString(), title: "私聊画的", source: "chat", scopeId: "private:10001" });
    assert.equal(listQqBotDrawingsForScope(drawings, "123456").length, 1);
    assert.equal(listQqBotDrawingsForScope(drawings, "private:10001").length, 2);
    assert.match(formatQqBotDrawingsContext(drawings, { scopeId: "123456" }), /《趴桌的猫》/);
    assert.doesNotMatch(formatQqBotDrawingsContext(drawings, { scopeId: "123456" }), /私聊画的/);
    drawings = markQqBotDrawingPosted(drawings, stored.id);
    assert.ok(drawings.find((item) => item.id === stored.id).postedAt);
    assert.equal(normalizeQqBotLifeState({ drawings }).drawings.length, 2);

    await writeFile(join(dir.library, "ffffffffffffffff.png"), png);
    assert.equal(await pruneQqBotDrawingFiles(drawings, { directory: dir.library }), 1);
    assert.deepEqual(await readdir(dir.library), [stored.file]);
    assert.equal(parseQqBotDrawingIdFromPath(`/w/output/drawing-${stored.id}.png`), stored.id);
  } finally {
    await rm(dir.root, { recursive: true, force: true });
  }
});

test("the drawings tool lists, shows and takes out only drawings visible here", async () => {
  const dir = await scratch();
  try {
    await writeFile(join(dir.output, "cat.png"), png);
    const stored = await storeQqBotDrawingFile(join(dir.output, "cat.png"), { directory: dir.library, sourceRoot: dir.output });
    const drawings = normalizeQqBotDrawings([{ ...stored, at: new Date().toISOString(), title: "猫", source: "chat", scopeId: "123456" }]);
    const deps = { drawings, scopeId: "123456", directory: dir.library, taskWorkspace: { outputDir: join(dir.root, "turn-output") } };
    assert.match((await executeQqDrawingsTool({ action: "list" }, deps)).reply, new RegExp(`${stored.id}《猫》`));
    const shown = await executeQqDrawingsTool({ action: "inspect", id: stored.id }, deps);
    assert.match(shown.contentItems[1].imageUrl, /^data:image\/png;base64,/);
    const used = await executeQqDrawingsTool({ action: "use", id: stored.id }, deps);
    assert.match(used.reply, new RegExp(`drawing-${stored.id}\\.png`));
    assert.equal((await readdir(join(dir.root, "turn-output"))).length, 1);
    const elsewhere = await executeQqDrawingsTool({ action: "inspect", id: stored.id }, { ...deps, scopeId: "999999" });
    assert.equal(elsewhere.ok, false);
  } finally {
    await rm(dir.root, { recursive: true, force: true });
  }
});

test("draw segments are scheduled only when the engine can draw", () => {
  assert.ok(qqBotRoutineOutputSchema.properties.segments.items.properties.kind.enum.includes("draw"));
  assert.match(buildQqBotRoutinePrompt({ canDraw: true }), /kind=draw/);
  assert.match(buildQqBotRoutinePrompt({ canDraw: false }), /不要安排 kind=draw/);
  const now = Date.parse("2026-11-05T03:00:00Z");
  const life = normalizeQqBotLifeState({
    routine: { date: "2026-11-05", segments: [
      { start: "10:00", end: "12:20", activity: "画草稿", state: "专注", kind: "draw", plan: "画一只趴在桌边发呆的猫猫" },
      { start: "12:20", end: "10:00", activity: "其他", state: "", kind: "none", plan: "" }
    ] }
  });
  assert.equal(selectQqLifeActivityDue(life, { now, canDraw: false }), null);
  assert.equal(selectQqLifeActivityDue(life, { now, canDraw: true }).segment.kind, "draw");
});

test("qq_context.images serves conversation pictures and drawings, and use takes either out", async () => {
  const { executeQqImageMemoryTool } = await import("../src/app/qq-image-memory-tool.js");
  const dir = await scratch();
  try {
    const input = join(dir.root, "input");
    await mkdir(input, { recursive: true });
    await writeFile(join(dir.output, "cat.png"), png);
    const stored = await storeQqBotDrawingFile(join(dir.output, "cat.png"), { directory: dir.library, sourceRoot: dir.output });
    const entries = normalizeQqBotDrawings([{ ...stored, at: new Date().toISOString(), title: "猫", source: "routine" }]);
    const taskWorkspace = { root: dir.root, inputDir: input, outputDir: join(dir.root, "turn-output") };
    const candidates = [{ selector: "image-abc", image: { file: "a.png" }, origin: "当前消息", sender: "甲", text: "" }];
    const prepareImage = async (image, { outputDir }) => {
      const path = join(outputDir, "a.png");
      await writeFile(path, png);
      return path;
    };
    const deps = { candidates, taskWorkspace, prepareImage, drawings: { entries, scopeId: "123456", directory: dir.library } };
    const listed = await executeQqImageMemoryTool({ action: "list" }, deps);
    assert.match(listed.reply, /image-abc/);
    assert.match(listed.reply, new RegExp(`${stored.id}《猫》`));
    const drawing = await executeQqImageMemoryTool({ action: "inspect", selector: stored.id }, deps);
    assert.equal(drawing.contentItems[1].type, "inputImage");
    const usedImage = await executeQqImageMemoryTool({ action: "use", selector: "image-abc" }, deps);
    assert.match(usedImage.reply, /image-abc\.png/);
    const usedDrawing = await executeQqImageMemoryTool({ action: "use", selector: stored.id }, deps);
    assert.match(usedDrawing.reply, /drawing-d-/);
    assert.equal((await readdir(taskWorkspace.outputDir)).length, 2);
    const background = await executeQqImageMemoryTool({ action: "inspect", selector: "image-abc" }, { ...deps, conversation: false });
    assert.equal(background.ok, false);
    const backgroundList = await executeQqImageMemoryTool({ action: "list" }, { ...deps, conversation: false });
    assert.doesNotMatch(backgroundList.reply, /image-abc/);
  } finally {
    await rm(dir.root, { recursive: true, force: true });
  }
});
