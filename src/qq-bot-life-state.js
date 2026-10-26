// The Bot's own continuing state between turns: a short mood that follows it
// across conversations, the first-person inner thought it formed in each
// conversation (the structured-output equivalent of DeepSeek's in-character
// "内心OS" thinking), and an optional daily routine. Only the mood crosses
// conversations; inner thoughts stay in the conversation that produced them,
// so a private chat never leaks into a group through this state.

export const QQ_BOT_LIFE_STATE_VERSION = 1;
const MAX_THOUGHTS = 120;
const MAX_THOUGHTS_PER_SCOPE = 6;
const MAX_THOUGHT_CHARS = 160;
const MAX_MOOD_CHARS = 16;
const MOOD_FRESH_MS = 90 * 60_000;
const MOOD_FADE_MS = 4 * 60 * 60_000;
const THOUGHT_CONTEXT_MS = 8 * 60 * 60_000;
const MAX_ROUTINE_SEGMENTS = 12;
// A routine day starts at 05:00 local time, so 01:00 still belongs to the
// previous evening's routine and its overnight segment.
export const QQ_BOT_ROUTINE_DAY_START_HOUR = 5;

export function createEmptyQqBotLifeState() {
  return { version: QQ_BOT_LIFE_STATE_VERSION, mood: null, thoughts: [], routine: null };
}

export function normalizeQqBotLifeState(value = {}) {
  const raw = value && typeof value === "object" ? value : {};
  const state = createEmptyQqBotLifeState();
  state.mood = normalizeMood(raw.mood);
  state.thoughts = (Array.isArray(raw.thoughts) ? raw.thoughts : [])
    .map(normalizeThought)
    .filter(Boolean)
    .slice(-MAX_THOUGHTS);
  state.routine = normalizeQqBotRoutine(raw.routine);
  return state;
}

export function normalizeQqBotThoughtText(value) {
  return compact(value, MAX_THOUGHT_CHARS);
}

export function normalizeQqBotMoodText(value) {
  return compact(value, MAX_MOOD_CHARS).replace(/[。.!！]+$/u, "");
}

// Records one finished turn. An empty mood keeps the previous mood.
export function recordQqBotLifeTurn(state, {
  scopeId = "",
  thought = "",
  mood = "",
  silent = false,
  at = new Date().toISOString()
} = {}) {
  const next = normalizeQqBotLifeState(state);
  const scope = String(scopeId || "").trim();
  const text = normalizeQqBotThoughtText(thought);
  const moodText = normalizeQqBotMoodText(mood);
  let changed = false;
  if (moodText) {
    next.mood = { text: moodText, at, scopeId: scope || null };
    changed = true;
  }
  if (scope && text) {
    next.thoughts.push({ scopeId: scope, text, mood: moodText || null, silent: Boolean(silent), at });
    const perScope = next.thoughts.filter((entry) => entry.scopeId === scope);
    if (perScope.length > MAX_THOUGHTS_PER_SCOPE) {
      const drop = new Set(perScope.slice(0, perScope.length - MAX_THOUGHTS_PER_SCOPE));
      next.thoughts = next.thoughts.filter((entry) => !drop.has(entry));
    }
    next.thoughts = next.thoughts.slice(-MAX_THOUGHTS);
    changed = true;
  }
  return { state: next, changed };
}

export function setQqBotRoutine(state, routine) {
  const next = normalizeQqBotLifeState(state);
  next.routine = normalizeQqBotRoutine(routine);
  return next;
}

// Short prompt block; it is the Bot's private state, not a script.
export function formatQqBotLifeContext(state, { scopeId = "", now = Date.now(), timeZone = "Asia/Shanghai" } = {}) {
  const value = normalizeQqBotLifeState(state);
  const lines = [];
  const segment = selectQqBotRoutineSegment(value.routine, { now, timeZone });
  if (segment) {
    lines.push(`- 按你今天的作息，现在（${formatClock(now, timeZone)}）大概在：${segment.activity}${segment.state ? `；状态：${segment.state}` : ""}。`);
  }
  const mood = value.mood;
  const moodAge = mood ? now - Date.parse(mood.at) : Infinity;
  if (mood && moodAge >= 0 && moodAge <= MOOD_FADE_MS) {
    const where = mood.scopeId && mood.scopeId === scopeId ? "在这里" : "在别处";
    const fading = moodAge > MOOD_FRESH_MS ? "，已经过去一阵，可能淡了" : "";
    lines.push(`- 心情：${mood.text}（${formatAge(moodAge)}${where}${fading}）。`);
  }
  const thoughts = value.thoughts
    .filter((entry) => entry.scopeId === scopeId && now - Date.parse(entry.at) <= THOUGHT_CONTEXT_MS)
    .slice(-2);
  for (const entry of thoughts) {
    lines.push(`- ${formatAge(now - Date.parse(entry.at))}你在这里${entry.silent ? "没出声，" : ""}心里想的是：${entry.text}`);
  }
  if (!lines.length) return "";
  return [
    "【你此刻的状态】只有你自己知道，用来延续态度和情绪，不要复述或解释：",
    ...lines,
    "状态只影响语气、兴趣和耐心；事实、权限和任务完整性不受它影响。新消息让你心情变了就让它变。"
  ].join("\n");
}

