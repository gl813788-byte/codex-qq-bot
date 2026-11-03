import assert from "node:assert/strict";
import test from "node:test";
import { applyDashboardBotSettings, readDashboardBotSettings, readDashboardInterestSettings } from "../src/dashboard-bot-settings.js";

function createState() {
  return {
    qq: {
      enhancer: { enabled: true },
      webLookup: { enabled: true },
      proactive: {
        enabled: true,
        judgeEveryMessages: 20,
        judgeEveryMinutes: 5,
        judge: {
          enabled: true,
          provider: "openrouter",
          model: "provider/model:free",
          baseUrl: "https://openrouter.ai/api/v1",
          timeoutMs: 6500,
          maxRecentMessages: 8,
          apiKeyConfigured: true
        }
      }
    }
  };
}

test("dashboard Bot settings update bounded runtime controls and can roll back", () => {
  const state = createState();
  const change = applyDashboardBotSettings(state, {
    webLookupEnabled: false,
    proactiveEnabled: true,
    judgeEveryMessages: 12,
    judgeEveryMinutes: 3,
    judgeModel: "vendor/new-model:free",
    judgeTimeoutMs: 9000,
    judgeMaxRecentMessages: 10
  });

  assert.deepEqual(change.settings, {
    enhancerEnabled: true,
    webLookupEnabled: false,
    proactiveEnabled: true,
    judgeEnabled: true,
    judgeEveryMessages: 12,
    judgeEveryMinutes: 3,
    judgeModel: "vendor/new-model:free",
    judgeTimeoutMs: 9000,
    judgeMaxRecentMessages: 10,
    judgeProvider: "openrouter",
    judgeApiKeyConfigured: true,
    judgeProviders: [
      { id: "openrouter", label: "OpenRouter", defaultModel: "openrouter/free" },
      { id: "deepseek", label: "DeepSeek", defaultModel: "deepseek-v4-flash" },
      { id: "custom", label: "自定义兼容服务", defaultModel: "gpt-4o-mini" },
      { id: "codex", label: "Codex 订阅", defaultModel: "default" },
      { id: "claude", label: "Claude 订阅", defaultModel: "haiku" }
    ]
  });

  change.restore();
  assert.equal(readDashboardBotSettings(state).judgeEveryMessages, 20);
  assert.equal(readDashboardBotSettings(state).webLookupEnabled, true);
});

test("dashboard Bot settings preserve enhancer and proactive invariants", () => {
  const disabled = createState();
  applyDashboardBotSettings(disabled, { enhancerEnabled: false, proactiveEnabled: true });
  assert.equal(disabled.qq.enhancer.enabled, true, "enabling proactive also enables the enhancer");
  assert.equal(disabled.qq.proactive.enabled, true);

  const enhancerOff = createState();
  applyDashboardBotSettings(enhancerOff, { enhancerEnabled: false });
  assert.equal(enhancerOff.qq.proactive.enabled, false);
});

test("dashboard Bot settings switch interest providers with safe defaults", () => {
  const state = createState();
  const change = applyDashboardBotSettings(state, { judgeProvider: "deepseek" });
  assert.equal(change.settings.judgeProvider, "deepseek");
  assert.equal(change.settings.judgeModel, "deepseek-v4-flash");
  assert.equal(change.settings.judgeApiKeyConfigured, false);
  assert.equal(state.qq.proactive.judge.baseUrl, "https://api.deepseek.com");
  change.restore();
  assert.equal(state.qq.proactive.judge.provider, "openrouter");
  assert.equal(state.qq.proactive.judge.baseUrl, "https://openrouter.ai/api/v1");
});

test("dashboard Bot settings reject malformed values without mutation", () => {
  const state = createState();
  assert.throws(() => applyDashboardBotSettings(state, { judgeTimeoutMs: 500 }), /between 1500 and 20000/);
  assert.throws(() => applyDashboardBotSettings(state, { judgeModel: "bad model id" }), /valid provider model id/);
  assert.throws(() => applyDashboardBotSettings(state, { judgeProvider: "unknown" }), /must be one of/);
  assert.equal(readDashboardBotSettings(state).judgeTimeoutMs, 6500);
});

test("dashboard interest settings switch to a subscription provider and edit the preset", () => {
  const state = createState();
  const change = applyDashboardBotSettings(state, {
    judgeProvider: "claude",
    judgeReasoningEffort: "minimal",
    judgeAgentTimeoutMs: 45000,
    judgePreset: { likes: ["AI", " ", "游戏"], style: "短句\n不客服" }
  });
  assert.equal(change.settings.judgeProvider, "claude");
  assert.equal(change.settings.judgeModel, "haiku");
  const interest = readDashboardInterestSettings(state);
  assert.equal(interest.subscription, true);
  assert.equal(interest.baseUrl, "");
  assert.equal(interest.reasoningEffort, "minimal");
  assert.equal(interest.agentTimeoutMs, 45000);
  assert.deepEqual(interest.preset.likes, ["AI", "游戏"]);
  assert.deepEqual(interest.preset.style, ["短句", "不客服"]);
  change.restore();
  assert.equal(state.qq.proactive.judge.provider, "openrouter");
  assert.equal(state.qq.proactive.judge.preset, undefined);
});

test("dashboard interest settings reject unsafe or out-of-range values", () => {
  assert.throws(() => applyDashboardBotSettings(createState(), { judgeReasoningEffort: "ultra" }), RangeError);
  assert.throws(() => applyDashboardBotSettings(createState(), { judgeAgentTimeoutMs: 1000 }), RangeError);
  assert.throws(() => applyDashboardBotSettings(createState(), { judgeBaseUrl: "https://example.test/v1" }), /custom provider/);
  const custom = createState();
  applyDashboardBotSettings(custom, { judgeProvider: "custom", judgeBaseUrl: "https://llm.example.test/v1/" });
  assert.equal(custom.qq.proactive.judge.baseUrl, "https://llm.example.test/v1");
  assert.throws(() => applyDashboardBotSettings(custom, { judgeBaseUrl: "file:///etc/passwd" }), /http/);
});
