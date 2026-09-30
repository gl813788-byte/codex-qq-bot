import { getQqCommand } from "../qq-command-catalog.js";
import { formatQqCard, formatQqDone, formatQqUsageSection, formatQqWarning } from "../qq-command-reply.js";

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
  persist
} = {}) {
  const normalized = String(command || "").trim();
  if (!normalized || !state?.ai) return null;
  const usage = formatQqUsageSection(getQqCommand("reasoning"));
  const settingCard = (title, fields) => ({ reply: formatQqCard({ icon: "🧠", title, fields, sections: [usage] }) });

  if (/^(?:智能等级|智能|思考强度|qq智能等级|qq智能|qq思考强度)$/i.test(normalized)) {
    try {
      const models = await modelCatalog.list();
      const selected = findModel(models, state.ai.model);
      const efforts = selected?.supportedReasoningEfforts || [];
      if (efforts.length === 0) return { reply: formatQqWarning(`当前模型 ${state.ai.model} 没有返回可选思考强度。`) };
      const effortLabels = efforts.map((effort) => reasoningEffortChineseLabels[effort]
        ? `${effort}（${reasoningEffortChineseLabels[effort]}）`
        : effort);
      return settingCard("思考强度", [
        ["模型", `${selected.displayName}（${selected.model}）`],
        ["当前", state.ai.reasoningEffort],
        ["可选", effortLabels]
      ]);
    } catch (error) {
      return { reply: formatQqWarning(`读取思考强度失败：${error.message}`) };
    }
  }

  const effortMatch = normalized.match(/^(?:智能等级|智能|思考强度|qq智能等级|qq智能|qq思考强度)\s+(low|medium|high|xhigh|max|ultra|低|中|高|最高|极高|极致)$/i);
  if (effortMatch) {
    const effort = normalizeReasoningEffort(effortMatch[1]);
    const models = await modelCatalog.list().catch(() => []);
    const selected = findModel(models, state.ai.model);
    if (selected && !selected.supportedReasoningEfforts.includes(effort)) {
      return { reply: formatQqWarning(`当前模型 ${selected.displayName} 不支持 ${effort}。`, [`可选：${selected.supportedReasoningEfforts.join("、")}`]) };
    }
    state.ai.reasoningEffort = effort;
    return { reply: formatQqDone(`思考强度已切换：${effort}`), beforeSend: persist };
  }

  if (/^(?:推理摘要|思考摘要|reasoning-summary)$/i.test(normalized)) {
    return settingCard("推理摘要", [
      ["当前", state.ai.reasoningSummary],
      ["可选", "auto（自动）、concise（简洁）、detailed（详细）、none（关闭）"],
      ["说明", "控制 Codex 是否返回可展示的推理摘要；不改变思考强度"]
    ]);
  }
  const summaryMatch = normalized.match(/^(?:推理摘要|思考摘要|reasoning-summary)\s+(auto|concise|detailed|none|自动|简洁|详细|关闭)$/i);
  if (summaryMatch) {
    state.ai.reasoningSummary = normalizeReasoningSummary(summaryMatch[1]);
    return {
      reply: formatQqDone(`推理摘要已切换：${state.ai.reasoningSummary}`, ["下一轮回复生效。"]),
      beforeSend: persist
    };
  }

  if (/^(?:人格|agent人格|personality)$/i.test(normalized)) {
    return settingCard("Agent 人格", [
      ["当前", state.ai.personality],
      ["可选", "none（无）、friendly（友好）、pragmatic（务实）"]
    ]);
  }
  const personalityMatch = normalized.match(/^(?:人格|agent人格|personality)\s+(none|friendly|pragmatic|无|友好|务实)$/i);
  if (personalityMatch) {
    state.ai.personality = normalizeCodexPersonality(personalityMatch[1]);
    return {
      reply: formatQqDone(`Agent 人格已切换：${state.ai.personality}`, ["下一轮回复生效。"]),
      beforeSend: persist
    };
  }

  if (/^(?:服务档位|服务等级|service-tier)$/i.test(normalized)) {
    try {
      const models = await modelCatalog.list();
      const selected = findModel(models, state.ai.model);
      const tiers = (selected?.serviceTiers || [])
        .map((tier) => `${tier.id}${tier.name && tier.name !== tier.id ? `（${tier.name}）` : ""}`);
      return settingCard("服务档位", [
        ["当前", state.ai.serviceTier || "默认"],
        ["可选", ["默认", ...tiers]]
      ]);
    } catch (error) {
      return { reply: formatQqWarning(`读取服务档位失败：${error.message}`) };
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
          reply: formatQqWarning(`当前模型 ${selected?.displayName || state.ai.model} 没有公布服务档位 ${tier}。`, [
            `可选：${["默认", ...supported].join("、")}`
          ])
        };
      }
    }
    state.ai.serviceTier = tier;
    return {
      reply: formatQqDone(`服务档位已切换：${state.ai.serviceTier || "默认"}`, ["下一轮回复生效。"]),
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
