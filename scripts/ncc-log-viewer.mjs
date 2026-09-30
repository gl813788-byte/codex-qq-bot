#!/usr/bin/env node
import { open, readdir, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import {
  compactLogDisplayText,
  formatLogDetailValue,
  formatLogError,
  formatLogMessage,
  getLogCategoryLabel,
  getLogDetailLabel,
  getLogLevelLabel
} from "../src/log-presentation.js";
import { summarizeProcessDiagnostics } from "../src/process-diagnostics.js";
import {
  AGENT_ENGINE_IDS,
  canonicalLogCategory,
  expandLogCategoryFilter,
  getAgentEngine,
  resolveLogEngine
} from "../src/infrastructure/agent/agent-engines.js";

// Every label and value comes from src/log-presentation.js, the table the
// dashboard also uses, so the terminal and browser show the same words.
const logLevels = ["debug", "info", "success", "warn", "error"];
const logCategories = ["system", "qq", "onebot", "agent", "codex", "web", "search", "interest", "learning", "memory", "command", "lifecycle"];
const categoryColumnWidth = 6;
const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
  white: "\x1b[37m",
  brightRed: "\x1b[91m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightBlue: "\x1b[94m",
  brightCyan: "\x1b[96m",
  brightMagenta: "\x1b[95m",
  brightWhite: "\x1b[97m"
};
const levelColors = {
  debug: "gray",
  info: "brightBlue",
  success: "brightGreen",
  warn: "brightYellow",
  error: "brightRed"
};
const categoryColors = {
  system: "white",
  qq: "brightBlue",
  onebot: "cyan",
  agent: "brightMagenta",
  codex: "brightMagenta",
  web: "blue",
  search: "brightCyan",
  interest: "yellow",
  learning: "green",
  memory: "green",
  command: "brightYellow",
  lifecycle: "brightWhite"
};
const engineColors = { codex: "brightGreen", claude: "brightYellow" };
const traceColors = ["brightBlue", "brightCyan", "brightMagenta", "brightYellow", "green", "magenta"];

// --compact shows only these fields, in this order. --verbose (the default)
// shows them first, then every other field in logged order.
const keyFieldsByCategory = {
  lifecycle: ["outcome", "messageType", "groupId", "triggerMode", "decisionReason", "totalDurationMs", "durationMs", "error"],
  search: ["query", "reason", "provider", "providers", "durationMs", "resultCount", "error"],
  interest: [
    "shouldReply", "reason", "triggerMode", "messageCount", "judgeEveryMessages",
    "activityAdvancedDuringJudge", "additionalActivityCount", "ruleScore", "labels", "blockers"
  ]
};
const defaultKeyFields = [
  "operation", "action", "outcome", "status", "code", "errorCode", "error", "reason", "source", "url",
  "durationMs", "totalDurationMs", "modelDurationMs", "modelTemperature", "deadlineRenewalCount", "resultCount",
  "scopeType", "scopeId", "sourceScopeId", "targetScopeId", "targetType", "actorRole", "actorUserId",
  "toolNamespace", "toolName", "toolAction", "toolCallId", "toolRound",
  "entryId", "variantId", "title", "titles", "matchedTerms",
  "appliedCount", "rejectedCount", "removedCount", "entryCount", "scopeCount", "titleCount", "slangCount", "variantCount",
  "matchedTitleCount", "recordedHitCount", "contextExtendedCount", "hitCount", "totalHits", "recentHits", "retainedOccurrenceCount",
  "deleted", "modelDecision", "modelOutput", "outputChars", "outputTruncated",
  "reviewPipeline", "reviewStage", "interestRecommendation", "interestComplexity", "interestEvidenceConcerns", "interestModelOutput",
  "mainModel", "mainModelDurationMs", "mainModelDecision", "mainModelOutput",
  "contentMode", "researchRounds", "researchToolCalls", "researchToolKinds", "researchQueries", "failedToolCalls",
  "proactiveKind", "interestGateRequired", "interestGateApproved", "interestGateProvider", "interestGateModel", "interestGateTask", "mainContentRequired",
  "topicStartShouldStart", "topicStartMode", "topicStartInterest", "topicStartReason", "topicStartJudgeProvider", "topicStartJudgeModel", "topicStartJudgeDurationMs",
  "privateStartShouldStart", "privateStartInterest", "privateStartReason", "privateStartJudgeProvider", "privateStartJudgeModel", "privateStartJudgeDurationMs", "spontaneityRoll"
];

class CliError extends Error {}

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof CliError)) throw error;
  process.stderr.write(`错误：${error.message}\n发送 --help 查看全部选项。\n`);
  process.exit(2);
}
if (options.help) {
  process.stdout.write(usage());
  process.exit(0);
}
if (!options.file) {
  process.stderr.write(usage());
  process.exit(2);
}

