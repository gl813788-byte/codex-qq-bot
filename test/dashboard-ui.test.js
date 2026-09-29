import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const resources = new URL("../modules/mac-client/Resources/", import.meta.url);
const html = readFileSync(new URL("client.html", resources), "utf8");
const css = readFileSync(new URL("client.css", resources), "utf8");
const javascript = readFileSync(new URL("client.js", resources), "utf8");

function unique(values) {
  return [...new Set(values)];
}

function extractTranslations(source) {
  const prefix = "const translations = ";
  const suffix = "\n\nconst app =";
  const start = source.indexOf(prefix);
  const end = source.indexOf(suffix, start + prefix.length);
  assert.notEqual(start, -1, "client.js must declare translations");
  assert.notEqual(end, -1, "translations must be declared before app state");
  const expression = source.slice(start + prefix.length, end).replace(/;\s*$/, "");
  return vm.runInNewContext(`(${expression})`, Object.create(null), { timeout: 100 });
}

function viewMarkup(view, nextView) {
  const start = html.indexOf(`id="view-${view}"`);
  const end = nextView ? html.indexOf(`id="view-${nextView}"`) : html.indexOf("</main>");
  assert.ok(start >= 0 && end > start, `view ${view} must exist before ${nextView || "</main>"}`);
  return html.slice(start, end);
}

test("dashboard HTML has unique ids referenced by static client selectors", () => {
  const ids = [...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1]);
  const duplicateIds = unique(ids.filter((id, index) => ids.indexOf(id) !== index));
  assert.deepEqual(duplicateIds, [], `duplicate HTML ids: ${duplicateIds.join(", ")}`);
  const knownIds = new Set(ids);
  const referencedIds = unique([...javascript.matchAll(/\$\(\s*["']#([^"']+)["']\s*\)/g)].map((match) => match[1]));
  const missingIds = referencedIds.filter((id) => !knownIds.has(id));
  assert.deepEqual(missingIds, [], `client.js references missing HTML ids: ${missingIds.join(", ")}`);
});

