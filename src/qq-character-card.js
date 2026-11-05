import { inflateRawSync, inflateSync } from "node:zlib";

// Imports and exports mainstream role-play character cards so a persona made
// in SillyTavern, RisuAI, Chub, Agnai or similar tools can drive the QQ Bot,
// and the Bot's own persona can be taken back to them.
//
// Accepted inputs (detected from content, not the file name):
// - Character Card V3 (`chara_card_v3`) and V2 (`chara_card_v2`) JSON;
// - TavernAI V1 flat JSON, Pygmalion (`char_persona`) and Agnai (`persona`)
//   JSON, and this project's own export;
// - PNG cards carrying the card in a `ccv3` or `chara` text chunk;
// - RisuAI `.charx` zip archives (their `card.json`);
// - anything else as free text, kept whole as the character description.
//
// The result is an intermediate card; mapping it onto the Bot's profile lives
// in qq-bot-personality.js. Card text is persona material written by whoever
// made the card: it never becomes a system rule (see the prompt formatter).

export const QQ_CHARACTER_CARD_MAX_BYTES = 12 * 1024 * 1024;
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_TEXT_CHARS = 60_000;
const MAX_LORE_ENTRIES = 200;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const QQ_CHARACTER_CARD_EXTENSION = "codex_qq_bot";

export class QqCharacterCardError extends Error {
  constructor(message) {
    super(message);
    this.name = "QqCharacterCardError";
  }
}

// `data` is the raw file (Buffer or base64 string); `text` is pasted text.
export function parseQqCharacterCard({ data = null, text = null, fileName = "" } = {}) {
  if (text != null && data == null) return parseTextualCard(String(text), fileName);
  const buffer = Buffer.isBuffer(data) ? data : decodeBase64(data);
  if (!buffer?.length) throw new QqCharacterCardError("角色卡文件是空的");
  if (buffer.length > QQ_CHARACTER_CARD_MAX_BYTES) throw new QqCharacterCardError("角色卡文件太大（上限 12 MB）");
  if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return parsePngCard(buffer);
  if (buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) return parseCharxCard(buffer);
  if (isLikelyBinary(buffer)) throw new QqCharacterCardError("无法识别的文件：请使用 PNG / JSON / CHARX 角色卡或纯文本");
  return parseTextualCard(stripBom(buffer.toString("utf8")), fileName);
}