await printExisting(options);
if (options.follow) await followFile(options);

function parseArgs(args) {
  const output = {
    file: "",
    help: false,
    tail: 80,
    follow: false,
    level: "",
    category: "",
    engine: "",
    plain: !process.stdout.isTTY,
    all: false,
    verbose: true,
    traceId: "",
    query: "",
    groupId: "",
    senderId: "",
    scopeId: "",
    operation: "",
    sinceMs: null,
    untilMs: null,
    minDurationMs: 0,
    summary: false,
    json: false
  };
  const valueOf = (index, flag) => {
    const value = args[index];
    if (value == null || value === "" || (value.startsWith("-") && !/^-\d/.test(value))) {
      throw new CliError(`${flag} 需要一个值`);
    }
    return value;
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!output.file && !arg.startsWith("-")) {
      output.file = arg;
    } else if (arg === "-h" || arg === "--help") {
      output.help = true;
    } else if (arg === "-n" || arg === "--tail") {
      const tail = Number(valueOf(++index, arg));
      if (!Number.isInteger(tail) || tail < 1) throw new CliError(`${arg} 需要正整数`);
      output.tail = Math.min(1000, tail);
    } else if (arg === "-f" || arg === "--follow") {
      output.follow = true;
    } else if (arg === "--level") {
      output.level = validateChoices(valueOf(++index, arg), logLevels, arg);
    } else if (arg === "--errors") {
      output.level = "warn,error";
    } else if (arg === "--category") {
      output.category = validateChoices(valueOf(++index, arg), logCategories, arg);
    } else if (arg === "--engine") {
      output.engine = validateChoices(valueOf(++index, arg), AGENT_ENGINE_IDS, arg);
    } else if (arg === "--plain") {
      output.plain = true;
    } else if (arg === "--color" || arg === "--colour") {
      output.plain = false;
    } else if (arg === "--all") {
      output.all = true;
    } else if (arg === "--verbose" || arg === "--detail" || arg === "--details") {
      output.verbose = true;
    } else if (arg === "--compact" || arg === "--no-verbose") {
      output.verbose = false;
    } else if (arg === "--trace") {
      output.traceId = valueOf(++index, arg).toLowerCase();
    } else if (arg === "--search" || arg === "--query" || arg === "-q") {
      output.query = valueOf(++index, arg).toLowerCase();
    } else if (arg === "--group") {
      output.groupId = valueOf(++index, arg);
    } else if (arg === "--sender") {
      output.senderId = valueOf(++index, arg);
    } else if (arg === "--scope") {
      output.scopeId = valueOf(++index, arg).toLowerCase();
    } else if (arg === "--operation" || arg === "--op") {
      output.operation = valueOf(++index, arg).toLowerCase();
    } else if (arg === "--since") {
      output.sinceMs = parseTimeFilter(valueOf(++index, arg), { relativeFromNow: true });
    } else if (arg === "--until") {
      output.untilMs = parseTimeFilter(valueOf(++index, arg));
    } else if (arg === "--slow") {
      const next = args[index + 1];
      if (next && !next.startsWith("-")) {
        const threshold = Number(args[++index]);
        if (!Number.isFinite(threshold) || threshold <= 0) throw new CliError("--slow 的阈值需要是正数毫秒");
        output.minDurationMs = threshold;
      } else {
        output.minDurationMs = 1000;
      }
    } else if (arg === "--summary") {
      output.summary = true;
    } else if (arg === "--json") {
      output.json = true;
      output.plain = true;
    } else {
      throw new CliError(`未知参数 ${arg}`);
    }
  }
  return output;
}

function validateChoices(value, allowed, flag) {
  const requested = [...splitFilter(value)];
  const unknown = requested.filter((item) => !allowed.includes(item));
  if (requested.length === 0 || unknown.length > 0) {
    throw new CliError(`${flag} 不支持 ${unknown.join(",") || value}；可选：${allowed.join(",")}`);
  }
  return requested.join(",");
}

