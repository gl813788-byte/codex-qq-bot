import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Release tracking for the optional media components. Checking is a few
// small HTTP reads (npm "latest" documents and yt-dlp's latest-release
// redirect) and never spawns a process; applying runs the installer's
// `update` command, which is memory-gated, self-tests the result and rolls
// back on failure. The pinned ONNX models are verified by SHA-256 and are
// not part of automatic updates.

export const QQ_MEDIA_NPM_COMPONENTS = Object.freeze([
  Object.freeze({ name: "dsh-video-storyboard", label: "看视频（dsh-video-storyboard）" }),
  Object.freeze({ name: "sherpa-onnx-node", label: "听声音（sherpa-onnx）" }),
  Object.freeze({ name: "@meting/core", label: "音乐解析（Meting）" }),
  Object.freeze({ name: "essentia.js", label: "节奏/调性分析（essentia.js）" })
]);
export const QQ_MEDIA_YTDLP_COMPONENT = Object.freeze({ name: "yt-dlp", label: "视频链接下载（yt-dlp）" });
export const QQ_MEDIA_UPDATE_MODES = Object.freeze(["compatible", "all", "check", "off"]);
export const QQ_MEDIA_UPDATE_STATE_FILE = "update-state.json";
export const QQ_MEDIA_UPDATE_PENDING_FILE = "update-pending";

export function normalizeQqMediaUpdateMode(value, fallback = "compatible") {
  const mode = String(value ?? "").trim().toLowerCase();
  if (["0", "false", "no", "disabled", "disable"].includes(mode)) return "off";
  if (["1", "true", "yes", "auto", "on"].includes(mode)) return "compatible";
  if (["notify", "report"].includes(mode)) return "check";
  if (["latest", "major"].includes(mode)) return "all";
  return QQ_MEDIA_UPDATE_MODES.includes(mode) ? mode : fallback;
}

function parseVersion(value) {
  const match = String(value || "").trim().replace(/^v/i, "").match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+].*)?$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0), /-/.test(String(value)) ? 1 : 0];
}

// Semantic (and yt-dlp's date-like 2026.10.26) version order. A release
// without a prerelease tag sorts after its prerelease.
export function compareQqMediaVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return String(left || "").localeCompare(String(right || ""));
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return a[3] === b[3] ? 0 : a[3] > b[3] ? -1 : 1;
}

// Compatible = same major, and for 0.x the same minor (semver's breaking
// boundary). yt-dlp's date versions are always compatible.
export function isQqCompatibleMediaUpdate(name, current, latest) {
  if (name === QQ_MEDIA_YTDLP_COMPONENT.name) return true;
  const a = parseVersion(current);
  const b = parseVersion(latest);
  if (!a || !b) return false;
  if (a[0] !== b[0]) return false;
  return a[0] !== 0 || a[1] === b[1];
}

// installMissing: an npm component this project added after the media
// tools were installed (e.g. music parsing) is installed with the updates.
// A machine without media tools is never touched.
export function planQqMediaUpdates(installed = {}, latest = {}, { mode = "compatible", failed = {}, installMissing = Object.keys(installed).length > 0 } = {}) {
  const updates = [];
  for (const component of [...QQ_MEDIA_NPM_COMPONENTS, QQ_MEDIA_YTDLP_COMPONENT]) {
    const current = String(installed[component.name] || "");
    const next = String(latest[component.name] || "");
    if (!current && next && installMissing && component.name !== QQ_MEDIA_YTDLP_COMPONENT.name) {
      const previouslyFailed = failed[component.name] === next;
      updates.push({
        name: component.name,
        label: component.label,
        current: "",
        latest: next,
        compatible: true,
        missing: true,
        previouslyFailed,
        auto: !previouslyFailed && (mode === "all" || mode === "compatible")
      });
      continue;
    }
    if (!current || !next || compareQqMediaVersions(current, next) >= 0) continue;
    const compatible = isQqCompatibleMediaUpdate(component.name, current, next);
    const previouslyFailed = failed[component.name] === next;
    updates.push({
      name: component.name,
      label: component.label,
      current,
      latest: next,
      compatible,
      previouslyFailed,
      auto: !previouslyFailed && (mode === "all" || (mode === "compatible" && compatible))
    });
  }
  return updates;
}

async function readJson(path, read = readFile) {
  try {
    return JSON.parse(await read(path, "utf8"));
  } catch {
    return null;
  }
}

export async function readQqMediaInstalledVersions(toolsDir, { read = readFile } = {}) {
  const versions = {};
  for (const component of QQ_MEDIA_NPM_COMPONENTS) {
    const manifest = await readJson(join(toolsDir, "node_modules", ...component.name.split("/"), "package.json"), read);
    if (manifest?.version) versions[component.name] = String(manifest.version);
  }
  // Written by the installer next to the binary; running yt-dlp just to read
  // its version would start a Python process.
  const ytDlp = String(await read(join(toolsDir, "bin", "yt-dlp.version"), "utf8").catch(() => "")).trim();
  if (/^\d{4}\.\d{1,2}\.\d{1,2}(?:\.\d+)?$/.test(ytDlp)) versions[QQ_MEDIA_YTDLP_COMPONENT.name] = ytDlp;
  return versions;
}

