import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildOneBotInboundFileUrlRequest,
  collectQqInboundFileCandidates,
  downloadQqInboundFile,
  extractOneBotFileInputs,
  formatQqInboundFileCandidates,
  redactQqFileCqCodes
} from "../src/qq-inbound-files.js";

test("builds the supported NapCat URL lookup for group and private files", () => {
  assert.deepEqual(buildOneBotInboundFileUrlRequest({
    messageType: "group",
    groupId: "123456",
    fileId: "/group-file"
  }), {
    endpoint: "get_group_file_url",
    payload: { group_id: 123456, file_id: "/group-file" }
  });
  assert.deepEqual(buildOneBotInboundFileUrlRequest({
    messageType: "private",
    senderId: "234567",
    fileId: "/private-file"
  }), {
    endpoint: "get_private_file_url",
    payload: { file_id: "/private-file" }
  });
  assert.equal(buildOneBotInboundFileUrlRequest({ messageType: "group", fileId: "/missing-group" }), null);
});

test("inherits private scope when quoted-message metadata omits its message type", () => {
  const [candidate] = collectQqInboundFileCandidates({
    type: "private_message",
    senderId: "234567",
    replyContext: {
      files: [{ name: "quoted.txt", fileId: "/quoted-file", messageType: "" }]
    }
  });
  assert.equal(candidate.messageType, "private");
  assert.deepEqual(buildOneBotInboundFileUrlRequest(candidate), {
    endpoint: "get_private_file_url",
    payload: { file_id: "/quoted-file" }
  });
});

test("extracts and deduplicates bounded OneBot file metadata without trusting paths", () => {
  const payload = {
    message_type: "group",
    group_id: 123456,
    user_id: 234567,
    message_id: 42,
    raw_message: "[CQ:file,file=../报告&#44;最终版.pdf,file_id=/file-uuid,file_size=2048,url=https://files.example/download]",
    message: [{
      type: "file",
      data: {
        file: "../报告,最终版.pdf",
        file_id: "/file-uuid",
        file_size: "2048",
        url: "https://files.example/download"
      }
    }]
  };
  const files = extractOneBotFileInputs(payload);

  assert.equal(files.length, 1);
  assert.equal(files[0].name, "报告,最终版.pdf");
  assert.equal(files[0].fileId, "/file-uuid");
  assert.equal(files[0].fileSize, 2048);
  assert.equal(files[0].groupId, "123456");
  assert.equal(files[0].senderId, "234567");
  assert.equal(redactQqFileCqCodes(payload.raw_message), "[文件]");
});

test("assigns opaque selectors to current and explicitly quoted files", () => {
  const candidates = collectQqInboundFileCandidates({
    groupId: "123456",
    senderId: "234567",
    files: [{ name: "current.txt", fileId: "current-id", fileSize: 10, messageType: "group" }],
    replyContext: {
      files: [{ name: "quoted.zip", fileId: "quoted-id", fileSize: 20, messageType: "group" }]
    }
  });

  assert.deepEqual(candidates.map((file) => ({ selector: file.selector, name: file.name, origin: file.origin })), [
    { selector: "file-1", name: "current.txt", origin: "当前消息" },
    { selector: "file-2", name: "quoted.zip", origin: "引用消息" }
  ]);
  const summary = formatQqInboundFileCandidates(candidates, { maxBytes: 1024 });
  assert.match(summary, /file-1 · current\.txt/);
  assert.match(summary, /文件尚未下载/);
  assert.doesNotMatch(summary, /current-id|quoted-id/);
});

test("downloads a selected QQ file into the task input directory with a bounded safe name", async () => {
  const root = await mkdtemp(join(tmpdir(), "qq-inbound-file-"));
  try {
    const candidate = {
      selector: "file-1",
      name: "../../资料.txt",
      fileSize: 5
    };
    let resolvedCandidate = null;
    let fetchedUrl = "";
    const saved = await downloadQqInboundFile(candidate, {
      inputDir: root,
      maxBytes: 32,
      resolveDownloadUrl: async (value) => {
        resolvedCandidate = value;
        return "https://files.example/value";
      },
      fetchDownload: async (url) => {
        fetchedUrl = url;
        return new Response("hello", {
          status: 200,
          headers: { "content-length": "5" }
        });
      }
    });

    assert.equal(resolvedCandidate, candidate);
    assert.equal(fetchedUrl, "https://files.example/value");
    assert.equal(saved.name, "资料.txt");
    assert.equal(saved.bytes, 5);
    assert.equal(await readFile(saved.path, "utf8"), "hello");
    assert.equal((await readdir(root)).length, 1);
    assert.ok(saved.path.startsWith(`${root}/file-1-`));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("rejects declared and streamed files over the configured limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "qq-inbound-limit-"));
  try {
    let resolveCalls = 0;
    await assert.rejects(downloadQqInboundFile({
      selector: "file-1",
      name: "large.bin",
      fileSize: 100
    }, {
      inputDir: root,
      maxBytes: 10,
      resolveDownloadUrl: async () => {
        resolveCalls += 1;
        return "https://files.example/large";
      },
      fetchDownload: async () => new Response("ignored")
    }), (error) => error.code === "QQ_FILE_TOO_LARGE");
    assert.equal(resolveCalls, 0);

    await assert.rejects(downloadQqInboundFile({
      selector: "file-2",
      name: "unknown.bin",
      fileSize: 0
    }, {
      inputDir: root,
      maxBytes: 10,
      resolveDownloadUrl: async () => "https://files.example/unknown",
      fetchDownload: async () => new Response("this body is too large")
    }), (error) => error.code === "PAYLOAD_TOO_LARGE");
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
