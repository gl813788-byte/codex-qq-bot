// Bracketed actions the Bot types that QQ can really perform.
//
// People write short bracketed actions in chat (“（亲亲）”“（抱住）”) and the
// Bot learned to do the same. Some of them are not imaginary at all: a poke,
// a sticker, a reaction, a profile like, recalling a message, saving a
// sticker, a dice or rock-paper-scissors card, a song card, a Qzone post,
// muting or kicking someone, a friend request. The Bot used to type
// “（戳回去）” or “（甩出一张表情包）” without doing it. A bracket that claims
// such an action must be backed by the action itself: the matching tool
// succeeded earlier in the turn, or this very message carries the sticker or
// picture. The Hub performs a poke itself (safe and unambiguous); other
// unbacked claims are refused once so the model really does them or drops
// the bracket, and stripped after that. Imaginary actions stay text.
// Pure: callers keep the turn's evidence and perform the side effects.

const LEAD = "(?:轻轻|偷偷|悄悄|使劲|狠狠|反手|默默|顺手|也|再|又|直接|立刻|马上)?";

export const QQ_BRACKET_ACTION_KINDS = Object.freeze([
  {
    kind: "poke",
    label: "戳一戳",
    inner: new RegExp(`^${LEAD}(?:戳一戳|戳了戳|戳戳|戳一下|戳回去|戳回|戳|拍一拍|拍了拍|拍拍|拍一下|拍回去|拍回)(?:你|回去|回来|对方|他|她|ta|一下|的)*(?:头|脑袋|肩膀?|背|脸蛋?|脸颊)?$`, "iu"),
    evidence: ["qq_social.act:poke"],
    autoPerform: true,
    howTo: "qq_social.act poke"
  },
  {
    kind: "sticker",
    label: "发表情包",
    inner: new RegExp(`^${LEAD}(?:发|甩|丢|扔|来|回|放|掏出?|拿出)(?:了|出|过去|一下)*(?:一)?(?:个|张)?表情包?$`, "u"),
    evidence: ["message:sticker"],
    howTo: "把 qq_sticker 搜到的 #编号 填进 qq_chat.send 的 sticker"
  },
  {
    kind: "image",
    label: "发图",
    inner: new RegExp(`^${LEAD}(?:发|甩|丢|扔|放|贴)(?:了|出|过去|一下)*(?:一)?张?(?:图|图片|照片|截图|自拍)$`, "u"),
    evidence: ["message:image"],
    howTo: "把图片放进 qq_chat.send 的 attachments"
  },
  {
    kind: "react",
    label: "贴表情回应",
    inner: new RegExp(`^${LEAD}(?:给(?:你|这条|它)?)?贴(?:了|个|一个|上)*(?:个|一个)?表情(?:回应)?$|^表情回应$`, "u"),
    evidence: ["qq_message.act:react"],
    howTo: "qq_message.act react"
  },
  {
    kind: "like",
    label: "点赞",
    inner: new RegExp(`^${LEAD}(?:给你|帮你)?(?:点(?:了|个|一个|一下)*赞|赞了?你)(?:了)?$`, "u"),
    evidence: ["qq_social.act:like", "qq_message.act:react"],
    howTo: "qq_social.act like（点名片赞）或 qq_message.act react（给这条消息贴个赞）"
  },
  {
    kind: "recall",
    label: "撤回",
    inner: /^(?:已|默默|偷偷)?撤回(?:了)?$|^撤了$/u,
    evidence: ["qq_message.act:recall"],
    howTo: "qq_message.act recall（只是开玩笑就别写这个括号）"
  },
  {
    kind: "favorite",
    label: "收藏表情包",
    inner: /^(?:已|默默|偷偷)?(?:收藏|存|偷)(?:了|走了?)?(?:这张|这个)?(?:表情包?|图)?$/u,
    evidence: ["qq_sticker.manage:favorite"],
    howTo: "qq_sticker.manage favorite"
  },
  {
    kind: "dice",
    label: "掷骰子",
    inner: new RegExp(`^${LEAD}(?:扔|掷|摇|丢|投)(?:了|个|一个|一下|一把)*骰子$`, "u"),
    evidence: ["qq_message.act:dice"],
    howTo: "qq_message.act dice"
  },
  {
    kind: "rps",
    label: "猜拳",
    inner: /^(?:猜拳|出(?:了)?(?:石头|剪刀|布))$/u,
    evidence: ["qq_message.act:rps"],
    howTo: "qq_message.act rps"
  },
  {
    kind: "music",
    label: "分享歌",
    inner: new RegExp(`^${LEAD}(?:放|分享|点|来|甩|丢)(?:了|一)*首(?:歌|曲子)(?:给你)?$`, "u"),
    evidence: ["qq_message.act:music"],
    howTo: "qq_message.act music（用 qq_media.music 搜到的 song-N）"
  },
  {
    kind: "qzone",
    label: "发说说",
    inner: /^(?:发|写)(?:了)?(?:一)?条?(?:说说|动态|空间)$/u,
    evidence: ["qq_social.act:qzone_publish"],
    howTo: "qq_social.act qzone_publish"
  },
  {
    kind: "moderation",
    label: "禁言/踢人",
    inner: /^(?:禁言|踢(?:了|出去|出群)?|移出群聊?)(?:你|他|她)?(?:了)?$/u,
    evidence: ["qq_social.act:ban", "qq_social.act:group_admin"],
    howTo: "qq_social.act ban 或 group_admin（没有权限或不该做就别写这个括号）"
  },
  {
    kind: "add_friend",
    label: "加好友",
    inner: /^(?:加(?:了)?(?:你)?好友|申请加你)$/u,
    evidence: ["qq_social.act:add_friend"],
    howTo: "qq_social.act add_friend"
  }
]);

