import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildQqMediaUpdateEnv,
  compareQqMediaVersions,
  createQqMediaUpdater,
  fetchQqMediaLatestVersions,
  isQqCompatibleMediaUpdate,
  isWithinQqMediaUpdateWindow,
  normalizeQqMediaUpdateMode,
  parseQqMediaUpdateWindow,
  planQqMediaUpdates,
  readQqMediaInstalledVersions,
  setQqMediaUpdatePending,
  writeQqMediaUpdateState
} from "../src/qq-media/media-updates.js";
import {
  formatQqVoiceToTextReply,
  isQqVoiceToTextCommand,
  needsQqVoiceRetranscription
} from "../src/app/qq-voice-transcription.js";
import { buildQqHumanActionPlan, formatQqHumanActionContext } from "../src/qq-human-behavior.js";

test("versions compare semantically and compatibility follows semver boundaries", () => {
  assert.equal(compareQqMediaVersions("0.6.7", "0.6.9"), -1);
  assert.equal(compareQqMediaVersions("2.0.1", "2.0.1"), 0);
  assert.equal(compareQqMediaVersions("1.10.0", "1.9.9"), 1);
  assert.equal(compareQqMediaVersions("2026.10.26", "2026.11.2"), -1);
  assert.equal(compareQqMediaVersions("1.0.0-beta.1", "1.0.0"), -1);
  assert.equal(isQqCompatibleMediaUpdate("dsh-video-storyboard", "0.6.7", "0.6.9"), true);
  assert.equal(isQqCompatibleMediaUpdate("dsh-video-storyboard", "0.6.7", "0.7.0"), false);
  assert.equal(isQqCompatibleMediaUpdate("sherpa-onnx-node", "2.0.1", "2.3.0"), true);
  assert.equal(isQqCompatibleMediaUpdate("sherpa-onnx-node", "2.0.1", "3.0.0"), false);
  assert.equal(isQqCompatibleMediaUpdate("yt-dlp", "2026.10.26", "2027.1.1"), true);
  assert.equal(normalizeQqMediaUpdateMode("0"), "off");
  assert.equal(normalizeQqMediaUpdateMode("auto"), "compatible");
  assert.equal(normalizeQqMediaUpdateMode("latest"), "all");
  assert.equal(normalizeQqMediaUpdateMode("bogus"), "compatible");
});

test("the update plan marks what may install automatically in each mode", () => {
  const installed = { "dsh-video-storyboard": "0.6.7", "sherpa-onnx-node": "2.0.1", "yt-dlp": "2026.10.26" };
  const latest = { "dsh-video-storyboard": "0.7.0", "sherpa-onnx-node": "2.0.2", "yt-dlp": "2026.10.26", "@meting/core": "1.6.2" };
  const compatible = planQqMediaUpdates(installed, latest, { mode: "compatible", installMissing: false });
  assert.deepEqual(compatible.map((item) => [item.name, item.latest, item.compatible, item.auto]), [
    ["dsh-video-storyboard", "0.7.0", false, false],
    ["sherpa-onnx-node", "2.0.2", true, true]
  ]);
  assert.ok(planQqMediaUpdates(installed, latest, { mode: "all" }).every((item) => item.auto));
  assert.ok(planQqMediaUpdates(installed, latest, { mode: "check" }).every((item) => !item.auto));
  const failed = planQqMediaUpdates(installed, latest, { mode: "all", failed: { "sherpa-onnx-node": "2.0.2" } });
  assert.equal(failed.find((item) => item.name === "sherpa-onnx-node").auto, false);
  assert.equal(failed.find((item) => item.name === "sherpa-onnx-node").previouslyFailed, true);
});

