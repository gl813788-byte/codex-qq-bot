import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { promisify } from "node:util";
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

test("ncc sends the force and background parameters and distinguishes acceptance from completion", async () => {
  let received;
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    received = JSON.parse(raw);
    res.writeHead(202, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, accepted: true, jobId: "job-test", taskId: "all", scopeId: "10001" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { stdout } = await promisify(execFile)("zsh", [commandPath, "ai-run", "all", "10001", "--force", "--background", "--full"], {
      cwd: tmpdir(),
      env: { ...process.env, GPT_QQ_BOT_HUB_URL: `http://127.0.0.1:${server.address().port}` }
    });
    assert.deepEqual(received, { taskId: "all", scopeId: "10001", force: true, fullHistory: true, background: true });
    assert.match(stdout, /已提交后台，尚未完成/);
    assert.match(stdout, /任务编号：job-test/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("startup applies resource budgets and preserves explicit environment overrides", async () => {
  const directory = await mkdtemp(join(tmpdir(), "qq-start-resources-"));
  const nodePath = process.execPath;
  const quote = (value) => `'${value.replace(/'/g, `'"'"'`)}'`;
  const fields = ["NODE_OPTIONS", "CODEX_REMOTE_CONTACT_CODEX_MAX_CONCURRENCY", "CODEX_REMOTE_CONTACT_QQ_IMAGE_MAX_BYTES", "CODEX_REMOTE_CONTACT_QQ_COMPRESSED_IMAGE_MAX_EDGE"];
  const script = `console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(fields)}.map(key => [key,process.env[key]]))))`;
  await writeFile(join(directory, "node"), `#!/bin/sh\ncase "$1" in\n*/src/server.js) exec ${quote(nodePath)} -e ${quote(script)} ;;\n*) exec ${quote(nodePath)} "$@" ;;\nesac\n`, { mode: 0o700 });
  try {
    for (const manual of [false, true]) {
      const env = { ...process.env, PATH: `${directory}:${process.env.PATH}`, CODEX_REMOTE_CONTACT_RESOURCE_PROFILE: "balanced" };
      for (const key of fields) delete env[key];
      if (manual) {
        env.NODE_OPTIONS = "--max-old-space-size=321";
        env.CODEX_REMOTE_CONTACT_CODEX_MAX_CONCURRENCY = "3";
        env.CODEX_REMOTE_CONTACT_QQ_IMAGE_MAX_BYTES = "12345678";
      }
      const { stdout } = await promisify(execFile)("bash", [join(projectDir, "scripts/start-hub.sh")], { env });
      const applied = JSON.parse(stdout.trim().split("\n").at(-1));
      assert.match(applied.NODE_OPTIONS, manual ? /321/ : /256/);
      assert.equal(applied.CODEX_REMOTE_CONTACT_CODEX_MAX_CONCURRENCY, manual ? "3" : "1");
      assert.equal(applied.CODEX_REMOTE_CONTACT_QQ_IMAGE_MAX_BYTES, manual ? "12345678" : String(10 * 1024 * 1024));
      assert.equal(applied.CODEX_REMOTE_CONTACT_QQ_COMPRESSED_IMAGE_MAX_EDGE, "1600");
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