// fetchJson(url) → parsed JSON; resolveRedirect(url) → final URL.
export async function fetchQqMediaLatestVersions({ fetchJson, resolveRedirect, githubBase = "https://github.com", signal } = {}) {
  const latest = {};
  const errors = [];
  for (const component of QQ_MEDIA_NPM_COMPONENTS) {
    try {
      const document = await fetchJson(`https://registry.npmjs.org/${component.name.replace("/", "%2f")}/latest`, { signal });
      if (parseVersion(document?.version)) latest[component.name] = String(document.version);
    } catch (error) {
      errors.push(`${component.name}: ${String(error?.message || error).slice(0, 80)}`);
    }
  }
  if (typeof resolveRedirect === "function") {
    try {
      const finalUrl = await resolveRedirect(`${String(githubBase).replace(/\/+$/, "")}/yt-dlp/yt-dlp/releases/latest`, { signal });
      const tag = String(finalUrl || "").match(/\/releases\/tag\/([0-9][0-9.]*)\/?$/)?.[1];
      if (tag) latest[QQ_MEDIA_YTDLP_COMPONENT.name] = tag;
    } catch (error) {
      errors.push(`yt-dlp: ${String(error?.message || error).slice(0, 80)}`);
    }
  }
  return { latest, errors };
}

// "3-6" (local hours, wrapping past midnight) or empty for any time.
export function parseQqMediaUpdateWindow(value) {
  const match = String(value || "").trim().match(/^(\d{1,2})\s*-\s*(\d{1,2})$/);
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start > 23 || end > 24 || start === end) return null;
  return { start, end };
}

export function isWithinQqMediaUpdateWindow(window, date = new Date()) {
  if (!window) return true;
  const hour = date.getHours();
  return window.start < window.end ? hour >= window.start && hour < window.end : hour >= window.start || hour < window.end;
}

export async function readQqMediaUpdateState(toolsDir, { read = readFile } = {}) {
  const state = await readJson(join(toolsDir, QQ_MEDIA_UPDATE_STATE_FILE), read);
  return state && typeof state === "object" ? state : {};
}

export async function writeQqMediaUpdateState(toolsDir, state) {
  const path = join(toolsDir, QQ_MEDIA_UPDATE_STATE_FILE);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, path);
}

export async function setQqMediaUpdatePending(toolsDir, pending) {
  const path = join(toolsDir, QQ_MEDIA_UPDATE_PENDING_FILE);
  if (pending) await writeFile(path, `${new Date().toISOString()}\n`, "utf8");
  else await rm(path, { force: true });
}

