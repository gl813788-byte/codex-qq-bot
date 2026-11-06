#!/usr/bin/env node
// Release checks and manifest edits for the optional media components, used
// by install-media-tools.sh (`check`, `update`, `apply-pending`). Network
// reads go only to the npm registry and GitHub's latest-release redirect.
//
//   node media-updates.mjs check    --tools DIR [--mode compatible|all|check] [--json]
//   node media-updates.mjs targets  --tools DIR [--all]
//   node media-updates.mjs manifest --tools DIR --pins name=ver,... [--targets JSON]
//   node media-updates.mjs record   --tools DIR --ok 1|0 [--targets JSON] [--detail TEXT]

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  QQ_MEDIA_NPM_COMPONENTS,
  compareQqMediaVersions,
  fetchQqMediaLatestVersions,
  normalizeQqMediaUpdateMode,
  planQqMediaUpdates,
  readQqMediaInstalledVersions,
  readQqMediaUpdateState,
  setQqMediaUpdatePending,
  writeQqMediaUpdateState
} from "../../src/qq-media/media-updates.js";

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!key.startsWith("--")) continue;
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) options[key.slice(2)] = "1";
    else {
      options[key.slice(2)] = value;
      index += 1;
    }
  }
  return options;
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json", "user-agent": "codex-qq-bot-media-updates" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 512 * 1024) throw new Error("response too large");
  return JSON.parse(text);
}

async function resolveRedirect(url) {
  let current = url;
  for (let hop = 0; hop < 4; hop += 1) {
    const response = await fetch(current, { method: "HEAD", redirect: "manual", headers: { "user-agent": "codex-qq-bot-media-updates" }, signal: AbortSignal.timeout(15_000) });
    const location = response.headers.get("location");
    if (![301, 302, 303, 307, 308].includes(response.status) || !location) return current;
    current = new URL(location, current).href;
  }
  return current;
}

async function check(options) {
  const toolsDir = String(options.tools || "");
  const mode = normalizeQqMediaUpdateMode(options.mode);
  const saved = await readQqMediaUpdateState(toolsDir);
  const installed = await readQqMediaInstalledVersions(toolsDir);
  const { latest, errors } = await fetchQqMediaLatestVersions({
    fetchJson,
    resolveRedirect,
    githubBase: process.env.CODEX_REMOTE_CONTACT_MEDIA_GITHUB_BASE || "https://github.com"
  });
  const updates = planQqMediaUpdates(installed, latest, { mode, failed: saved.failedVersions || {} });
  const state = { ...saved, mode, checkedAt: new Date().toISOString(), installed, latest, updates, errors };
  await writeQqMediaUpdateState(toolsDir, state);
  await setQqMediaUpdatePending(toolsDir, updates.some((update) => update.auto));
  return state;
}

function printCheck(state) {
  const lines = [`媒体组件更新检查（${state.mode === "all" ? "自动更新全部新版本" : state.mode === "compatible" ? "自动更新兼容版本" : state.mode === "check" ? "只检查不自动更新" : "已关闭自动更新"}）：`];
  const names = [...QQ_MEDIA_NPM_COMPONENTS.map((component) => component.name), "yt-dlp"];
  for (const name of names) {
    const current = state.installed?.[name] || "";
    const latest = state.latest?.[name] || "";
    const update = (state.updates || []).find((item) => item.name === name);
    const mark = !current ? (update?.missing ? `未安装 → 将安装 ${latest}` : "未安装") : update
      ? `${current} → ${latest}${update.compatible ? "" : "（大版本，需要 ncc media update-all）"}${update.previouslyFailed ? "（上次更新失败已回滚）" : ""}`
      : latest ? `${current}（最新）` : `${current}（没查到最新版本）`;
    lines.push(`  ${name}: ${mark}`);
  }
  if (state.errors?.length) lines.push(`  查询失败：${state.errors.join("；")}`);
  if ((state.updates || []).length) {
    lines.push(state.updates.some((update) => update.auto)
      ? "Hub 空闲时会自动安装；也会在下次启动前装好。想立即更新：npm run ncc -- media update（手机上请先停掉 Bot）。"
      : "可运行 npm run ncc -- media update-all 安装（手机上请先停掉 Bot）。");
  }
  console.log(lines.join("\n"));
}

