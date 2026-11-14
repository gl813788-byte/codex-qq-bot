import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseQqAgentOutput } from "../src/infrastructure/codex/qq-agent-output.js";
import {
  estimateOneBotTransferTimeoutMs,
  resolveQqReplyFileAttachments,
  toOneBotLocalFileUri,
  withQqSourceExtension
} from "../src/qq-reply-files.js";
import { buildQqDeliveryReceipt, combineOneBotSendResults, createQqDeliveryFailureMemoryEntry } from "../src/qq-delivery-receipt.js";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "qq-reply-files-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const taskRoot = join(root, "current");
  const inputDir = join(taskRoot, "input");
  const outputDir = join(taskRoot, "output");
  const oldOutput = join(root, "old", "output");
  await Promise.all([inputDir, outputDir, oldOutput].map((dir) => mkdir(dir, { recursive: true })));
  return { root, taskRoot, inputDir, outputDir, oldOutput, event: { qqTaskWorkspace: { root: taskRoot, inputDir, outputDir } } };
}

function replyWithFiles(paths) {
  return parseQqAgentOutput(JSON.stringify({
    status: "reply", text: "网页做好了", bubbles: [], reply: { mode: "plain", targetUserId: "" },
    attachments: paths.map((path) => ({ kind: "file", path, name: "自我介绍.html" }))
  })).output;
}

test("an HTML file created in the current output directory reaches the upload plan once", async (t) => {
  const f = await fixture(t);
  const path = join(f.outputDir, "intro.html");
  await writeFile(path, "<!doctype html><title>介绍</title>");
  const reply = replyWithFiles([path, path]);
  const { attachments, failures } = await resolveQqReplyFileAttachments(reply, { event: f.event });
  assert.deepEqual(attachments, [{ path, name: "自我介绍.html", size: Buffer.byteLength("<!doctype html><title>介绍</title>") }]);
  assert.deepEqual(failures, []);
  const sent = combineOneBotSendResults({ ok: true, status: 200 }, [{ ok: true, endpoint: "upload_private_file" }]);
  assert.equal(buildQqDeliveryReceipt(reply, { ok: sent.ok, results: [sent] }).failedBubbleCount, 0);
});

test("root, input, stale, missing and symlink-escaping files remain failed deliveries after text succeeds", async (t) => {
  const f = await fixture(t);
  const rootFile = join(f.taskRoot, "intro.html");
  const inputFile = join(f.inputDir, "source.html");
  const oldFile = join(f.oldOutput, "old.html");
  const outsideFile = join(f.root, "private.html");
  const escape = join(f.outputDir, "escape.html");
  await Promise.all([rootFile, inputFile, oldFile, outsideFile].map((file) => writeFile(file, "private")));
  await symlink(outsideFile, escape);
  for (const path of [rootFile, inputFile, oldFile, escape, join(f.outputDir, "missing.html"), f.outputDir]) {
    const reply = replyWithFiles([path]);
    const { attachments, failures } = await resolveQqReplyFileAttachments(reply, { event: f.event });
    assert.deepEqual(attachments, []);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].errorCode, "QQ_FILE_ATTACHMENT_REJECTED");
    const sent = combineOneBotSendResults({ ok: true, status: 200 }, failures);
    assert.equal(sent.ok, false);
    const receipt = buildQqDeliveryReceipt(reply, { ok: sent.ok, results: [sent] });
    assert.equal(receipt.deliveredBubbleCount, 0);
    assert.equal(receipt.failedBubbleCount, 1);
    assert.match(receipt.error, /文件未发送/);
    assert.equal(createQqDeliveryFailureMemoryEntry(f.event, receipt).deliveryFailure, true);
    assert.equal(JSON.stringify(failures).includes(f.root), false);
  }
});

test("a valid file does not hide a rejected file or an upload failure", async (t) => {
  const f = await fixture(t);
  const valid = join(f.outputDir, "intro.html");
  await writeFile(valid, "<!doctype html><title>介绍</title>");
  const { attachments, failures } = await resolveQqReplyFileAttachments(replyWithFiles([valid, join(f.taskRoot, "bad.html")]), { event: f.event });
  assert.equal(attachments.length, 1);
  assert.equal(failures.length, 1);
  assert.equal(combineOneBotSendResults({ ok: true }, [...failures, { ok: true }]).ok, false);
  const failedUpload = combineOneBotSendResults({ ok: true }, [{ ok: false, body: { wording: "上传失败" } }]);
  assert.equal(failedUpload.ok, false);
  assert.equal(failedUpload.error, "上传失败");
});

test("display names keep the real extension, and empty or outside files say why they failed", async (t) => {
  const f = await fixture(t);
  const report = join(f.outputDir, "report.pdf");
  const empty = join(f.outputDir, "empty.txt");
  const outside = join(f.taskRoot, "draft.md");
  await writeFile(report, "%PDF-1.7");
  await writeFile(empty, "");
  await writeFile(outside, "# draft");
  const reply = [
    `[[qq_file:${report}|季度报告]]`,
    `[[qq_file:${empty}]]`,
    `[[qq_file:${outside}]]`,
    `[[qq_file:${join(f.outputDir, "gone.zip")}]]`
  ].join("\n");
  const { attachments, failures } = await resolveQqReplyFileAttachments(reply, { event: f.event });
  assert.deepEqual(attachments, [{ path: report, name: "季度报告.pdf", size: 8 }]);
  assert.deepEqual(failures.map((failure) => failure.errorCode), [
    "QQ_FILE_ATTACHMENT_EMPTY",
    "QQ_FILE_ATTACHMENT_REJECTED",
    "QQ_FILE_ATTACHMENT_REJECTED"
  ]);
  assert.match(failures[0].error, /空文件/);
  assert.match(failures[1].error, /不在本轮输出目录中/);
  assert.match(failures[2].error, /不存在或已经不可读/);
  assert.equal(JSON.stringify(failures).includes(f.root), false);

  assert.equal(withQqSourceExtension("", "/o/a.tar.gz"), "a.tar.gz");
  assert.equal(withQqSourceExtension("备份.tar.gz", "/o/x.gz"), "备份.tar.gz");
  assert.equal(withQqSourceExtension("说明", "/o/readme"), "说明");
  assert.equal(withQqSourceExtension("a/b", "/o/x.CSV"), "a_b.csv");
});

test("local file URIs survive NapCat's decodeURIComponent and uploads wait as long as NapCat does", () => {
  const path = "/w/out/100% 完成 #1.png";
  const uri = toOneBotLocalFileUri(path);
  assert.equal(uri, "file:///w/out/100%25 完成 #1.png");
  // NapCat: decodeURIComponent(uri.slice(7)).
  assert.equal(decodeURIComponent(uri.slice(7)), path);

  assert.equal(estimateOneBotTransferTimeoutMs(0, { minMs: 30_000 }), 30_000);
  assert.equal(estimateOneBotTransferTimeoutMs(1024 * 1024), 24_000);
  assert.equal(estimateOneBotTransferTimeoutMs(50 * 1024 * 1024, { minMs: 30_000 }), 220_000);
  assert.equal(estimateOneBotTransferTimeoutMs(10 * 1024 ** 3), 30 * 60_000 + 10_000);
});
