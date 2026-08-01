const commandPrefixPattern = /^(?:智能等级|智能|思考强度|qq智能等级|qq智能|qq思考强度|推理摘要|思考摘要|reasoning-summary|人格|agent人格|personality|服务档位|服务等级|service-tier)/i;
const reasoningEffortChineseLabels = Object.freeze({
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "极高",
  max: "最高",
  ultra: "极致"
});

export function isQqCodexRuntimeSettingCommand(value) {
  return commandPrefixPattern.test(String(value || "").trim());
}

export async function buildQqCodexRuntimeSettingAction({
  command,
  state,
  modelCatalog,
  findModel,
  persist,
  actionBeat = ""
} = {}) {
  const normalized = String(command || "").trim();
  if (!normalized || !state?.ai) return null;
  const prefix = String(actionBeat || "");

  if (/^(?:智能等级|智能|思考强度|qq智能等级|qq智能|qq思考强度)$/i.test(normalized)) {
    try {
      const models = await modelCatalog.list();
      const selected = findModel(models, state.ai.model);
      const efforts = selected?.supportedReasoningEfforts || [];
      if (efforts.length === 0) return { reply: `当前模型 ${state.ai.model} 没有返回可选思考强度。` };
      const effortLabels = efforts.map((effort) => reasoningEffortChineseLabels[effort]
        ? `${effort}（${reasoningEffortChineseLabels[effort]}）`
        : effort);
      return {
        reply: `当前模型：${selected.displayName}（${selected.model}）\n支持的思考强度：${effortLabels.join("、")}\n当前：${state.ai.reasoningEffort}\n发送 /思考强度 档位 进行切换。`
      };
    } catch (error) {
      return { reply: `读取思考强度失败：${error.message}` };
    }
  }

  const effortMatch = normalized.match(/^(?:智能等级|智能|思考强度|qq智能等级|qq智能|qq思考强度)\s+(low|medium|high|xhigh|max|ultra|低|中|高|最高|极高|极致)$/i);
  if (effortMatch) {
    const effort = normalizeReasoningEffort(effortMatch[1]);
    const models = await modelCatalog.list().catch(() => []);
    const selected = findModel(models, state.ai.model);
    if (selected && !selected.supportedReasoningEfforts.includes(effort)) {
      return { reply: `${prefix}当前模型 ${selected.displayName} 不支持 ${effort}。可用：${selected.supportedReasoningEfforts.join("、")}` };
    }
    state.ai.reasoningEffort = effort;
    return { reply: `${prefix}QQ 通道智能等级已切换：${effort}`, beforeSend: persist };
  }

  if (/^(?:推理摘要|思考摘要|reasoning-summary)$/i.test(normalized)) {
    return {
      reply: `当前推理摘要：${state.ai.reasoningSummary}\n它控制 Codex 是否返回一段可展示的推理过程摘要及其详细度；不是完整内部思维，也不会改变思考强度。\n可选：auto（自动）、concise（简洁）、detailed（详细）、none（关闭）\n发送 /推理摘要 档位 进行切换。`
    };
  }
  const summaryMatch = normalized.match(/^(?:推理摘要|思考摘要|reasoning-summary)\s+(auto|concise|detailed|none|自动|简洁|详细|关闭)$/i);
  if (summaryMatch) {
    state.ai.reasoningSummary = normalizeReasoningSummary(summaryMatch[1]);
    return {
      reply: `${prefix}Codex 推理摘要已切换：${state.ai.reasoningSummary}（下一轮生效）`,
      beforeSend: persist
    };
  }

  if (/^(?:人格|agent人格|personality)$/i.test(normalized)) {
    return {
      reply: `当前 Agent 人格：${state.ai.personality}\n可选：none（无）、friendly（友好）、pragmatic（务实）\n发送 /人格 档位 进行切换。`
    };
  }
  const personalityMatch = normalized.match(/^(?:人格|agent人格|personality)\s+(none|friendly|pragmatic|无|友好|务实)$/i);
  if (personalityMatch) {
    state.ai.personality = normalizeCodexPersonality(personalityMatch[1]);
    return {
      reply: `${prefix}Codex Agent 人格已切换：${state.ai.personality}（下一轮生效）`,
      beforeSend: persist
    };
  }

  if (/^(?:服务档位|服务等级|service-tier)$/i.test(normalized)) {
    try {
      const models = await modelCatalog.list();
      const selected = findModel(models, state.ai.model);
      const tiers = selected?.serviceTiers || [];
      const lines = tiers.length
        ? tiers.map((tier) => `${tier.id}${tier.name && tier.name !== tier.id ? `（${tier.name}）` : ""}`).join("、")
        : "当前模型没有公布额外档位";
      return {
        reply: `当前服务档位：${state.ai.serviceTier || "默认"}\n可选：默认、${lines}\n发送 /服务档位 档位 进行切换。`
      };
    } catch (error) {
      return { reply: `读取服务档位失败：${error.message}` };
    }
  }
  const serviceTierMatch = normalized.match(/^(?:服务档位|服务等级|service-tier)\s+(默认|default|[a-z0-9][a-z0-9_-]{0,63})$/i);
  if (serviceTierMatch) {
    const tier = normalizeCodexServiceTier(serviceTierMatch[1]);
    if (tier) {
      const models = await modelCatalog.list().catch(() => []);
      const selected = findModel(models, state.ai.model);
      const supported = (selected?.serviceTiers || []).map((item) => item.id);
      if (!supported.includes(tier)) {
        return {
          reply: `${prefix}当前模型 ${selected?.displayName || state.ai.model} 没有公布服务档位 ${tier}。可用：${supported.length ? supported.join("、") : "默认"}`
        };
      }
    }
    state.ai.serviceTier = tier;
    return {
      reply: `${prefix}Codex 服务档位已切换：${state.ai.serviceTier || "默认"}（下一轮生效）`,
      beforeSend: persist
    };
  }
  return null;
}

export function isValidReasoningEffort(value) {
  return ["low", "medium", "high", "xhigh", "max", "ultra"].includes(String(value || ""));
}

export function isValidReasoningSummary(value) {
  return ["auto", "concise", "detailed", "none"].includes(String(value || ""));
}

export function isValidCodexPersonality(value) {
  return ["none", "friendly", "pragmatic"].includes(String(value || ""));
}

export function isValidCodexServiceTier(value) {
  const normalized = String(value ?? "");
  return normalized === "" || /^[a-z0-9][a-z0-9_-]{0,63}$/.test(normalized);
}

export function normalizeReasoningEffort(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ({ 低: "low", 中: "medium", 高: "high", 极高: "xhigh", 最高: "max", 极致: "ultra" })[normalized] || normalized;
}

export function normalizeReasoningSummary(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ({ 自动: "auto", 简洁: "concise", 详细: "detailed", 关闭: "none" })[normalized] || normalized;
}

export function normalizeCodexPersonality(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ({ 无: "none", 友好: "friendly", 务实: "pragmatic" })[normalized] || normalized;
}

export function normalizeCodexServiceTier(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "默认" || normalized === "default" ? "" : normalized;
}