// npm packages' install scripts can read the environment, so the update
// child gets the variables an install needs and no Hub secrets.
export function buildQqMediaUpdateEnv(env = {}, { toolsDir = "", mode = "compatible" } = {}) {
  const output = {};
  for (const [key, value] of Object.entries(env)) {
    if (value == null) continue;
    if (["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "TERM", "SHELL", "USER", "PREFIX", "ANDROID_ROOT", "ANDROID_DATA"].includes(key)
      || /^(?:https?_proxy|no_proxy|all_proxy)$/i.test(key)
      || /^npm_config_(?:registry|cache|proxy|https_proxy|noproxy|strict_ssl|cafile|prefix)$/i.test(key)
      || ["NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE", "SSL_CERT_DIR"].includes(key)
      || ["CODEX_REMOTE_CONTACT_MEDIA_GITHUB_BASE", "CODEX_REMOTE_CONTACT_MEDIA_INSTALL_MIN_MB"].includes(key)) {
      output[key] = String(value);
    }
  }
  output.CODEX_REMOTE_CONTACT_MEDIA_TOOLS_DIR = String(toolsDir);
  output.CODEX_REMOTE_CONTACT_MEDIA_AUTO_UPDATE = normalizeQqMediaUpdateMode(mode);
  return output;
}

// The Hub side: check every few hours; apply automatic updates only while
// the Bot is idle, inside the update window, with enough free memory and
// process room. Otherwise the pending marker lets the controller apply them
// before the next start, when the stack is not using the phone's memory.
export function createQqMediaUpdater({
  toolsDir,
  mode = "compatible",
  checkIntervalMs = 12 * 60 * 60 * 1000,
  firstCheckDelayMs = 10 * 60 * 1000,
  retryDelayMs = 60 * 60 * 1000,
  window = null,
  minAvailableBytes = 1500 * 1024 * 1024,
  readAvailable = async () => null,
  isIdle = () => true,
  acquireCapacity = async () => ({ release() {} }),
  runUpdate,
  fetchJson,
  resolveRedirect,
  githubBase = "https://github.com",
  onEvent = () => {},
  now = Date.now,
  toDate = (value) => new Date(value),
  readInstalled = () => readQqMediaInstalledVersions(toolsDir),
  readState = () => readQqMediaUpdateState(toolsDir),
  writeState = (value) => writeQqMediaUpdateState(toolsDir, value),
  setPending = (value) => setQqMediaUpdatePending(toolsDir, value)
} = {}) {
  const normalizedMode = normalizeQqMediaUpdateMode(mode);
  const startedAt = now();
  let running = null;
  let snapshot = { mode: normalizedMode, checkedAt: null, updates: [], errors: [], lastApply: null, deferredReason: null };
  let nextCheckAt = startedAt + Math.max(0, firstCheckDelayMs);
  let loaded = false;

  async function load() {
    if (loaded) return;
    loaded = true;
    const saved = await readState().catch(() => ({}));
    snapshot = { ...snapshot, ...saved, mode: normalizedMode };
    const lastCheck = Date.parse(saved?.checkedAt || "");
    if (Number.isFinite(lastCheck)) nextCheckAt = Math.max(nextCheckAt, lastCheck + checkIntervalMs);
  }

  async function persist() {
    await writeState(snapshot).catch(() => undefined);
    await setPending(snapshot.updates.some((update) => update.auto)).catch(() => undefined);
  }

  async function check() {
    // `ncc media update` records failures and results in the same file.
    const saved = await readState().catch(() => ({}));
    const savedApply = Date.parse(saved?.lastApply?.at || "");
    const ownApply = Date.parse(snapshot.lastApply?.at || "");
    if (Number.isFinite(savedApply) && !(ownApply > savedApply)) {
      snapshot = { ...snapshot, lastApply: saved.lastApply, failedVersions: saved.failedVersions || {} };
    }
    const installed = await readInstalled();
    const { latest, errors } = await fetchQqMediaLatestVersions({ fetchJson, resolveRedirect, githubBase });
    const failed = snapshot.failedVersions || {};
    snapshot = {
      ...snapshot,
      checkedAt: toDate(now()).toISOString(),
      installed,
      latest,
      updates: planQqMediaUpdates(installed, latest, { mode: normalizedMode, failed }),
      errors
    };
    nextCheckAt = now() + checkIntervalMs;
    await persist();
    onEvent({ type: "checked", updates: snapshot.updates, errors });
    return snapshot;
  }

  function blocker(availableBytes) {
    if (!["compatible", "all"].includes(normalizedMode)) return "mode";
    if (!isWithinQqMediaUpdateWindow(window, toDate(now()))) return "window";
    if (!isIdle()) return "busy";
    if (availableBytes != null && availableBytes < minAvailableBytes) return "memory";
    return null;
  }

  async function apply({ manual = false } = {}) {
    const targets = snapshot.updates.filter((update) => (manual ? true : update.auto));
    if (!targets.length) return { ok: true, applied: [] };
    let capacity;
    try {
      capacity = await acquireCapacity();
    } catch {
      // No process or memory room right now (Android's process limit).
      return { ok: false, applied: [], deferred: "processes" };
    }
    try {
      const result = await runUpdate({ mode: manual ? "all" : normalizedMode, targets });
      const failedVersions = { ...(snapshot.failedVersions || {}) };
      for (const target of targets) {
        if (result.ok) delete failedVersions[target.name];
        else failedVersions[target.name] = target.latest;
      }
      snapshot = {
        ...snapshot,
        failedVersions,
        lastApply: { at: toDate(now()).toISOString(), ok: Boolean(result.ok), targets: targets.map((target) => `${target.name}@${target.latest}`), detail: String(result.detail || "").slice(0, 300) }
      };
      onEvent({ type: "applied", ok: Boolean(result.ok), targets, detail: result.detail });
      await check();
      return { ok: Boolean(result.ok), applied: result.ok ? targets : [] };
    } finally {
      capacity?.release?.();
    }
  }

  // One step of the periodic loop; never runs two checks or updates at once.
  function tick() {
    if (normalizedMode === "off" || running) return running;
    running = (async () => {
      await load();
      if (now() >= nextCheckAt) {
        await check().catch((error) => {
          nextCheckAt = now() + retryDelayMs;
          onEvent({ type: "check_failed", error });
        });
      }
      if (!snapshot.updates?.some((update) => update.auto)) return;
      const reason = blocker(await readAvailable().catch(() => null));
      if (reason) {
        if (snapshot.deferredReason !== reason) {
          snapshot = { ...snapshot, deferredReason: reason };
          onEvent({ type: "deferred", reason, updates: snapshot.updates });
        }
        return;
      }
      const result = await apply().catch((error) => {
        onEvent({ type: "apply_failed", error });
        return null;
      });
      if (result?.deferred) {
        if (snapshot.deferredReason !== result.deferred) onEvent({ type: "deferred", reason: result.deferred, updates: snapshot.updates });
        snapshot = { ...snapshot, deferredReason: result.deferred };
        return;
      }
      snapshot = { ...snapshot, deferredReason: null };
    })().finally(() => {
      running = null;
    });
    return running;
  }

  return {
    tick,
    check: async () => {
      await load();
      return check();
    },
    apply: async (options) => {
      await load();
      return apply(options);
    },
    status: () => ({ ...snapshot, mode: normalizedMode, nextCheckAt: toDate(nextCheckAt).toISOString(), running: Boolean(running) })
  };
}
