import test from "node:test";
import assert from "node:assert/strict";
import {
  baseAgentRuntimeEnvKeys,
  parseEnvFile,
  pickAgentChildEnv
} from "../src/infrastructure/agent/agent-child-env.js";

test("parses the supported active profile env syntax without executing shell code", () => {
  assert.deepEqual(parseEnvFile(`
    # profile
    export CODEX_API_KEY='secret-value'
    OPENAI_BASE_URL="https://example.test/v1"
    PLAIN=value # comment
  `), {
    CODEX_API_KEY: "secret-value",
    OPENAI_BASE_URL: "https://example.test/v1",
    PLAIN: "value"
  });
});

test("agent child env keeps only allowlisted, locale and admitted keys", () => {
  const env = pickAgentChildEnv({
    HOME: "/root",
    PATH: "/usr/bin",
    LC_ALL: "C.UTF-8",
    ENGINE_KEY: "kept",
    ADMITTED: 1,
    DROPPED_NULL: null,
    ONEBOT_ACCESS_TOKEN: "do-not-forward"
  }, new Set([...baseAgentRuntimeEnvKeys, "ENGINE_KEY", "DROPPED_NULL"]), (key) => key === "ADMITTED");

  assert.deepEqual(env, {
    HOME: "/root",
    PATH: "/usr/bin",
    LC_ALL: "C.UTF-8",
    ENGINE_KEY: "kept",
    ADMITTED: "1"
  });
});