const BRACKET_PATTERN = /[（(]\s*([^()（）\n]{1,16}?)\s*[）)]/gu;

// Every bracketed action claim in the text, in order.
export function findQqBracketActionClaims(text) {
  const claims = [];
  for (const match of String(text || "").matchAll(BRACKET_PATTERN)) {
    const inner = match[1].trim();
    const definition = QQ_BRACKET_ACTION_KINDS.find((item) => item.inner.test(inner));
    if (definition) claims.push({ kind: definition.kind, bracket: match[0] });
  }
  return claims;
}

// The evidence key a successful QQ tool call provides (“qq_social.act:poke”).
export function qqActionEvidenceKey({ namespace = "", tool = "", toolAction = "" } = {}) {
  const ns = String(namespace || "").trim();
  const name = String(tool || "").trim();
  if (!ns || !name) return "";
  return `${ns}.${name}${toolAction ? `:${String(toolAction).trim()}` : ""}`;
}

// Claims nothing in this turn backs. `evidence` holds keys from successful
// tool calls and from what earlier messages carried; this message's own
// sticker or picture backs the matching claim too.
export function findUnbackedQqActionClaims(claims = [], { evidence = new Set(), sticker = false, image = false } = {}) {
  const have = new Set(evidence instanceof Set ? evidence : []);
  if (sticker) have.add("message:sticker");
  if (image) have.add("message:image");
  return (Array.isArray(claims) ? claims : []).filter((claim) => {
    const definition = QQ_BRACKET_ACTION_KINDS.find((item) => item.kind === claim.kind);
    return definition && !definition.evidence.some((key) => have.has(key));
  });
}

export function isQqAutoPerformedActionClaim(claim) {
  return Boolean(QQ_BRACKET_ACTION_KINDS.find((item) => item.kind === claim?.kind)?.autoPerform);
}

// Removes the given claims' brackets; a bubble left empty is dropped with
// its separator.
export function stripQqBracketActionClaims(text, claims = [], { bubbleSeparator = "|||" } = {}) {
  const brackets = new Set((Array.isArray(claims) ? claims : []).map((claim) => claim.bracket));
  if (!brackets.size) return String(text || "");
  const separator = `\n${String(bubbleSeparator || "|||").trim() || "|||"}\n`;
  return String(text || "")
    .split(separator)
    .map((bubble) => bubble
      .split("\n")
      .map((line) => line
        .replace(BRACKET_PATTERN, (whole) => (brackets.has(whole) ? "" : whole))
        .replace(/[ \t]{2,}/g, " ")
        .trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim())
    .filter(Boolean)
    .join(separator);
}

// What the model is told when a message claims actions it has not done.
export function formatQqUnbackedActionRefusal(claims = []) {
  const kinds = [...new Set((Array.isArray(claims) ? claims : []).map((claim) => claim.kind))];
  const lines = kinds.map((kind) => {
    const definition = QQ_BRACKET_ACTION_KINDS.find((item) => item.kind === kind);
    const brackets = claims.filter((claim) => claim.kind === kind).map((claim) => claim.bracket).join("");
    return `${brackets}是 QQ 里真能做的${definition.label}，但这轮还没真的做：用 ${definition.howTo} 做成后再发这句`;
  });
  return `这条没有发出。${lines.join("；")}。不打算真的做，就把这个括号删掉再发。`;
}
