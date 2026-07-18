import { extractQqUrls } from "./qq-message-content.js";

const markerPattern = /\[\[qq_memory:(\{[^\n]*?\})\]\]/g;
const anyMarkerPattern = /\[\[qq_memory:[\s\S]*?\]\]/g;
const maxPeoplePerGroup = 500;
const maxGlobalPeople = 2_000;
export const qqConversationMemoryVersion = 2;

export function createEmptyQqConversationMemory() {
  return {
    version: qqConversationMemoryVersion,
    updatedAt: null,
    groups: Object.create(null),
    people: Object.create(null),
    privateChats: Object.create(null)
  };
}

export function normalizeQqConversationMemory(value) {
  const input = value && typeof value === "object" ? value : {};
  const groups = normalizeRecord(input.groups);
  const state = {
    version: qqConversationMemoryVersion,
    updatedAt: input.updatedAt || null,
    groups,
    people: normalizeRecord(input.people),
    privateChats: normalizeRecord(input.privateChats)
  };
  normalizeGlobalPeople(state.people);
  if (Number(input.version || 1) < qqConversationMemoryVersion) migrateLegacyGroupPeople(state);
  return state;
}

export function updateQqConversationMemoryFromEvent(memory, event, { now = () => new Date() } = {}) {
  const state = ensureMemory(memory);
  const at = now().toISOString();
  const text = memoryText(event?.contentContext?.displayText || event?.text || "", 520);
  const reusableText = containsLikelySecret(text) ? "" : text;
  const links = event?.contentContext?.links?.length
    ? event.contentContext.links
    : extractQqUrls(text);
  const topic = inferConversationTopic(reusableText, event);
  if (event?.groupId) {
    const group = getGroup(state, event.groupId);
    if (!group) return state;
    group.updatedAt = at;
    group.messageCount = Number(group.messageCount || 0) + 1;
    if (topic) group.recentTopics = pushTopic(group.recentTopics, topic, event, at);
    group.recentLinks = pushLinks(group.recentLinks, links, event, at);
    if (event?.contentContext?.forward?.text) {
      group.recentSharedContent = pushLimited(group.recentSharedContent, {
        type: "forward",
        at,
        senderId: String(event.senderId || ""),
        senderName: String(event.senderName || event.senderLabel || "群友"),
        summary: memoryText(event.contentContext.forward.text, 260)
      }, 8);
    } else if (event?.contentContext?.cards?.length) {
      group.recentSharedContent = pushLimited(group.recentSharedContent, {
        type: "card",
        at,
        senderId: String(event.senderId || ""),
        senderName: String(event.senderName || event.senderLabel || "群友"),
        summary: memoryText(event.contentContext.displayText, 260)
      }, 8);
    }
    const senderName = event.senderName || event.senderLabel;
    const person = getGroupPerson(group, event.senderId, senderName);
    const globalPerson = getGlobalPerson(state, event.senderId, event.groupId, senderName);
    if (person) {
      person.updatedAt = at;
      person.messageCount = Number(person.messageCount || 0) + 1;
      if (topic) person.recentTopics = pushTopic(person.recentTopics, topic, event, at, 8);
    }
    if (globalPerson) {
      globalPerson.updatedAt = at;
      globalPerson.messageCount = Number(globalPerson.messageCount || 0) + 1;
    }
  } else if (event?.senderId) {
    const chat = getPrivateChat(state, event.senderId, event.senderLabel || event.senderName);
    if (!chat) return state;
    chat.updatedAt = at;
    chat.messageCount = Number(chat.messageCount || 0) + 1;
    if (topic) chat.recentTopics = pushTopic(chat.recentTopics, topic, event, at, 10);
    chat.recentLinks = pushLinks(chat.recentLinks, links, event, at);
    if (reusableText) {
      chat.recentMessages = pushLimited(chat.recentMessages, {
        at,
        role: "user",
        text: memoryText(reusableText, 280)
      }, 12);
    }
  }
  state.updatedAt = at;
  return state;
}

