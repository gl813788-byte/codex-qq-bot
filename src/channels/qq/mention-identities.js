const maxMentionIdentities = 16;

export async function enrichQqMentionIdentities(event, {
  knownNameById = () => "",
  lookupGroupMember = async () => null
} = {}) {
  const groupId = normalizeId(event?.groupId);
  const inlineNames = new Map((Array.isArray(event?.atMentions) ? event.atMentions : [])
    .map(normalizeMentionIdentity)
    .filter(Boolean)
    .map((mention) => [mention.userId, mention.name]));
  const userIds = [...new Set([
    ...(Array.isArray(event?.atTargets) ? event.atTargets : []),
    ...inlineNames.keys()
  ].map(normalizeId).filter(Boolean))].slice(0, maxMentionIdentities);

  const atMentions = await Promise.all(userIds.map(async (userId) => {
    let name = inlineNames.get(userId) || compactName(await Promise.resolve(
      knownNameById(groupId, userId)
    ));
    if (!name && groupId) {
      const member = await Promise.resolve(lookupGroupMember(groupId, userId)).catch(() => null);
      name = compactName(member?.card || member?.nickname || member?.name || "");
    }
    return { userId, name };
  }));

  return {
    ...event,
    atTargets: userIds,
    atMentions
  };
}

export function normalizeMentionIdentity(value) {
  const userId = normalizeId(value?.userId ?? value?.qq ?? value?.id ?? value?.uin);
  if (!userId) return null;
  return {
    userId,
    name: compactName(value?.name ?? value?.card ?? value?.nickname ?? "")
  };
}

export function mergeQqMentionIdentities(...lists) {
  const merged = new Map();
  for (const value of lists.flat()) {
    const mention = normalizeMentionIdentity(value);
    if (!mention) continue;
    const existing = merged.get(mention.userId);
    merged.set(mention.userId, {
      userId: mention.userId,
      name: mention.name || existing?.name || ""
    });
    if (merged.size >= maxMentionIdentities) break;
  }
  return [...merged.values()];
}

export function formatQqIdentity(value, fallback = "群友") {
  const userId = normalizeId(value?.userId ?? value?.senderId ?? value?.id);
  const name = compactName(value?.name ?? value?.senderName ?? value?.senderLabel ?? "");
  if (name && userId) return `${name}(QQ ${userId})`;
  if (userId) return `QQ ${userId}`;
  return name || fallback;
}

export function formatQqMentionIdentities(mentions = []) {
  return mergeQqMentionIdentities(mentions).map((mention) => formatQqIdentity(mention)).join("、");
}

function normalizeId(value) {
  const id = String(value ?? "").trim();
  return /^\d{4,20}$/.test(id) ? id : "";
}

function compactName(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/^@+/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}
