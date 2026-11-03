// Parses /好感度 commands. Permission checks and persistence stay with the
// caller; this module only recognizes the request shape.
const commandPattern = /^(?:好感度|好感|affinity)(?:\s+(.*))?$/i;

export function isQqAffinityCommand(normalized) {
  return commandPattern.test(String(normalized || "").trim());
}

export function parseQqAffinityCommand(normalized, { atTargets = [], selfId = "" } = {}) {
  const match = String(normalized || "").trim().match(commandPattern);
  if (!match) return null;
  const rest = String(match[1] || "").replace(/\[CQ:at,qq=\d+[^\]]*\]/g, " ").trim();
  const mentioned = (Array.isArray(atTargets) ? atTargets : [])
    .map(String)
    .filter((id) => /^[1-9][0-9]{4,12}$/.test(id) && id !== String(selfId || ""));
  if (!rest) return mentioned.length ? { action: "view", targetUserId: mentioned[0] } : { action: "self" };
  if (/^(?:排行|排行榜|排名|rank|top)$/i.test(rest)) return { action: "rank" };
  const set = rest.match(/^(?:设置|设定|set)\s+@?([1-9][0-9]{4,12})?\s*(-?\d{1,3}(?:\.\d)?)$/i);
  if (set) {
    const targetUserId = set[1] || mentioned[0] || "";
    const value = Number(set[2]);
    if (!targetUserId || !Number.isFinite(value) || value < -100 || value > 100) return { action: "invalid" };
    return { action: "set", targetUserId, value };
  }
  const id = rest.match(/^@?([1-9][0-9]{4,12})$/);
  if (id) return { action: "view", targetUserId: id[1] };
  if (mentioned.length) return { action: "view", targetUserId: mentioned[0] };
  return { action: "invalid" };
}
