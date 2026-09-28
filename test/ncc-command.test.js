import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import test from "node:test";

const projectDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const commandPath = join(projectDir, "scripts", "ncc.command");

test("repository ncc resolves its project when invoked outside the checkout or through a symlink", async () => {
  const directory = await mkdtemp(join(tmpdir(), "codex-qq-bot-ncc-"));
  const symlinkPath = join(directory, "ncc");
  const env = { ...process.env };
  delete env.GPT_QQ_BOT_HOME;

  try {
    await symlink(commandPath, symlinkPath);
    for (const entry of [commandPath, symlinkPath]) {
      const output = execFileSync("zsh", [entry, "help"], {
        cwd: tmpdir(),
        encoding: "utf8",
        env
      });
      assert.match(output, new RegExp(`项目目录：${escapeRegExp(projectDir)}(?:\\n|$)`));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("repository ncc saves the chosen agent engine in config/local.env", async () => {
  const home = await mkdtemp(join(tmpdir(), "codex-qq-bot-engine-"));
  const env = { ...process.env, GPT_QQ_BOT_HOME: home };
  const run = (...args) => execFileSync("zsh", [commandPath, ...args], { cwd: tmpdir(), encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] });
  try {
    assert.equal(run("engine").trim(), "codex");
    assert.match(run("engine", "claude"), /Claude Code/);
    assert.equal(run("engine").trim(), "claude");
    assert.match(await readFile(join(home, "config", "local.env"), "utf8"), /^export CODEX_REMOTE_CONTACT_AGENT_ENGINE=claude$/m);
    assert.throws(() => run("engine", "gemini"));
    assert.equal(run("engine").trim(), "claude");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