async function printExisting(options) {
  const hasDiagnosticFilter = Boolean(options.traceId || options.query || options.groupId || options.senderId || options.scopeId || options.operation
    || options.sinceMs != null || options.untilMs != null || options.minDurationMs > 0);
  const body = await readLogHistory(options.file, Math.max(hasDiagnosticFilter ? 1024 * 1024 : 256 * 1024, options.tail * 8192)).catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  const entries = body
    .split("\n")
    .filter(Boolean)
    .map(parseLine)
    .filter((entry) => entry && matchesViewerFilters(entry, options))
    .slice(-options.tail);
  if (options.json) {
    for (const entry of entries) process.stdout.write(`${JSON.stringify(entry)}\n`);
  } else {
    for (const entry of entries) process.stdout.write(`${renderEntry(entry, options)}\n`);
  }
  if (options.summary) process.stdout.write(`${renderSummary(entries, options)}\n`);
}

async function readLogHistory(file, bytesPerFile) {
  const directory = dirname(file);
  const base = basename(file);
  const names = await readdir(directory).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const files = names
    .filter((name) => name === base || new RegExp(`^${escapeRegExp(base)}\\.\\d+$`).test(name))
    .sort((left, right) => rotationIndex(right, base) - rotationIndex(left, base))
    .map((name) => join(directory, name));
  const chunks = [];
  for (const current of files) chunks.push(await readTail(current, bytesPerFile));
  return chunks.join("\n");
}

