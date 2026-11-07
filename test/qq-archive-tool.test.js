import assert from "node:assert/strict";
import test from "node:test";
import { executeQqArchiveTool, getQqArchiveState } from "../src/app/qq-archive-tool.js";

const groupEvent = () => ({ groupId: "10001", senderId: "20002", selfId: "99999" });

function message(seq, time, userId, segments, extra = {}) {
  return {
    message_id: `m${seq}`,
    message_seq: String(seq),
    message_type: "group",
    group_id: 10001,
    time,
    user_id: userId,
    sender: { user_id: userId, card: `群友${userId}` },
    message: segments,
    ...extra
  };
}

const text = (value) => ({ type: "text", data: { text: value } });

function historyAction(pages, requests = []) {
  return async (endpoint, payload) => {
    requests.push({ endpoint, payload });
    return { ok: true, body: { data: { messages: pages[String(payload.message_seq)] || [] } } };
  };
}

test("read pages back through server history and numbers files and pictures in old messages", async () => {
  const event = groupEvent();
  const requests = [];
  const logs = [];
  const result = await executeQqArchiveTool({ action: "read", count: 3 }, {
    event,
    callAction: historyAction({
      "0": [
        message(101, 1_790_000_100, "20002", [text("昨天的会议纪要在这"), {
          type: "file", data: { name: "../纪要.pdf", file_id: "/abc-file", file_size: 2048 }
        }]),
        message(102, 1_790_000_200, "30003", [text("那张图"), {
          type: "image", data: { file: "ABC.jpg", url: "https://multimedia.nt.qq.com.cn/download?rkey=x", summary: "" }
        }]),
        message(103, 1_790_000_300, "99999", [text("收到")])
      ]
    }, requests),
    onLog: (details) => logs.push(details)
  });
  assert.equal(result.ok, true);
  assert.equal(requests[0].endpoint, "get_group_msg_history");
  assert.equal(requests[0].payload.group_id, "10001");
  assert.match(result.reply, /\[101\] .*群友20002\(20002\)：昨天的会议纪要在这\[文件：纪要\.pdf\] 〔文件 hf-1：纪要\.pdf · 2\.0 KiB〕/);
  assert.match(result.reply, /\[102\] .*〔图片 hi-1〕/);
  assert.match(result.reply, /\[103\] .*你（Bot）：收到/);
  assert.match(result.reply, /before=101/);
  assert.doesNotMatch(result.reply, /abc-file|rkey/);
  const state = getQqArchiveState(event);
  assert.equal(state.files[0].fileId, "/abc-file");
  assert.equal(state.files[0].messageType, "group");
  assert.equal(state.images[0].image.url, "https://multimedia.nt.qq.com.cn/download?rkey=x");
  // Logs carry counts only, never message text or search terms.
  assert.deepEqual(Object.keys(logs[0]).sort(), [
    "action", "fileCount", "filtered", "imageCount", "outcome", "pageCount", "resultCount", "scannedCount", "targetType", "termCount"
  ]);
});

test("search scans several older pages and resumes before the oldest shown match", async () => {
  const pages = {
    "0": [message(30, 300, "20002", [text("闲聊")]), message(31, 310, "20002", [text("原神 抽卡")])],
    "30": [
      message(20, 200, "30003", [text("原神 角色 一")]),
      message(21, 210, "30003", [text("原神 角色 二")]),
      message(22, 220, "30003", [text("别的")])
    ],
    "20": [message(10, 100, "30003", [text("原神 角色 零")])]
  };
  const event = groupEvent();
  const first = await executeQqArchiveTool({ action: "read", query: "原神", count: 2 }, {
    event, callAction: historyAction(pages)
  });
  assert.equal(first.ok, true);
  assert.match(first.reply, /扫描 5 条，命中 2 条/);
  assert.match(first.reply, /\[21\].*\n\[31\]/);
  assert.match(first.reply, /before=21/);

  // NapCat would answer before=21 with messages up to 21; the anchor is dropped.
  pages["21"] = [message(20, 200, "30003", [text("原神 角色 一")]), message(21, 210, "30003", [text("原神 角色 二")])];
  const next = await executeQqArchiveTool({ action: "read", query: "原神", before: "21", count: 5 }, {
    event, callAction: historyAction(pages)
  });
  assert.match(next.reply, /\[10\].*\n\[20\]/);
  assert.match(next.reply, /最早记录/);

  const byPerson = await executeQqArchiveTool({ action: "read", userId: "20002", count: 5 }, {
    event: groupEvent(), callAction: historyAction(pages)
  });
  assert.match(byPerson.reply, /只看 QQ 20002/);
  assert.doesNotMatch(byPerson.reply, /\[2\d\]/);
});

