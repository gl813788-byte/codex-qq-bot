export const SETTINGS_SCHEMA_VERSION = 3;

export function createSettingsSnapshot({
  state,
  networkApiToken = "",
  interestApiKeyConfigured = false,
  branding = {},
  updatedAt = new Date().toISOString()
} = {}) {
  if (!state?.ai || !state?.qq || !state?.network) {
    throw new TypeError("state must contain ai, qq, and network settings");
  }
  return structuredClone({
    version: SETTINGS_SCHEMA_VERSION,
    updatedAt,
    network: {
      allowLanAccess: state.network.allowLanAccess,
      publicTunnelEnabled: state.network.publicTunnelEnabled,
      apiToken: networkApiToken
    },
    ai: {
      model: state.ai.model,
      reasoningEffort: state.ai.reasoningEffort,
      reasoningSummary: state.ai.reasoningSummary,
      personality: state.ai.personality,
      serviceTier: state.ai.serviceTier
    },
    qq: {
      allowedGroups: state.qq.allowedGroups,
      ownerUserIds: state.qq.ownerUserIds,
      adminUserIds: state.qq.adminUserIds,
      bannedUserIds: state.qq.bannedUserIds,
      bannedUntilByUserId: state.qq.bannedUntilByUserId,
      enhancer: { enabled: state.qq.enhancer.enabled },
      webLookup: { enabled: state.qq.webLookup.enabled },
      proactive: {
        enabled: state.qq.proactive.enabled,
        judgeEveryMessages: state.qq.proactive.judgeEveryMessages,
        judgeEveryMinutes: state.qq.proactive.judgeEveryMinutes,
        judge: {
          enabled: state.qq.proactive.judge.enabled,
          provider: state.qq.proactive.judge.provider,
          model: state.qq.proactive.judge.model,
          baseUrl: state.qq.proactive.judge.baseUrl,
          timeoutMs: state.qq.proactive.judge.timeoutMs,
          minInterest: state.qq.proactive.judge.minInterest,
          maxRecentMessages: state.qq.proactive.judge.maxRecentMessages,
          apiKeyConfigured: Boolean(interestApiKeyConfigured),
          preset: state.qq.proactive.judge.preset
        }
      },
      commandPermissions: {
        publicCommands: state.qq.commandPermissions.publicCommands,
        userCommands: state.qq.commandPermissions.userCommands
      },
      codexSession: state.qq.codexSession.settings
    },
    unifiedMemory: {
      autoWriteOnSkillRecall: state.unifiedMemory.autoWriteOnSkillRecall,
      manualHandoffCommand: state.unifiedMemory.manualHandoffCommand
    },
    branding: {
      assistantName: branding.assistantName || "assistant",
      ownerLabel: branding.ownerLabel || "主人",
      userAgent: branding.userAgent || "CodexQQBot/1.0",
      assistantMentions: Array.isArray(branding.assistantMentions) ? branding.assistantMentions : []
    }
  });
}