export function updateQqConversationMemoryFromExchange(memory, event, reply, patches = [], { now = () => new Date() } = {}) {
  const state = ensureMemory(memory);
  const at = now().toISOString();
  const userText = memoryText(event?.contentContext?.displayText || event?.text || "", 300);
  const assistantText = memoryText(reply, 300);
  if (event?.groupId) {
    const group = getGroup(state, event.groupId);
    if (!group) return state;
    group.updatedAt = at;
    group.recentInteractions = pushLimited(group.recentInteractions, {
      at,
      senderId: String(event.senderId || ""),
      senderName: String(event.senderName || event.senderLabel || "群友"),
      userText,
      assistantText
    }, 10);
    const senderName = event.senderName || event.senderLabel;
    const person = getGroupPerson(group, event.senderId, senderName);
    const globalPerson = getGlobalPerson(state, event.senderId, event.groupId, senderName);
    if (person) {
      person.recentInteractions = pushLimited(person.recentInteractions, { at, userText, assistantText }, 6);
    }
    for (const patch of patches) applyPatchToGroup(group, person, globalPerson, patch, at);
  } else if (event?.senderId) {
    const chat = getPrivateChat(state, event.senderId, event.senderLabel || event.senderName);
    if (!chat) return state;
    chat.updatedAt = at;
    if (assistantText) chat.recentMessages = pushLimited(chat.recentMessages, { at, role: "assistant", text: assistantText }, 12);
    chat.recentConversations = pushLimited(chat.recentConversations, { at, userText, assistantText }, 8);
    for (const patch of patches) applyPatchToPrivateChat(chat, patch, at);
  }
  state.updatedAt = at;
  return state;
}

export function extractQqConversationMemoryMarkers(reply) {
  const patches = [];
  const visibleText = String(reply || "").replace(markerPattern, (_, json) => {
    try {
      const parsed = JSON.parse(json);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) patches.push(normalizePatch(parsed));
    } catch {
      // Invalid model metadata is hidden and ignored rather than exposed to QQ.
    }
    return "";
  }).replace(anyMarkerPattern, "").replace(/\n{3,}/g, "\n\n").trim();
  return { visibleText, patches: patches.filter(hasPatchContent) };
}

