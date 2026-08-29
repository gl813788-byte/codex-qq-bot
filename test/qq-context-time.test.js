import assert from "node:assert/strict";
import test from "node:test";
import { formatQqContextTime } from "../src/qq-context-time.js";

const now = "2026-08-29T12:00:00.000Z";

test("formats QQ context timestamps with enough date information to expose stale chat", () => {
  assert.equal(formatQqContextTime("2026-08-29T11:56:00.000Z", { now }), "今天 19:56");
  assert.equal(formatQqContextTime("2026-08-28T11:56:00.000Z", { now }), "昨天 19:56");
  assert.equal(formatQqContextTime("2026-08-26T14:25:00.000Z", { now }), "8月26日 22:25");
  assert.equal(formatQqContextTime("2025-12-31T16:05:00.000Z", { now }), "1月1日 00:05");
  assert.equal(formatQqContextTime("invalid", { now }), "");
});
