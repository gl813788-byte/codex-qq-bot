import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveQqShortTermEntry,
  normalizeQqShortTermNoteScopes,
  overwriteQqShortTermEntry,
  parseQqShortTermContent
} from "../src/qq-short-term-memory.js";

test("legacy short-term notes migrate to title, summary and detail", () => {
  const scopes = normalizeQqShortTermNoteScopes({
    "10001": [{
      id: "old1",
      text: "周五晚上部署服务，若失败则回滚。",
      createdAt: "2026-07-01T00:00:00.000Z"
    }]
  }, {
    createId: () => "generated",
    normalizeTime: (value) => value || "2026-07-01T00:00:00.000Z"
  });
  const entry = scopes["10001"][0];
  assert.equal(entry.id, "old1");
  assert.equal(entry.detail, entry.text);
  assert.match(entry.title, /周五晚上部署/);
  assert.equal(entry.status, "active");
});

test("short-term overwrite preserves id while stale marking removes it from active lifecycle", () => {
  const initial = {
    id: "note1",
    title: "部署",
    summary: "旧时间",
    detail: "原定周四",
    text: "原定周四",
    status: "active",
    createdAt: "2026-07-01T00:00:00.000Z"
  };
  const parsed = parseQqShortTermContent("部署窗口 | 改到周五 | 维护窗口改到周五晚上十点");
  const updated = overwriteQqShortTermEntry(initial, parsed, { at: "2026-07-02T00:00:00.000Z" });
  assert.equal(updated.id, "note1");
  assert.equal(updated.summary, "改到周五");
  assert.equal(updated.detail, "维护窗口改到周五晚上十点");
  const archived = archiveQqShortTermEntry(updated, "已被新安排替代", {
    at: "2026-07-03T00:00:00.000Z"
  });
  assert.equal(archived.status, "archived");
  assert.equal(archived.staleReason, "已被新安排替代");
});
