import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const viewerPath = new URL("../scripts/ncc-log-viewer.mjs", import.meta.url);

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error("Timed out while waiting for log viewer output");
}

test("ncc log viewer is detailed by default and compacts only when requested", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-log-viewer-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "hub.jsonl");
  const query = "search-query-".repeat(12);
  const entries = [
    { ts: "2026-01-01T00:00:00.000Z", level: "debug", category: "qq", message: "QQ message details received", details: { text: "private message" } },
    { ts: "2026-01-01T00:00:01.000Z", level: "info", category: "onebot", message: "OneBot message received", details: { textLength: 14 } },
    { ts: "2026-01-01T00:00:02.000Z", level: "info", category: "search", message: "QQ web lookup started", details: { query, results: [{ title: "result title", url: "https://example.test" }] } },
    { ts: "2026-01-01T00:00:03.000Z", level: "success", category: "codex", message: "Codex CLI finished", details: { durationMs: 42, stderr: "internal detail" } },
    { ts: "2026-01-01T00:00:04.000Z", level: "warn", category: "search", message: "QQ web lookup failed", details: { error: "timeout" } },
    { ts: "2026-01-01T00:00:05.000Z", level: "error", category: "codex", message: "Codex CLI exited with non-zero status", details: { stderr: "secret-prompt-body\nERROR: unexpected status 403 Forbidden" } }
  ];
  await writeFile(filePath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");

  const compact = await execFileAsync(process.execPath, [viewerPath.pathname, filePath, "--plain", "--compact", "--tail", "20"]);
  assert.match(compact.stdout, /Codex CLI 执行完成/);
  assert.match(compact.stdout, /QQ 联网搜索失败/);
  assert.match(compact.stdout, /QQ 联网搜索开始/);
  assert.doesNotMatch(compact.stdout, /收到 OneBot 消息|private message|result title|internal detail/);
  assert.match(compact.stdout, /查询：(?:search-query-)+\S*…/);

  const all = await execFileAsync(process.execPath, [viewerPath.pathname, filePath, "--plain", "--all"]);
  assert.match(all.stdout, /收到 OneBot 消息/);
  assert.match(all.stdout, /private message/);

  const verbose = await execFileAsync(process.execPath, [viewerPath.pathname, filePath, "--plain"]);
  assert.match(verbose.stdout, /private message|result title|internal detail/);
  assert.match(verbose.stdout, /403 Forbidden/);
  assert.doesNotMatch(verbose.stdout, /secret-prompt-body/);
});

test("ncc log viewer localizes startup learning snapshots and model output fields", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-log-startup-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "hub.jsonl");
  const entries = [
    {
      ts: "2026-01-01T00:00:00.000Z",
      level: "debug",
      category: "learning",
      message: "QQ adaptive learning group snapshot",
      details: {
        groupId: "10001",
        learning: { sampleSize: 42, averageTextChars: 8.5, activityLevel: "typical" },
        proactiveIntervals: { judgeEveryMessages: 20, reason: "activity_typical" }
      }
    },
    {
      ts: "2026-01-01T00:00:01.000Z",
      level: "debug",
      category: "codex",
      message: "Codex model output captured",
      details: { taskType: "qq-reply", modelOutput: "模型原样输出" }
    }
  ];
  await writeFile(filePath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");

  const result = await execFileAsync(process.execPath, [viewerPath.pathname, filePath, "--plain", "--verbose"]);
  assert.match(result.stdout, /自动学习数据：总样本数 42，平均文字长度 8\.5，当前活跃度 一般/);
  assert.match(result.stdout, /主动兴趣间隔：消息间隔 20，原因 当前活跃度一般/);
  assert.match(result.stdout, /Codex 模型输出已记录/);
  assert.match(result.stdout, /模型具体输出：模型原样输出/);
});

