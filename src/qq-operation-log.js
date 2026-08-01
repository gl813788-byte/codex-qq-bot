export function getQqLogScopeId(event) {
  if (event?.qqCrossSessionScopeId) return String(event.qqCrossSessionScopeId);
  if (event?.groupId) return String(event.groupId);
  if (event?.senderId) return `private:${event.senderId}`;
  return "";
}

export function getQqLogScopeType(event) {
  if (event?.groupId) return "group";
  if (event?.senderId) return "private";
  return "unknown";
}

export function getQqLogActorRole(event) {
  if (event?.isOwner) return "owner";
  if (event?.isBotAdmin) return "administrator";
  if (event?.senderId) return "user";
  return "system";
}

export function buildQqOperationLogDetails(event, {
  operation,
  outcome,
  sourceScopeId,
  targetScopeId,
  targetType,
  targetEvent = event,
  ...details
} = {}) {
  return {
    operation: String(operation || "unknown"),
    outcome: String(outcome || "unknown"),
    actorRole: getQqLogActorRole(event),
    actorUserId: event?.senderId ? String(event.senderId) : null,
    sourceScopeId: sourceScopeId == null ? getQqLogScopeId(event) || null : String(sourceScopeId || "") || null,
    targetScopeId: targetScopeId == null ? getQqLogScopeId(targetEvent) || null : String(targetScopeId || "") || null,
    targetType: targetType == null ? getQqLogScopeType(targetEvent) : String(targetType || "unknown"),
    ...details
  };
}