function parseTextualCard(source, fileName) {
  const text = stripBom(String(source || "")).trim();
  if (!text) throw new QqCharacterCardError("角色卡内容是空的");
  if (/^[{[]/.test(text)) {
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    if (json && typeof json === "object") return normalizeCardJson(json, "json");
  }
  // Free text in any format (W++, PList, Markdown, prose): the whole thing is
  // the description; a leading "Name:" / "名字：" line names the character.
  const nameMatch = text.match(/^(?:name|char(?:acter)?(?:\s*name)?|名字|姓名|角色名|角色)\s*[:：]\s*([^\n]{1,40})$/im)
    || text.match(/\[\s*character\s*\(\s*"([^"\n]{1,40})"\s*\)/i)
    || text.match(/^\[\s*([^'\n:]{1,40})'s\s+persona\s*:/im);
  return finalizeCard({
    format: "text",
    spec: "text",
    name: nameMatch ? nameMatch[1].trim() : baseName(fileName),
    description: text.slice(0, MAX_TEXT_CHARS)
  });
}

function normalizeCardJson(json, format) {
  if (Array.isArray(json)) throw new QqCharacterCardError("角色卡 JSON 必须是对象");
  const spec = String(json.spec || "");
  if ((spec === "chara_card_v3" || spec === "chara_card_v2") && json.data && typeof json.data === "object") {
    return fromTavernData(json.data, { format, spec: spec === "chara_card_v3" ? "v3" : "v2" });
  }
  // Some exporters wrap V2 data without the spec marker.
  if (json.data && typeof json.data === "object" && (json.data.name || json.data.description)) {
    return fromTavernData(json.data, { format, spec: "v2" });
  }
  if (json.char_name || json.char_persona) {
    return finalizeCard({
      format,
      spec: "pygmalion",
      name: json.char_name,
      description: json.char_persona,
      scenario: json.world_scenario,
      firstMessage: json.char_greeting,
      exampleDialogues: json.example_dialogue
    });
  }
  if (json.kind === "character" || (json.persona && typeof json.persona === "object")) {
    return finalizeCard({
      format,
      spec: "agnai",
      name: json.name,
      description: [json.description, formatAgnaiPersona(json.persona)].filter(Boolean).join("\n\n"),
      scenario: json.scenario,
      firstMessage: json.greeting,
      exampleDialogues: json.sampleChat,
      systemPrompt: json.systemPrompt,
      postHistoryInstructions: json.postHistoryInstructions,
      tags: json.tags,
      creator: json.creator,
      characterBook: json.characterBook
    });
  }
  if (json.name || json.description || json.personality || json.first_mes || json.mes_example) {
    return fromTavernData(json, { format, spec: "v1" });
  }
  throw new QqCharacterCardError("JSON 里没有找到角色卡字段（name / description / personality …）");
}

function fromTavernData(data, { format, spec }) {
  const extensions = data.extensions && typeof data.extensions === "object" && !Array.isArray(data.extensions) ? data.extensions : {};
  const depthPrompt = extensions.depth_prompt && typeof extensions.depth_prompt === "object"
    ? extensions.depth_prompt.prompt
    : "";
  return finalizeCard({
    format,
    spec,
    name: data.name,
    nickname: data.nickname,
    description: data.description,
    personality: data.personality,
    scenario: data.scenario,
    firstMessage: data.first_mes,
    exampleDialogues: data.mes_example,
    systemPrompt: data.system_prompt,
    postHistoryInstructions: data.post_history_instructions,
    depthPrompt,
    creatorNotes: data.creator_notes || data.creatorcomment,
    alternateGreetings: data.alternate_greetings,
    tags: data.tags,
    creator: data.creator,
    characterVersion: data.character_version,
    characterBook: data.character_book,
    native: extensions[QQ_CHARACTER_CARD_EXTENSION]
  });
}

function finalizeCard(card) {
  const text = (value, limit = MAX_TEXT_CHARS) => normalizeMultiline(value).slice(0, limit);
  const native = card.native && typeof card.native === "object" && !Array.isArray(card.native) ? card.native : null;
  return {
    format: card.format,
    spec: card.spec,
    name: text(card.name, 80).replace(/\n/g, " "),
    nickname: text(card.nickname, 80).replace(/\n/g, " "),
    description: text(card.description),
    personality: text(card.personality),
    scenario: text(card.scenario),
    firstMessage: text(card.firstMessage),
    exampleDialogues: text(card.exampleDialogues),
    systemPrompt: text(card.systemPrompt),
    postHistoryInstructions: text(card.postHistoryInstructions),
    depthPrompt: text(card.depthPrompt),
    creatorNotes: text(card.creatorNotes, 4000),
    alternateGreetings: (Array.isArray(card.alternateGreetings) ? card.alternateGreetings : []).map((item) => text(item, 4000)).filter(Boolean).slice(0, 20),
    tags: (Array.isArray(card.tags) ? card.tags : typeof card.tags === "string" ? card.tags.split(/[,，]/) : [])
      .map((item) => text(item, 40).replace(/\n/g, " ")).filter(Boolean).slice(0, 30),
    creator: text(card.creator, 80).replace(/\n/g, " "),
    characterVersion: text(card.characterVersion, 40).replace(/\n/g, " "),
    lore: normalizeCharacterBook(card.characterBook),
    native
  };
}

function normalizeCharacterBook(book) {
  const entries = Array.isArray(book?.entries) ? book.entries : Array.isArray(book) ? book : [];
  return entries.slice(0, MAX_LORE_ENTRIES).map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const keys = [...(Array.isArray(entry.keys) ? entry.keys : Array.isArray(entry.key) ? entry.key : []),
      ...(Array.isArray(entry.secondary_keys) ? entry.secondary_keys : [])]
      .map((key) => String(key ?? "").trim()).filter(Boolean);
    const content = normalizeMultiline(entry.content);
    if (!content) return null;
    return {
      keys,
      content,
      enabled: entry.enabled !== false && entry.disable !== true,
      constant: Boolean(entry.constant),
      comment: String(entry.comment || entry.name || "").replace(/\s+/g, " ").trim().slice(0, 60)
    };
  }).filter(Boolean);
}

function formatAgnaiPersona(persona) {
  if (!persona || typeof persona !== "object") return "";
  const attributes = persona.attributes && typeof persona.attributes === "object" ? persona.attributes : {};
  const lines = Object.entries(attributes).map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(", ") : String(value ?? "")}`);
  return lines.join("\n");
}

// ---------- PNG ----------
function parsePngCard(buffer) {
  const chunks = extractQqPngTextChunks(buffer);
  const preferred = chunks.find((chunk) => chunk.keyword.toLowerCase() === "ccv3")
    || chunks.find((chunk) => chunk.keyword.toLowerCase() === "chara");
  if (!preferred) throw new QqCharacterCardError("这张 PNG 里没有角色卡数据（缺少 chara / ccv3 文本块）");
  const decoded = decodeEmbeddedCardText(preferred.text);
  let json;
  try {
    json = JSON.parse(decoded);
  } catch {
    throw new QqCharacterCardError("PNG 里的角色卡数据不是有效 JSON");
  }
  return normalizeCardJson(json, "png");
}

// tEXt, zTXt and iTXt chunks; stops at IEND and never reads past the buffer.
export function extractQqPngTextChunks(buffer) {
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("latin1", offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > buffer.length) break;
    if (type === "tEXt" || type === "zTXt" || type === "iTXt") {
      const parsed = parsePngTextChunk(type, buffer.subarray(start, end));
      if (parsed) chunks.push(parsed);
    }
    if (type === "IEND") break;
    offset = end + 4;
  }
  return chunks;
}

function parsePngTextChunk(type, data) {
  const separator = data.indexOf(0);
  if (separator <= 0) return null;
  const keyword = data.toString("latin1", 0, separator);
  try {
    if (type === "tEXt") return { keyword, text: data.toString("latin1", separator + 1) };
    if (type === "zTXt") return { keyword, text: inflateLimited(data.subarray(separator + 2), inflateSync).toString("latin1") };
    // iTXt: keyword\0 compressionFlag compressionMethod languageTag\0 translatedKeyword\0 text
    const compressed = data[separator + 1] === 1;
    const languageEnd = data.indexOf(0, separator + 3);
    const translatedEnd = languageEnd < 0 ? -1 : data.indexOf(0, languageEnd + 1);
    if (translatedEnd < 0) return null;
    const body = data.subarray(translatedEnd + 1);
    return { keyword, text: (compressed ? inflateLimited(body, inflateSync) : body).toString("utf8") };
  } catch {
    return null;
  }
}

function decodeEmbeddedCardText(value) {
  const text = String(value || "").trim();
  if (text.startsWith("{")) return text;
  const decoded = Buffer.from(text, "base64");
  if (decoded.length > MAX_JSON_BYTES) throw new QqCharacterCardError("角色卡数据太大");
  return stripBom(decoded.toString("utf8"));
}

// ---------- CHARX (zip) ----------
function parseCharxCard(buffer) {
  const entry = readZipEntry(buffer, (name) => name.replace(/\\/g, "/").toLowerCase() === "card.json");
  if (!entry) throw new QqCharacterCardError("CHARX 压缩包里没有 card.json");
  let json;
  try {
    json = JSON.parse(stripBom(entry.toString("utf8")));
  } catch {
    throw new QqCharacterCardError("CHARX 里的 card.json 不是有效 JSON");
  }
  return normalizeCardJson(json, "charx");
}

// Minimal central-directory reader: stored and deflated entries only.
function readZipEntry(buffer, matches) {
  const minimum = Math.max(0, buffer.length - 65_557);
  let eocd = -1;
  for (let index = buffer.length - 22; index >= minimum; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) {
      eocd = index;
      break;
    }
  }
  if (eocd < 0) throw new QqCharacterCardError("CHARX 压缩包已损坏");
  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let index = 0; index < count && offset + 46 <= buffer.length; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (!matches(name)) continue;
    if (size > MAX_JSON_BYTES) throw new QqCharacterCardError("card.json 太大");
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) return null;
    const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) return raw;
    if (method === 8) return inflateLimited(raw, inflateRawSync);
    throw new QqCharacterCardError("CHARX 使用了不支持的压缩方式");
  }
  return null;
}

function inflateLimited(data, inflate) {
  return inflate(data, { maxOutputLength: MAX_JSON_BYTES });
}

// ---------- Export ----------
// Character Card V2 is the format every major front end imports; V3 keeps
// the same fields under a newer spec. The Bot's structured settings travel in
// data.extensions.codex_qq_bot so a round trip loses nothing.
export function buildQqCharacterCardExport(fields = {}, { spec = "v2", now = new Date() } = {}) {
  const data = {
    name: String(fields.name || ""),
    description: String(fields.description || ""),
    personality: String(fields.personality || ""),
    scenario: String(fields.scenario || ""),
    first_mes: String(fields.firstMessage || ""),
    mes_example: String(fields.exampleDialogues || ""),
    creator_notes: String(fields.creatorNotes || ""),
    system_prompt: String(fields.systemPrompt || ""),
    post_history_instructions: String(fields.postHistoryInstructions || ""),
    alternate_greetings: Array.isArray(fields.alternateGreetings) ? fields.alternateGreetings.map(String) : [],
    tags: Array.isArray(fields.tags) ? fields.tags.map(String) : [],
    creator: String(fields.creator || ""),
    character_version: String(fields.characterVersion || ""),
    extensions: { [QQ_CHARACTER_CARD_EXTENSION]: fields.native || {} }
  };
  const lore = Array.isArray(fields.lore) ? fields.lore : [];
  if (lore.length) {
    data.character_book = {
      name: `${data.name || "character"} lore`,
      extensions: {},
      entries: lore.map((entry, index) => ({
        id: index + 1,
        keys: [...(entry.keys || [])],
        secondary_keys: [],
        content: String(entry.content || ""),
        comment: String(entry.comment || ""),
        name: String(entry.comment || ""),
        enabled: entry.enabled !== false,
        constant: Boolean(entry.constant),
        selective: false,
        case_sensitive: false,
        insertion_order: 100 + index,
        priority: 10,
        position: "before_char",
        extensions: {}
      }))
    };
  }
  if (spec === "v3") {
    const seconds = Math.floor(new Date(now).getTime() / 1000);
    return {
      spec: "chara_card_v3",
      spec_version: "3.0",
      data: {
        ...data,
        nickname: String(fields.nickname || ""),
        group_only_greetings: [],
        creation_date: seconds,
        modification_date: seconds,
        assets: [{ type: "icon", uri: "ccdefault:", name: "main", ext: "png" }]
      }
    };
  }
  return { spec: "chara_card_v2", spec_version: "2.0", data };
}

// ---------- Helpers ----------
function decodeBase64(value) {
  const text = String(value || "").replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  if (!text) return null;
  if (!/^[A-Za-z0-9+/=_-]+$/.test(text)) throw new QqCharacterCardError("文件数据不是有效的 base64");
  return Buffer.from(text, "base64");
}

function isLikelyBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let control = 0;
  for (const byte of sample) {
    if (byte === 0) return true;
    if (byte < 9 || (byte > 13 && byte < 32)) control += 1;
  }
  return control > sample.length * 0.05;
}

function normalizeMultiline(value) {
  if (value == null) return "";
  const text = Array.isArray(value) ? value.join("\n") : typeof value === "object" ? "" : String(value);
  return text.replace(/\r\n?/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function stripBom(value) {
  return String(value || "").replace(/^\uFEFF/, "");
}

function baseName(fileName) {
  return String(fileName || "").split(/[\\/]/).pop().replace(/\.[^.]+$/, "").replace(/\s+/g, " ").trim().slice(0, 40);
}
