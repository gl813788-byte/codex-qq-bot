import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isExecutableOnPathSync, resolveAgentDrawing } from "../src/infrastructure/agent/agent-drawing.js";
import { formatCodexDrawingPrompt, runCodexImageGeneration } from "../src/infrastructure/codex/codex-image-generation.js";
import { createQqDrawingService, executeQqDrawTool, normalizeQqDrawArguments } from "../src/app/qq-draw-tool.js";

const png = Buffer.concat([Buffer.from("89504e470d0a1a0a0000000d49484452", "hex"), Buffer.alloc(64, 1)]);

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), "qq-draw-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const inputDir = join(root, "input");
  const outputDir = join(root, "output");
  await mkdir(inputDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  return { root, inputDir, outputDir };
}

test("the Bot draws natively, through Codex, or not at all", () => {
  assert.equal(resolveAgentDrawing({ nativeImageGeneration: true, codexDrawing: "off" }), "native");
  assert.equal(resolveAgentDrawing({ codexDrawing: "auto", codexAvailable: true }), "codex");
  assert.equal(resolveAgentDrawing({ codexDrawing: "off", codexAvailable: true }), null);
  assert.equal(resolveAgentDrawing({ codexDrawing: "auto", codexAvailable: false }), null);
  assert.equal(isExecutableOnPathSync(process.execPath), true);
  assert.equal(isExecutableOnPathSync("definitely-not-a-command-xyz", { PATH: "/nonexistent" }), false);
});

test("a Codex drawing turn is tool-free and read-only, and imports what it saved", async (t) => {
  const ws = await workspace(t);
  const generatedImagesDir = join(ws.root, "generated");
  await mkdir(join(generatedImagesDir, "thread-1"), { recursive: true });
  let options;
  const result = await runCodexImageGeneration({
    prompt: "一只橘猫",
    referenceImagePaths: [join(ws.inputDir, "ref.png")],
    outputDir: ws.outputDir,
    generatedImagesDir,
    model: "gpt-test",
    buildEnv: () => ({ PATH: "/bin" }),
    runTurn: async (turnOptions) => {
      options = turnOptions;
      await writeFile(join(generatedImagesDir, "thread-1", "ig_1.png"), png);
      turnOptions.onItem({ method: "item/completed", item: { type: "imageGeneration", revisedPrompt: "an orange cat", savedPath: join(generatedImagesDir, "thread-1", "ig_1.png") } });
      return { threadId: "thread-1", finalResponse: "画了一只橘猫", items: [] };
    }
  });
  assert.deepEqual(options.dynamicTools, []);
  assert.equal(options.sandbox, "read-only");
  assert.equal(options.webSearchMode, "disabled");
  assert.equal(options.ephemeral, true);
  assert.equal(options.model, "gpt-test");
  assert.deepEqual(options.imagePaths, [join(ws.inputDir, "ref.png")]);
  assert.match(options.prompt, /1 张参考图/);
  assert.match(options.developerInstructions, /只负责画图/);
  assert.equal(Object.hasOwn(options.config || {}, "features.image_generation"), false);
  assert.equal(result.imagePaths.length, 1);
  assert.ok(result.imagePaths[0].startsWith(`${ws.outputDir}/codex-generated-`));
  assert.deepEqual(await readFile(result.imagePaths[0]), png);
  assert.equal(result.revisedPrompt, "an orange cat");
  assert.equal(result.text, "画了一只橘猫");
});

test("echoed picture data is used only when it really is a picture", async (t) => {
  const ws = await workspace(t);
  const result = await runCodexImageGeneration({
    prompt: "猫",
    outputDir: ws.outputDir,
    generatedImagesDir: join(ws.root, "none"),
    buildEnv: () => ({}),
    runTurn: async () => ({
      threadId: "t2",
      finalResponse: "",
      items: [
        { type: "imageGeneration", result: Buffer.from("not an image at all").toString("base64") },
        { type: "imageGeneration", result: png.toString("base64") }
      ]
    })
  });
  assert.equal(result.imagePaths.length, 1);
  assert.deepEqual(await readFile(result.imagePaths[0]), png);
  await assert.rejects(runCodexImageGeneration({ prompt: " ", outputDir: ws.outputDir, runTurn: async () => ({}) }), { code: "CODEX_DRAWING_EMPTY_PROMPT" });
  assert.match(formatCodexDrawingPrompt({ prompt: "x" }), /^请画一张图。/);
});