test("dashboard translations stay aligned and cover static i18n usage", () => {
  const translations = extractTranslations(javascript);
  const zhKeys = Object.keys(translations.zh || {}).sort();
  const enKeys = Object.keys(translations.en || {}).sort();
  assert.ok(zhKeys.length > 0, "Chinese translations must not be empty");
  assert.deepEqual(enKeys, zhKeys, "Chinese and English translation keys must match");
  const scriptKeys = [...javascript.matchAll(/\bt\(\s*["']([^"']+)["']/g)].map((match) => match[1]);
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

test("dashboard CSS is responsive, themeable in both schemes and respects reduced motion", () => {
  const breakpoints = [...css.matchAll(/@media\s*\(\s*max-width\s*:\s*(\d+)px\s*\)/gi)].map((match) => Number(match[1]));
  assert.ok(unique(breakpoints).length >= 2, "CSS must define multiple responsive breakpoints");
  assert.ok(breakpoints.some((value) => value <= 600), "CSS must include a compact mobile breakpoint");
  assert.ok(breakpoints.some((value) => value >= 800), "CSS must include a tablet/desktop breakpoint");
  assert.match(css, /:root\[data-theme="dark"\]\s*\{/);
  assert.match(css, /@media \(prefers-color-scheme: dark\)\s*\{\s*:root\[data-theme="system"\]/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\.mobile-nav\s*\{[^}]*position:\s*fixed/);
});

test("dashboard shows the active agent engine instead of assuming Codex", () => {
  for (const id of ["topEngine", "sidebarEngine", "engineCard", "engineFacts", "engineLastRun", "quotaSection"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(javascript, /app\.maintenance\?\.agent/);
  assert.match(javascript, /ai\.activeModel/);
  assert.match(javascript, /const engineNames = \{ codex: "Codex", claude: "Claude Code" \}/);
  assert.match(javascript, /function getEngineInfo\(\)/);
  assert.match(javascript, /if \(!engine\.reportsQuota\)/, "usage bars only appear for an engine that reports quota");
  assert.match(javascript, /engine\.connection === "profile"/);
  assert.match(javascript, /id: "agent", state: getEngineState\(engine\)/);
  assert.match(css, /\[data-engine="codex"\] \.engine-glyph/);
  assert.match(css, /\[data-engine="claude"\] \.engine-glyph/);
  const chrome = html.slice(0, html.indexOf('id="view-channels"'));
  assert.doesNotMatch(chrome, />Codex</, "navigation and overview must not hard-code the Codex engine name");
});

test("dashboard logs filter and tag agent entries by engine", () => {
  const activity = viewMarkup("activity", "settings");
  for (const id of ["logFilterForm", "logLevel", "logCategory", "logEngine", "logQuery", "logSlow", "logLimit", "liveLogsToggle", "logFollowToggle", "logExpandToggle", "liveLogState", "logLastUpdated", "logStream"]) {
    assert.match(activity, new RegExp(`id="${id}"`));
  }
  assert.match(activity, /<option value="claude">Claude Code<\/option>/);
  assert.match(javascript, /engine: \$\("#logEngine"\)\.value/);
  assert.match(javascript, /verbose:\s*"1"/);
  assert.match(javascript, /entry\.engine \? `<span class="engine-tag/);
  assert.match(javascript, /summary\.byEngine/);
  assert.match(javascript, /agent: "catAgent"/);
  assert.match(javascript, /app\.view === "activity" && app\.liveLogs &&[^\n]+now - app\.lastFetch\.logs >= 1_000/);
  assert.match(javascript, /app\.language === "en" \? entry\.details : \(entry\.detailsZh \|\| entry\.details\)/);
  assert.match(javascript, /entry\.messageZh\s*\|\|\s*entry\.message/);
  assert.match(javascript, /entry\.errorZh/);
  for (const level of ["debug", "info", "success", "warn", "error"]) {
    assert.match(css, new RegExp(`\\.log-entry\\.level-${level}\\s*\\{`));
  }
  for (const category of ["system", "qq", "onebot", "agent", "search", "interest", "learning", "lifecycle"]) {
    assert.match(css, new RegExp(`\\.log-entry\\.category-${category} \\.log-category\\s*\\{`));
  }
  assert.match(css, /\.engine-tag\.claude\s*\{/);
  assert.match(css, /\.log-duration\.slow\s*\{/);
  assert.match(css, /\.log-duration\.bad\s*\{/);
  assert.match(css, /\.log-detail\.is-error\s*\{/);
});

test("dashboard realtime visuals come from API samples instead of demo values", () => {
  assert.match(html, /id="pulseLine" class="pulse-line" d=""/);
  assert.match(javascript, /function recordRuntimeSample\(latencyMs\)/);
  assert.match(javascript, /performance\.now\(\) - requestStartedAt/);
  assert.match(javascript, /function renderRuntimePulse\(\)/);
  assert.match(javascript, /writeStorage\(sessionStorage, "runtimeSamples"/);
  assert.match(javascript, /point\.removeAttribute\("hidden"\)/, "SVG visibility must toggle the attribute");
  assert.match(javascript, /\["memory", "knowledge"\]\.includes\(app\.view\)[^\n]+refreshMemory/);
});

test("dashboard keeps every management control in its workspace", () => {
  const channels = viewMarkup("channels", "intelligence");
  const intelligence = viewMarkup("intelligence", "memory");
  for (const id of ["qqToggle", "qqChannelMeta", "groupList", "addGroupForm", "groupInput", "qqEvents"]) assert.match(channels, new RegExp(`id="${id}"`));
  assert.doesNotMatch(channels, /id="qqAdaptiveLearning"/);
  for (const id of ["botSettingsForm", "botDiagnostics", "botEnhancerToggle", "botWebLookupToggle", "botProactiveToggle", "botJudgeToggle", "qqSelfPersona", "qqStickerFrequency", "qqAdaptiveLearning", "qqColdInterest", "qqPrivateInterest"]) {
    assert.match(intelligence, new RegExp(`id="${id}"`));
  }
  for (const id of ["memorySearch", "memoryTabs", "knowledgeSearch", "knowledgeEditorForm", "lanAccessToggle", "publicTunnelToggle", "commandDialog", "confirmDialog"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(javascript, /validViews = new Set\(\["overview", "channels", "intelligence", "memory", "knowledge", "activity", "settings"\]\)/);
  assert.match(javascript, /\/api\/qq\/bot-settings/);
  assert.match(javascript, /\/api\/qq\/groups/);
  assert.match(javascript, /\/api\/memory\/clear/);
  assert.match(javascript, /network\?\.safeFetchMode/);
});

test("dashboard knowledge workspace renders real scoped data through the protected API", () => {
  const knowledge = viewMarkup("knowledge", "activity");
  for (const id of ["knowledgeMetrics", "knowledgeIndex", "knowledgeList", "knowledgeInspector", "knowledgeKindFilter", "knowledgeScopeFilter", "knowledgeSort"]) {
    assert.match(knowledge, new RegExp(`id="${id}"`));
  }
  assert.match(javascript, /app\.memory\?\.qq\?\.knowledgeBase/);
  assert.match(javascript, /function renderKnowledge\(\)/);
  assert.match(javascript, /function renderKnowledgeEvidence\(occurrence\)/);
  assert.match(javascript, /\/api\/qq\/knowledge/);
  assert.match(javascript, /entryId,\s*variantId/);
  assert.doesNotMatch(knowledge, /示例黑话|Example slang/);
  assert.match(css, /\.knowledge-workspace\s*\{[^}]*grid-template-columns:/);
  assert.match(css, /\.knowledge-context-row\s*\{[^}]*grid-template-columns:\s*42px minmax\(0,\s*1fr\)/);
  assert.match(css, /\.knowledge-context-row > div\s*\{[^}]*min-width:\s*0/);
  assert.match(css, /\.knowledge-context-row p\s*\{[^}]*overflow-wrap:\s*anywhere/);
});

test("dashboard exposes local-only token-protected temporary public tunnel controls", () => {
  for (const id of ["publicTunnelToggle", "publicTunnelHint", "publicTunnelUrl", "copyPublicTunnelUrl", "copyPublicTunnelToken"]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(javascript, /\/api\/network\/public-tunnel/);
  assert.match(javascript, /tunnelToggle\.disabled = tunnelBusy \|\| !app\.state \|\| !localBrowser/);
  assert.match(javascript, /copyPublicTunnelToken"\)\.disabled = !tunnelRunning \|\| !network\.apiTokenConfigured \|\| !localBrowser/);
  assert.match(javascript, /publicTunnelEnableMessage/);
  assert.match(css, /\.public-tunnel-card\s*\{/);
});

test("dashboard preserves local interaction state across polling and page reloads", () => {
  assert.match(javascript, /sessionStorage\.setItem\(`\$\{STORAGE_PREFIX\}uiState`/);
  assert.match(javascript, /window\.addEventListener\("pagehide", persistDashboardUiState\)/);
  assert.match(javascript, /restoreDashboardUiState\(\);/);
  assert.match(javascript, /dirtyForms: new Set\(restoredUiState\.botSettingsDraft/);
  assert.match(javascript, /openAdaptiveLearningGroups: new Set\(restoredUiState\.openAdaptiveLearningGroups \|\| \[\]\)/);
  assert.match(javascript, /data-adaptive-learning-key="\$\{escapeHtml\(groupId\)\}" \$\{app\.openAdaptiveLearningGroups\.has\(groupId\) \? "open" : ""\}/);
  assert.match(javascript, /engine: \["", "codex", "claude"\]\.includes\(logFilters\.engine\)/);
  assert.match(javascript, /if \(!busy && !dirty && !form\.contains\(document\.activeElement\)\)/);
  assert.match(javascript, /if \(app\.busyKeys\.has\("groups"\)\) return/);
  assert.match(javascript, /if \(app\.busyKeys\.has\("memory"\)/);
  assert.match(javascript, /busyKey: `channel:\$\{channel\}`/);
  assert.match(css, /\.save-state\.dirty\s*\{/);
});