export function formatQqBotLifeDetail(state, { scopeId = "", now = Date.now(), timeZone = "Asia/Shanghai" } = {}) {
  const value = normalizeQqBotLifeState(state);
  const lines = [];
  lines.push(value.mood
    ? `心情：${value.mood.text}（${formatAge(now - Date.parse(value.mood.at))}）`
    : "心情：还没有记录。");
  const routine = value.routine;
  if (routine?.segments?.length) {
    lines.push(`今天（${routine.date}）的作息：`);
    const current = selectQqBotRoutineSegment(routine, { now, timeZone });
    for (const segment of routine.segments) {
      const isCurrent = current?.start === segment.start && current?.end === segment.end;
      lines.push(`${isCurrent ? "→" : "-"} ${segment.start}-${segment.end} ${segment.activity}${segment.state ? `（${segment.state}）` : ""}`);
    }
  } else {
    lines.push("今天还没有生成作息。");
  }
  const thoughts = value.thoughts.filter((entry) => entry.scopeId === scopeId).slice(-4);
  lines.push(thoughts.length ? "你在这个会话里最近的内心OS：" : "这个会话里还没有记录过内心OS。");
  for (const entry of thoughts) lines.push(`- ${formatAge(now - Date.parse(entry.at))}：${entry.text}`);
  return lines.join("\n");
}

export function normalizeQqBotRoutine(value) {
  if (!value || typeof value !== "object") return null;
  const date = String(value.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const segments = (Array.isArray(value.segments) ? value.segments : [])
    .map((segment) => {
      const start = normalizeClock(segment?.start);
      const end = normalizeClock(segment?.end);
      const activity = compact(segment?.activity, 40);
      if (!start || !end || !activity || start === end) return null;
      return { start, end, activity, state: compact(segment?.state, 20) };
    })
    .filter(Boolean)
    .slice(0, MAX_ROUTINE_SEGMENTS);
  if (!segments.length) return null;
  return { date, generatedAt: String(value.generatedAt || "") || null, segments };
}

export function getQqBotLocalHour(now = Date.now(), timeZone = "Asia/Shanghai") {
  return Number(new Intl.DateTimeFormat("en", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(new Date(now)));
}

// A moment inside the current routine day (the previous calendar day before 05:00).
export function getQqBotRoutineDayAnchor(now = Date.now(), timeZone = "Asia/Shanghai") {
  return getQqBotLocalHour(now, timeZone) < QQ_BOT_ROUTINE_DAY_START_HOUR ? now - 24 * 60 * 60_000 : now;
}

export function getQqBotRoutineDay(now = Date.now(), timeZone = "Asia/Shanghai") {
  return formatLocalDate(getQqBotRoutineDayAnchor(now, timeZone), timeZone);
}

// Only the current routine day applies; a segment may cross midnight (22:30-07:30).
export function selectQqBotRoutineSegment(routine, { now = Date.now(), timeZone = "Asia/Shanghai" } = {}) {
  const value = normalizeQqBotRoutine(routine);
  if (!value || value.date !== getQqBotRoutineDay(now, timeZone)) return null;
  const minute = toMinutes(formatClock(now, timeZone));
  return value.segments.find((segment) => {
    const start = toMinutes(segment.start);
    const end = toMinutes(segment.end);
    return start < end ? minute >= start && minute < end : minute >= start || minute < end;
  }) || null;
}

export function formatLocalDate(value = Date.now(), timeZone = "Asia/Shanghai") {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatClock(value, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en", {
    timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(value)).map((part) => [part.type, part.value]));
  return `${parts.hour}:${parts.minute}`;
}

function formatAge(ms) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 2) return "刚才";
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.round(minutes / 60);
  return `${hours} 小时前`;
}

function normalizeMood(value) {
  if (!value || typeof value !== "object") return null;
  const text = normalizeQqBotMoodText(value.text);
  const at = String(value.at || "");
  if (!text || !Number.isFinite(Date.parse(at))) return null;
  return { text, at, scopeId: value.scopeId ? String(value.scopeId) : null };
}

function normalizeThought(value) {
  if (!value || typeof value !== "object") return null;
  const scopeId = String(value.scopeId || "").trim();
  const text = normalizeQqBotThoughtText(value.text);
  const at = String(value.at || "");
  if (!scopeId || !text || !Number.isFinite(Date.parse(at))) return null;
  return { scopeId, text, mood: value.mood ? normalizeQqBotMoodText(value.mood) : null, silent: Boolean(value.silent), at };
}

function normalizeClock(value) {
  const match = String(value || "").trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  return match ? `${match[1].padStart(2, "0")}:${match[2]}` : "";
}

function toMinutes(clock) {
  const [hour, minute] = clock.split(":").map(Number);
  return hour * 60 + minute;
}

function compact(value, maxChars) {
  return [...String(value || "").replace(/\s+/g, " ").trim()].slice(0, maxChars).join("");
}