test("qq_draw.image draws into the turn's output directory and shows the picture", async (t) => {
  const ws = await workspace(t);
  const event = {};
  const drawn = [];
  let request;
  const service = {
    draw: async (input) => {
      request = input;
      const path = join(ws.outputDir, "codex-generated-1-a.png");
      await writeFile(path, png);
      return { imagePaths: [path], text: "ok" };
    }
  };
  const reference = join(ws.inputDir, "ref.png");
  await writeFile(reference, png);
  const result = await executeQqDrawTool({ prompt: "  把这张图改成水彩风  ", references: [reference] }, {
    event,
    service,
    taskWorkspace: ws,
    onDrawn: (paths, meta) => drawn.push({ paths, meta })
  });
  assert.equal(result.ok, true);
  assert.match(result.reply, /codex-generated-1-a\.png/);
  assert.match(result.reply, /attachments（kind=image）/);
  assert.equal(result.contentItems[1].type, "inputImage");
  assert.match(result.contentItems[1].imageUrl, /^data:image\/png;base64,/);
  assert.equal(request.prompt, "把这张图改成水彩风");
  assert.equal(request.outputDir, ws.outputDir);
  assert.equal(request.referenceImagePaths.length, 1);
  assert.equal(drawn[0].meta.prompt, "把这张图改成水彩风");
  assert.equal(event.qqDrawCount, 1);

  // References outside the workspace, or not pictures, are refused before drawing.
  const outside = join(tmpdir(), `qq-draw-outside-${process.pid}.png`);
  await writeFile(outside, png);
  t.after(() => rm(outside, { force: true }));
  const refused = await executeQqDrawTool({ prompt: "x", references: [outside] }, { event: {}, service, taskWorkspace: ws });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /只能用本轮输入或输出目录里的图片/);
  const text = join(ws.inputDir, "notes.png");
  await writeFile(text, "hello world, not a png");
  assert.equal((await executeQqDrawTool({ prompt: "x", references: [text] }, { event: {}, service, taskWorkspace: ws })).ok, false);
});

test("qq_draw.image is capped per turn and says so honestly when nothing was drawn", async (t) => {
  const ws = await workspace(t);
  let calls = 0;
  const event = { qqDrawCount: 2 };
  const capped = await executeQqDrawTool({ prompt: "x" }, { event, service: { draw: async () => { calls += 1; } }, taskWorkspace: ws });
  assert.equal(capped.ok, false);
  assert.match(capped.error, /已经画了 2 张/);
  assert.equal(calls, 0);

  const empty = await executeQqDrawTool({ prompt: "x" }, { event: {}, service: { draw: async () => ({ imagePaths: [], text: "这个描述违反内容政策" }) }, taskWorkspace: ws });
  assert.equal(empty.ok, false);
  assert.match(empty.error, /Codex 没有画出图（它说：这个描述违反内容政策）/);

  const failingEvent = {};
  const busy = await executeQqDrawTool({ prompt: "x" }, {
    event: failingEvent,
    service: { draw: async () => { throw Object.assign(new Error("full"), { code: "CODEX_HOST_BUSY" }); } },
    taskWorkspace: ws
  });
  assert.match(busy.error, /进程或内存余量不够/);
  // A failed attempt does not use up the turn's drawings.
  assert.equal(failingEvent.qqDrawCount, 0);

  assert.match((await executeQqDrawTool({ prompt: "x" }, { event: {}, service: null, taskWorkspace: ws })).error, /不能画图/);
  assert.match((await executeQqDrawTool({ prompt: "" }, { event: {}, service: { draw: async () => ({}) }, taskWorkspace: ws })).error, /画面描述/);
  assert.deepEqual(normalizeQqDrawArguments({ description: "猫", references: "/a.png" }), { prompt: "猫", references: ["/a.png"] });
});

test("the drawing service draws one at a time behind the capacity gate and refuses a full queue", async () => {
  const gate = [];
  let release;
  const order = [];
  const service = createQqDrawingService({
    maxQueued: 1,
    processes: 2,
    processGate: {
      acquire: async (options) => {
        gate.push(options.processes);
        return { release: () => order.push("released") };
      }
    },
    generate: async ({ prompt }) => {
      order.push(`start ${prompt}`);
      if (prompt === "a") await new Promise((resolve) => { release = resolve; });
      order.push(`end ${prompt}`);
      return { imagePaths: [prompt] };
    }
  });
  const first = service.draw({ prompt: "a" });
  const second = service.draw({ prompt: "b" });
  await assert.rejects(service.draw({ prompt: "c" }), { code: "QQ_DRAW_BUSY" });
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  release();
  assert.deepEqual((await first).imagePaths, ["a"]);
  assert.deepEqual((await second).imagePaths, ["b"]);
  assert.deepEqual(order, ["start a", "end a", "released", "start b", "end b", "released"]);
  assert.deepEqual(gate, [2, 2]);
});
