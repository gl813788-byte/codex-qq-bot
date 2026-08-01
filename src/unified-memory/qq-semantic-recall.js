import {
  buildQqSemanticScope,
  formatSemanticMemoryPrompt
} from "./qq-memory-items.js";

export function buildQqSemanticRecallQuery(event = {}, {
  maxChars = 2_400
} = {}) {
  const parts = [
    event.text,
    event.replyContext?.text,
    ...(Array.isArray(event.queuedEvents) ? event.queuedEvents.map((entry) => entry?.text) : []),
    ...(Array.isArray(event.proactiveDecision?.replyContext)
      ? event.proactiveDecision.replyContext.map((entry) => entry?.text)
      : [])
  ]
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const seen = new Set();
  return parts
    .filter((part) => {
      const key = part.normalize("NFKC").toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join("\n")
    .slice(0, Math.max(200, Math.min(8_000, Number(maxChars) || 2_400)));
}

export async function recallQqSemanticMemory({
  semanticSearch,
  event = {},
  query = "",
  includeImpressions = true,
  excludeItemIds = []
} = {}) {
  if (typeof semanticSearch !== "function") {
    return emptyRecall(query, new Error("semanticSearch is unavailable"));
  }

  const semanticScope = buildQqSemanticScope(event);
  const publicSemanticScope = { ...semanticScope, includeGlobal: true };
  const personSemanticScope = {
    ...semanticScope,
    includeGlobal: false
  };
  const ownerGlobalSemanticScope = {
    ...semanticScope,
    scopeId: "",
    groupId: "",
    privateUserId: "",
    userIds: [],
    includeGlobal: true
  };
  const requests = [
    includeImpressions
      ? {
        name: "impression",
        options: {
          query,
          layers: ["impression"],
          scope: semanticScope,
          limit: 12,
          minScore: 0
        }
      }
      : null,
    {
      name: "short-term",
      options: {
        query,
        layers: ["short-term"],
        scope: semanticScope,
        limit: 6
      }
    },
    {
      name: "knowledge",
      options: {
        query,
        layers: ["knowledge"],
        scope: publicSemanticScope,
        limit: 6
      }
    },
    {
      name: "unified-person-profile",
      options: {
        query: "",
        layers: ["unified"],
        kinds: ["personProfile"],
        scope: personSemanticScope,
        limit: 12,
        minScore: 0
      }
    },
    {
      name: "unified-person-session",
      options: {
        query,
        layers: ["unified"],
        kinds: ["personSession"],
        scope: personSemanticScope,
        limit: 8,
        minScore: query ? 0.06 : 0
      }
    },
    (event.isOwner || event.isBotAdmin)
      ? {
        name: "unified",
        options: {
          query,
          layers: ["unified"],
          scope: ownerGlobalSemanticScope,
          limit: 4
        }
      }
      : null
  ].filter(Boolean);

  const settled = await Promise.allSettled(
    requests.map((request) => semanticSearch(request.options))
  );
  const excluded = new Set((Array.isArray(excludeItemIds) ? excludeItemIds : []).map(String));
  const seen = new Set();
  const items = [];
  const errors = [];
  const layers = Object.create(null);

  settled.forEach((result, index) => {
    const request = requests[index];
    if (result.status === "rejected") {
      errors.push({
        layer: request.name,
        error: result.reason?.message || String(result.reason || "semantic search failed")
      });
      layers[request.name] = 0;
      return;
    }
    const hits = Array.isArray(result.value) ? result.value : [];
    layers[request.name] = hits.length;
    for (const item of hits) {
      const id = String(item?.id || "");
      if (!id || excluded.has(id) || seen.has(id)) continue;
      seen.add(id);
      items.push(item);
    }
  });

  return {
    query: String(query || ""),
    scope: semanticScope,
    items,
    itemIds: items.map((item) => String(item.id)),
    context: formatSemanticMemoryPrompt(items, {
      currentScopeId: semanticScope.scopeId
    }),
    layers,
    errors
  };
}

export function summarizeQqSemanticRecall(recall = {}) {
  const items = Array.isArray(recall.items) ? recall.items : [];
  return {
    queryChars: String(recall.query || "").length,
    resultCount: items.length,
    layers: { ...(recall.layers || {}) },
    matches: items.slice(0, 12).map((item) => ({
      id: String(item.id || "").slice(0, 160),
      layer: item.layer || null,
      score: Number.isFinite(Number(item.score))
        ? Number(Number(item.score).toFixed(4))
        : null
    })),
    errorCount: Array.isArray(recall.errors) ? recall.errors.length : 0,
    errors: Array.isArray(recall.errors) ? recall.errors.slice(0, 4) : []
  };
}

function emptyRecall(query, error) {
  return {
    query: String(query || ""),
    scope: null,
    items: [],
    itemIds: [],
    context: "",
    layers: {},
    errors: [{ layer: null, error: error.message }]
  };
}
