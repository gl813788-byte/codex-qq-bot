import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import crypto from "node:crypto";
import {
  cosineSimilarity,
  deserializeEmbedding,
  embedLocalSemanticFields,
  embedLocalSemanticText,
  lexicalSimilarity,
  localSemanticEmbeddingDimensions,
  localSemanticEmbeddingModel,
  normalizeSemanticText,
  semanticQueryCoverage,
  semanticTokens,
  serializeEmbedding
} from "./semantic-embedding.js";
import { serializeFileOperation, writeJsonAtomically } from "../file-store.js";

export const semanticMemorySchemaVersion = 2;

export async function createSemanticMemoryIndex({
  dbPath,
  fallbackPath = `${dbPath}.json`
} = {}) {
  if (!dbPath) throw new Error("semantic memory dbPath is required");
  await mkdir(dirname(dbPath), { recursive: true });
  try {
    const { DatabaseSync } = await import("node:sqlite");
    return createSqliteIndex({ DatabaseSync, dbPath });
  } catch (error) {
    if (!["ERR_UNKNOWN_BUILTIN_MODULE", "ERR_MODULE_NOT_FOUND"].includes(error?.code)) throw error;
    return createJsonIndex({ filePath: fallbackPath });
  }
}

function createSqliteIndex({ DatabaseSync, dbPath }) {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA synchronous=FULL");
  db.exec("PRAGMA foreign_keys=ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS semantic_memory_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS semantic_memory_items (
      id TEXT PRIMARY KEY,
      layer TEXT NOT NULL,
      kind TEXT NOT NULL,
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      group_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      detail TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at TEXT,
      content_hash TEXT NOT NULL,
      embedding_model TEXT NOT NULL,
      embedding BLOB NOT NULL,
      metadata_json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS semantic_memory_layer_scope_idx
      ON semantic_memory_items(layer, scope_type, scope_id, status);
  `);
  const storedEmbeddingModel = db.prepare(
    "SELECT value FROM semantic_memory_meta WHERE key = ?"
  ).get("embeddingModel")?.value || "";
  const ftsTokenizer = ensureFtsTable(db);
  db.prepare(`
    INSERT INTO semantic_memory_meta(key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run("schemaVersion", String(semanticMemorySchemaVersion));
  db.prepare(`
    INSERT INTO semantic_memory_meta(key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run("embeddingModel", localSemanticEmbeddingModel);

  const statements = {
    deleteLayer: db.prepare("DELETE FROM semantic_memory_items WHERE layer = ?"),
    deleteFtsLayer: db.prepare("DELETE FROM semantic_memory_fts WHERE layer = ?"),
    deleteFtsItem: db.prepare("DELETE FROM semantic_memory_fts WHERE item_id = ?"),
    upsert: db.prepare(`
      INSERT INTO semantic_memory_items (
        id, layer, kind, scope_type, scope_id, group_id, user_id,
        title, summary, detail, status, updated_at, content_hash,
        embedding_model, embedding, metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        layer = excluded.layer,
        kind = excluded.kind,
        scope_type = excluded.scope_type,
        scope_id = excluded.scope_id,
        group_id = excluded.group_id,
        user_id = excluded.user_id,
        title = excluded.title,
        summary = excluded.summary,
        detail = excluded.detail,
        status = excluded.status,
        updated_at = excluded.updated_at,
        content_hash = excluded.content_hash,
        embedding_model = excluded.embedding_model,
        embedding = excluded.embedding,
        metadata_json = excluded.metadata_json
    `),
    insertFts: db.prepare(`
      INSERT INTO semantic_memory_fts(item_id, layer, title, summary, detail)
      VALUES (?, ?, ?, ?, ?)
    `),
    selectAll: db.prepare("SELECT * FROM semantic_memory_items"),
    count: db.prepare(`
      SELECT layer, status, COUNT(*) AS count
      FROM semantic_memory_items
      GROUP BY layer, status
      ORDER BY layer, status
    `),
    selectEmbeddingSources: db.prepare(`
      SELECT id, title, summary, detail
      FROM semantic_memory_items
      WHERE embedding_model != ? OR length(embedding) != ?
    `),
    updateEmbedding: db.prepare(`
      UPDATE semantic_memory_items
      SET embedding_model = ?, embedding = ?
      WHERE id = ?
    `)
  };
  refreshSqliteEmbeddings(db, statements, storedEmbeddingModel);

  return {
    backend: "sqlite",
    dbPath,
    embeddingModel: localSemanticEmbeddingModel,
    async replaceLayer(layer, values) {
      const items = normalizeItems(values, layer);
      return serializeFileOperation(dbPath, async () => {
        db.exec("BEGIN IMMEDIATE");
        try {
          statements.deleteFtsLayer.run(layer);
          statements.deleteLayer.run(layer);
          for (const item of items) writeSqliteItem(statements, item);
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        return { ok: true, layer, count: items.length };
      });
    },
    async upsert(values) {
      const items = normalizeItems(values);
      return serializeFileOperation(dbPath, async () => {
        db.exec("BEGIN IMMEDIATE");
        try {
          for (const item of items) {
            statements.deleteFtsItem.run(item.id);
            writeSqliteItem(statements, item);
          }
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
        return { ok: true, count: items.length };
      });
    },
    async search(options = {}) {
      const rows = statements.selectAll.all().map(rowToItem);
      const ftsRanks = searchFts(db, options.query, ftsTokenizer);
      return scoreItems(rows, { ...options, ftsRanks });
    },
    async status() {
      const rows = statements.count.all();
      return {
        ok: true,
        backend: "sqlite",
        dbPath,
        schemaVersion: semanticMemorySchemaVersion,
        embeddingModel: localSemanticEmbeddingModel,
        dimensions: localSemanticEmbeddingDimensions,
        ftsTokenizer,
        count: rows.reduce((sum, row) => sum + Number(row.count || 0), 0),
        layers: rows.map((row) => ({
          layer: row.layer,
          status: row.status,
          count: Number(row.count || 0)
        }))
      };
    },
    close() {
      db.close();
    }
  };
}

async function createJsonIndex({ filePath }) {
  let items = await readFile(filePath, "utf8")
    .then((body) => JSON.parse(body))
    .then((value) => normalizeItems(value?.items))
    .catch((error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
  const persist = () => writeJsonAtomically(filePath, {
    version: semanticMemorySchemaVersion,
    embeddingModel: localSemanticEmbeddingModel,
    updatedAt: new Date().toISOString(),
    items: items.map(({ embedding, ...item }) => item)
  });
  return {
    backend: "json-fallback",
    dbPath: filePath,
    embeddingModel: localSemanticEmbeddingModel,
    async replaceLayer(layer, values) {
      return serializeFileOperation(filePath, async () => {
        items = [
          ...items.filter((item) => item.layer !== layer),
          ...normalizeItems(values, layer)
        ];
        await persist();
        return { ok: true, layer, count: items.filter((item) => item.layer === layer).length };
      });
    },
    async upsert(values) {
      return serializeFileOperation(filePath, async () => {
        const next = new Map(items.map((item) => [item.id, item]));
        for (const item of normalizeItems(values)) next.set(item.id, item);
        items = [...next.values()];
        await persist();
        return { ok: true, count: items.length };
      });
    },
    async search(options = {}) {
      return scoreItems(items, options);
    },
    async status() {
      const layers = new Map();
      for (const item of items) {
        const key = `${item.layer}:${item.status}`;
        layers.set(key, {
          layer: item.layer,
          status: item.status,
          count: Number(layers.get(key)?.count || 0) + 1
        });
      }
      return {
        ok: true,
        backend: "json-fallback",
        dbPath: filePath,
        schemaVersion: semanticMemorySchemaVersion,
        embeddingModel: localSemanticEmbeddingModel,
        dimensions: localSemanticEmbeddingDimensions,
        ftsTokenizer: null,
        count: items.length,
        layers: [...layers.values()]
      };
    },
    close() {}
  };
}

function ensureFtsTable(db) {
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS semantic_memory_fts
      USING fts5(item_id UNINDEXED, layer UNINDEXED, title, summary, detail, tokenize='trigram')
    `);
    return "trigram";
  } catch {
    db.exec("DROP TABLE IF EXISTS semantic_memory_fts");
    db.exec(`
      CREATE VIRTUAL TABLE semantic_memory_fts
      USING fts5(item_id UNINDEXED, layer UNINDEXED, title, summary, detail, tokenize='unicode61')
    `);
    return "unicode61";
  }
}

function writeSqliteItem(statements, item) {
  const embedding = embedLocalSemanticFields(item);
  statements.upsert.run(
    item.id,
    item.layer,
    item.kind,
    item.scopeType,
    item.scopeId,
    item.groupId,
    item.userId,
    item.title,
    item.summary,
    item.detail,
    item.status,
    item.updatedAt,
    item.contentHash,
    localSemanticEmbeddingModel,
    serializeEmbedding(embedding),
    JSON.stringify(item.metadata || {})
  );
  statements.insertFts.run(item.id, item.layer, item.title, item.summary, item.detail);
}

function refreshSqliteEmbeddings(db, statements, storedEmbeddingModel) {
  const expectedBytes = localSemanticEmbeddingDimensions * Float32Array.BYTES_PER_ELEMENT;
  const rows = statements.selectEmbeddingSources.all(localSemanticEmbeddingModel, expectedBytes);
  if (!rows.length && storedEmbeddingModel === localSemanticEmbeddingModel) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) {
      const embedding = embedLocalSemanticFields(row);
      statements.updateEmbedding.run(
        localSemanticEmbeddingModel,
        serializeEmbedding(embedding),
        row.id
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function rowToItem(row) {
  return {
    id: row.id,
    layer: row.layer,
    kind: row.kind,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    groupId: row.group_id,
    userId: row.user_id,
    title: row.title,
    summary: row.summary,
    detail: row.detail,
    status: row.status,
    updatedAt: row.updated_at || null,
    contentHash: row.content_hash,
    embedding: deserializeEmbedding(row.embedding),
    metadata: safeJsonObject(row.metadata_json)
  };
}

function normalizeItems(values, forcedLayer = "") {
  const output = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const id = compact(raw?.id, 240);
    const layer = compact(forcedLayer || raw?.layer, 80);
    if (!id || !layer || seen.has(id)) continue;
    seen.add(id);
    const title = compact(raw?.title, 240);
    const summary = compact(raw?.summary || raw?.text || raw?.detail, 1_200);
    const detail = compact(raw?.detail || raw?.text || raw?.summary, 6_000);
    const scopeType = normalizeScopeType(raw?.scopeType);
    const groupId = compact(raw?.groupId, 40);
    const userId = compact(raw?.userId, 40);
    const scopeId = compact(raw?.scopeId || inferScopeId(scopeType, groupId, userId), 120);
    const item = {
      id,
      layer,
      kind: compact(raw?.kind || "note", 80),
      scopeType,
      scopeId,
      groupId,
      userId,
      title,
      summary,
      detail,
      status: ["active", "archived", "pending"].includes(raw?.status) ? raw.status : "active",
      updatedAt: normalizeTime(raw?.updatedAt),
      metadata: raw?.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)
        ? raw.metadata
        : {}
    };
    item.contentHash = compact(raw?.contentHash, 120) || hashItem(item);
    item.embedding = raw?.embedding?.length
      && raw.embedding.length === localSemanticEmbeddingDimensions
      ? Float32Array.from(raw.embedding)
      : embedLocalSemanticFields(item);
    output.push(item);
  }
  return output;
}

function scoreItems(items, {
  query = "",
  layers = [],
  kinds = [],
  scope = null,
  statuses = ["active"],
  limit = 8,
  minScore = 0.08,
  ftsRanks = new Map()
} = {}) {
  const normalizedQuery = normalizeSemanticText(query);
  const queryEmbedding = embedLocalSemanticText(normalizedQuery);
  const allowedLayers = new Set((Array.isArray(layers) ? layers : [layers]).filter(Boolean));
  const allowedKinds = new Set((Array.isArray(kinds) ? kinds : [kinds]).filter(Boolean));
  const allowedStatuses = new Set((Array.isArray(statuses) ? statuses : [statuses]).filter(Boolean));
  return items
    .filter((item) => (!allowedLayers.size || allowedLayers.has(item.layer))
      && (!allowedKinds.size || allowedKinds.has(item.kind))
      && (!allowedStatuses.size || allowedStatuses.has(item.status))
      && matchesScope(item, scope))
    .map((item) => {
      const haystack = itemSearchText(item);
      const vectorScore = normalizedQuery
        ? Math.max(0, cosineSimilarity(
          queryEmbedding,
          item.embedding?.length === localSemanticEmbeddingDimensions
            ? item.embedding
            : embedLocalSemanticFields(item)
        ))
        : 0;
      const lexicalScore = normalizedQuery
        ? Math.max(
          lexicalSimilarity(normalizedQuery, item.title),
          lexicalSimilarity(normalizedQuery, item.summary) * 0.94,
          lexicalSimilarity(normalizedQuery, item.detail) * 0.78,
          lexicalSimilarity(normalizedQuery, haystack) * 0.86
        )
        : 0;
      const coverageScore = normalizedQuery
        ? Math.max(
          semanticQueryCoverage(normalizedQuery, item.title),
          semanticQueryCoverage(normalizedQuery, item.summary) * 0.95,
          semanticQueryCoverage(normalizedQuery, item.detail) * 0.82
        )
        : 0;
      const exactTitle = normalizedQuery && normalizeSemanticText(item.title).includes(normalizedQuery) ? 1 : 0;
      const ftsScore = Number(ftsRanks.get(item.id) || 0);
      const recencyScore = scoreRecency(item.updatedAt);
      const score = normalizedQuery
        ? vectorScore * 0.5
          + lexicalScore * 0.2
          + coverageScore * 0.14
          + ftsScore * 0.07
          + exactTitle * 0.05
          + recencyScore * 0.04
        : recencyScore;
      return { ...item, score };
    })
    .filter((item) => !normalizedQuery || item.score >= Number(minScore || 0))
    .sort((left, right) => right.score - left.score
      || Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || ""))
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 8)))
    .map(({ embedding, ...item }) => item);
}

