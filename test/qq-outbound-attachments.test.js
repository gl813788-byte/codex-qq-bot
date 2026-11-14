import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";
import {
  prepareQqOutboundReplyMarkers,
  QQ_INLINE_ATTACHMENT_MAX_BYTES,
  writeQqInlineAttachments
} from "../src/app/qq-outbound-attachments.js";
import {
  chooseQqSvgRenderBox,
  convertQqImageForSending,
  detectQqImageFileFormat,
  detectQqImageFormat,
  inspectQqSvgSafety,
  readQqSvgIntrinsicSize
} from "../src/qq-enhancer/convert-image.js";
import { resolveQqReplyFileAttachments } from "../src/qq-reply-files.js";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="#fde"/></svg>';

async function workspace(t) {
  const root = await mkdtemp(join(tmpdir(), "qq-outbound-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputDir = join(root, "task", "output");
  const inputDir = join(root, "task", "input");
  await mkdir(outputDir, { recursive: true });
  await mkdir(inputDir, { recursive: true });
  return { root, outputDir, inputDir, event: { qqTaskWorkspace: { root: join(root, "task"), inputDir, outputDir } } };
}

// Stands in for rsvg-convert/magick: writes a PNG where the real tool would.
function fakeRenderer(calls) {
  return async (command, args) => {
    calls.push({ command, args });
    const output = command === "rsvg-convert"
      ? args[args.indexOf("--output") + 1]
      : args.at(-1).replace(/^png:/, "");
    await writeFile(output, PNG);
    return { stdout: "", stderr: "" };
  };
}

test("picture formats are recognised by their signature, not their name", () => {
  const bmp = Buffer.alloc(32);
  bmp.write("BM", 0, "latin1");
  bmp.writeUInt32LE(40, 14);
  const ftyp = (brand) => Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from(`ftyp${brand}`, "latin1"), Buffer.alloc(8)]);
  assert.equal(detectQqImageFormat(PNG), "png");
  assert.equal(detectQqImageFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "jpeg");
  assert.equal(detectQqImageFormat(Buffer.from("GIF89a....")), "gif");
  assert.equal(detectQqImageFormat(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), "webp");
  assert.equal(detectQqImageFormat(bmp), "bmp");
  assert.equal(detectQqImageFormat(Buffer.from([0x49, 0x49, 0x2a, 0x00, 8, 0])), "tiff");
  assert.equal(detectQqImageFormat(Buffer.from([0, 0, 1, 0, 1, 0, 16, 16])), "ico");
  assert.equal(detectQqImageFormat(ftyp("avif")), "avif");
  assert.equal(detectQqImageFormat(ftyp("heic")), "heic");
  assert.equal(detectQqImageFormat(Buffer.from(`﻿<?xml version="1.0"?>\n<!-- drawn by hand -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">\n${SVG}`)), "svg");
  // Text that merely starts like a bitmap or mentions <svg> later is not a picture.
  assert.equal(detectQqImageFormat(Buffer.from("BMW 年度报告：第一季度销量……")), "");
  assert.equal(detectQqImageFormat(Buffer.from("# 笔记\n\n这里讲 <svg> 标签怎么写")), "");
  assert.equal(detectQqImageFormat(Buffer.from("<html><body>hi</body></html>")), "");
});

test("SVGs that reach beyond the document are refused before rendering", () => {
  const wrap = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${inner}</svg>`;
  assert.equal(inspectQqSvgSafety(wrap('<rect fill="url(#g)"/><use href="#a"/>')).ok, true);
  assert.equal(inspectQqSvgSafety(wrap('<image href="data:image/png;base64,iVBORw0KGgo="/>')).ok, true);
  for (const unsafe of [
    wrap('<image href="file:///root/.codex/auth.json"/>'),
    wrap('<image xlink:href="../input/secret.png"/>'),
    wrap("<image href='https://example.com/x.png'/>"),
    wrap('<image href="data:image/svg+xml;base64,PHN2Zz4="/>'),
    wrap('<rect style="fill:url(http://example.com/p.svg#x)"/>'),
    wrap("<style>@import url(#a);</style>"),
    `<?xml-stylesheet href="a.css"?>${wrap("")}`,
    `<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>${wrap("<text>&x;</text>")}`,
    "<html>not an svg</html>"
  ]) {
    assert.equal(inspectQqSvgSafety(unsafe).ok, false, unsafe);
  }
  // A plain external DTD declaration is dropped from the rendered copy.
  const declared = inspectQqSvgSafety(`<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">${SVG}`);
  assert.equal(declared.ok, true);
  assert.doesNotMatch(declared.sanitized, /DOCTYPE/);
});

