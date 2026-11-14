import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const resources = new URL("../modules/mac-client/Resources/", import.meta.url);
const html = readFileSync(new URL("client.html", resources), "utf8");
const javascript = readFileSync(new URL("client.js", resources), "utf8");
const personaScript = readFileSync(new URL("client-persona.js", resources), "utf8");
const allScripts = `${javascript}\n${personaScript}`;

function unique(values) {
  return [...new Set(values)];
}

function extractTranslations(source, prefix = "const translations = ", suffix = "\n\nconst app =") {
  const start = source.indexOf(prefix);
  const end = source.indexOf(suffix, start + prefix.length);
  assert.notEqual(start, -1, "client.js must declare translations");
  assert.notEqual(end, -1, "translations must be declared before app state");
  const expression = source.slice(start + prefix.length, end).replace(/;\s*$/, "");
  return vm.runInNewContext(`(${expression})`, Object.create(null), { timeout: 100 });
}

test("dashboard HTML has unique ids referenced by static client selectors", () => {
  const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
  const duplicateIds = unique(ids.filter((id, index) => ids.indexOf(id) !== index));
  assert.deepEqual(duplicateIds, [], `duplicate HTML ids: ${duplicateIds.join(", ")}`);
  const knownIds = new Set(ids);
  const referencedIds = unique([...allScripts.matchAll(/\$\(\s*["']#([^"']+)["']\s*\)/g)].map((match) => match[1]));
  const missingIds = referencedIds.filter((id) => !knownIds.has(id));
  assert.deepEqual(missingIds, [], `client.js references missing HTML ids: ${missingIds.join(", ")}`);
});