// Targets for this run: automatic ones for compatible/all, or every update
// for an explicit `update-all`.
async function targets(options) {
  // The saved state keeps the configured mode; `--all` only widens this run.
  const state = await check({ ...options, mode: process.env.CODEX_REMOTE_CONTACT_MEDIA_AUTO_UPDATE || "compatible" });
  const chosen = (state.updates || []).filter((update) => (options.all === "1" ? true : update.auto));
  const npm = Object.fromEntries(chosen.filter((update) => update.name !== "yt-dlp").map((update) => [update.name, update.latest]));
  const ytDlp = chosen.find((update) => update.name === "yt-dlp")?.latest || "";
  return { npm, ytDlp, count: chosen.length };
}

// package.json for the tools directory: keeps what is installed, raises
// anything older than the pinned minimum, and applies update targets.
async function manifest(options) {
  const toolsDir = String(options.tools || "");
  const path = join(toolsDir, "package.json");
  let current = {};
  try {
    current = JSON.parse(await readFile(path, "utf8"));
  } catch {
    current = {};
  }
  const dependencies = { ...(current.dependencies || {}) };
  for (const pair of String(options.pins || "").split(",").filter(Boolean)) {
    const at = pair.lastIndexOf("=");
    const name = pair.slice(0, at);
    const version = pair.slice(at + 1);
    if (!name || !version) continue;
    if (!dependencies[name] || compareQqMediaVersions(String(dependencies[name]).replace(/^[\^~]/, ""), version) < 0) dependencies[name] = version;
  }
  const targetMap = options.targets ? JSON.parse(options.targets) : {};
  for (const [name, version] of Object.entries(targetMap)) dependencies[name] = String(version);
  const next = {
    name: "codex-qq-bot-media-tools",
    private: true,
    description: "Optional local media components for the Codex QQ Bot Hub",
    dependencies: Object.fromEntries(Object.entries(dependencies).sort(([left], [right]) => left.localeCompare(right)))
  };
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next.dependencies;
}

async function record(options) {
  const toolsDir = String(options.tools || "");
  const saved = await readQqMediaUpdateState(toolsDir);
  const ok = options.ok === "1";
  const targetMap = options.targets ? JSON.parse(options.targets) : {};
  const failedVersions = { ...(saved.failedVersions || {}) };
  for (const [name, version] of Object.entries(targetMap)) {
    if (ok) delete failedVersions[name];
    else failedVersions[name] = String(version);
  }
  const installed = await readQqMediaInstalledVersions(toolsDir);
  const updates = planQqMediaUpdates(installed, saved.latest || {}, { mode: saved.mode || "compatible", failed: failedVersions });
  const state = {
    ...saved,
    installed,
    updates,
    failedVersions,
    lastApply: { at: new Date().toISOString(), ok, targets: Object.entries(targetMap).map(([name, version]) => `${name}@${version}`), detail: String(options.detail || "").slice(0, 300) }
  };
  await writeQqMediaUpdateState(toolsDir, state);
  await setQqMediaUpdatePending(toolsDir, updates.some((update) => update.auto));
  return state;
}

const options = parseArgs(process.argv.slice(2));
try {
  if (!options.tools) throw new Error("--tools is required");
  if (options.command === "check") {
    const state = await check(options);
    if (options.json === "1") console.log(JSON.stringify(state));
    else printCheck(state);
  } else if (options.command === "targets") {
    console.log(JSON.stringify(await targets(options)));
  } else if (options.command === "manifest") {
    console.log(JSON.stringify(await manifest(options)));
  } else if (options.command === "record") {
    await record(options);
  } else {
    throw new Error(`unknown command: ${options.command || ""}`);
  }
} catch (error) {
  console.error(`[media-updates] ${String(error?.message || error)}`);
  process.exitCode = 1;
}