test("SVG render size follows the declared size but stays inside fixed bounds", () => {
  assert.deepEqual(readQqSvgIntrinsicSize(SVG), { width: 120, height: 60 });
  assert.deepEqual(readQqSvgIntrinsicSize('<svg viewBox="0 0 400 300">'), { width: 400, height: 300 });
  assert.deepEqual(readQqSvgIntrinsicSize('<svg width="1in" viewBox="0 0 2 1">'), { width: 96, height: 48 });
  assert.equal(readQqSvgIntrinsicSize('<svg width="100%" height="100%">'), null);
  assert.deepEqual(chooseQqSvgRenderBox({ width: 120, height: 60 }), { width: 768, height: 384 });
  assert.deepEqual(chooseQqSvgRenderBox({ width: 200000, height: 100000 }), { width: 2048, height: 1024 });
  assert.deepEqual(chooseQqSvgRenderBox({ width: 1000, height: 1500 }), { width: 1000, height: 1500 });
  assert.deepEqual(chooseQqSvgRenderBox(null), { width: 1024, height: 1024 });
});

test("SVG and other formats become PNG pictures; a mislabeled picture is only renamed", async (t) => {
  const w = await workspace(t);
  const calls = [];
  const svg = join(w.outputDir, "图表.svg");
  await writeFile(svg, `<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "x.dtd">${SVG}`);
  const rendered = await convertQqImageForSending(svg, { outputDir: w.outputDir, run: fakeRenderer(calls) });
  assert.equal(rendered.converted, true);
  assert.match(basename(rendered.path), /^图表-[0-9a-f]{8}\.png$/);
  assert.equal(await detectQqImageFileFormat(rendered.path), "png");
  assert.equal(calls[0].command, "rsvg-convert");
  assert.deepEqual(calls[0].args.slice(0, 7), ["--width", "768", "--height", "384", "--keep-aspect-ratio", "--background-color", "white"]);
  // The renderer reads a sanitized copy that is removed afterwards.
  const staged = calls[0].args.at(-1);
  assert.doesNotMatch(staged, /图表\.svg$/);
  assert.equal((await readdir(w.outputDir)).some((name) => name.startsWith(".render-")), false);

  const bmp = join(w.outputDir, "scan.bmp");
  const header = Buffer.alloc(64);
  header.write("BM", 0, "latin1");
  header.writeUInt32LE(40, 14);
  await writeFile(bmp, header);
  const fromBmp = await convertQqImageForSending(bmp, { outputDir: w.outputDir, run: fakeRenderer(calls) });
  assert.equal(calls[1].command, "magick");
  assert.ok(calls[1].args.includes(`bmp:${bmp}[0]`), "the coder is fixed by the detected signature");
  assert.equal(fromBmp.converted, true);

  const mislabeled = join(w.outputDir, "photo.image");
  await writeFile(mislabeled, PNG);
  const renamed = await convertQqImageForSending(mislabeled, { outputDir: w.outputDir, run: fakeRenderer(calls) });
  assert.equal(renamed.converted, false);
  assert.match(renamed.path, /\.png$/);
  assert.equal(calls.length, 2, "a real PNG is copied, never re-rendered");

  const unsafe = join(w.outputDir, "leak.svg");
  await writeFile(unsafe, '<svg xmlns="http://www.w3.org/2000/svg"><image href="/etc/passwd"/></svg>');
  await assert.rejects(
    convertQqImageForSending(unsafe, { outputDir: w.outputDir, run: fakeRenderer(calls) }),
    (error) => error.code === "QQ_IMAGE_CONVERT_REJECTED"
  );
  assert.equal(calls.length, 2, "an unsafe SVG never reaches the renderer");
});

