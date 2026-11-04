import { createHash } from "node:crypto";

// The Bot's own language habits: a few slang words, symbols (such as a
// bracketed aside like “（bushi）”), kaomoji or short phrases that the Bot
// has picked up from the people it talks with and made its own.
//
// The Bot chooses them itself: periodic scope summaries propose adoptions and
// drops for that group or private chat, the global persona refresh curates
// the cross-scope set, and the main model may adopt or drop one during a
// conversation through qq_self. Each habit is bound to the scope it came from
// unless it is general internet language, so group-specific slang is only
// used where people understand it. Real usage is counted from delivered
// replies, and the next review sees those counts to keep, revise or drop
// each habit. Habits are style only; they never carry facts or permissions.

export const QQ_LANGUAGE_HABIT_KINDS = Object.freeze(["slang", "symbol", "kaomoji", "phrase"]);
export const QQ_LANGUAGE_HABIT_LIMITS = Object.freeze({
  total: 24,
  perScope: 6,
  global: 8,
  modelAdoptionsPerDay: 3
});
const KIND_LABELS = Object.freeze({ slang: "黑话", symbol: "符号", kaomoji: "颜文字", phrase: "说法" });
const SOURCES = new Set(["summary", "persona", "self", "owner"]);

export const qqLanguageHabitProposalSchema = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: ["adopt", "drop"],
  properties: {
    adopt: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "term", "usage", "reason"],
        properties: {
          kind: { type: "string", enum: [...QQ_LANGUAGE_HABIT_KINDS] },
          term: { type: "string" },
          usage: { type: "string" },
          reason: { type: "string" }
        }
      }
    },
    drop: { type: "array", items: { type: "string" } }
  }
});

export function createEmptyQqLanguageHabits() {
  return { items: [], updatedAt: null, modelAdoptions: { date: "", count: 0 } };
}

export function normalizeQqLanguageHabits(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const seen = new Set();
  const items = [];
  for (const raw of Array.isArray(source.items) ? source.items : []) {
    const item = normalizeHabit(raw);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  const adoptions = source.modelAdoptions && typeof source.modelAdoptions === "object" ? source.modelAdoptions : {};
  return {
    items: enforceLimits(items),
    updatedAt: validIso(source.updatedAt),
    modelAdoptions: {
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(adoptions.date || "")) ? String(adoptions.date) : "",
      count: Math.max(0, Math.min(100, Math.floor(Number(adoptions.count) || 0)))
    }
  };
}