export function stripQqConversationMemoryMarkers(reply) {
  return String(reply || "").replace(anyMarkerPattern, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function formatQqConversationMemoryContext(memory, event) {
  const state = ensureMemory(memory);
  if (event?.groupId) {
    const group = state.groups[String(event.groupId)];
    if (!group) return "";
    const groupPerson = group.people?.[String(event.senderId || "")];
    const person = state.people?.[String(event.senderId || "")] || groupPerson;
    const recentTopics = formatTopics(group.recentTopics, 5);
    const lines = [
      "群聊印象记忆（弱参考）：",
      "群印象只属于当前群；人物印象按 QQ 号跨群共享。它们都只是长期积累的弱参考，不要当成绝对事实，也不要主动宣称在给群友建档。",
      group.impression ? `- 对这个群的印象：${group.impression}` : null,
      recentTopics ? `- 这个群最近聊过：${recentTopics}` : null,
      group.botThought ? `- Bot 最近对群聊的感想：${group.botThought}` : null,
      person?.impression ? `- 对当前发送者的跨群人物印象：${person.impression}` : null,
      groupPerson?.botThought ? `- 与当前发送者在本群互动后的感想：${groupPerson.botThought}` : null
    ].filter(Boolean);
    return lines.length > 2 ? lines.join("\n") : "";
  }
  const chat = state.privateChats[String(event?.senderId || "")];
  if (!chat) return "";
  const recentTopics = formatTopics(chat.recentTopics, 6);
  return [
    "私聊印象记忆（弱参考）：",
    "这些是和当前联系人长期互动形成的印象、最近话题和 Bot 自己的主观感受；只用于自然承接，不要把推测说成事实，不要主动说自己在记录对方。",
    chat.impression ? `- 对这个人的印象：${chat.impression}` : null,
    recentTopics ? `- 最近聊过：${recentTopics}` : null,
    chat.botThought ? `- Bot 最近的感想：${chat.botThought}` : null,
    chat.recentConversations?.length ? `- 最近一次互动：${formatConversation(chat.recentConversations.at(-1))}` : null
  ].filter(Boolean).join("\n");
}

export function summarizeQqConversationMemory(memory) {
  const state = ensureMemory(memory);
  return {
    groups: Object.keys(state.groups).length,
    people: Object.keys(state.people).length,
    privateChats: Object.keys(state.privateChats).length,
    groupPeople: Object.values(state.groups).reduce((sum, group) => sum + Object.keys(group?.people || {}).length, 0)
  };
}

function ensureMemory(memory) {
  if (!memory || typeof memory !== "object") return createEmptyQqConversationMemory();
  if (Number(memory.version || 1) < qqConversationMemoryVersion) return normalizeQqConversationMemory(memory);
  memory.version = qqConversationMemoryVersion;
  memory.groups = normalizeRecord(memory.groups);
  memory.people = normalizeRecord(memory.people);
  normalizeGlobalPeople(memory.people);
  memory.privateChats = normalizeRecord(memory.privateChats);
  return memory;
}

function getGroup(state, groupId) {
  const id = String(groupId);
  if (!isSafeRecordKey(id)) return null;
  state.groups[id] ||= {
    groupId: id,
    messageCount: 0,
    updatedAt: null,
    impression: "",
    botThought: "",
    recentTopics: [],
    recentLinks: [],
    recentSharedContent: [],
    recentInteractions: [],
    people: Object.create(null)
  };
  state.groups[id].people = normalizeRecord(state.groups[id].people);
  return state.groups[id];
}

function getGroupPerson(group, senderId, senderName = "") {
  if (!senderId) return null;
  const id = String(senderId);
  if (!isSafeRecordKey(id)) return null;
  if (!group.people[id] && Object.keys(group.people).length >= maxPeoplePerGroup) {
    const oldestId = Object.keys(group.people).sort((left, right) => {
      const leftAt = Date.parse(group.people[left]?.updatedAt || "") || 0;
      const rightAt = Date.parse(group.people[right]?.updatedAt || "") || 0;
      return leftAt - rightAt;
    })[0];
    if (oldestId) delete group.people[oldestId];
  }
  group.people[id] ||= {
    userId: id,
    aliases: [],
    messageCount: 0,
    updatedAt: null,
    impression: "",
    botThought: "",
    recentTopics: [],
    recentInteractions: []
  };
  addAlias(group.people[id], senderName);
  return group.people[id];
}

function getGlobalPerson(state, senderId, groupId, senderName = "") {
  if (!senderId) return null;
  const id = String(senderId);
  const scopedGroupId = String(groupId || "");
  if (!isSafeRecordKey(id) || !isSafeRecordKey(scopedGroupId)) return null;
  if (!state.people[id] && Object.keys(state.people).length >= maxGlobalPeople) {
    const oldestId = Object.keys(state.people).sort((left, right) => {
      const leftAt = Date.parse(state.people[left]?.updatedAt || "") || 0;
      const rightAt = Date.parse(state.people[right]?.updatedAt || "") || 0;
      return leftAt - rightAt;
    })[0];
    if (oldestId) delete state.people[oldestId];
  }
  state.people[id] ||= createGlobalPerson(id);
  const person = state.people[id];
  addAlias(person, senderName);
  person.groupIds = [...new Set([...(person.groupIds || []), scopedGroupId])].slice(-32);
  person.groupAliases = normalizeRecord(person.groupAliases);
  person.groupAliases[scopedGroupId] = addAliasToList(person.groupAliases[scopedGroupId], senderName);
  return person;
}

function getPrivateChat(state, senderId, senderName = "") {
  const id = String(senderId);
  if (!isSafeRecordKey(id)) return null;
  state.privateChats[id] ||= {
    userId: id,
    aliases: [],
    messageCount: 0,
    updatedAt: null,
    impression: "",
    botThought: "",
    recentTopics: [],
    recentLinks: [],
    recentMessages: [],
    recentConversations: []
  };
  addAlias(state.privateChats[id], senderName);
  return state.privateChats[id];
}

function addAlias(record, alias) {
  record.aliases = addAliasToList(record.aliases, alias);
}

function addAliasToList(aliases, alias) {
  const value = memoryText(alias, 48);
  const list = Array.isArray(aliases) ? aliases : [];
  if (!value) return list;
  const key = value.toLowerCase().replace(/\s+/g, "");
  if (list.some((item) => String(item).toLowerCase().replace(/\s+/g, "") === key)) return list;
  return [...list, value].slice(-8);
}

function inferConversationTopic(text, event) {
  const value = String(text || "");
  const rules = [
    ["Bot 与 AI", /(bot|机器人|模型|gpt|codex|ai|提示词|记忆|上下文|agent)/i],
    ["技术与排障", /(代码|脚本|接口|服务器|部署|报错|bug|网络|电脑|软件|系统|配置)/i],
    ["游戏", /(游戏|手游|端游|steam|开黑|上分|角色|装备|攻略|副本)/i],
    ["动画与二次元", /(动漫|动画|番剧|漫画|二次元|gal|vtb|兽设|福瑞)/i],
    ["学习与工作", /(学校|上课|考试|作业|学习|公司|上班|下班|工作|项目)/i],
    ["日常生活", /(吃饭|睡觉|回家|出门|天气|台风|快递|买|喝|困|累)/i],
    ["情绪与关系", /(喜欢|讨厌|开心|难过|生气|焦虑|朋友|对象|感情|安慰)/i],
    ["新闻与网络内容", /(新闻|热搜|公告|通报|链接|网页|视频|文章|转发)/i]
  ];
  const labels = rules.filter(([, pattern]) => pattern.test(value)).map(([label]) => label);
  if ((event?.contentContext?.links || []).length > 0 && !labels.includes("新闻与网络内容")) labels.push("新闻与网络内容");
  if (event?.contentContext?.forward?.text && !labels.includes("转发聊天记录")) labels.push("转发聊天记录");
  if (labels.length === 0 && value) return { label: "近期闲聊", summary: memoryText(value, 100) };
  return labels.length ? { label: labels.slice(0, 2).join(" / "), summary: memoryText(value, 100) } : null;
}

function pushTopic(items, topic, event, at, limit = 12) {
  const list = Array.isArray(items) ? [...items] : [];
  const previous = list.at(-1);
  const entry = {
    label: memoryText(topic.label, 60),
    summary: memoryText(topic.summary, 120),
    at,
    senderId: String(event?.senderId || ""),
    senderName: memoryText(event?.senderLabel || event?.senderName || "", 48),
    count: previous?.label === topic.label ? Number(previous.count || 1) + 1 : 1
  };
  if (previous?.label === topic.label) list[list.length - 1] = entry;
  else list.push(entry);
  return list.slice(-limit);
}

function pushLinks(items, links, event, at) {
  let list = Array.isArray(items) ? [...items] : [];
  for (const url of links || []) {
    const safeUrl = sanitizeMemoryUrl(url);
    if (!safeUrl) continue;
    const entry = {
      url: safeUrl,
      host: safeHost(safeUrl),
      at,
      senderId: String(event?.senderId || ""),
      senderName: memoryText(event?.senderLabel || event?.senderName || "", 48)
    };
    list = [...list.filter((item) => item.url !== entry.url), entry].slice(-12);
  }
  return list;
}

function applyPatchToGroup(group, person, globalPerson, patch, at) {
  if (patch.scopeImpression) group.impression = patch.scopeImpression;
  if (patch.personImpression) {
    if (person) person.impression = patch.personImpression;
    if (globalPerson) globalPerson.impression = patch.personImpression;
  }
  if (patch.botThought) {
    group.botThought = patch.botThought;
    if (person) person.botThought = patch.botThought;
  }
  if (patch.recentTopic) {
    group.recentTopics = pushLimited(group.recentTopics, {
      label: patch.recentTopic,
      summary: patch.recentTopic,
      at,
      senderId: person?.userId || "",
      senderName: person?.aliases?.at(-1) || "",
      count: 1
    }, 12);
  }
}

function createGlobalPerson(userId) {
  return {
    userId,
    aliases: [],
    groupIds: [],
    groupAliases: Object.create(null),
    messageCount: 0,
    updatedAt: null,
    impression: ""
  };
}

function normalizeGlobalPeople(people) {
  for (const [userId, value] of Object.entries(people)) {
    const person = value && typeof value === "object" && !Array.isArray(value)
      ? value
      : createGlobalPerson(userId);
    person.userId = String(person.userId || userId);
    person.aliases = Array.isArray(person.aliases) ? person.aliases.map((item) => memoryText(item, 48)).filter(Boolean).slice(-8) : [];
    person.groupIds = Array.isArray(person.groupIds) ? [...new Set(person.groupIds.map(String).filter(isSafeRecordKey))].slice(-32) : [];
    person.groupAliases = normalizeRecord(person.groupAliases);
    for (const [groupId, aliases] of Object.entries(person.groupAliases)) {
      person.groupAliases[groupId] = Array.isArray(aliases)
        ? aliases.map((item) => memoryText(item, 48)).filter(Boolean).slice(-8)
        : [];
    }
    person.messageCount = Math.max(0, Number(person.messageCount) || 0);
    person.updatedAt = person.updatedAt || null;
    person.impression = safeMemoryField(person.impression);
    people[userId] = person;
  }
}

function migrateLegacyGroupPeople(state) {
  const newestByUserId = new Map();
  for (const [groupId, group] of Object.entries(state.groups)) {
    for (const [userId, legacy] of Object.entries(normalizeRecord(group?.people))) {
      if (!isSafeRecordKey(userId)) continue;
      state.people[userId] ||= createGlobalPerson(userId);
      const person = state.people[userId];
      for (const alias of legacy?.aliases || []) addAlias(person, alias);
      person.groupIds = [...new Set([...(person.groupIds || []), groupId])].slice(-32);
      person.groupAliases[groupId] = (legacy?.aliases || []).reduce(addAliasToList, []);
      person.messageCount = Number(person.messageCount || 0) + Math.max(0, Number(legacy?.messageCount) || 0);
      const updatedAt = Date.parse(legacy?.updatedAt || "") || 0;
      if (updatedAt >= (newestByUserId.get(userId) || 0)) {
        if (legacy?.impression) person.impression = safeMemoryField(legacy.impression);
        person.updatedAt = legacy?.updatedAt || person.updatedAt;
        newestByUserId.set(userId, updatedAt);
      }
    }
  }
}

function applyPatchToPrivateChat(chat, patch, at) {
  if (patch.scopeImpression || patch.personImpression) chat.impression = patch.personImpression || patch.scopeImpression;
  if (patch.botThought) chat.botThought = patch.botThought;
  if (patch.recentTopic) {
    chat.recentTopics = pushLimited(chat.recentTopics, {
      label: patch.recentTopic,
      summary: patch.recentTopic,
      at,
      senderId: chat.userId,
      senderName: chat.aliases?.at(-1) || "",
      count: 1
    }, 10);
  }
}

function normalizePatch(value) {
  return {
    scopeImpression: safeMemoryField(value.scopeImpression),
    personImpression: safeMemoryField(value.personImpression),
    recentTopic: safeMemoryField(value.recentTopic, 80),
    botThought: safeMemoryField(value.botThought)
  };
}

function safeMemoryField(value, limit = 180) {
  const text = memoryText(value, limit);
  if (!text || containsLikelySecret(text)) return "";
  return text;
}

function hasPatchContent(patch) {
  return Object.values(patch).some(Boolean);
}

function formatTopics(items, limit) {
  return (Array.isArray(items) ? items : [])
    .slice(-limit)
    .map((item) => item.summary && item.summary !== item.label ? `${item.label}（${item.summary}）` : item.label)
    .filter(Boolean)
    .join("；");
}

function formatConversation(item) {
  if (!item) return "";
  return [item.userText ? `对方：${item.userText}` : null, item.assistantText ? `Bot：${item.assistantText}` : null]
    .filter(Boolean).join("；");
}

function pushLimited(items, entry, limit) {
  return [...(Array.isArray(items) ? items : []), entry].slice(-limit);
}

function normalizeRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return Object.create(null);
  if (Object.getPrototypeOf(value) === null) return value;
  const output = Object.create(null);
  for (const [key, entry] of Object.entries(value)) {
    if (isSafeRecordKey(key)) output[key] = entry;
  }
  return output;
}

function isSafeRecordKey(value) {
  const key = String(value || "");
  return Boolean(key) && !["__proto__", "prototype", "constructor"].includes(key);
}

function memoryText(value, limit) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function sanitizeMemoryUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    for (const key of [...parsed.searchParams.keys()]) {
      if (/(?:token|key|secret|password|passwd|auth|code|session|signature|credential)/i.test(key)) {
        parsed.searchParams.delete(key);
      }
    }
    parsed.hash = "";
    return memoryText(parsed.toString(), 500);
  } catch {
    return "";
  }
}

function containsLikelySecret(text) {
  const value = String(text || "");
  return /sk-[A-Za-z0-9_-]{10,}/i.test(value)
    || /\bBearer\s+[A-Za-z0-9._~-]{10,}/i.test(value)
    || /(?:api[_ -]?key|access[_ -]?token|password|密码|验证码|密钥)\s*[:：=]\s*\S{4,}/i.test(value);
}