function rotationIndex(name, base) {
  if (name === base) return 0;
  const value = Number(name.slice(base.length + 1));
  return Number.isFinite(value) ? value : 999;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function followFile(options) {
  const initial = await stat(options.file).catch(() => null);
  let offset = initial?.size || 0;
  let fileIdentity = initial ? getFileIdentity(initial) : "";
  let reading = false;
  process.stdout.write(color(`正在跟随日志：${options.file}（Ctrl+C 退出）\n`, "dim", options));
  setInterval(async () => {
    if (reading) return;
    reading = true;
    try {
      const current = await stat(options.file).catch(() => null);
      if (!current) return;
      const currentIdentity = getFileIdentity(current);
      if (currentIdentity !== fileIdentity || current.size < offset) {
        offset = 0;
        fileIdentity = currentIdentity;
      }
      if (current.size === offset) return;
      const handle = await open(options.file, "r");
      try {
        const opened = await handle.stat();
        const openedIdentity = getFileIdentity(opened);
        if (openedIdentity !== fileIdentity || opened.size < offset) {
          offset = 0;
          fileIdentity = openedIdentity;
        }
        if (opened.size === offset) return;
        const size = opened.size - offset;
        const buffer = Buffer.alloc(size);
        const { bytesRead } = await handle.read(buffer, 0, size, offset);
        offset += bytesRead;
        for (const line of buffer.subarray(0, bytesRead).toString("utf8").split("\n").filter(Boolean)) {
          const rendered = renderLine(line, options);
          if (rendered) process.stdout.write(`${rendered}\n`);
        }
      } finally {
        await handle.close().catch(() => null);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        process.stderr.write(`日志跟随读取失败：${error.message}\n`);
      }
    } finally {
      reading = false;
    }
  }, 1000);
  await new Promise(() => {});
}

function getFileIdentity(entry) {
  return `${entry.dev ?? ""}:${entry.ino ?? ""}:${entry.birthtimeMs ?? ""}`;
}

async function readTail(file, bytes) {
  const handle = await open(file, "r");
  try {
    const { size } = await handle.stat();
    const readSize = Math.min(size, bytes);
    const buffer = Buffer.alloc(readSize);
    await handle.read(buffer, 0, readSize, Math.max(0, size - readSize));
    return buffer.toString("utf8");
  } finally {
    await handle.close().catch(() => null);
  }
}

function renderLine(line, options) {
  const entry = parseLine(line);
  if (!entry || !matchesViewerFilters(entry, options)) return null;
  return options.json ? JSON.stringify(entry) : renderEntry(entry, options);
}

function parseLine(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function matchesViewerFilters(entry, options) {
  if (options.level && !splitFilter(options.level).has(String(entry.level || "").toLowerCase())) return false;
  if (options.category && !expandLogCategoryFilter(splitFilter(options.category)).has(String(entry.category || "").toLowerCase())) return false;
  if (options.engine && !splitFilter(options.engine).has(resolveLogEngine(entry))) return false;
  if (options.traceId && !String(entry.traceId || "").toLowerCase().startsWith(options.traceId)) return false;
  if (options.operation && !matchesOperation(entry.details?.operation, splitFilter(options.operation))) return false;
  const scopeIds = getLogScopeIds(entry.details);
  if (options.scopeId && !matchesScopeId(scopeIds, options.scopeId)) return false;
  if (options.groupId && !matchesGroupId(entry.details, scopeIds, options.groupId)) return false;
  if (options.senderId && !matchesSenderId(entry.details, scopeIds, options.senderId)) return false;
  const timestamp = Date.parse(String(entry.ts || ""));
  if (options.sinceMs != null && (!Number.isFinite(timestamp) || timestamp < options.sinceMs)) return false;
  if (options.untilMs != null && (!Number.isFinite(timestamp) || timestamp > options.untilMs)) return false;
  if (options.minDurationMs > 0 && getEntryDurationMs(entry) < options.minDurationMs) return false;
  if (options.query) {
    const searchable = JSON.stringify(entry).toLowerCase();
    if (!searchable.includes(options.query)) return false;
  }
  const level = String(entry.level || "info").toLowerCase();
  const hasExplicitFilter = Boolean(options.level || options.category || options.traceId || options.query || options.groupId
    || options.senderId || options.scopeId || options.operation || options.sinceMs != null || options.untilMs != null || options.minDurationMs > 0);
  if (!options.verbose && level === "debug" && !hasExplicitFilter) return false;
  if (!options.verbose && !options.all && !hasExplicitFilter && !isDefaultVisible(entry, level)) return false;
  return true;
}

function matchesOperation(value, operations) {
  const operation = String(value || "").trim().toLowerCase();
  return Boolean(operation && [...operations].some((filter) => operation === filter || operation.startsWith(`${filter}.`)));
}

function getLogScopeIds(details = {}) {
  return [
    details.scopeId,
    details.sourceScopeId,
    details.targetScopeId,
    details.groupId ? String(details.groupId) : "",
    details.senderId ? `private:${details.senderId}` : ""
  ].map((value) => String(value || "").trim().toLowerCase()).filter(Boolean);
}

function matchesScopeId(scopeIds, filter) {
  const candidates = expandScopeId(filter);
  return scopeIds.some((scopeId) => [...expandScopeId(scopeId)].some((candidate) => candidates.has(candidate)));
}

function expandScopeId(value) {
  const normalized = String(value || "").trim().toLowerCase();
  const output = new Set(normalized ? [normalized] : []);
  if (normalized.startsWith("group:")) output.add(normalized.slice("group:".length));
  else if (/^[1-9][0-9]{4,12}$/.test(normalized)) output.add(`group:${normalized}`);
  return output;
}

function matchesGroupId(details, scopeIds, groupId) {
  const normalized = String(groupId || "");
  return String(details?.groupId ?? "") === normalized
    || matchesScopeId(scopeIds.filter((scopeId) => !scopeId.startsWith("private:")), normalized);
}

function matchesSenderId(details, scopeIds, senderId) {
  const normalized = String(senderId || "");
  return [details?.senderId, details?.actorUserId, details?.targetUserId]
    .some((value) => String(value ?? "") === normalized)
    || scopeIds.includes(`private:${normalized}`.toLowerCase());
}

function renderEntry(entry, options) {
  const level = String(entry.level || "info").toLowerCase();
  const category = canonicalLogCategory(entry.category) || "system";
  const engine = resolveLogEngine(entry);
  const levelColor = levelColors[level] || "white";
  const categoryColor = colorForCategory(entry, category);
  const messageColor = ["error", "warn", "success"].includes(level) ? levelColor : categoryColor;
  const header = [
    color(formatLocalTimestamp(entry.ts), "dim", options),
    color(padDisplay(getLogLevelLabel(level), 4), levelColor, options),
    color(padDisplay(getLogCategoryLabel(category), categoryColumnWidth), categoryColor, options),
    engine ? color(getAgentEngine(engine).name, engineColors[engine] || "white", options) : null,
    entry.traceId ? color(`[${shortTraceId(entry.traceId)}]`, colorForTrace(entry.traceId), options) : null,
    color(formatLogMessage(entry.message || "", "zh"), messageColor, options)
  ].filter(Boolean).join(" ");
  const fields = collectFields(entry, options);
  return fields.length > 0 ? `${header} ${renderFields(fields, entry, options)}` : header;
}

function isDefaultVisible(entry, level) {
  return ["success", "warn", "error"].includes(level)
    || ["Codex QQ Bot hub started", "QQ web lookup started"].includes(String(entry.message || ""));
}

function colorForCategory(entry, category) {
  if (isAtBotEntry(entry)) return "brightYellow";
  return categoryColors[category] || "white";
}

function colorForTrace(traceId) {
  let hash = 0;
  for (const character of String(traceId || "")) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
  return traceColors[hash % traceColors.length];
}

function isAtBotEntry(entry) {
  const details = entry?.details || {};
  const messageType = String(details.messageType || details.type || "").toLowerCase();
  return messageType === "group_at"
    || details.isAt === true
    || details.hasSelfAtSegment === true;
}

// One field list for every category: key fields first, then (verbose) the
// rest. Each field is { key, label, value, text } so coloring uses the key.
function collectFields(entry, options) {
  const details = entry.details && typeof entry.details === "object" ? entry.details : {};
  const keyFields = keyFieldsByCategory[canonicalLogCategory(entry.category)] || defaultKeyFields;
  const ordered = [
    ...keyFields.filter((key) => Object.hasOwn(details, key)),
    ...(options.verbose ? Object.keys(details).filter((key) => !keyFields.includes(key)) : [])
  ];
  const maxLength = options.verbose ? 900 : 120;
  const fields = [];
  for (const key of ordered) {
    const value = details[key];
    if (value == null || value === "" || (Array.isArray(value) && value.length === 0)) continue;
    if (key === "stderr" || key === "stdout") {
      const diagnostics = summarizeProcessDiagnostics({ [key]: value });
      if (diagnostics.lines.length === 0) continue;
      fields.push({ key, label: getLogDetailLabel("diagnosticLines", "zh"), value, text: compactLogDisplayText(diagnostics.lines.join("；"), maxLength) });
      continue;
    }
    const text = formatFieldValue(value, key);
    if (text === "") continue;
    fields.push({ key, label: getLogDetailLabel(key, "zh"), value, text: compactLogDisplayText(text, maxLength) });
  }
  return fields;
}

function formatFieldValue(value, key) {
  if (value == null) return "";
  if (/error/i.test(key) && !Array.isArray(value)) return formatLogError(value, "zh");
  if (isDurationKey(key) && Number.isFinite(Number(value)) && typeof value !== "boolean") return formatMs(value);
  if (key === "providers" && Array.isArray(value)) return value.join(" → ");
  if (key === "results" && Array.isArray(value)) return value.map(formatSearchResult).join("；");
  if (typeof value === "boolean") return value ? "是" : "否";
  if (Array.isArray(value)) return value.map((item) => formatFieldValue(item, key)).filter(Boolean).join("、");
  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([, item]) => item != null && item !== "")
      .map(([itemKey, item]) => `${getLogDetailLabel(itemKey, "zh")} ${formatFieldValue(item, itemKey)}`)
      .join("，");
  }
  if (typeof value === "string") return String(formatLogDetailValue(value, key, "zh"));
  return String(value);
}