test("group files list folders and files, and download only selectors this turn listed", async () => {
  const event = groupEvent();
  const calls = [];
  const callAction = async (endpoint, payload) => {
    calls.push({ endpoint, payload });
    if (endpoint === "get_group_root_files") {
      return { ok: true, body: { data: {
        folders: [{ folder_id: "/folder-a", folder_name: "资料", total_file_count: 3 }],
        files: [{ file_id: "/f1", file_name: "规则.docx", file_size: 1024 * 1024 * 3, uploader_name: "群主", upload_time: 1_790_000_000 }]
      } } };
    }
    if (endpoint === "get_group_files_by_folder") {
      return { ok: true, body: { data: { files: [{ file_id: "/f2", file_name: "旧照片.zip", file_size: 10 }] } } };
    }
    throw new Error(`unexpected ${endpoint}`);
  };
  const downloads = [];
  const deps = {
    event,
    callAction,
    maxFileBytes: 50 * 1024 * 1024,
    downloadFile: async (candidate) => {
      downloads.push(candidate);
      return { path: `/task/input/${candidate.selector}-x`, bytes: 10, name: candidate.name, selector: candidate.selector };
    }
  };
  const root = await executeQqArchiveTool({ action: "files" }, deps);
  assert.match(root.reply, /gd-1 \[文件夹\] 资料（3 个文件）/);
  assert.match(root.reply, /gf-1 规则\.docx · 3\.0 MiB · 群主 上传/);
  assert.match(root.reply, /单文件下载上限 50 MiB/);

  const missingFolder = await executeQqArchiveTool({ action: "files", folder: "gd-9" }, deps);
  assert.equal(missingFolder.ok, false);
  const folder = await executeQqArchiveTool({ action: "files", folder: "gd-1" }, deps);
  assert.equal(calls.at(-1).payload.folder_id, "/folder-a");
  assert.match(folder.reply, /「资料」.*\n- gf-2 旧照片\.zip/);

  const unknown = await executeQqArchiveTool({ action: "download", selector: "gf-7" }, deps);
  assert.equal(unknown.ok, false);
  assert.equal(downloads.length, 0);
  const saved = await executeQqArchiveTool({ action: "download", selector: "gf-1" }, deps);
  assert.equal(saved.ok, true);
  assert.deepEqual(
    { selector: downloads[0].selector, fileId: downloads[0].fileId, groupId: downloads[0].groupId, messageType: downloads[0].messageType },
    { selector: "gf-1", fileId: "/f1", groupId: "10001", messageType: "group" }
  );
  const again = await executeQqArchiveTool({ action: "download", selector: "gf-1" }, deps);
  assert.match(again.reply, /已在本轮输入目录/);
  assert.equal(downloads.length, 1);

  const failing = await executeQqArchiveTool({ action: "download", selector: "gf-2" }, {
    ...deps,
    downloadFile: async () => { throw Object.assign(new Error("QQ 没有返回可用的文件下载地址。"), { code: "QQ_FILE_URL_UNAVAILABLE" }); }
  });
  assert.equal(failing.ok, false);
  assert.match(failing.error, /过期或被删除/);
});

test("private chats page their own history and have no group file system", async () => {
  const event = { senderId: "20002", selfId: "99999" };
  const requests = [];
  const read = await executeQqArchiveTool({ action: "read" }, {
    event,
    callAction: historyAction({ "0": [message(5, 50, "20002", [text("你好")], { message_type: "private", group_id: undefined })] }, requests)
  });
  assert.equal(requests[0].endpoint, "get_friend_msg_history");
  assert.equal(requests[0].payload.user_id, "20002");
  assert.match(read.reply, /本私聊/);
  const files = await executeQqArchiveTool({ action: "files" }, { event, callAction: async () => assert.fail("no call") });
  assert.equal(files.ok, false);
});

test("archived pictures never carry local paths into the image reader", async () => {
  const event = groupEvent();
  await executeQqArchiveTool({ action: "read" }, {
    event,
    callAction: historyAction({ "0": [
      message(1, 10, "20002", [{ type: "image", data: { file: "/root/.ssh/id_rsa", url: "file:///etc/passwd" } }]),
      message(2, 20, "20002", [{ type: "image", data: { file: "/tmp/x.png", url: "https://gchat.qpic.cn/a.png" } }]),
      message(3, 30, "20002", [{ type: "image", data: { file: "B7E2.png" } }])
    ] })
  });
  const images = getQqArchiveState(event).images.map((item) => item.image);
  assert.deepEqual(images.map(({ file, url }) => ({ file, url })), [
    { file: "", url: "https://gchat.qpic.cn/a.png" },
    { file: "B7E2.png", url: "" }
  ]);

  const inspected = [];
  const result = await executeQqArchiveTool({ action: "image", selector: "hi-2", mode: "compressed" }, {
    event,
    inspectImage: async (args, candidates) => {
      inspected.push({ args, selectors: candidates.map((candidate) => candidate.selector) });
      return { ok: true, reply: "seen", contentItems: [{ type: "inputText", text: "seen" }] };
    }
  });
  assert.equal(result.ok, true);
  assert.deepEqual(inspected, [{ args: { action: "inspect", selector: "hi-2", mode: "compressed" }, selectors: ["hi-1", "hi-2"] }]);
  const use = await executeQqArchiveTool({ action: "use_image", selector: "hi-1" }, {
    event,
    inspectImage: async (args) => ({ ok: true, reply: args.action })
  });
  assert.equal(use.reply, "use");
  const unknown = await executeQqArchiveTool({ action: "image", selector: "hi-9" }, { event, inspectImage: async () => assert.fail("not listed") });
  assert.equal(unknown.ok, false);
});

test("server history failures are reported honestly and unknown actions are refused", async () => {
  const failed = await executeQqArchiveTool({ action: "read" }, {
    event: groupEvent(),
    callAction: async () => ({ ok: false, error: "NapCat offline" })
  });
  assert.equal(failed.ok, false);
  assert.match(failed.error, /NapCat offline/);
  assert.equal((await executeQqArchiveTool({ action: "delete" }, { event: groupEvent() })).ok, false);
  assert.equal((await executeQqArchiveTool({ action: "read" }, { event: {} })).ok, false);
});
