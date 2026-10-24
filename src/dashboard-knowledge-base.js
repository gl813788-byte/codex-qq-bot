import {
  applyQqKnowledgeImageChange,
  applyQqKnowledgePatches,
  normalizeQqKnowledgeBase
} from "./qq-knowledge-base.js";
import { detectQqImageMimeType } from "./qq-memory-image-store.js";

const validKinds = new Set(["note", "slang"]);
const validScopeTypes = new Set(["global", "group", "member", "group-member"]);
const imageActions = { "attach-image": "attach", "replace-image": "replace", "caption-image": "caption", "remove-image": "remove" };
export const dashboardKnowledgeImageMaxBytes = 4 * 1024 * 1024;

export class DashboardKnowledgeConflictError extends Error {
  constructor(message) {
    super(message);
    this.name = "DashboardKnowledgeConflictError";
    this.code = "KNOWLEDGE_CONFLICT";
  }
}

export function applyDashboardKnowledgeMutation(store, body, { at = Date.now() } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new TypeError("knowledge mutation body must be an object");
  }
  const action = cleanText(body.action, 20).toLowerCase();
  if (action !== "upsert" && action !== "delete") {
    throw new TypeError("knowledge action must be upsert or delete");
  }

  const current = normalizeQqKnowledgeBase(store);
  const original = resolveOriginal(current, body);
  if (action === "delete") return removeExactVariant(current, original, at);

  const kind = cleanText(body.kind ?? original?.entry.kind ?? "", 20).toLowerCase();
  if (!validKinds.has(kind)) throw new TypeError("knowledge kind must be note or slang");
  if (original && kind !== original.entry.kind) {
    throw new TypeError("an existing knowledge entry cannot change kind; create a new entry instead");
  }

  const title = cleanText(body.title ?? original?.entry.title, 80);
  const content = cleanText(body.content ?? original?.variant.content, 800);
  if (!title) throw new TypeError("knowledge title is required");
  if (!content) throw new TypeError("knowledge content is required");

  const scope = normalizeScope(body, original?.variant.scope);
  if (original && !sameScopeIdentity(scope, original.variant.scope)) {
    throw new TypeError("an existing knowledge variant cannot change scope; create a new variant instead");
  }
  assertRenameIsSafe(current, original, kind, title);

  const patch = {
    kind,
    title,
    content,
    aliases: normalizeAliases(body.aliases),
    replacesTitle: original?.entry.title || "",
    scopeType: scope.type,
    groupId: scope.groupId,
    groupName: scope.groupName,
    userId: scope.userId,
    userName: scope.userName
  };
  const context = buildMutationContext(scope);
  const result = applyQqKnowledgePatches(current, [patch], context, {
    allowGlobal: true,
    sourceType: "dashboard",
    at
  });
  if (!result.applied.length) {
    throw new TypeError(result.rejected[0]?.reason || "knowledge mutation was rejected");
  }
  const applied = result.applied[0];
  if (original && (applied.entryId !== original.entry.id || applied.variantId !== original.variant.id)) {
    throw new DashboardKnowledgeConflictError("knowledge changed while it was being edited; refresh and try again");
  }
  const saved = findVariant(result.store, applied.entryId, applied.variantId);
  return {
    store: result.store,
    changed: result.changed,
    action: applied.action,
    entry: saved.entry,
    variant: saved.variant
  };
}

export function isDashboardKnowledgeImageAction(value) {
  return Object.hasOwn(imageActions, cleanText(value, 20).toLowerCase());
}