test("dashboard translations stay aligned and cover static i18n usage", () => {
  const base = extractTranslations(javascript);
  const persona = extractTranslations(personaScript, "const personaTranslations = ", "\n\nconst personaUi =");
  assert.deepEqual(Object.keys(persona.en).sort(), Object.keys(persona.zh).sort(), "persona translation keys must match");
  const shared = Object.keys(persona.zh).filter((key) => Object.hasOwn(base.zh, key));
  assert.deepEqual(shared, [], `persona translations must not override base keys: ${shared.join(", ")}`);
  const translations = { zh: { ...base.zh, ...persona.zh }, en: { ...base.en, ...persona.en } };
  const zhKeys = Object.keys(translations.zh || {}).sort();
  const enKeys = Object.keys(translations.en || {}).sort();
  assert.ok(zhKeys.length > 0, "Chinese translations must not be empty");
  assert.deepEqual(enKeys, zhKeys, "Chinese and English translation keys must match");
  const scriptKeys = [...allScripts.matchAll(/\bt\(\s*["']([^"']+)["']/g)].map((match) => match[1]);
  const markupKeys = [...html.matchAll(/\bdata-i18n(?:-[a-z-]+)?\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
  const availableKeys = new Set(zhKeys);
  const missingKeys = unique([...scriptKeys, ...markupKeys]).filter((key) => !availableKeys.has(key));
  assert.deepEqual(missingKeys, [], `missing translations for static keys: ${missingKeys.join(", ")}`);
});

test("dashboard keeps code and styles external so the strict CSP holds", () => {
  assert.doesNotMatch(html, /<style\b/i, "inline style blocks are not allowed");
  assert.doesNotMatch(html, /\sstyle\s*=/i, "inline style attributes are not allowed");
  // The CSP has no 'unsafe-inline' for styles, so generated markup must not rely on style attributes.
  assert.doesNotMatch(javascript, /\sstyle\s*=\s*["'`]/i, "generated markup must not use style attributes");
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0, "dashboard must load its client script");
  for (const [, attributes, body] of scripts) {
    assert.match(attributes, /\bsrc\s*=\s*["'][^"']+["']/i, "scripts must use an external src");
    assert.equal(body.trim(), "", "inline script bodies are not allowed");
  }
});

test("dashboard shows raw QQ CQ codes as short readable tags", () => {
  const start = javascript.indexOf("function displayQqText");
  const end = javascript.indexOf("\nfunction ", start + 1);
  assert.notEqual(start, -1, "client.js must define displayQqText");
  const { zh } = extractTranslations(javascript);
  const displayQqText = vm.runInNewContext(`${javascript.slice(start, end)}; displayQqText`, { t: (key) => zh[key] ?? key }, { timeout: 100 });
  assert.equal(displayQqText("[CQ:image,file=a.jpg,sub_type=0,url=https://multimedia.nt.qq.com.cn/download?a=1&amp;b=2]"), zh.cqImage);
  assert.equal(displayQqText("[CQ:image,file=b.jpg,sub_type=1,summary=&#91;动画表情&#93;]"), zh.cqSticker);
  assert.equal(displayQqText("[CQ:reply,id=9][CQ:at,qq=12345,name=小明] 你好[CQ:face,id=14]"), `@小明 你好${zh.cqFace}`);
  assert.equal(displayQqText("[CQ:record,file=x.amr] 听听"), `${zh.cqVoice} 听听`);
  assert.equal(displayQqText("[CQ:unknown_kind,x=1]"), zh.cqOther);
  assert.equal(displayQqText("plain text [not a code]"), "plain text [not a code]");
});

test("save-and-sync saves dirty forms one at a time, keeps failures and still syncs", async () => {
  const start = javascript.indexOf("async function runSaveSync");
  const end = javascript.indexOf("\nfunction ", start + 1);
  assert.notEqual(start, -1, "client.js must define runSaveSync");
  const runSaveSync = vm.runInNewContext(`${javascript.slice(start, end)}; runSaveSync`, {}, { timeout: 100 });
  const order = [];
  let running = 0;
  const step = (label, outcome) => ({
    label,
    save: async () => {
      running += 1;
      assert.equal(running, 1, "saves must not overlap");
      order.push(label);
      await new Promise((resolve) => setImmediate(resolve));
      running -= 1;
      if (outcome instanceof Error) throw outcome;
      return outcome;
    }
  });
  const result = await runSaveSync([step("bot", true), step("persona", false), step("ai", new Error("offline")), step("preset", true)], async () => {
    order.push("sync");
    return true;
  });
  assert.deepEqual(order, ["bot", "persona", "ai", "preset", "sync"]);
  assert.deepEqual({ ...result, failed: [...result.failed] }, { saved: 2, failed: ["persona", "ai"], synced: true });
  const empty = await runSaveSync([], async () => false);
  assert.deepEqual({ ...empty, failed: [...empty.failed] }, { saved: 0, failed: [], synced: false });
  const thrown = await runSaveSync([], async () => { throw new Error("offline"); });
  assert.equal(thrown.synced, false);
});

test("the top-bar refresh button saves unsaved settings before syncing", () => {
  assert.match(html, /id="refreshButton"[^>]*data-i18n-title="saveAndSync"/);
  assert.match(javascript, /\$\("#refreshButton"\)\.addEventListener\("click", \(\) => \{ void saveAndSync\(\); \}\)/);
  assert.match(personaScript, /pendingSaves: personaPendingSaves/);
  for (const name of ["savePersona", "saveInterestPreset", "saveAiSettings", "saveIdentity"]) {
    assert.match(personaScript, new RegExp(`async function ${name}\\(control, \\{ announce = true \\} = \\{\\}\\)`), `${name} must support quiet batch saves`);
  }
});

test("buttons with light text keep a solid background where color-mix is unsupported", () => {
  const css = readFileSync(new URL("client.css", resources), "utf8");
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }));
  const lightText = blocks.filter(({ selector, body }) => /\bcolor:\s*(var\(--on-accent\)|#fff\b)/.test(body) || /\.button\.(primary|danger)/.test(selector));
  assert.ok(lightText.some(({ selector }) => selector === ".button.primary"), "the primary button rule must be checked");
  for (const { selector, body } of lightText) {
    const backgrounds = [...body.matchAll(/(?:^|;|\s)background:\s*([^;]+)/g)].map((match) => match[1]);
    const firstMixed = backgrounds.findIndex((value) => value.includes("color-mix("));
    if (firstMixed === -1) continue;
    assert.ok(backgrounds.slice(0, firstMixed).some((value) => !value.includes("color-mix(")), `${selector} needs a plain background before its color-mix background`);
  }
});

test("the main-model card puts the active engine's group first and saves Claude settings", async () => {
  const pick = (name) => {
    const start = personaScript.indexOf(`function ${name}(`);
    const asyncStart = personaScript.lastIndexOf("async ", start) === start - 6 ? start - 6 : start;
    const end = personaScript.indexOf("\n}\n", start);
    assert.notEqual(start, -1, `client-persona.js must define ${name}`);
    return personaScript.slice(asyncStart, end + 2);
  };
  const element = (id) => ({ id, textContent: "", className: "", innerHTML: "", value: "", dataset: {}, focus() {} });
  const nodes = Object.fromEntries([
    "aiSettingsHint", "aiClaudeBadge", "aiCodexBadge", "aiClaudeNote", "aiCodexNote", "aiClaudeModel", "aiClaudeModelOptions",
    "aiClaudeEffort", "aiModel", "aiEffort", "aiServiceTier", "aiSummary", "aiPersonality"
  ].map((id) => [id, element(id)]));
  const claudeGroup = element("aiClaudeGroup");
  const codexGroup = element("aiCodexGroup");
  const actions = element("actions");
  const form = {
    ...element("aiSettingsForm"),
    children: [claudeGroup, codexGroup, actions],
    contains: () => false,
    get firstElementChild() { return this.children[0]; },
    insertBefore(node, reference) {
      if (reference === node) return;
      this.children = this.children.filter((child) => child !== node);
      const index = reference ? this.children.indexOf(reference) : this.children.length;
      this.children.splice(index < 0 ? this.children.length : index, 0, node);
    }
  };
  for (const group of [claudeGroup, codexGroup, actions]) {
    Object.defineProperty(group, "nextElementSibling", { get: () => form.children[form.children.indexOf(group) + 1] || null });
  }
  Object.assign(nodes, { aiSettingsForm: form, aiClaudeGroup: claudeGroup, aiCodexGroup: codexGroup });
  const translations = { aiActiveEngine: "当前引擎", aiStandbyEngine: "未使用", aiClaudeActiveNote: "claude-active {model}", aiCodexDrawingNote: "codex-draws", aiClaudeStandbyNote: "claude-standby", aiCodexActiveNote: "", claudeEffortFollow: "跟随 Codex（{effort}）", aiSettingsHint: "hint" };
  const posted = [];
  const context = {
    $: (selector) => nodes[selector.slice(1)],
    t: (key, values = {}) => String(translations[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => values[name] ?? ""),
    escapeHtml: (value) => String(value),
    document: { activeElement: null },
    personaUi: {},
    showToast: (message) => posted.push({ toast: message }),
    api: async (path, options) => { posted.push({ path, body: JSON.parse(options.body) }); return {}; },
    mutate: async (run) => run(),
    renderAdminSettings: () => {},
    refreshState: async () => {},
    refreshMaintenance: async () => {}
  };
  vm.runInNewContext(
    [pick("renderAiSettingsForm"), pick("renderClaudeSettingsFields"), pick("fillAiModelDependents"), pick("saveAiSettings"),
      "this.render = renderAiSettingsForm; this.save = saveAiSettings;"].join("\n"),
    context,
    { timeout: 100 }
  );
  const admin = {
    agent: { engine: "claude", drawing: "codex", modelCatalog: false },
    ai: { model: "gpt-x", reasoningEffort: "high", reasoningSummary: "auto", personality: "none", serviceTier: "" },
    claude: { model: "sonnet", reasoningEffort: "", suggestions: ["opus", "sonnet", "haiku"], efforts: ["low", "high"], defaultModel: "opus" },
    models: []
  };
  context.personaUi.admin = admin;
  context.render(admin);
  assert.deepEqual(form.children.map((child) => child.id), ["aiClaudeGroup", "aiCodexGroup", "actions"]);
  assert.equal(nodes.aiClaudeBadge.textContent, "当前引擎");
  assert.equal(nodes.aiClaudeBadge.className, "badge ok");
  assert.equal(nodes.aiCodexBadge.textContent, "未使用");
  assert.equal(nodes.aiClaudeNote.textContent, "claude-active opus");
  assert.equal(nodes.aiCodexNote.textContent, "codex-draws");
  assert.equal(nodes.aiClaudeModel.value, "sonnet");
  assert.match(nodes.aiClaudeEffort.innerHTML, /跟随 Codex（high）/);
  assert.equal(nodes.aiClaudeEffort.value, "");

  nodes.aiClaudeModel.value = " haiku ";
  nodes.aiClaudeEffort.value = "low";
  await context.save(null, { announce: false });
  assert.deepEqual(posted.at(-1).body.claude, { model: "haiku", reasoningEffort: "low" });
  assert.equal(posted.at(-1).body.model, "gpt-x");
  nodes.aiClaudeModel.value = "bad model";
  assert.equal(await context.save(null, { announce: false }), false);
  assert.ok(posted.at(-1).toast);

  // With Codex answering, its group leads and Claude says when it is used.
  context.render({ ...admin, agent: { engine: "codex", drawing: "native", modelCatalog: true } });
  assert.deepEqual(form.children.map((child) => child.id), ["aiCodexGroup", "aiClaudeGroup", "actions"]);
  assert.equal(nodes.aiCodexBadge.textContent, "当前引擎");
  assert.equal(nodes.aiClaudeNote.textContent, "claude-standby");
});
