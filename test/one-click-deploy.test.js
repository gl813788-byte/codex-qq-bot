import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectDir = fileURLToPath(new URL("..", import.meta.url));
const launcherPath = fileURLToPath(new URL("一键部署.command", new URL("..", import.meta.url)));
const nccPath = fileURLToPath(new URL("scripts/ncc.command", new URL("..", import.meta.url)));
const deployPath = fileURLToPath(new URL("scripts/deploy.command", new URL("..", import.meta.url)));

test("Chinese one-click deployment entry is executable and has valid Bash syntax", async () => {
  await access(launcherPath, constants.X_OK);
  const syntax = spawnSync("bash", ["-n", launcherPath], {
    cwd: projectDir,
    encoding: "utf8"
  });
  assert.equal(syntax.status, 0, syntax.stderr);
});

test("one-click launcher delegates first-run and later daily behavior to ncc", async () => {
  const source = await readFile(launcherPath, "utf8");
  const nccSource = await readFile(nccPath, "utf8");
  const deploySource = await readFile(deployPath, "utf8");
  assert.match(source, /exec zsh "\$NCC_SCRIPT"/);
  assert.match(nccSource, /CODEX_REMOTE_CONTACT_NCC_SETUP_COMPLETED/);
  assert.match(nccSource, /首次部署/);
  assert.match(nccSource, /以后运行 ncc/);
  assert.match(nccSource, /主人 QQ/);
  assert.match(nccSource, /群白名单/);
  assert.match(nccSource, /OneBot/);
  assert.match(deploySource, /npm install/);
  assert.match(deploySource, /npm run verify/);

  const help = spawnSync("bash", [launcherPath, "--help"], {
    cwd: projectDir,
    encoding: "utf8"
  });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /首次直接运行 ncc/);
  assert.match(help.stdout, /自动检测环境/);
  assert.match(help.stdout, /安装依赖/);
  assert.match(help.stdout, /常规功能菜单/);
});

test("fresh ncc run enters first-run deployment and keeps it pending when cancelled", async () => {
  const home = await mkdtemp(join(tmpdir(), "codex-qq-bot-first-run-"));
  try {
    const result = spawnSync("zsh", [nccPath], {
      cwd: projectDir,
      encoding: "utf8",
      input: "n\n",
      env: { ...process.env, GPT_QQ_BOT_HOME: home }
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /Codex QQ Bot 首次部署/);
    assert.match(result.stdout, /下次运行 ncc 会继续询问/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("existing installations are adopted once and later ncc runs open the normal menu", async () => {
  const home = await mkdtemp(join(tmpdir(), "codex-qq-bot-existing-"));
  try {
    await mkdir(join(home, "data"), { recursive: true });
    await mkdir(join(home, "config"), { recursive: true });
    await writeFile(join(home, "data", "settings.json"), "{}\n");
    await writeFile(join(home, "config", "local.env"), "");
    const result = spawnSync("zsh", [nccPath], {
      cwd: projectDir,
      encoding: "utf8",
      input: "0\n",
      env: { ...process.env, GPT_QQ_BOT_HOME: home }
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /已识别并接管现有部署/);
    assert.match(result.stdout, /Codex QQ Bot 控制中心/);
    const envFile = await readFile(join(home, "config", "local.env"), "utf8");
    assert.match(envFile, /CODEX_REMOTE_CONTACT_NCC_SETUP_COMPLETED=1/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("a status check on a fresh checkout does not accidentally skip first-run deployment", async () => {
  const home = await mkdtemp(join(tmpdir(), "codex-qq-bot-status-first-"));
  try {
    await mkdir(join(home, "config"), { recursive: true });
    await writeFile(
      join(home, "config", "settings.example.json"),
      '{"version":1,"qq":{},"branding":{}}\n'
    );
    const status = spawnSync("zsh", [nccPath, "status"], {
      cwd: projectDir,
      encoding: "utf8",
      env: { ...process.env, GPT_QQ_BOT_HOME: home }
    });
    assert.equal(status.status, 0, status.stderr);
    const envFile = await readFile(join(home, "config", "local.env"), "utf8");
    assert.match(envFile, /CODEX_REMOTE_CONTACT_NCC_SETUP_COMPLETED=0/);

    const menu = spawnSync("zsh", [nccPath], {
      cwd: projectDir,
      encoding: "utf8",
      input: "n\n",
      env: { ...process.env, GPT_QQ_BOT_HOME: home }
    });
    assert.equal(menu.status, 1, menu.stderr);
    assert.match(menu.stdout, /Codex QQ Bot 首次部署/);
    assert.doesNotMatch(menu.stdout, /已识别并接管现有部署/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
