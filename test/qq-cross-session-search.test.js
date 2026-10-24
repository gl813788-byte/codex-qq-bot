import assert from "node:assert/strict";
import test from "node:test";
import {
  buildQqInterestCrossSessionContext,
  canSearchQqCrossSessionScope,
  formatQqCrossSessionSearchResult,
  formatQqHistoryScopeResolutionNotice,
  isQqHistoryWindowQuery,
  parseQqCrossSessionSearchTerms,
  parseQqHistorySearchQuery,
  resolveQqHistorySearchScopes,
  runQqHistorySearch,
  searchQqCrossSessionMessages
} from "../src/qq-cross-session-search.js";

const now = Date.parse("2026-08-02T08:00:00.000Z");
const source = {
  recentMessages: {
    "10001": [
      { at: "2026-08-02T07:00:00.000Z", senderId: "50005", senderLabel: "小张", text: "今天原神更新了吗" },
      { at: "2026-08-02T07:01:00.000Z", senderId: "60006", senderLabel: "小赵", text: "还没，晚上更新" }
    ],
    "20002": [
      { at: "2026-08-01T10:00:00.000Z", senderId: "60006", senderLabel: "小赵", text: "我在写毕业论文" },
      { at: "2026-08-01T10:01:00.000Z", senderId: "50005", senderLabel: "小张", text: "原神新角色强度很高", atTargets: ["60006"] },
      { at: "2026-08-01T10:02:00.000Z", isAssistant: true, senderId: "assistant", text: "这次角色确实强" },
      { at: "2026-08-01T10:03:00.000Z", senderId: "70007", senderLabel: "小钱", text: "收到", replyContext: { senderId: "60006", senderName: "小赵", text: "我在写毕业论文" } }
    ],
    "private:60006": [
      { at: "2026-08-01T12:00:00.000Z", senderId: "60006", senderLabel: "小赵", text: "论文答辩下周二" }
    ],
    "private:80008": [
      { at: "2026-08-01T12:30:00.000Z", senderId: "80008", senderLabel: "小孙", text: "别告诉别人我原神弃坑了" }
    ]
  },
  privateChats: { "60006": { aliases: ["小赵"] }, "80008": { aliases: ["小孙"] } },
  getGroupName: (groupId) => ({ "10001": "游戏群", "20002": "学习群" })[groupId] || ""
};

test("cross-session search privacy keeps third-party private chats privileged-only", async () => {
  assert.equal(canSearchQqCrossSessionScope("20002"), true);
  assert.equal(canSearchQqCrossSessionScope("private:60006", { requesterId: "60006" }), true);
  assert.equal(canSearchQqCrossSessionScope("private:80008", { requesterId: "60006" }), false);
  assert.equal(canSearchQqCrossSessionScope("private:80008", { privileged: true }), true);
  assert.equal(canSearchQqCrossSessionScope("../etc"), false);

  const ordinary = await searchQqCrossSessionMessages(source, { query: "原神", requesterId: "60006", now });
  assert.equal(ordinary.privacySkippedScopeCount, 1);
  assert.equal(ordinary.sessions.some((session) => session.scopeId === "private:80008"), false);
  const owner = await searchQqCrossSessionMessages(source, { query: "原神", privileged: true, now });
  assert.equal(owner.privacySkippedScopeCount, 0);
  assert.ok(owner.sessions.some((session) => session.scopeId === "private:80008"));
});

test("cross-session keyword hits are labeled with session, selector, line, time and sender", async () => {
  const result = await searchQqCrossSessionMessages(source, {
    query: "原神 角色",
    excludeScopeIds: ["10001"],
    requesterId: "60006",
    currentScopeId: "10001",
    now
  });
  assert.equal(result.mode, "keyword");
  assert.deepEqual(result.terms, ["原神", "角色"]);
  const study = result.sessions.find((session) => session.scopeId === "20002");
  assert.equal(study.label, "群 学习群(20002)");
  assert.equal(study.selector, "group:20002");
  const best = study.lines.find((line) => line.line === 2);
  assert.equal(best.hit, true);
  assert.equal(best.speaker, "小张(QQ 50005)");
  assert.deepEqual(best.matchedBy, ["keyword"]);
  assert.ok(study.lines.find((line) => line.line === 3).speaker === "Bot");

  const text = formatQqCrossSessionSearchResult(result, { now });
  assert.match(text, /【群 学习群\(20002\) · group:20002】缓冲共 4 行，命中 2 条：/);
  assert.match(text, /▶ 第2行 \S+ \S+ 小张\(QQ 50005\)：原神新角色强度很高 \[关键词\]/);
  assert.match(text, /他人私聊不在本轮检索范围/);
  assert.match(text, /说明来自哪个会话/);
  assert.doesNotMatch(text, /游戏群/);
});

