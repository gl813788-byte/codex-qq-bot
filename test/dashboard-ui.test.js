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