function isDurationKey(key) {
  return /(?:^d|D)urationMs$|(?:^t|T)imeoutMs$/.test(String(key || ""));
}

function formatSearchResult(result, index) {
  if (!result || typeof result !== "object") return formatFieldValue(result, "");
  const parts = [
    result.title ? `${index + 1}. ${result.title}` : `${index + 1}.`,
    result.url,
    result.snippet ? String(result.snippet).slice(0, 180) : "",
    result.source || result.provider
  ];
  return parts.filter(Boolean).join("，");
}

function renderFields(fields, entry, options) {
  if (options.plain) return fields.map((field) => `${field.label}：${field.text}`).join(" · ");
  return fields
    .map((field) => `${color(`${field.label}：`, "dim", options)}${color(field.text, colorForField(field, entry), options)}`)
    .join(color(" · ", "dim", options));
}

function colorForField({ key, value, text }, entry) {
  const normalized = String(text || "").toLowerCase();
  if (/error|blockers/i.test(key) || /失败|错误|超时|error|timeout/.test(normalized)) return "brightRed";
  if (isDurationKey(key)) return colorForDuration(Number(value));
  if (/^(reason|decisionReason|modelReason|penalty)$/.test(key) || /Reason$/.test(key)) return "yellow";
  if (/url$/i.test(key)) return "brightBlue";
  if (/^(outcome|status|sendStatus|shouldReply|enabled|eligible)$/.test(key) || typeof value === "boolean") return colorForStateValue(normalized);
  if (/provider|preset|model$|Model$/i.test(key)) return "brightMagenta";
  if (/(?:Id|Ids)$/.test(key)) return "brightCyan";
  if (/^(query|text|title|titles|summary|modelReplyStyle|modelOutput)$/.test(key)) return "brightWhite";
  if (/^(triggerMode|messageType|source|channel|postType|noticeType|operation|action)$/.test(key)) return "brightYellow";
  if (typeof value === "number") return "cyan";
  if (entry?.level === "error") return "brightRed";
  return "gray";
}