test("installed versions come from package manifests and the yt-dlp version file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "qq-media-versions-"));
  try {
    await mkdir(join(dir, "node_modules", "@meting", "core"), { recursive: true });
    await writeFile(join(dir, "node_modules", "@meting", "core", "package.json"), JSON.stringify({ version: "1.6.2" }));
    await mkdir(join(dir, "bin"), { recursive: true });
    await writeFile(join(dir, "bin", "yt-dlp.version"), "2026.10.26\n");
    assert.deepEqual(await readQqMediaInstalledVersions(dir), { "@meting/core": "1.6.2", "yt-dlp": "2026.10.26" });
    await setQqMediaUpdatePending(dir, true);
    assert.ok((await stat(join(dir, "update-pending"))).isFile());
    await setQqMediaUpdatePending(dir, false);
    await assert.rejects(stat(join(dir, "update-pending")));
    await writeQqMediaUpdateState(dir, { checkedAt: "x" });
    assert.equal(JSON.parse(await readFile(join(dir, "update-state.json"), "utf8")).checkedAt, "x");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("latest releases come from npm 'latest' documents and yt-dlp's release redirect", async () => {
  const urls = [];
  const { latest, errors } = await fetchQqMediaLatestVersions({
    fetchJson: async (url) => {
      urls.push(url);
      if (url.includes("essentia")) throw new Error("offline");
      return { version: url.includes("meting") ? "1.7.0" : "2.0.1" };
    },
    resolveRedirect: async (url) => {
      urls.push(url);
      return "https://github.com/yt-dlp/yt-dlp/releases/tag/2026.11.05";
    }
  });
  assert.equal(latest["@meting/core"], "1.7.0");
  assert.equal(latest["yt-dlp"], "2026.11.05");
  assert.equal(latest["essentia.js"], undefined);
  assert.equal(errors.length, 1);
  assert.ok(urls.includes("https://registry.npmjs.org/@meting%2fcore/latest"));
  assert.ok(urls.includes("https://github.com/yt-dlp/yt-dlp/releases/latest"));
});

test("update windows wrap past midnight and empty means any time", () => {
  const window = parseQqMediaUpdateWindow("23-5");
  assert.deepEqual(window, { start: 23, end: 5 });
  assert.equal(isWithinQqMediaUpdateWindow(window, new Date(2026, 10, 7, 2)), true);
  assert.equal(isWithinQqMediaUpdateWindow(window, new Date(2026, 10, 7, 12)), false);
  assert.equal(isWithinQqMediaUpdateWindow(parseQqMediaUpdateWindow("3-6"), new Date(2026, 10, 7, 4)), true);
  assert.equal(parseQqMediaUpdateWindow(""), null);
  assert.equal(parseQqMediaUpdateWindow("7-7"), null);
  assert.equal(isWithinQqMediaUpdateWindow(null), true);
});

function updaterHarness(overrides = {}) {
  const events = [];
  const runs = [];
  let clock = Date.parse("2026-11-07T04:00:00");
  let saved = {};
  let pending = null;
  let installed = { "dsh-video-storyboard": "0.6.7", "sherpa-onnx-node": "2.0.1", "@meting/core": "1.6.2", "essentia.js": "0.1.3" };
  const releases = { "dsh-video-storyboard": "0.6.9", "sherpa-onnx-node": "2.0.1", "@meting/core": "1.6.2", "essentia.js": "0.1.3" };
  const updater = createQqMediaUpdater({
    toolsDir: "/tools",
    mode: "compatible",
    firstCheckDelayMs: 0,
    checkIntervalMs: 60_000,
    window: null,
    minAvailableBytes: 100,
    readAvailable: async () => 1000,
    fetchJson: async (url) => ({ version: Object.entries(releases).find(([name]) => url.includes(name.replace("/", "%2f")))?.[1] }),
    resolveRedirect: async () => "",
    runUpdate: async ({ targets }) => {
      runs.push(targets.map((target) => target.name));
      installed = { ...installed, "dsh-video-storyboard": "0.6.9" };
      return { ok: true, detail: "[media] 媒体组件已更新" };
    },
    onEvent: (event) => events.push(event.type === "deferred" ? `deferred:${event.reason}` : event.type),
    now: () => clock,
    readInstalled: async () => installed,
    readState: async () => saved,
    writeState: async (value) => {
      saved = JSON.parse(JSON.stringify(value));
    },
    setPending: async (value) => {
      pending = value;
    },
    ...overrides
  });
  return { updater, events, runs, advance: (ms) => { clock += ms; }, getPending: () => pending, getSaved: () => saved, setInstalled: (value) => { installed = value; } };
}

test("the updater checks, installs compatible releases while idle and records the result", async () => {
  const harness = updaterHarness();
  await harness.updater.tick();
  assert.deepEqual(harness.runs, [["dsh-video-storyboard"]]);
  assert.deepEqual(harness.events, ["checked", "applied", "checked"]);
  assert.equal(harness.getPending(), false);
  assert.equal(harness.updater.status().lastApply.ok, true);
  assert.deepEqual(harness.updater.status().updates, []);
  // Nothing new: the next tick inside the interval neither checks nor runs.
  await harness.updater.tick();
  assert.equal(harness.runs.length, 1);
});

test("a busy Bot, low memory or the update window defer the install and leave it pending", async () => {
  for (const [overrides, reason] of [
    [{ isIdle: () => false }, "busy"],
    [{ readAvailable: async () => 10 }, "memory"],
    [{ window: { start: 1, end: 2 } }, "window"]
  ]) {
    const harness = updaterHarness(overrides);
    await harness.updater.tick();
    assert.deepEqual(harness.runs, [], reason);
    assert.ok(harness.events.includes(`deferred:${reason}`), reason);
    assert.equal(harness.getPending(), true, reason);
  }
  const reportOnly = updaterHarness({ mode: "check" });
  await reportOnly.updater.tick();
  assert.deepEqual(reportOnly.runs, []);
  assert.equal(reportOnly.getPending(), false);
  assert.equal(reportOnly.updater.status().updates[0].auto, false);
});

test("a failed update is not retried until a newer release appears", async () => {
  const harness = updaterHarness({ runUpdate: async () => ({ ok: false, detail: "self-test failed" }) });
  await harness.updater.tick();
  assert.equal(harness.updater.status().failedVersions["dsh-video-storyboard"], "0.6.9");
  assert.equal(harness.updater.status().updates[0].previouslyFailed, true);
  assert.equal(harness.getPending(), false);
  harness.advance(120_000);
  await harness.updater.tick();
  assert.equal(harness.events.filter((event) => event === "applied").length, 1);
});

test("the update child gets install variables but no Hub secrets", () => {
  const env = buildQqMediaUpdateEnv({
    PATH: "/usr/bin",
    HOME: "/root",
    HTTPS_PROXY: "http://proxy:1",
    npm_config_registry: "https://registry.npmmirror.com",
    CODEX_REMOTE_CONTACT_API_TOKEN: "secret",
    ANTHROPIC_API_KEY: "secret",
    TAVILY_API_KEY: "secret",
    npm_config__authToken: "secret"
  }, { toolsDir: "/tools", mode: "latest" });
  assert.deepEqual(env, {
    PATH: "/usr/bin",
    HOME: "/root",
    HTTPS_PROXY: "http://proxy:1",
    npm_config_registry: "https://registry.npmmirror.com",
    CODEX_REMOTE_CONTACT_MEDIA_TOOLS_DIR: "/tools",
    CODEX_REMOTE_CONTACT_MEDIA_AUTO_UPDATE: "all"
  });
});

test("/转文字 reuses complete transcripts and explains what it could not do", () => {
  assert.equal(isQqVoiceToTextCommand("转文字"), true);
  assert.equal(isQqVoiceToTextCommand("语音转文字"), true);
  assert.equal(isQqVoiceToTextCommand("转文字吧"), false);
  assert.equal(needsQqVoiceRetranscription([{ ok: true, durationSeconds: 12 }], { autoMaxSeconds: 90 }), false);
  assert.equal(needsQqVoiceRetranscription([{ ok: true, durationSeconds: 90 }], { autoMaxSeconds: 90 }), true);
  assert.equal(needsQqVoiceRetranscription([{ ok: false }]), true);
  assert.equal(needsQqVoiceRetranscription([]), true);
  assert.match(formatQqVoiceToTextReply([], { hasVoice: false }), /回复（引用）一条语音消息/);
  assert.match(formatQqVoiceToTextReply([], { hasVoice: true, available: false }), /还没装语音识别组件/);
  assert.equal(
    formatQqVoiceToTextReply([{ ok: true, text: "晚上一起吃饭吗", durationSeconds: 3 }]),
    "🎙️ 语音转文字\n这条语音（3 秒）：\n晚上一起吃饭吗\n（本机识别，可能有同音错字）"
  );
  assert.match(formatQqVoiceToTextReply([{ ok: true, noSpeech: true }, { ok: false, code: "MEDIA_BUSY" }]), /第 1 条听不出说了什么。\n第 2 条没识别出来（媒体处理正忙/);
});

test("a shared song suggests listening to it like a person taps a music card", () => {
  const event = { groupId: "1", senderId: "2", type: "group_at", hasSelfAtSegment: true, raw: { message_id: 3 }, text: "听听这首" };
  const plan = buildQqHumanActionPlan(event, { mode: "shared_content" }, { media: { videos: 0, audios: 0, unheardAudios: 0, musics: 1 }, mediaAvailable: { music: true } });
  assert.equal(plan.musicChance, 0.8);
  const text = formatQqHumanActionContext({ ...plan, actions: ["listen_music"] });
  assert.match(text, /qq_media\.music listen/);
  const offline = buildQqHumanActionPlan(event, { mode: "shared_content" }, { media: { musics: 1 }, mediaAvailable: { music: false } });
  assert.equal(offline.musicChance, 0);
  assert.ok(!offline.actions.includes("listen_music"));
});

test("the installer manifest keeps updated versions, raises old pins and applies targets", async () => {
  const { runProcess } = await import("../src/process-runner.js");
  const script = new URL("../scripts/media/media-updates.mjs", import.meta.url).pathname;
  const dir = await mkdtemp(join(tmpdir(), "qq-media-manifest-"));
  try {
    await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies: { "dsh-video-storyboard": "0.6.9", "sherpa-onnx-node": "1.9.0" } }));
    await runProcess(process.execPath, [script, "manifest", "--tools", dir, "--pins", "dsh-video-storyboard=0.6.7,sherpa-onnx-node=2.0.1,@meting/core=1.6.2"], { timeoutMs: 10_000 });
    let manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    assert.equal(manifest.name, "codex-qq-bot-media-tools");
    assert.deepEqual(manifest.dependencies, { "@meting/core": "1.6.2", "dsh-video-storyboard": "0.6.9", "sherpa-onnx-node": "2.0.1" });
    await runProcess(process.execPath, [script, "manifest", "--tools", dir, "--pins", "dsh-video-storyboard=0.6.7", "--targets", JSON.stringify({ "dsh-video-storyboard": "0.7.0" })], { timeoutMs: 10_000 });
    manifest = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
    assert.equal(manifest.dependencies["dsh-video-storyboard"], "0.7.0");
    await writeQqMediaUpdateState(dir, { mode: "compatible", latest: { "dsh-video-storyboard": "0.7.1" } });
    await runProcess(process.execPath, [script, "record", "--tools", dir, "--ok", "0", "--targets", JSON.stringify({ "dsh-video-storyboard": "0.7.1" }), "--detail", "self-test failed"], { timeoutMs: 10_000 });
    const state = JSON.parse(await readFile(join(dir, "update-state.json"), "utf8"));
    assert.equal(state.failedVersions["dsh-video-storyboard"], "0.7.1");
    assert.equal(state.lastApply.ok, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("components added after installation are installed with the updates, never from scratch", () => {
  const latest = { "@meting/core": "1.6.2", "essentia.js": "0.1.3", "dsh-video-storyboard": "0.6.9" };
  const existing = planQqMediaUpdates({ "dsh-video-storyboard": "0.6.9" }, latest, { mode: "compatible" });
  assert.deepEqual(existing.map((item) => [item.name, item.missing, item.auto]), [["@meting/core", true, true], ["essentia.js", true, true]]);
  assert.deepEqual(planQqMediaUpdates({}, latest, { mode: "all" }), []);
  assert.ok(planQqMediaUpdates({ "dsh-video-storyboard": "0.6.9" }, latest, { mode: "check" }).every((item) => !item.auto));
});

test("no process room defers the install once instead of failing every minute", async () => {
  const harness = updaterHarness({ acquireCapacity: async () => { throw Object.assign(new Error("busy"), { code: "CODEX_HOST_BUSY" }); } });
  await harness.updater.tick();
  await harness.updater.tick();
  assert.deepEqual(harness.runs, []);
  assert.deepEqual(harness.events, ["checked", "deferred:processes"]);
  assert.equal(harness.getPending(), true);
});
