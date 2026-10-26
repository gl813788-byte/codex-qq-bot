import assert from "node:assert/strict";
import test from "node:test";
import {
  findQqStickerBySelector,
  formatQqStickerLibraryHint,
  formatQqStickerSearchResults,
  formatQqStickerSuggestions,
  suggestQqStickers,
  getQqStickerRef,
  parseQqStickerRef,
  searchQqStickers
} from "../src/qq-sticker-search.js";
import { getQqStickerIdentity } from "../src/qq-sticker-label-store.js";

const catalog = [
  { identity: "account:aaa", name: "账号表情1", source: "account", tags: ["自闭", "趴下", "委屈"], description: "戴兜帽的小动物低头趴着，适合表达自闭、受挫或委屈" },
  { identity: "market:bbb", name: "捏你", source: "downloaded", tags: ["捏你"], description: "QQ 商城标签：捏你", animated: true },
  { identity: "account:ccc", name: "账号表情2", source: "account", tags: ["无语", "翻白眼"], description: "猫咪翻白眼，表示无语" },
  { identity: "local:ddd", name: "狗头", source: "local", tags: ["狗头", "阴阳怪气"], description: "保命狗头" },
  { identity: "account:eee", name: "账号表情3", source: "account", tags: [], description: "" }
];

test("sticker refs are stable short hashes of the canonical identity", () => {
  const ref = getQqStickerRef(catalog[0]);
  assert.match(ref, /^#[0-9a-f]{6}$/);
  assert.equal(getQqStickerRef({ ...catalog[0], name: "改名了" }), ref);
  // A raw local item and its enriched copy (identity stamped) share one ref.
  const raw = { name: "本地图", file: "/stickers/本地图.png" };
  assert.equal(getQqStickerRef(raw), getQqStickerRef({ ...raw, identity: getQqStickerIdentity(raw) }));
  assert.equal(parseQqStickerRef(ref.slice(1).toUpperCase()), ref);
  assert.equal(parseQqStickerRef("狗头"), "");
});

test("selectors resolve #refs, exact names and unique partial names", () => {
  assert.equal(findQqStickerBySelector(catalog, getQqStickerRef(catalog[2])), catalog[2]);
  assert.equal(findQqStickerBySelector(catalog, "狗头"), catalog[3]);
  assert.equal(findQqStickerBySelector(catalog, "账号表情"), null);
  assert.equal(findQqStickerBySelector(catalog, "#000000"), null);
});

test("search ranks by tags, then name and description, and penalizes recent use", () => {
  const results = searchQqStickers(catalog, "无语");
  assert.equal(results[0].item, catalog[2]);
  assert.equal(results[0].ref, getQqStickerRef(catalog[2]));
  const multi = searchQqStickers(catalog, "委屈 趴下");
  assert.equal(multi[0].item, catalog[0]);
  assert.equal(searchQqStickers(catalog, "阴阳怪气")[0].item, catalog[3]);
  assert.deepEqual(searchQqStickers(catalog, "完全不相关的词"), []);
  const recent = searchQqStickers(catalog, "狗头 无语", { recentRefs: [getQqStickerRef(catalog[2])] });
  assert.equal(recent[0].item, catalog[3]);
});

test("an empty query samples labeled stickers and skips recent ones", () => {
  const sample = searchQqStickers(catalog, "", { random: () => 0, recentRefs: [getQqStickerRef(catalog[3])] });
  assert.ok(sample.length > 0);
  assert.equal(sample.some((entry) => entry.item === catalog[4]), false);
  assert.equal(sample.some((entry) => entry.item === catalog[3]), false);
});

test("search results and the prompt hint stay compact and actionable", () => {
  const text = formatQqStickerSearchResults(searchQqStickers(catalog, "无语"), { query: "无语", total: catalog.length });
  assert.match(text, /表情包库共 5 张/);
  assert.match(text, new RegExp(getQqStickerRef(catalog[2])));
  assert.match(text, /sticker 字段/);
  assert.match(formatQqStickerSearchResults([], { query: "x", total: 5 }), /没有合适的/);
  assert.match(formatQqStickerLibraryHint(catalog), /共 5 张（已标注 4 张）/);
  assert.equal(formatQqStickerLibraryHint([]), "");
});

test("sticker-friendly turns get message matches first, then a labeled handful", () => {
  const suggestions = suggestQqStickers(catalog, "我真的无语了", { limit: 3, random: () => 0 });
  assert.equal(suggestions[0].item, catalog[2]);
  assert.equal(suggestions.length, 3);
  assert.equal(new Set(suggestions.map((entry) => entry.ref)).size, 3);
  assert.equal(suggestions.some((entry) => entry.item === catalog[4]), false);
  const text = formatQqStickerSuggestions(suggestions);
  assert.match(text, /^手边可直接发的表情包：/);
  assert.match(text, new RegExp(`${getQqStickerRef(catalog[2])} 账号表情2：无语、翻白眼`));
  assert.equal(formatQqStickerSuggestions([]), "");
});