function colorForStateValue(value) {
  if (/失败|错误|不可用|未开启|^否$/.test(value)) return "brightRed";
  if (/已发送|成功|找到了结果|已处理|已完成|已保存|^是$|开启|正常/.test(value)) return "brightGreen";
  if (/已排队|等待|处理中|运行中/.test(value)) return "brightBlue";
  if (/警告|跳过|忽略|沉默/.test(value)) return "brightYellow";
  return "gray";
}

function colorForDuration(milliseconds) {
  if (!Number.isFinite(milliseconds)) return "cyan";
  if (milliseconds >= 10_000) return "brightRed";
  if (milliseconds >= 2_000) return "brightYellow";
  return "cyan";
}

function formatMs(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  if (number >= 60_000) return `${(number / 60_000).toFixed(number >= 600_000 ? 1 : 2)}m`;
  if (number >= 1000) return `${(number / 1000).toFixed(number >= 10_000 ? 1 : 2)}s`;
  return `${number}ms`;
}

// CJK characters take two terminal columns; pad by columns so the level and
// category columns line up.
function padDisplay(text, width) {
  const value = String(text || "");
  return value + " ".repeat(Math.max(0, width - displayWidth(value)));
}

function displayWidth(text) {
  let width = 0;
  for (const character of String(text || "")) {
    width += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(character) ? 2 : 1;
  }
  return width;
}

function formatLocalTimestamp(value) {
  const date = new Date(String(value || ""));
  if (!Number.isFinite(date.getTime())) return String(value || "").replace("T", " ").replace(/\.\d+Z$/, "");
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function shortTraceId(value) {
  const text = String(value || "");
  return text.length <= 12 ? text : text.slice(0, 8);
}

function splitFilter(value) {
  return new Set(String(value || "").toLowerCase().split(/[,|\s]+/).map((item) => item.trim()).filter(Boolean));
}

function getEntryDurationMs(entry) {
  const details = entry?.details || {};
  const durations = [details.totalDurationMs, details.durationMs, details.modelDurationMs, details.sendDurationMs, details.generationDurationMs]
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0);
  return durations.length > 0 ? Math.max(...durations) : 0;
}

function parseTimeFilter(value, { relativeFromNow = false } = {}) {
  const text = String(value || "").trim();
  const relative = text.match(/^(\d+(?:\.\d+)?)(ms|s|m|h|d)$/i);
  if (relative && relativeFromNow) {
    const unitMs = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[relative[2].toLowerCase()];
    return Date.now() - Number(relative[1]) * unitMs;
  }
  const parsed = Date.parse(text);
  if (!Number.isFinite(parsed)) throw new CliError(`无法识别的时间 ${text}；示例：30m、2h、2026-10-01T08:00`);
  return parsed;
}