test("outgoing picture markers are converted, or fall back to files instead of being dropped", async (t) => {
  const w = await workspace(t);
  const svg = join(w.outputDir, "chart.svg");
  const notes = join(w.outputDir, "notes.md");
  const broken = join(w.outputDir, "broken.svg");
  const png = join(w.outputDir, "ok.png");
  const outside = join(w.inputDir, "theirs.svg");
  await Promise.all([
    writeFile(svg, SVG),
    writeFile(notes, "# 笔记"),
    writeFile(broken, SVG),
    writeFile(png, PNG),
    writeFile(outside, SVG)
  ]);
  const converted = [];
  const convert = async (path, { format }) => {
    if (path === broken) throw Object.assign(new Error("rsvg-convert failed: /secret/path"), { code: 1 });
    converted.push(format);
    return { path: join(w.outputDir, "chart-1.png"), format, converted: true };
  };
  const reply = [
    "看图",
    `[[qq_image:${svg}]]`,
    `[[qq_image:${notes}]]`,
    `[[qq_image:${broken}]]`,
    `[[qq_image:${png}]]`,
    `[[qq_image:${outside}]]`
  ].join("\n");
  const prepared = await prepareQqOutboundReplyMarkers(reply, { outputDir: w.outputDir, convert });
  assert.deepEqual(converted, ["svg"]);
  assert.match(prepared.reply, new RegExp(`\\[\\[qq_image:${join(w.outputDir, "chart-1.png")}\\]\\]`));
  assert.match(prepared.reply, /\[\[qq_file:[^\]]*notes\.md\|notes\.md\]\]/);
  assert.match(prepared.reply, /\[\[qq_file:[^\]]*broken\.svg\|broken\.svg\]\]/);
  assert.ok(prepared.reply.includes(`[[qq_image:${png}]]`), "native pictures pass through untouched");
  assert.ok(prepared.reply.includes(`[[qq_image:${outside}]]`), "files outside the output directory keep their marker and meet the normal rejection");
  assert.equal(prepared.notes.length, 2);
  assert.match(prepared.notes[0], /notes\.md」不是 QQ 能显示的图片，已按文件发送/);
  assert.match(prepared.notes[1], /broken\.svg」没能转成图片（渲染出错或超时），已按文件发送/);
  assert.doesNotMatch(prepared.notes.join(""), /secret/);
  assert.deepEqual(prepared.conversions.map((item) => item.outcome), ["converted", "sent-as-file", "convert-failed"]);

  // The fallback files still pass the ordinary output-directory check.
  const files = await resolveQqReplyFileAttachments(prepared.reply, { event: w.event });
  assert.deepEqual(files.attachments.map((item) => basename(item.path)), ["notes.md", "broken.svg"]);
  assert.deepEqual(files.failures, []);

  // Without an output directory nothing is touched.
  assert.equal((await prepareQqOutboundReplyMarkers(reply, { outputDir: "", convert })).reply, reply);
});

test("qq_chat.send text content is written into the output directory as a real file", async (t) => {
  const w = await workspace(t);
  const original = [
    { kind: "file", path: join(w.outputDir, "existing.pdf"), name: "" },
    { kind: "file", path: "", name: "周报", content: "# 本周\n- 完成了发送文件" },
    { kind: "image", path: "", name: "", content: SVG },
    { kind: "file", path: "", name: "../../escape.csv", content: "a,b\n1,2" },
    { kind: "file", path: "", name: "empty.txt", content: "" },
    { kind: "file", path: "", name: "big.txt", content: "x".repeat(QQ_INLINE_ATTACHMENT_MAX_BYTES + 1) }
  ];
  const { attachments, notes } = await writeQqInlineAttachments(original, { outputDir: w.outputDir });
  assert.equal(attachments.length, 4);
  assert.deepEqual(attachments[0], original[0]);
  assert.equal(attachments[1].name, "周报.txt");
  assert.equal(await readFile(attachments[1].path, "utf8"), "# 本周\n- 完成了发送文件");
  assert.equal(attachments[2].kind, "image");
  assert.equal(attachments[2].name, "image.svg");
  assert.match(attachments[2].path, /\.svg$/);
  assert.equal(attachments[3].name, "_.._escape.csv", "path separators never survive into a name");
  for (const attachment of attachments.slice(1)) {
    assert.ok(attachment.path.startsWith(`${w.outputDir}/`), "inline files stay inside the output directory");
    assert.equal(Object.hasOwn(attachment, "content"), false);
  }
  assert.equal(notes.length, 2);
  assert.match(notes[0], /empty\.txt」的 content 是空的/);
  assert.match(notes[1], /big\.txt」内容太长/);

  const noWorkspace = await writeQqInlineAttachments([{ kind: "file", name: "a.md", content: "x" }], { outputDir: "" });
  assert.deepEqual(noWorkspace.attachments, []);
  assert.match(noWorkspace.notes[0], /没有输出目录/);

  const untouched = [{ kind: "file", path: "/w/out/a.txt", name: "" }];
  assert.equal((await writeQqInlineAttachments(untouched, { outputDir: w.outputDir })).attachments, untouched);
});

test("rsvg-convert renders a real SVG with Chinese text when it is installed", async (t) => {
  if (spawnSync("rsvg-convert", ["--version"]).status !== 0) {
    t.skip("rsvg-convert is not installed");
    return;
  }
  const w = await workspace(t);
  const svg = join(w.outputDir, "hello.svg");
  await writeFile(svg, '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="60"><text x="10" y="40" font-size="28">你好 SVG</text></svg>');
  const result = await convertQqImageForSending(svg, { outputDir: w.outputDir });
  assert.equal(await detectQqImageFileFormat(result.path), "png");
  const header = await readFile(result.path);
  const width = header.readUInt32BE(16);
  assert.ok(Math.abs(width - 768) <= 2, `the 200px drawing is rendered near the 768px minimum edge (got ${width})`);
});