test("ncc log viewer highlights at-bot QQ entries separately", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-log-color-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "hub.jsonl");
  const entries = [
    {
      ts: "2026-01-01T00:00:00.000Z",
      level: "debug",
      category: "qq",
      message: "QQ message details received",
      details: { messageType: "group", text: "ordinary group message", isAt: false }
    },
    {
      ts: "2026-01-01T00:00:01.000Z",
      level: "debug",
      category: "qq",
      message: "QQ message details received",
      details: { messageType: "group", text: "at bot message", isAt: true, atTargets: ["12345"] }
    },
    {
      ts: "2026-01-01T00:00:02.000Z",
      level: "debug",
      category: "search",
      message: "QQ web lookup trigger matched",
      details: { messageType: "group_at", query: "at bot search", isAt: true }
    },
    {
      ts: "2026-01-01T00:00:03.000Z",
      level: "success",
      category: "lifecycle",
      message: "QQ reply lifecycle completed",
      traceId: "trace-colored-success",
      details: { outcome: "sent", totalDurationMs: 2300 }
    },
    {
      ts: "2026-01-01T00:00:04.000Z",
      level: "warn",
      category: "search",
      message: "QQ web lookup failed",
      details: { error: "search timeout" }
    }
  ];
  await writeFile(filePath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");

  const result = await execFileAsync(process.execPath, [viewerPath.pathname, filePath, "--color", "--tail", "20", "--summary"]);

  assert.match(result.stdout, /\x1b\[94mQQ\s+\x1b\[0m \x1b\[94m收到 QQ 消息详情\x1b\[0m/);
  assert.match(result.stdout, /\x1b\[93mQQ\s+\x1b\[0m \x1b\[93m收到 QQ 消息详情\x1b\[0m/);
  assert.match(result.stdout, /\x1b\[93m搜索\s+\x1b\[0m \x1b\[93mQQ 消息触发联网搜索\x1b\[0m/);
  assert.match(result.stdout, /\x1b\[92m成功\x1b\[0m \x1b\[97m流程\s+\x1b\[0m/);
  assert.match(result.stdout, /\x1b\[92mQQ 回复流程完成\x1b\[0m \x1b\[2m结果：\x1b\[0m\x1b\[92m已发送\x1b\[0m/);
  assert.match(result.stdout, /\x1b\[2m总耗时：\x1b\[0m\x1b\[93m2\.30s\x1b\[0m/);
  assert.match(result.stdout, /\x1b\[93m警告\x1b\[0m \x1b\[96m搜索\s+\x1b\[0m \x1b\[93mQQ 联网搜索失败\x1b\[0m/);
  assert.match(result.stdout, /\x1b\[2m错误：\x1b\[0m\x1b\[91msearch timeout\x1b\[0m/);
  assert.match(result.stdout, /\x1b\[97m日志摘要\x1b\[0m/);
});

test("ncc log follower resets its offset after rotation", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-log-follow-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "hub.jsonl");
  await writeFile(filePath, `${JSON.stringify({
    ts: "2026-01-01T00:00:00.000Z",
    level: "success",
    category: "system",
    message: "before rotation",
    details: {}
  })}\n`, "utf8");

  const child = spawn(process.execPath, [viewerPath.pathname, filePath, "--plain", "--follow"], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  t.after(() => {
    child.kill("SIGTERM");
  });

  await waitFor(() => output.includes("正在跟随日志"));
  await rename(filePath, `${filePath}.1`);
  await writeFile(filePath, `${JSON.stringify({
    ts: "2026-01-01T00:00:01.000Z",
    level: "warn",
    category: "system",
    message: "after rotation",
    details: { payload: "x".repeat(1024) }
  })}\n`, "utf8");

  await waitFor(() => output.includes("after rotation"));
  assert.match(output, /after rotation/);
});

test("ncc log viewer follows a trace, finds slow operations, and prints a summary", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-log-trace-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "hub.jsonl");
  const entries = [
    {
      ts: "2026-07-13T10:00:00.000Z",
      level: "debug",
      category: "lifecycle",
      message: "QQ reply lifecycle started",
      traceId: "trace-main-abcdef",
      details: { groupId: "123", senderId: "456", messageType: "group_at" }
    },
    {
      ts: "2026-07-13T10:00:02.000Z",
      level: "success",
      category: "lifecycle",
      message: "QQ reply lifecycle completed",
      traceId: "trace-main-abcdef",
      details: { groupId: "123", senderId: "456", outcome: "sent", totalDurationMs: 2200, generationDurationMs: 1800, bubbleCount: 2 }
    },
    {
      ts: "2026-07-13T10:00:03.000Z",
      level: "error",
      category: "system",
      message: "unrelated failure",
      traceId: "trace-other",
      details: { groupId: "999", durationMs: 9000 }
    },
    {
      ts: "2026-07-13T10:00:04.000Z",
      level: "success",
      category: "qq",
      message: "QQ cross-session message completed",
      traceId: "trace-cross-session",
      details: {
        operation: "session.send",
        outcome: "success",
        sourceScopeId: "123",
        targetScopeId: "private:30003",
        actorRole: "administrator",
        durationMs: 20
      }
    }
  ];
  await writeFile(`${filePath}.1`, `${JSON.stringify({
    ts: "2026-07-13T09:59:59.000Z",
    level: "info",
    category: "search",
    message: "QQ web lookup started",
    traceId: "trace-main-abcdef",
    details: { groupId: "123", senderId: "456", durationMs: 30 }
  })}\n`, "utf8");
  await writeFile(filePath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");

  const trace = await execFileAsync(process.execPath, [
    viewerPath.pathname,
    filePath,
    "--plain",
    "--compact",
    "--trace",
    "trace-main",
    "--summary"
  ]);
  assert.match(trace.stdout, /\[trace-ma\]/);
  assert.match(trace.stdout, /QQ 回复流程开始/);
  assert.match(trace.stdout, /QQ 回复流程完成/);
  assert.match(trace.stdout, /QQ 联网搜索开始/);
  assert.match(trace.stdout, /日志摘要：3 条，1 条链路/);
  assert.doesNotMatch(trace.stdout, /unrelated failure/);

  const slow = await execFileAsync(process.execPath, [
    viewerPath.pathname,
    filePath,
    "--plain",
    "--slow",
    "2000",
    "--group",
    "123",
    "--search",
    "sent"
  ]);
  assert.match(slow.stdout, /QQ 回复流程完成/);
  assert.doesNotMatch(slow.stdout, /QQ 回复流程开始|unrelated failure/);

  const scoped = await execFileAsync(process.execPath, [
    viewerPath.pathname,
    filePath,
    "--plain",
    "--scope",
    "private:30003",
    "--operation",
    "session"
  ]);
  assert.match(scoped.stdout, /QQ 跨会话消息发送完成/);
  assert.match(scoped.stdout, /目标会话：private:30003/);
  assert.doesNotMatch(scoped.stdout, /QQ 回复流程完成|unrelated failure/);
});

test("ncc log viewer prints help and rejects bad arguments in Chinese", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-log-args-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "hub.jsonl");
  await writeFile(filePath, "", "utf8");

  const help = await execFileAsync(process.execPath, [viewerPath.pathname, filePath, "--help"]);
  assert.match(help.stdout, /^用法：ncc logs \[选项\]/);
  assert.match(help.stdout, /--engine NAME\s+只看某个引擎的智能体日志：codex,claude/);

  for (const [args, message] of [
    [["--bogus"], /错误：未知参数 --bogus/],
    [["--level", "fatal"], /错误：--level 不支持 fatal；可选：debug,info,success,warn,error/],
    [["--engine", "gpt"], /错误：--engine 不支持 gpt/],
    [["--since", "yesterday"], /错误：无法识别的时间 yesterday/],
    [["--tail"], /错误：--tail 需要一个值/]
  ]) {
    await assert.rejects(
      execFileAsync(process.execPath, [viewerPath.pathname, filePath, ...args]),
      (error) => error.code === 2 && message.test(error.stderr) && !/at parseArgs|Error:/.test(error.stderr)
    );
  }
});

test("ncc log viewer aligns CJK columns and formats every duration the same way", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-log-align-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "hub.jsonl");
  const entries = [
    { ts: "2026-01-01T00:00:00.000Z", level: "info", category: "qq", message: "m1", details: {} },
    { ts: "2026-01-01T00:00:01.000Z", level: "info", category: "onebot", message: "m2", details: {} },
    { ts: "2026-01-01T00:00:02.000Z", level: "warn", category: "memory", message: "m3", details: {} },
    {
      ts: "2026-01-01T00:00:03.000Z",
      level: "success",
      category: "lifecycle",
      message: "m4",
      details: { outcome: "command", modelDurationMs: 1500, attemptTimeoutMs: 6500, replyChars: 12 }
    }
  ];
  await writeFile(filePath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");

  const { stdout } = await execFileAsync(process.execPath, [viewerPath.pathname, filePath, "--plain"]);
  const width = (text) => [...text].reduce((sum, character) => sum + (/[⺀-꓏＀-｠]/.test(character) ? 2 : 1), 0);
  const columns = stdout.trim().split("\n").map((line) => width(line.slice(0, line.search(/m\d/))));
  assert.equal(new Set(columns).size, 1, `message column differs: ${columns.join(",")}`);
  assert.match(stdout, /结果：指令已处理 · 模型耗时：1\.50s · 单次超时：6\.50s · 回复字符数：12/);
});

test("ncc log viewer filters the whole rotated history instead of each file's tail", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-log-history-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "hub.jsonl");
  const noise = (index) => JSON.stringify({
    ts: new Date(Date.UTC(2026, 9, 2, 0, 0, index)).toISOString(),
    level: "debug",
    category: "memory",
    message: "noise",
    details: { pad: "x".repeat(400) }
  });
  // About 1.3 MB in the rotated file; the old reader only looked at its last
  // 640 KB, so this success entry near the start was never shown.
  const rotated = [JSON.stringify({ ts: "2026-10-01T00:00:00.000Z", level: "success", category: "agent", message: "older agent turn", details: {} })];
  for (let index = 0; index < 3000; index += 1) rotated.push(noise(index));
  await writeFile(`${filePath}.1`, `${rotated.join("\n")}\n`, "utf8");
  await writeFile(filePath, `${Array.from({ length: 20 }, (_, index) => noise(4000 + index)).join("\n")}\n`, "utf8");

  const { stdout } = await execFileAsync(process.execPath, [viewerPath.pathname, filePath, "--plain", "--level", "success"]);
  assert.match(stdout, /older agent turn/);
});

test("ncc log viewer card layout groups by day, quotes chat and wraps to the width", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-log-card-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, "hub.jsonl");
  const entries = [
    {
      ts: "2026-10-24T14:22:14.000Z",
      level: "debug",
      category: "qq",
      message: "QQ message details received",
      traceId: "a1b2c3d4-trace",
      details: {
        senderName: "小明",
        senderId: "10001",
        text: "[CQ:image,summary=[动画表情],file=a.jpg,url=https://x.test/a?rkey=[redacted]] 你好呀",
        groupId: "20002",
        imageCount: 1,
        hasReply: false
      }
    },
    {
      ts: "2026-10-24T14:22:15.000Z",
      level: "success",
      category: "lifecycle",
      message: "QQ reply lifecycle completed",
      traceId: "a1b2c3d4-trace",
      details: {
        outcome: "sent",
        groupId: "20002",
        decisionReason: "model final decision",
        totalDurationMs: 76137,
        generationDurationMs: 58345,
        proactive: false,
        failedBubbleCount: 0,
        modelOutput: "这是一段很长的模型输出".repeat(12)
      }
    }
  ];
  await writeFile(filePath, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`, "utf8");
  const width = (text) => [...text].reduce((sum, character) => sum + (/[⺀-꓏＀-｠]/.test(character) ? 2 : 1), 0);

  const { stdout } = await execFileAsync(process.execPath, [viewerPath.pathname, filePath, "--pretty", "--plain", "--width", "60"]);
  const lines = stdout.trimEnd().split("\n");
  assert.match(lines[0], /^── 2026-10-2\d 周.+ ─+$/);
  assert.equal(lines.filter((line) => line.startsWith("── ")).length, 1, "one divider for one day");
  assert.match(stdout, /\d{2}:\d{2}:\d{2} · 调试 QQ +收到 QQ 消息详情 #a1b2c3d4/);
  assert.match(stdout, /  │ 小明 \(10001\)：\[图片 动画表情\] 你好呀/);
  assert.match(stdout, /✓ 成功 流程 +QQ 回复流程完成 #a1b2c3d4 1\.27m/);
  assert.match(stdout, /结果 已发送/);
  assert.doesNotMatch(stdout, /是否主动发言|失败气泡|是否引用/);
  for (const line of lines) assert.ok(width(line) <= 60, `line wider than 60 columns: ${line}`);

  const verbose = await execFileAsync(process.execPath, [viewerPath.pathname, filePath, "--pretty", "--plain", "--width", "60", "--verbose"]);
  assert.match(verbose.stdout, /是否主动发言 否/);

  const oneLine = await execFileAsync(process.execPath, [viewerPath.pathname, filePath, "--plain"]);
  assert.equal(oneLine.stdout.trimEnd().split("\n").length, 2);
});