function renderSummary(entries, options) {
  const byLevel = {};
  const byCategory = {};
  const byEngine = {};
  const byOperation = {};
  const byOutcome = {};
  const durations = [];
  const traces = new Set();
  for (const entry of entries) {
    const category = canonicalLogCategory(entry.category) || "system";
    const engine = resolveLogEngine(entry);
    byLevel[entry.level] = Number(byLevel[entry.level] || 0) + 1;
    byCategory[category] = Number(byCategory[category] || 0) + 1;
    if (engine) byEngine[engine] = Number(byEngine[engine] || 0) + 1;
    const operation = String(entry.details?.operation || "").trim();
    const outcome = String(entry.details?.outcome || "").trim();
    if (operation) byOperation[operation] = Number(byOperation[operation] || 0) + 1;
    if (outcome) byOutcome[outcome] = Number(byOutcome[outcome] || 0) + 1;
    if (entry.traceId) traces.add(entry.traceId);
    const duration = getEntryDurationMs(entry);
    if (duration > 0) durations.push(duration);
  }
  durations.sort((left, right) => left - right);
  const p95 = durations.length ? durations[Math.max(0, Math.ceil(durations.length * 0.95) - 1)] : 0;
  const counts = (record, label, colorFor) => {
    const parts = Object.entries(record).map(([key, count]) => color(`${label(key)} ${count}`, colorFor(key), options));
    return parts.length ? parts.join(color(" / ", "dim", options)) : color("无", "gray", options);
  };
  const sections = [
    `${color(`${entries.length} 条`, "brightCyan", options)}，${color(`${traces.size} 条链路`, "brightMagenta", options)}`,
    `级别 ${counts(byLevel, (key) => getLogLevelLabel(key), (key) => levelColors[key] || "white")}`,
    `分类 ${counts(byCategory, (key) => getLogCategoryLabel(key), (key) => categoryColors[key] || "white")}`,
    Object.keys(byEngine).length ? `引擎 ${counts(byEngine, (key) => getAgentEngine(key).name, (key) => engineColors[key] || "white")}` : null,
    Object.keys(byOperation).length ? `操作 ${counts(byOperation, (key) => formatLogDetailValue(key, "operation", "zh"), () => "cyan")}` : null,
    Object.keys(byOutcome).length ? `结果 ${counts(byOutcome, (key) => formatLogDetailValue(key, "outcome", "zh"), () => "cyan")}` : null,
    durations.length
      ? `耗时样本 ${color(String(durations.length), "cyan", options)}，P95 ${color(formatMs(p95), colorForDuration(p95), options)}，最慢 ${color(formatMs(durations.at(-1)), colorForDuration(durations.at(-1)), options)}`
      : null
  ].filter(Boolean);
  const summary = `${color("日志摘要", "brightWhite", options)}：${sections.join("；")}`;
  if (options.json) {
    return JSON.stringify({ summary, total: entries.length, traces: traces.size, byLevel, byCategory, byEngine, byOperation, byOutcome, p95Ms: p95 || null });
  }
  return summary;
}

function color(text, colorName, options) {
  if (options.plain) return text;
  return `${colors[colorName] || ""}${text}${colors.reset}`;
}

function usage() {
  return `用法：ncc logs [选项]
      node scripts/ncc-log-viewer.mjs <日志文件> [选项]

范围
  -n, --tail N            显示最后 N 条（默认 80，最多 1000）
  -f, --follow            显示后继续跟随新日志（Ctrl+C 退出）
  --since 30m|ISO         只看此时间之后；相对时间支持 ms、s、m、h、d
  --until ISO             只看此时间之前

过滤
  --level LEVELS          级别，逗号分隔：${logLevels.join(",")}
  --errors                等同 --level warn,error
  --category NAMES        分类，逗号分隔：${logCategories.filter((item) => item !== "codex").join(",")}
  --engine NAME           只看某个引擎的智能体日志：${AGENT_ENGINE_IDS.join(",")}
  --trace ID              按链路 ID 前缀过滤
  --scope ID              按范围过滤：群号、group:群号 或 private:QQ号
  --group ID              按群号过滤
  --sender ID             按发送者 QQ 过滤
  --operation NAME        按操作名或前缀过滤，例如 agent.tool
  -q, --search TEXT       在整条日志里搜索关键字
  --slow [MS]             只看耗时不少于 MS 毫秒的记录（默认 1000）

显示
  --verbose               显示全部字段（默认）
  --compact               只显示关键字段，并隐藏调试和普通信息日志
  --all                   配合 --compact 时也显示普通信息日志
  --summary               末尾追加统计摘要
  --json                  输出原始 JSON 行
  --plain | --color       关闭或强制彩色输出
  -h, --help              显示此帮助
`;
}