// Decode a browser upload. Only base64 data URLs whose bytes carry a real
// PNG/JPEG/GIF/WebP signature are accepted.
export function parseDashboardKnowledgeImageUpload(value, { maxBytes = dashboardKnowledgeImageMaxBytes } = {}) {
  const match = String(value || "").match(/^data:image\/(?:png|jpeg|jpg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw new TypeError("image must be a base64 PNG, JPEG, GIF or WebP data URL");
  if (Math.floor(match[1].length * 3 / 4) > maxBytes + 2) throw new RangeError("image is too large");
  const data = Buffer.from(match[1], "base64");
  if (!data.length || data.length > maxBytes) throw new RangeError("image is too large");
  if (!detectQqImageMimeType(data)) throw new TypeError("image content is not a supported picture");
  return data;
}

export function applyDashboardKnowledgeImageMutation(store, body, { image = null, at = Date.now() } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new TypeError("knowledge image mutation body must be an object");
  }
  const action = imageActions[cleanText(body.action, 20).toLowerCase()];
  if (!action) throw new TypeError("knowledge image action must be attach-image, replace-image, caption-image or remove-image");
  const current = normalizeQqKnowledgeBase(store);
  const original = resolveOriginal(current, body);
  if (!original) throw new TypeError("entryId and variantId are required for knowledge images");
  if (["attach", "replace"].includes(action) && !image) throw new TypeError("an uploaded image is required");
  const result = applyQqKnowledgeImageChange(current, {
    entryId: original.entry.id,
    variantId: original.variant.id,
    action,
    image,
    imageId: cleanText(body.imageId, 70),
    caption: body.caption == null && action !== "caption" ? undefined : cleanText(body.caption, 120),
    source: "dashboard",
    at
  });
  if (!result.changed) {
    if (result.reason === "image_not_found") throw new DashboardKnowledgeConflictError("the knowledge image changed or was removed; refresh and try again");
    if (result.reason === "image_limit") throw new RangeError("a knowledge variant can hold at most 4 images");
    if (result.reason === "duplicate_image") throw new TypeError("this image is already attached");
    throw new TypeError(`knowledge image mutation was rejected: ${result.reason}`);
  }
  return {
    store: result.store,
    changed: true,
    action: `${action}-image`,
    entry: result.entry,
    variant: result.variant,
    image: result.image
  };
}

function resolveOriginal(store, body) {
  const entryId = cleanId(body.entryId);
  const variantId = cleanId(body.variantId);
  if (!entryId && !variantId) return null;
  if (!entryId || !variantId) {
    throw new TypeError("entryId and variantId must be provided together");
  }
  const found = findVariant(store, entryId, variantId, { required: false });
  if (!found) {
    throw new DashboardKnowledgeConflictError("knowledge changed or was removed; refresh and try again");
  }
  return found;
}

function findVariant(store, entryId, variantId, { required = true } = {}) {
  const entry = store.entries.find((item) => item.id === entryId);
  const variant = entry?.variants.find((item) => item.id === variantId);
  if (entry && variant) return { entry, variant };
  if (required) throw new DashboardKnowledgeConflictError("saved knowledge could not be resolved");
  return null;
}

function removeExactVariant(store, original, at) {
  if (!original) throw new TypeError("entryId and variantId are required for deletion");
  const updatedAt = toIsoTime(at);
  const next = normalizeQqKnowledgeBase(store);
  next.entries = next.entries.flatMap((entry) => {
    if (entry.id !== original.entry.id) return [entry];
    const variants = entry.variants.filter((variant) => variant.id !== original.variant.id);
    return variants.length ? [{ ...entry, variants, updatedAt }] : [];
  });
  next.updatedAt = updatedAt;
  return {
    store: next,
    changed: true,
    action: "deleted",
    entry: original.entry,
    variant: original.variant
  };
}

function normalizeScope(body, fallback = null) {
  const input = body.scope && typeof body.scope === "object" && !Array.isArray(body.scope)
    ? { ...body, ...body.scope }
    : body;
  const type = cleanText(input.scopeType ?? fallback?.type, 30).toLowerCase().replace(/_/g, "-");
  if (!validScopeTypes.has(type)) {
    throw new TypeError("knowledge scopeType must be global, group, member, or group-member");
  }
  if (type === "global") return { type };

  const groupName = cleanText(input.groupName ?? fallback?.groupName, 100);
  const userName = cleanText(input.userName ?? fallback?.userName, 100);
  if (type === "group") {
    return { type, groupId: cleanQqId(input.groupId ?? fallback?.groupId, "groupId"), groupName };
  }
  if (type === "member") {
    return { type, userId: cleanQqId(input.userId ?? fallback?.userId, "userId"), userName };
  }
  const groupId = cleanQqId(input.groupId ?? fallback?.groupId, "groupId");
  const userId = cleanQqId(input.userId ?? fallback?.userId, "userId");
  return { type, groupId, groupName, userId, userName };
}

function buildMutationContext(scope) {
  if (scope.type === "global") return {};
  if (scope.type === "group") {
    return { groupId: scope.groupId, groupName: scope.groupName };
  }
  if (scope.type === "member") {
    return {
      senderId: scope.userId,
      senderName: scope.userName,
      members: [{ userId: scope.userId, userName: scope.userName }]
    };
  }
  return {
    groupId: scope.groupId,
    groupName: scope.groupName,
    senderId: scope.userId,
    senderName: scope.userName,
    members: [{ userId: scope.userId, userName: scope.userName }]
  };
}

function assertRenameIsSafe(store, original, kind, title) {
  if (!original || normalizeTitleKey(title) === original.entry.normalizedTitle) return;
  const key = normalizeTitleKey(title);
  const conflict = store.entries.find((entry) => entry.id !== original.entry.id
    && entry.kind === kind
    && (entry.normalizedTitle === key || entry.aliases.some((alias) => normalizeTitleKey(alias) === key)));
  if (conflict) {
    throw new DashboardKnowledgeConflictError("another knowledge entry already uses this title or alias");
  }
}

function sameScopeIdentity(left, right) {
  if (left.type !== right.type) return false;
  if (left.type === "global") return true;
  if (left.type === "group") return left.groupId === right.groupId;
  if (left.type === "member") return left.userId === right.userId;
  return left.groupId === right.groupId && left.userId === right.userId;
}

function normalizeAliases(value) {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,，\n]/) : [];
  return [...new Set(values.map((item) => cleanText(item, 80)).filter(Boolean))].slice(0, 12);
}

function cleanQqId(value, field) {
  const id = String(value || "").trim();
  if (!/^\d{4,20}$/.test(id)) throw new TypeError(`${field} must be a 4-20 digit QQ identifier`);
  return id;
}

function cleanId(value) {
  return String(value || "").trim().replace(/^#/, "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
}

function cleanText(value, maxLength) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function normalizeTitleKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .trim();
}

function toIsoTime(value) {
  const numeric = Number(value);
  const parsed = Number.isFinite(numeric) ? numeric : Date.parse(value || "");
  return new Date(Number.isFinite(parsed) ? parsed : Date.now()).toISOString();
}
