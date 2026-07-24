const maxTitleLength = 80;
const maxSummaryLength = 160;
const maxDetailLength = 1_200;

export function normalizeQqShortTermNoteScopes(value, {
  createId = () => "",
  normalizeTime = defaultTime
} = {}) {
  const output = Object.create(null);
  for (const [scopeId, rawEntries] of Object.entries(value || {})) {
    if (!isQqShortTermScopeId(scopeId)) continue;
    const entries = (Array.isArray(rawEntries) ? rawEntries : [])
      .map((entry) => normalizeQqShortTermEntry(entry, { createId, normalizeTime }))
      .filter(Boolean)
      .slice(-40);
    if (entries.length) output[scopeId] = entries;
  }
  return output;
}

export function normalizeQqShortTermEntry(value, {
  createId = () => "",
  normalizeTime = defaultTime
} = {}) {
  const source = value && typeof value === "object" ? value : { text: value };
  const parsed = parseQqShortTermContent(
    source.detail || source.text || source.content || source.summary || ""
  );
  const detail = compact(source.detail || source.text || source.content || parsed.detail, maxDetailLength);
  if (!detail) return null;
  const id = compactId(source.id) || compactId(createId());
  if (!id) return null;
  const createdAt = normalizeTime(source.createdAt || source.at);
  return {
    id,
    title: compact(source.title || parsed.title || detail, maxTitleLength),
    summary: compact(source.summary || parsed.summary || summarize(detail), maxSummaryLength),
    detail,
    text: detail,
    status: source.status === "archived" ? "archived" : "active",
    staleReason: compact(source.staleReason, 240),
    createdAt,
    updatedAt: normalizeTime(source.updatedAt || source.createdAt || source.at),
    archivedAt: source.status === "archived" ? normalizeNullableTime(source.archivedAt || source.updatedAt) : null,
    createdBy: source.createdBy == null ? "" : String(source.createdBy),
    createdByLabel: compact(source.createdByLabel, 80),
    updatedBy: source.updatedBy == null ? "" : String(source.updatedBy),
    updatedByLabel: compact(source.updatedByLabel, 80)
  };
}

export function parseQqShortTermContent(value) {
  const parts = String(value || "").split("|").map((item) => compact(item, maxDetailLength));
  if (parts.length >= 3) {
    const detail = compact(parts.slice(2).join(" | "), maxDetailLength);
    return {
      title: compact(parts[0], maxTitleLength),
      summary: compact(parts[1] || summarize(detail), maxSummaryLength),
      detail
    };
  }
  if (parts.length === 2) {
    const detail = compact(parts[1], maxDetailLength);
    return {
      title: compact(parts[0], maxTitleLength),
      summary: summarize(detail),
      detail
    };
  }
  const detail = compact(parts[0], maxDetailLength);
  return {
    title: inferTitle(detail),
    summary: summarize(detail),
    detail
  };
}

export function overwriteQqShortTermEntry(entry, content, {
  at = new Date().toISOString(),
  updatedBy = "",
  updatedByLabel = ""
} = {}) {
  const parsed = typeof content === "string" ? parseQqShortTermContent(content) : content;
  const detail = compact(parsed?.detail, maxDetailLength);
  if (!detail) return null;
  return {
    ...entry,
    title: compact(parsed?.title || entry?.title || detail, maxTitleLength),
    summary: compact(parsed?.summary || summarize(detail), maxSummaryLength),
    detail,
    text: detail,
    status: "active",
    staleReason: "",
    archivedAt: null,
    updatedAt: at,
    updatedBy: String(updatedBy || ""),
    updatedByLabel: compact(updatedByLabel, 80)
  };
}

export function archiveQqShortTermEntry(entry, reason = "", {
  at = new Date().toISOString(),
  updatedBy = "",
  updatedByLabel = ""
} = {}) {
  return {
    ...entry,
    status: "archived",
    staleReason: compact(reason || "模型判断已过时", 240),
    archivedAt: at,
    updatedAt: at,
    updatedBy: String(updatedBy || ""),
    updatedByLabel: compact(updatedByLabel, 80)
  };
}

export function summarizeQqShortTermDetail(value) {
  return summarize(value);
}

function inferTitle(value) {
  const text = compact(value, maxDetailLength);
  const first = text.split(/(?<=[。！？!?；;])\s*/u).find(Boolean) || text;
  return compact(first, maxTitleLength);
}

function summarize(value) {
  const text = compact(value, maxDetailLength);
  const first = text.split(/(?<=[。！？!?；;])\s*/u).find(Boolean) || text;
  return compact(first, maxSummaryLength);
}

function isQqShortTermScopeId(value) {
  return /^\d{4,20}$/.test(String(value || "")) || /^private:\d{4,20}$/.test(String(value || ""));
}

function compactId(value) {
  return String(value || "").trim().replace(/^#/, "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
}

function defaultTime(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString();
}

function normalizeNullableTime(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function compact(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}