test("cross-session person search finds sent, mentioned and quoted messages across sessions", async () => {
  const result = await searchQqCrossSessionMessages(source, {
    userId: "60006",
    excludeScopeIds: ["10001"],
    requesterId: "60006",
    now
  });
  assert.equal(result.mode, "person");
  const matchedBy = result.sessions.flatMap((session) => session.lines.map((line) => `${session.scopeId}:${line.line}:${line.matchedBy.join("+")}`));
  assert.deepEqual(matchedBy.sort(), [
    "20002:1:sender",
    "20002:2:mention",
    "20002:4:quote",
    "private:60006:1:sender"
  ]);
  const withKeyword = await searchQqCrossSessionMessages(source, { userId: "60006", query: "论文", requesterId: "60006", now });
  assert.deepEqual(withKeyword.sessions.map((session) => session.scopeId).sort(), ["20002", "private:60006"]);
});

test("cross-session search adds bounded neighboring context and falls back to semantic matches", async () => {
  const withContext = await searchQqCrossSessionMessages(source, {
    query: "毕业论文",
    scopeIds: ["20002"],
    contextLines: 1,
    now
  });
  const lines = withContext.sessions[0].lines;
  assert.deepEqual(lines.map((line) => [line.line, line.hit]), [[1, true], [2, false], [3, false], [4, true]]);

  const literal = await searchQqCrossSessionMessages(source, { query: "新角色 强度", privileged: true, now });
  assert.equal(literal.mode, "keyword");
  const fallback = await searchQqCrossSessionMessages(source, { query: "角色强度怎么样", privileged: true, now, minSemanticScore: 0.15 });
  assert.equal(fallback.mode, "semantic");
  assert.ok(fallback.sessions.some((session) => session.lines.some((line) => line.hit && line.matchedBy.includes("semantic"))));
  assert.match(formatQqCrossSessionSearchResult(fallback, { now }), /无字面命中，改用语义近似/);

  assert.equal((await searchQqCrossSessionMessages(source, {})).ok, false);
  assert.deepEqual(parseQqCrossSessionSearchTerms("  A，b  a "), ["a", "b"]);
});

test("interest cross-session context describes the sender elsewhere without the current scope", async () => {
  const context = await buildQqInterestCrossSessionContext(source, {
    senderId: "60006",
    isOwner: false
  }, {
    currentScopeId: "10001",
    query: "原神新角色强度",
    now
  });
  assert.ok(context.aboutSender.length >= 3);
  assert.ok(context.aboutSender.every((line) => line.selector !== "group:10001"));
  assert.ok(context.aboutSender.some((line) => line.session === "私聊 小赵" && line.text === "论文答辩下周二"));
  assert.equal(context.aboutSender[0].selector, "private:60006");
  assert.ok(context.relatedElsewhere.every((line) => line.selector !== "private:80008"));
  assert.equal(context.privacySkippedScopeCount, 1);
  const seen = new Set(context.aboutSender.map((line) => `${line.selector}:${line.text}`));
  assert.ok(context.relatedElsewhere.every((line) => !seen.has(`${line.selector}:${line.text}`)));

  const stale = await buildQqInterestCrossSessionContext(source, { senderId: "60006" }, {
    currentScopeId: "10001",
    now: now + 30 * 24 * 60 * 60 * 1000
  });
  assert.equal(stale, null);
});

test("chat-history queries separate structured cross-session filters from the free-text query", () => {
  assert.deepEqual(parseQqHistorySearchQuery("人物:60006 会话:group:20002 上下文:9 毕业 论文"), {
    userId: "60006",
    scopeSelector: "group:20002",
    contextLines: 3,
    query: "毕业 论文"
  });
  assert.deepEqual(parseQqHistorySearchQuery("人物:abc 最近 30"), {
    userId: "",
    scopeSelector: "",
    contextLines: 0,
    query: "人物:abc 最近 30"
  });
  for (const query of ["", "最近", "最近 30", "last 20条", "20-40", "20 到 40"]) {
    assert.equal(isQqHistoryWindowQuery(query), true, query);
  }
  for (const query of ["原神", "最近在玩什么", "关键词：20-40"]) {
    assert.equal(isQqHistoryWindowQuery(query), false, query);
  }
});

