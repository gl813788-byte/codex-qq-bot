import assert from "node:assert/strict";
import test from "node:test";
import { flattenQqMarkdownLinks } from "../src/qq-markdown-links.js";

test("Markdown links reach QQ as their text followed by the bare URL", () => {
  // Both seen raw in group chat on 2026-11-15 after web searches.
  assert.equal(
    flattenQqMarkdownLinks("按刚才的判定词看，应该是 [Arcaea（韵律源点）](https://arcaea.lowiro.com/zh)，一款音游"),
    "按刚才的判定词看，应该是 Arcaea（韵律源点） https://arcaea.lowiro.com/zh，一款音游"
  );
  assert.equal(
    flattenQqMarkdownLinks("别硬撑，肚子还疼得厉害就找人陪你去急诊（[就医指引](https://www.nhs.uk/symptoms/stomach-ache/)）"),
    "别硬撑，肚子还疼得厉害就找人陪你去急诊（就医指引 https://www.nhs.uk/symptoms/stomach-ache/）"
  );
});

test("a label that only repeats the address leaves just the URL", () => {
  assert.equal(flattenQqMarkdownLinks("看 [https://example.com/](https://example.com) 吧"), "看 https://example.com 吧");
  assert.equal(flattenQqMarkdownLinks("[www.example.com](https://www.example.com/)"), "https://www.example.com/");
  assert.equal(flattenQqMarkdownLinks("[](https://example.com/a)"), "https://example.com/a");
});

test("an ASCII character right after the URL is kept apart, and titles and images are handled", () => {
  assert.equal(flattenQqMarkdownLinks("see [docs](https://a.dev/x_(y))."), "see docs https://a.dev/x_(y) .");
  assert.equal(flattenQqMarkdownLinks('[官网](https://a.dev "Title")'), "官网 https://a.dev");
  assert.equal(flattenQqMarkdownLinks("![图](https://a.dev/p.png)"), "图 https://a.dev/p.png");
});

test("code, non-web links and plain brackets stay as written", () => {
  const code = "用 `[a](https://x.dev)` 这种写法\n```md\n[b](https://y.dev)\n```";
  assert.equal(flattenQqMarkdownLinks(code), code);
  assert.equal(flattenQqMarkdownLinks("[跳到](#section)"), "[跳到](#section)");
  assert.equal(flattenQqMarkdownLinks("（抱住）[doge]"), "（抱住）[doge]");
  assert.equal(flattenQqMarkdownLinks(""), "");
  assert.equal(flattenQqMarkdownLinks(null), "");
});