function matchesScope(item, scope) {
  if (!scope) return true;
  if (item.scopeType === "global") return scope.includeGlobal === true;
  if (item.scopeType === "group") return Boolean(scope.groupId && item.groupId === String(scope.groupId));
  if (item.scopeType === "private") {
    return Boolean(scope.privateUserId && item.userId === String(scope.privateUserId));
  }
  const userIds = new Set((scope.userIds || []).map(String));
  if (item.scopeType === "member") return userIds.has(item.userId);
  if (item.scopeType === "group-member") {
    return Boolean(scope.groupId && item.groupId === String(scope.groupId) && userIds.has(item.userId));
  }
  if (item.scopeType === "scope") return item.scopeId === String(scope.scopeId || "");
  return false;
}

function searchFts(db, query, tokenizer) {
  const normalized = normalizeSemanticText(query);
  if (!normalized) return new Map();
  const lexicalTokens = semanticTokens(normalized)
    .filter((token) => /^(?:term|latin|word|zh[234]):/.test(token))
    .map((token) => token.slice(token.indexOf(":") + 1))
    .filter((token) => tokenizer !== "trigram" || [...token].length >= 3);
  const terms = [...new Set([
    ...normalized.split(/[^\p{L}\p{N}_.:/+-]+/u),
    ...lexicalTokens
  ].filter((term) => term && (tokenizer !== "trigram" || [...term].length >= 3)))].slice(0, 12);
  if (!terms.length) return new Map();
  const expression = terms
    .map((term) => `"${term.replace(/"/g, '""')}"`)
    .join(" OR ");
  try {
    const rows = db.prepare(`
      SELECT item_id, bm25(semantic_memory_fts) AS rank
      FROM semantic_memory_fts
      WHERE semantic_memory_fts MATCH ?
      ORDER BY rank
      LIMIT 200
    `).all(expression);
    return new Map(rows.map((row, index) => [
      row.item_id,
      Math.max(0, 1 - index / Math.max(1, rows.length))
    ]));
  } catch {
    return new Map();
  }
}

function itemSearchText(item) {
  return [item.title, item.summary, item.detail].filter(Boolean).join("\n");
}

function scoreRecency(value) {
  const timestamp = Date.parse(value || "");
  if (!Number.isFinite(timestamp)) return 0;
  const ageDays = Math.max(0, (Date.now() - timestamp) / 86_400_000);
  return Math.exp(-ageDays / 90);
}

function inferScopeId(type, groupId, userId) {
  if (type === "group") return groupId;
  if (type === "private") return `private:${userId}`;
  if (type === "member") return `member:${userId}`;
  if (type === "group-member") return `group-member:${groupId}:${userId}`;
  return type === "global" ? "global" : "";
}

function normalizeScopeType(value) {
  const normalized = String(value || "global").trim().toLowerCase();
  return ["global", "group", "member", "group-member", "private", "scope"].includes(normalized)
    ? normalized
    : "global";
}

function normalizeTime(value) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function hashItem(item) {
  const payload = [
    item.layer,
    item.kind,
    item.scopeType,
    item.scopeId,
    item.title,
    item.summary,
    item.detail,
    item.status
  ].join("\u0000");
  return crypto.createHash("sha256").update(payload).digest("base64url");
}

function safeJsonObject(value) {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function compact(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}
