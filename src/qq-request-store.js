import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { serializeFileOperation, writeJsonAtomically } from "./file-store.js";

const requestStatuses = new Set(["pending", "approved", "rejected"]);

export function normalizeOneBotRequest(payload, { now = () => new Date() } = {}) {
  if (!payload || payload.post_type !== "request") return null;
  const requestType = payload.request_type === "friend" || payload.request_type === "group"
    ? payload.request_type
    : "";
  if (!requestType || !payload.flag) return null;
  const subType = requestType === "group"
    ? (payload.sub_type === "invite" ? "invite" : "add")
    : "add";
  const key = `${requestType}:${subType}:${String(payload.flag)}`;
  const receivedAt = now().toISOString();
  return {
    id: createHash("sha256").update(key).digest("hex").slice(0, 10),
    key,
    requestType,
    subType,
    flag: String(payload.flag),
    userId: payload.user_id == null ? "" : String(payload.user_id),
    groupId: payload.group_id == null ? "" : String(payload.group_id),
    selfId: payload.self_id == null ? "" : String(payload.self_id),
    comment: String(payload.comment || "").trim().slice(0, 500),
    eventTime: Number.isFinite(Number(payload.time)) ? Number(payload.time) : null,
    receivedAt,
    updatedAt: receivedAt,
    handledAt: null,
    handledBy: "",
    status: "pending",
    autoHandled: false,
    lastError: ""
  };
}

export function createQqRequestStore({ filePath, maxEntries = 200 }) {
  if (!filePath) throw new TypeError("filePath is required");
  let entries = [];

  async function load() {
    try {
      const body = JSON.parse(await readFile(filePath, "utf8"));
      entries = normalizeStoredEntries(body?.entries).slice(0, maxEntries);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      entries = [];
    }
    return list({ status: "all", limit: maxEntries });
  }

  async function save() {
    return serializeFileOperation(filePath, () => writeJsonAtomically(filePath, {
      version: 1,
      updatedAt: new Date().toISOString(),
      entries
    }));
  }

  async function record(payload) {
    const normalized = normalizeOneBotRequest(payload);
    if (!normalized) return { entry: null, isNew: false };
    const index = entries.findIndex((entry) => entry.key === normalized.key);
    if (index >= 0) {
      entries[index] = {
        ...entries[index],
        userId: normalized.userId || entries[index].userId,
        groupId: normalized.groupId || entries[index].groupId,
        comment: normalized.comment || entries[index].comment,
        updatedAt: normalized.updatedAt
      };
      entries.unshift(entries.splice(index, 1)[0]);
      await save();
      return { entry: { ...entries[0] }, isNew: false };
    }
    entries.unshift(normalized);
    entries = entries.slice(0, maxEntries);
    await save();
    return { entry: { ...normalized }, isNew: true };
  }

  function list({ status = "pending", limit = 20 } = {}) {
    const normalizedStatus = status === "all" ? "all" : status;
    const filtered = normalizedStatus === "all"
      ? entries
      : entries.filter((entry) => entry.status === normalizedStatus);
    return filtered.slice(0, Math.max(1, Math.min(maxEntries, Number(limit) || 20))).map((entry) => ({ ...entry }));
  }

  function find(selector = "latest", { pendingOnly = false } = {}) {
    const candidates = pendingOnly ? entries.filter((entry) => entry.status === "pending") : entries;
    const value = String(selector || "latest").trim().replace(/^#/, "").toLowerCase();
    if (!value || /^(latest|newest|最新)$/.test(value)) return candidates[0] ? { ...candidates[0] } : null;
    const found = candidates.find((entry) => entry.id.toLowerCase() === value || entry.flag === selector);
    return found ? { ...found } : null;
  }

  async function update(id, patch) {
    const index = entries.findIndex((entry) => entry.id === String(id));
    if (index < 0) return null;
    const nextStatus = patch?.status;
    entries[index] = {
      ...entries[index],
      ...patch,
      status: requestStatuses.has(nextStatus) ? nextStatus : entries[index].status,
      updatedAt: new Date().toISOString()
    };
    entries.unshift(entries.splice(index, 1)[0]);
    await save();
    return { ...entries[0] };
  }

  return { load, record, list, find, update };
}

export function formatQqRequestEntry(entry) {
  if (!entry) return "未知申请";
  const kind = entry.requestType === "friend"
    ? "好友申请"
    : entry.subType === "invite" ? "群邀请" : "入群申请";
  const target = entry.requestType === "friend"
    ? `QQ ${entry.userId || "未知"}`
    : `${entry.userId ? `QQ ${entry.userId}` : "未知用户"}${entry.groupId ? ` / 群 ${entry.groupId}` : ""}`;
  const status = { pending: "待处理", approved: "已同意", rejected: "已拒绝" }[entry.status] || entry.status;
  return `#${entry.id} ${kind}｜${target}｜${status}${entry.comment ? `｜留言：${entry.comment}` : ""}`;
}

function normalizeStoredEntries(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => entry && typeof entry === "object" && entry.id && entry.flag).map((entry) => ({
    ...entry,
    id: String(entry.id),
    key: String(entry.key || `${entry.requestType}:${entry.subType}:${entry.flag}`),
    flag: String(entry.flag),
    userId: String(entry.userId || ""),
    groupId: String(entry.groupId || ""),
    status: requestStatuses.has(entry.status) ? entry.status : "pending",
    lastError: String(entry.lastError || "")
  }));
}