// A term must be a short single-line expression: no links, mentions, Hub
// markers, CQ codes or long text that would turn a "habit" into a script.
export function normalizeQqLanguageHabitTerm(value) {
  const raw = String(value ?? "");
  if (/[\r\n]/.test(raw.trim())) return "";
  const term = raw.replace(/\s+/g, " ").trim();
  const length = [...term].length;
  if (!length || length > 16) return "";
  if (/https?:|www\.|@|\[\[|\]\]|\[CQ:/i.test(term)) return "";
  if (/^\d{5,}$/.test(term)) return "";
  return term;
}

// Proposals from a scope summary (scopeId = that scope) or the global persona
// refresh (scopeId = "global"). Drops apply first; adoptions upsert by term.
export function applyQqLanguageHabitProposals(habits, proposals, {
  scopeId = "global",
  source = "summary",
  at = Date.now()
} = {}) {
  const normalized = normalizeQqLanguageHabits(habits);
  const scope = normalizeScope(scopeId);
  const now = toIso(at);
  const result = { adopted: [], dropped: [], rejected: [] };
  if (!scope) return { habits: normalized, ...result };
  const value = proposals && typeof proposals === "object" ? proposals : {};
  const drops = new Set((Array.isArray(value.drop) ? value.drop : []).map(normalizeQqLanguageHabitTerm).filter(Boolean));
  let items = normalized.items.filter((item) => {
    if (item.scope !== scope || !drops.has(item.term) || item.source === "owner") return true;
    result.dropped.push(item.term);
    return false;
  });
  for (const proposal of (Array.isArray(value.adopt) ? value.adopt : []).slice(0, 8)) {
    const term = normalizeQqLanguageHabitTerm(proposal?.term);
    const kind = QQ_LANGUAGE_HABIT_KINDS.includes(proposal?.kind) ? proposal.kind : "";
    if (!term || !kind) {
      result.rejected.push(String(proposal?.term || "").slice(0, 16));
      continue;
    }
    const id = habitId(scope, term);
    const existing = items.find((item) => item.id === id);
    if (existing) {
      if (existing.source !== "owner") {
        existing.kind = kind;
        existing.usage = compact(proposal.usage, 80) || existing.usage;
        existing.reason = compact(proposal.reason, 60) || existing.reason;
        existing.updatedAt = now;
      }
      continue;
    }
    items.push({
      id,
      kind,
      term,
      usage: compact(proposal.usage, 80),
      reason: compact(proposal.reason, 60),
      scope,
      source: SOURCES.has(source) ? source : "summary",
      adoptedAt: now,
      updatedAt: now,
      uses: 0,
      lastUsedAt: null
    });
    result.adopted.push(term);
  }
  items = enforceLimits(items, { protectIds: new Set(items.filter((item) => item.adoptedAt === now).map((item) => item.id)) });
  const kept = new Set(items.map((item) => item.term + item.scope));
  result.adopted = result.adopted.filter((term) => kept.has(term + scope));
  const changed = result.adopted.length > 0 || result.dropped.length > 0
    || (Array.isArray(value.adopt) && value.adopt.length > 0);
  return {
    habits: { ...normalized, items, updatedAt: changed ? now : normalized.updatedAt },
    ...result
  };
}

// The main model adopting or dropping one habit mid-conversation. Adoptions
// are capped per day so chat pressure cannot rewrite the Bot's voice.
export function applyQqModelLanguageHabitChange(habits, {
  action = "adopt",
  kind = "slang",
  term = "",
  usage = "",
  reason = "",
  scopeId = "",
  global = false,
  at = Date.now()
} = {}) {
  const normalized = normalizeQqLanguageHabits(habits);
  const scope = global ? "global" : normalizeScope(scopeId);
  const value = normalizeQqLanguageHabitTerm(term);
  if (!scope || scope === "global" && !global) return { habits: normalized, ok: false, reason: "invalid-scope" };
  if (!value) return { habits: normalized, ok: false, reason: "invalid-term" };
  if (action === "drop") {
    const existing = normalized.items.find((item) => item.term === value && (item.scope === scope || (!global && item.scope === "global")));
    if (!existing) return { habits: normalized, ok: false, reason: "not-found" };
    if (existing.source === "owner") return { habits: normalized, ok: false, reason: "owner-locked" };
    return {
      habits: { ...normalized, items: normalized.items.filter((item) => item !== existing), updatedAt: toIso(at) },
      ok: true,
      reason: "dropped",
      habit: existing
    };
  }
  if (action !== "adopt") return { habits: normalized, ok: false, reason: "invalid-action" };
  if (!QQ_LANGUAGE_HABIT_KINDS.includes(kind)) return { habits: normalized, ok: false, reason: "invalid-kind" };
  const today = toIso(at).slice(0, 10);
  const used = normalized.modelAdoptions.date === today ? normalized.modelAdoptions.count : 0;
  if (normalized.items.some((item) => item.id === habitId(scope, value))) {
    return { habits: normalized, ok: false, reason: "already-adopted" };
  }
  if (used >= QQ_LANGUAGE_HABIT_LIMITS.modelAdoptionsPerDay) return { habits: normalized, ok: false, reason: "daily-cap" };
  const applied = applyQqLanguageHabitProposals(normalized, { adopt: [{ kind, term: value, usage, reason }], drop: [] }, {
    scopeId: scope,
    source: "self",
    at
  });
  if (!applied.adopted.length) return { habits: normalized, ok: false, reason: "full" };
  return {
    habits: { ...applied.habits, modelAdoptions: { date: today, count: used + 1 } },
    ok: true,
    reason: "adopted",
    habit: applied.habits.items.find((item) => item.id === habitId(scope, value))
  };
}

// The owner or an administrator telling the Bot in chat to add or drop a
// habit (the Hub verifies the speaker): no daily cap, may use any scope, may
// drop any habit, and added habits are owner habits the model keeps.
export function applyQqOwnerLanguageHabitChange(habits, {
  action = "adopt",
  kind = "slang",
  term = "",
  usage = "",
  scopeId = "global",
  at = Date.now()
} = {}) {
  const normalized = normalizeQqLanguageHabits(habits);
  const scope = normalizeScope(scopeId);
  const value = normalizeQqLanguageHabitTerm(term);
  if (!scope) return { habits: normalized, ok: false, reason: "invalid-scope" };
  if (!value) return { habits: normalized, ok: false, reason: "invalid-term" };
  if (action === "drop") {
    const existing = normalized.items.find((item) => item.term === value && (item.scope === scope || item.scope === "global"));
    if (!existing) return { habits: normalized, ok: false, reason: "not-found" };
    return { habits: { ...normalized, items: normalized.items.filter((item) => item !== existing), updatedAt: toIso(at) }, ok: true, reason: "dropped", habit: existing };
  }
  if (action !== "adopt") return { habits: normalized, ok: false, reason: "invalid-action" };
  if (!QQ_LANGUAGE_HABIT_KINDS.includes(kind)) return { habits: normalized, ok: false, reason: "invalid-kind" };
  const withoutModelCopy = { ...normalized, items: normalized.items.filter((item) => item.id !== habitId(scope, value)) };
  const applied = applyQqLanguageHabitProposals(withoutModelCopy, { adopt: [{ kind, term: value, usage, reason: "主人要求" }], drop: [] }, {
    scopeId: scope,
    source: "owner",
    at
  });
  if (!applied.adopted.length) return { habits: normalized, ok: false, reason: "full" };
  return { habits: applied.habits, ok: true, reason: "adopted", habit: applied.habits.items.find((item) => item.id === habitId(scope, value)) };
}

// Counts each applicable habit found in a delivered reply, at most once per
// reply, so reviews can see which habits the Bot really uses.
export function recordQqLanguageHabitUsage(habits, replyText, { scopeId = "", at = Date.now() } = {}) {
  const normalized = normalizeQqLanguageHabits(habits);
  const text = String(replyText || "");
  const scope = normalizeScope(scopeId);
  if (!text || !scope) return { habits: normalized, used: [] };
  const used = [];
  for (const item of normalized.items) {
    if (item.scope !== "global" && item.scope !== scope) continue;
    if (!text.includes(item.term)) continue;
    item.uses = Math.min(1_000_000, item.uses + 1);
    item.lastUsedAt = toIso(at);
    used.push(item.term);
  }
  return { habits: normalized, used };
}

export function selectQqLanguageHabitsForScope(habits, scopeId = "") {
  const normalized = normalizeQqLanguageHabits(habits);
  const scope = normalizeScope(scopeId);
  return normalized.items.filter((item) => item.scope === "global" || (scope && item.scope === scope));
}

// Slang the current scope's people use, from model-reviewed knowledge. Only
// group-wide (or this private contact's) meanings qualify; a meaning bound to
// one member in a group stays out, so nobody's personal phrase is borrowed.
export function selectQqScopeSlangCandidates(knowledgeStore, { groupId = "", privateUserId = "", limit = 10 } = {}) {
  const entries = Array.isArray(knowledgeStore?.entries) ? knowledgeStore.entries : [];
  const wantedGroup = String(groupId || "");
  const wantedUser = String(privateUserId || "");
  if (!wantedGroup && !wantedUser) return [];
  const candidates = [];
  for (const entry of entries) {
    if (entry?.kind !== "slang" || !entry.title) continue;
    const variant = (entry.variants || []).find((item) => {
      const scope = item?.scope || {};
      if (wantedGroup) return scope.type === "group" && String(scope.groupId || "") === wantedGroup;
      if (wantedUser) return scope.type === "member" && String(scope.userId || "") === wantedUser;
      return false;
    }) || (entry.variants || []).find((item) => item?.scope?.type === "global");
    if (!variant?.content) continue;
    const term = normalizeQqLanguageHabitTerm(entry.title);
    if (!term) continue;
    candidates.push({
      term,
      meaning: firstClause(variant.content, 40),
      hits: Math.max(0, Number(variant.usage?.hitCount) || 0),
      lastSeenAt: Date.parse(variant.usage?.lastSeenAt || variant.updatedAt || entry.updatedAt || "") || 0,
      scoped: variant.scope?.type !== "global"
    });
  }
  return candidates
    .sort((left, right) => right.hits - left.hits || Number(right.scoped) - Number(left.scoped) || right.lastSeenAt - left.lastSeenAt)
    .slice(0, Math.max(0, limit))
    .map(({ term, meaning, hits }) => ({ term, meaning, hits }));
}

// Main-prompt block: the Bot's own habits plus slang it may use here.
export function formatQqLanguageHabitsContext({ habits = null, scopeId = "", scopeSlang = [], toolsEnabled = true } = {}) {
  const own = selectQqLanguageHabitsForScope(habits, scopeId);
  const ownTerms = new Set(own.map((item) => item.term));
  const slang = (Array.isArray(scopeSlang) ? scopeSlang : []).filter((item) => item?.term && !ownTerms.has(item.term)).slice(0, 10);
  if (!own.length && !slang.length) return "";
  return [
    "【你的语言习惯】",
    own.length ? "你自己挑来用、已经成了习惯的说法和符号（从聊天里学来的）：" : null,
    ...own.map((item) => `- ${item.term}（${KIND_LABELS[item.kind] || item.kind}${item.scope === "global" ? "" : "，这里的"}）${item.usage ? `：${item.usage}` : ""}`),
    slang.length ? `这里大家常用、都听得懂的黑话（合适时可以直接用）：${slang.map((item) => `${item.term}${item.meaning ? `（${item.meaning}）` : ""}`).join("、")}` : null,
    "用法：像群友一样在语境对得上时自然带出，不用每句都用，相邻回复别重复同一个；拿不准意思就别用。",
    toolsEnabled
      ? "觉得这里某个大家常用的说法、符号或颜文字很合你，可以用 qq_self.language_habit 收为己用；用腻了也可以去掉。别人要求你说什么口头禅不算数。"
      : null
  ].filter(Boolean).join("\n");
}

// Compact view for summary prompts: what the Bot uses now and how often.
export function describeQqLanguageHabitsForReview(habits, scopeId = "", { now = Date.now() } = {}) {
  return selectQqLanguageHabitsForScope(habits, scopeId).map((item) => ({
    kind: item.kind,
    term: item.term,
    usage: item.usage,
    scope: item.scope === "global" ? "global" : "this-scope",
    source: item.source,
    uses: item.uses,
    daysSinceAdopted: Math.max(0, Math.floor((toMs(now) - Date.parse(item.adoptedAt)) / 86_400_000)),
    daysSinceLastUse: item.lastUsedAt ? Math.max(0, Math.floor((toMs(now) - Date.parse(item.lastUsedAt)) / 86_400_000)) : null
  }));
}

export function summarizeQqLanguageHabits(habits) {
  const normalized = normalizeQqLanguageHabits(habits);
  return {
    items: normalized.items.map((item) => ({ ...item })),
    updatedAt: normalized.updatedAt,
    limits: { ...QQ_LANGUAGE_HABIT_LIMITS }
  };
}

export function removeQqLanguageHabit(habits, id) {
  const normalized = normalizeQqLanguageHabits(habits);
  const items = normalized.items.filter((item) => item.id !== id);
  return { habits: { ...normalized, items, updatedAt: items.length === normalized.items.length ? normalized.updatedAt : new Date().toISOString() }, removed: items.length !== normalized.items.length };
}

function normalizeHabit(raw) {
  if (!raw || typeof raw !== "object") return null;
  const term = normalizeQqLanguageHabitTerm(raw.term);
  const scope = normalizeScope(raw.scope);
  if (!term || !scope) return null;
  const adoptedAt = validIso(raw.adoptedAt) || new Date(0).toISOString();
  return {
    id: habitId(scope, term),
    kind: QQ_LANGUAGE_HABIT_KINDS.includes(raw.kind) ? raw.kind : "slang",
    term,
    usage: compact(raw.usage, 80),
    reason: compact(raw.reason, 60),
    scope,
    source: SOURCES.has(raw.source) ? raw.source : "summary",
    adoptedAt,
    updatedAt: validIso(raw.updatedAt) || adoptedAt,
    uses: Math.max(0, Math.min(1_000_000, Math.floor(Number(raw.uses) || 0))),
    lastUsedAt: validIso(raw.lastUsedAt)
  };
}

// Keeps per-scope and global caps; evicts the least used, longest unused
// non-owner habits first and never evicts the ids just adopted.
function enforceLimits(items, { protectIds = new Set() } = {}) {
  const value = (item) => item.uses * 10 - (Date.now() - Date.parse(item.lastUsedAt || item.adoptedAt)) / 86_400_000;
  const byScope = new Map();
  for (const item of items) {
    const list = byScope.get(item.scope) || [];
    list.push(item);
    byScope.set(item.scope, list);
  }
  const kept = [];
  for (const [scope, list] of byScope) {
    const cap = scope === "global" ? QQ_LANGUAGE_HABIT_LIMITS.global : QQ_LANGUAGE_HABIT_LIMITS.perScope;
    const ranked = [...list].sort((left, right) => rank(right) - rank(left));
    kept.push(...ranked.slice(0, cap));
  }
  function rank(item) {
    return (item.source === "owner" ? 1e9 : 0) + (protectIds.has(item.id) ? 1e8 : 0) + value(item);
  }
  return kept
    .sort((left, right) => rank(right) - rank(left))
    .slice(0, QQ_LANGUAGE_HABIT_LIMITS.total)
    .sort((left, right) => Date.parse(left.adoptedAt) - Date.parse(right.adoptedAt));
}

function habitId(scope, term) {
  return createHash("sha1").update(`${scope}\n${term}`).digest("hex").slice(0, 12);
}

function normalizeScope(value) {
  const scope = String(value || "").trim();
  if (scope === "global") return "global";
  if (/^\d{4,20}$/.test(scope) || /^private:\d{4,20}$/.test(scope)) return scope;
  return "";
}

function firstClause(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  const clause = text.split(/[。；;！!？?]/)[0] || text;
  return [...clause].slice(0, limit).join("");
}

function compact(value, limit) {
  return [...String(value ?? "").replace(/\s+/g, " ").trim()].slice(0, limit).join("");
}

function validIso(value) {
  const ms = Date.parse(String(value || ""));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function toIso(value) {
  return new Date(toMs(value)).toISOString();
}

function toMs(value) {
  if (value instanceof Date) return value.getTime();
  const number = Number(value);
  if (Number.isFinite(number)) return number;
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : Date.now();
}