test("chat-history session targets resolve names, ids and selectors only among permitted sessions", () => {
  const ordinary = { requesterId: "60006", currentScopeId: "10001" };
  const resolved = resolveQqHistorySearchScopes(source, "学习群，当前, private:60006", ordinary);
  assert.deepEqual(resolved.scopeIds, ["20002", "10001", "private:60006"]);
  assert.deepEqual([resolved.ambiguous, resolved.missing, resolved.denied], [[], [], []]);
  assert.deepEqual(resolveQqHistorySearchScopes(source, "游戏 群", ordinary).scopeIds, ["10001"]);
  assert.deepEqual(resolveQqHistorySearchScopes(source, "小赵", ordinary).scopeIds, ["private:60006"]);
  assert.deepEqual(resolveQqHistorySearchScopes(source, "20002", ordinary).scopeIds, ["20002"]);

  const hidden = resolveQqHistorySearchScopes(source, "小孙, 80008", ordinary);
  assert.deepEqual(hidden.scopeIds, []);
  assert.deepEqual(hidden.missing, ["小孙", "80008"]);
  const notice = formatQqHistoryScopeResolutionNotice(hidden, { includeCandidates: true });
  assert.match(notice, /没有找到可检索的会话：「小孙」、「80008」/);
  assert.match(notice, /group:20002 · 群 学习群\(20002\)/);
  assert.doesNotMatch(notice, /80008 ·|小孙 ·|私聊 小孙/);
  const explicit = resolveQqHistorySearchScopes(source, "private:80008", ordinary);
  assert.deepEqual(explicit.denied, ["private:80008"]);
  assert.match(formatQqHistoryScopeResolutionNotice(explicit), /是他人私聊，只有主人或 Bot 管理员可以检索/);
  assert.deepEqual(resolveQqHistorySearchScopes(source, "小孙", { privileged: true }).scopeIds, ["private:80008"]);

  const ambiguous = resolveQqHistorySearchScopes(source, "群", ordinary);
  assert.equal(ambiguous.scopeIds.length, 0);
  assert.deepEqual(ambiguous.ambiguous[0].candidates.map((scope) => scope.selector).sort(), ["group:10001", "group:20002"]);
  assert.match(formatQqHistoryScopeResolutionNotice(ambiguous), /「群」对应多个会话，请改用选择器/);

  const many = resolveQqHistorySearchScopes(source, "10001,20002,private:60006", { ...ordinary, maxScopes: 2 });
  assert.deepEqual(many.scopeIds, ["10001", "20002"]);
  assert.equal(many.truncated, true);
});

test("chat-history tool keeps window reads local, adds labeled other sessions to searches and honors named targets", async () => {
  const reads = [];
  const logs = [];
  const options = {
    source,
    eventScopeId: "10001",
    privileged: false,
    requesterId: "60006",
    now,
    readHistory: (scopeId, query) => {
      reads.push([scopeId, query]);
      return `READ ${scopeId} ${query}`;
    },
    countHistoryMatches: (scopeId, query) => (scopeId === "10001" && query === "原神" ? 1 : 0),
    personLabel: (userId) => `小赵(QQ ${userId})`,
    onSearch: (details) => logs.push(details)
  };

  assert.deepEqual(await runQqHistorySearch("最近 30", options), { ok: true, reply: "READ 10001 最近 30" });

  const search = await runQqHistorySearch("原神", options);
  assert.equal(search.ok, true);
  assert.match(search.reply, /^READ 10001 原神\n\n跨会话搜索（关键词「原神」）：检索 2 个会话/);
  assert.match(search.reply, /【群 学习群\(20002\) · group:20002】/);
  assert.doesNotMatch(search.reply, /弃坑/);
  assert.equal(logs.at(-1).privacySkippedScopeCount, 1);
  assert.equal(logs.at(-1).currentResultCount, 1);
  assert.equal(Object.values(logs.at(-1)).some((value) => String(value).includes("原神")), false);

  const targetedWindow = await runQqHistorySearch("会话:学习群,当前 最近 5", options);
  assert.match(targetedWindow.reply, /^【群 学习群\(20002\) · group:20002】\nREAD 20002 最近 5\n\n【群 游戏群\(10001\) · group:10001 · 当前会话】\nREAD 10001 最近 5$/);

  const targetedSearch = await runQqHistorySearch("会话:学习群 原神", options);
  assert.match(targetedSearch.reply, /^跨会话搜索（关键词「原神」）：检索 1 个会话，命中 1 条。/);
  assert.equal(logs.at(-1).requestedScopeCount, 1);
  assert.equal(logs.at(-1).targetScopeId, "20002");

  const onlyCurrent = await runQqHistorySearch("会话:当前 原神", options);
  assert.equal(onlyCurrent.reply, "READ 10001 原神");

  const person = await runQqHistorySearch("人物:60006", options);
  assert.match(person.reply, /人物 小赵\(QQ 60006\)/);
  assert.match(person.reply, /【私聊 小赵 · private:60006】/);

  const partial = await runQqHistorySearch("会话:学习群,不存在的群 论文", options);
  assert.match(partial.reply, /^没有找到可检索的会话：「不存在的群」\n\n跨会话搜索/);

  const unknown = await runQqHistorySearch("会话:小孙 原神", options);
  assert.equal(unknown.ok, false);
  assert.match(unknown.reply, /本轮可检索的会话：/);
  assert.doesNotMatch(unknown.reply, /private:80008/);
  assert.equal(reads.some(([scopeId]) => scopeId === "private:80008"), false);
});
