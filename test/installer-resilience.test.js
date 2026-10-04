import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));
const installer = join(root, "install.sh");
const cleanNetwork = { HTTP_PROXY: "", HTTPS_PROXY: "", ALL_PROXY: "", http_proxy: "", https_proxy: "", all_proxy: "", NO_PROXY: "127.0.0.1", no_proxy: "127.0.0.1" };
function run(command, args, env = {}, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: { ...process.env, ...env }, ...options });
    let stdout = "", stderr = "";
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.once("error", reject);
    child.once("close", (status) => resolve({ status, stdout, stderr }));
  });
}
async function workspace(t) {
  const dir = await mkdtemp(join(tmpdir(), "ncc-resilience-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
async function executable(path, body) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `#!/usr/bin/env bash\n${body}\n`, { mode: 0o755 });
}
async function http(t, handler) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
function download(url, file, env = {}, resume = "0") {
  return run("bash", ["-c", 'set -Eeuo pipefail; source "$1"; ncc_download "$2" "$3" "$4"', "test", installer, url, file, resume], { ...cleanNetwork, ...env });
}

test("source-only transport does not initialize the installer or change caller options", async (t) => {
  const home = await workspace(t);
  const result = await run("bash", ["-c", 'before="$-"; source "$1"; test "$before" = "$-"; test -z "${INSTALL_DIR+x}"; printf ready', "test", installer], { HOME: home });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "ready");
  assert.deepEqual(await readdir(home), []);
});

test("download recovers HTTP failures and ignores a conflicting curlrc", async (t) => {
  const home = await workspace(t);
  await writeFile(join(home, ".curlrc"), 'proxy = "http://127.0.0.1:1"\nhead\n');
  let requests = 0;
  const url = await http(t, (_req, res) => {
    if (++requests < 3) { res.writeHead(503); res.end("retry"); }
    else res.end("complete payload");
  });
  const file = join(home, "file.part");
  const result = await download(url, file, { HOME: home, CURL_HOME: home });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(requests, 3);
  assert.equal(await readFile(file, "utf8"), "complete payload");
});

test("a server without range support gets a fresh request instead of a corrupt append", async (t) => {
  const home = await workspace(t);
  const file = join(home, "file.part");
  await writeFile(file, "old fragment");
  const ranges = [];
  const url = await http(t, (req, res) => { ranges.push(req.headers.range); res.end("complete replacement"); });
  const result = await download(url, file, {}, "1");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(ranges[0], "bytes=12-");
  assert.equal(ranges.at(-1), undefined);
  assert.equal(await readFile(file, "utf8"), "complete replacement");
});

test("stalled downloads time out and keep their partial contents for recovery", async (t) => {
  const home = await workspace(t);
  const url = await http(t, (_req, res) => { res.writeHead(200, { "Content-Length": 100 }); res.write("partial"); });
  const result = await download(url, join(home, "file"), { CODEX_QQ_BOT_DOWNLOAD_TIMEOUT: "1", CODEX_QQ_BOT_DOWNLOAD_ATTEMPTS: "1" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /已保留缓存/);
  assert.equal(await readFile(join(home, "file"), "utf8"), "partial");
});

test("changing a download endpoint does not resume bytes from the old endpoint", async (t) => {
  const home = await workspace(t);
  const file = join(home, "file");
  const ranges = [];
  const url = await http(t, (req, res) => { ranges.push(req.headers.range); res.end(req.url); });
  assert.equal((await download(`${url}/first`, file)).status, 0);
  assert.equal((await download(`${url}/second`, file, {}, "1")).status, 0);
  assert.deepEqual(ranges, [undefined, undefined]);
  assert.equal(await readFile(file, "utf8"), "/second");
});

test("API outage falls back to the configured Git remote and resolves its exact default commit", async (t) => {
  const home = await workspace(t);
  const remote = join(home, "repo");
  await mkdir(remote);
  for (const args of [["init", "-b", "install-test"], ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-m", "fixture"]]) {
    const result = await run("git", args, {}, { cwd: remote });
    assert.equal(result.status, 0, result.stderr);
  }
  const revision = (await run("git", ["rev-parse", "HEAD"], {}, { cwd: remote })).stdout.trim();
  const url = await http(t, (_req, res) => { res.writeHead(503); res.end(); });
  const result = await run("bash", [installer, "--check"], {
    ...cleanNetwork, CODEX_QQ_BOT_REPOSITORY_API_URL: url,
    CODEX_QQ_BOT_GIT_URL: remote, CODEX_QQ_BOT_DOWNLOAD_ATTEMPTS: "1", CODEX_QQ_BOT_INSTALL_DIR: join(home, "target")
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Git 协议/);
  assert.ok(result.stdout.includes(`install-test@${revision.slice(0, 12)}`));
  assert.ok(result.stdout.includes(revision));
});

test("inherited Termux variables identify the existing Linux guest and its userland architecture", async (t) => {
  const home = await workspace(t);
  await executable(join(home, "dpkg"), "printf 'armhf\\n'");
  const result = await run("bash", [join(root, "scripts/install-environment.sh"), "--report"], {
    CODEX_QQ_BOT_BOOTSTRAP_PLATFORM: "", CODEX_QQ_BOT_BOOTSTRAP_OS: "", CODEX_QQ_BOT_BOOTSTRAP_ARCH: "",
    TERMUX_VERSION: "fixture", PREFIX: "/data/data/com.termux/files/usr", PATH: `${home}:${process.env.PATH}`
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /termux-proot/);
  assert.match(result.stdout, /armv7/);
  const plan = await run("bash", [join(root, "scripts/bootstrap-environment.sh"), "--dry-run"], {
    CODEX_QQ_BOT_BOOTSTRAP_PLATFORM: "termux-proot", CODEX_QQ_BOT_BOOTSTRAP_ARCH: "armv7"
  });
  assert.notEqual(plan.status, 0);
  assert.match(plan.stderr, /用户空间架构 armv7/);
  assert.doesNotMatch(plan.stdout, /计划通过 .* 安装/);
});

test("fresh PRoot starts through Bash and forwards proxy and certificate settings", async (t) => {
  const home = await workspace(t);
  const argsFile = join(home, "guest-args");
  const ca = join(home, "trust.pem");
  await writeFile(ca, "fixture CA");
  await executable(join(home, "proot-distro"), 'if [ "$#" -lt 5 ]; then exit 1; fi\ncase "$*" in *"/bin/sh -c"*) exit 0 ;; esac\nprintf "%s\\n" "$@" > "$ARGS_FILE"');
  const env = {
    PATH: `${home}:${process.env.PATH}`, ARGS_FILE: argsFile,
    CODEX_QQ_BOT_TERMUX_TEST_MODE: "1", HTTPS_PROXY: "http://user:secret@proxy.example:8080",
    NODE_EXTRA_CA_CERTS: ca, CODEX_QQ_BOT_NPM_REGISTRY: "https://registry.example/"
  };
  const result = await run("bash", [join(root, "scripts/termux-proot.command"), "status"], env);
  assert.equal(result.status, 0, result.stderr);
  const args = await readFile(argsFile, "utf8");
  assert.match(args, /bash\n\/opt\/codex-qq-bot\/一键部署.command\nstatus/);
  assert.match(args, /HTTPS_PROXY=http:\/\/user:secret@proxy.example:8080/);
  assert.match(args, /NODE_EXTRA_CA_CERTS=\/tmp\/codex-qq-bot-NODE_EXTRA_CA_CERTS.pem/);
  assert.ok(args.includes(`${ca}:/tmp/codex-qq-bot-NODE_EXTRA_CA_CERTS.pem`));
  const dry = await run("bash", [join(root, "scripts/termux-proot.command"), "--dry-run"], env);
  assert.equal(dry.status, 0, dry.stderr);
  assert.doesNotMatch(dry.stdout + dry.stderr, /secret/);
});

test("launcher stops immediately when bootstrap fails", async (t) => {
  const home = await workspace(t);
  await mkdir(join(home, "scripts"));
  await writeFile(join(home, "一键部署.command"), await readFile(join(root, "一键部署.command")));
  await executable(join(home, "scripts/bootstrap-environment.sh"), "exit 42");
  await executable(join(home, "scripts/ncc.command"), 'touch "$HOME/should-not-run"');
  const result = await run("bash", [join(home, "一键部署.command")], { HOME: home });
  assert.equal(result.status, 42);
  await assert.rejects(access(join(home, "should-not-run")));
});

test("npm overrides stale omission/cache settings but retains registry and trust configuration", async (t) => {
  const home = await workspace(t);
  await executable(join(home, "npm"), 'printf "%s\\n" "$@"; printf "cafile=%s\\n" "$npm_config_cafile"');
  const result = await run("bash", [join(root, "scripts/install-npm.sh"), "install", "--global=false"], {
    HOME: home, PATH: `${home}:${process.env.PATH}`, npm_config_cache: "/unwritable/cache",
    npm_config_omit: "optional", npm_config_cafile: "/custom/trust.pem", CODEX_QQ_BOT_NPM_REGISTRY: "https://registry.example/"
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--include=optional/);
  assert.match(result.stdout, /--include=dev/);
  assert.match(result.stdout, /--cache\n.*codex-qq-bot\/npm/);
  assert.match(result.stdout, /--registry\nhttps:\/\/registry.example\//);
  assert.match(result.stdout, /cafile=\/custom\/trust.pem/);
  assert.doesNotMatch(result.stdout, /strict-ssl=false/);
});

async function nodeFixture(home, working) {
  const dist = join(home, "dist"), packageDir = join(home, "package"), bin = join(home, "tools");
  const name = "node-v22.99.0-linux-arm64.tar.xz";
  await mkdir(join(dist, "latest-v22.x"), { recursive: true });
  await mkdir(join(dist, "v22.99.0"), { recursive: true });
  await executable(join(packageDir, "bin/node"), working ? 'case "$1" in -p) printf "22\\n" ;; --version) printf "v22.99.0\\n" ;; esac' : "exit 77");
  await executable(join(packageDir, "bin/npm"), "printf '10.9.0\\n'");
  const archive = join(dist, "v22.99.0", name);
  const tar = spawnSync("tar", ["-cJf", archive, "-C", home, "package"], { encoding: "utf8" });
  assert.equal(tar.status, 0, tar.stderr);
  const sha = createHash("sha256").update(await readFile(archive)).digest("hex");
  await writeFile(join(dist, "latest-v22.x/SHASUMS256.txt"), `${sha}  ${name}\n`);
  for (const tool of ["git", "jq", "zsh", "screen", "pgrep", "codex"]) await executable(join(bin, tool), "exit 0");
  return {
    HOME: home, PATH: `${bin}:${process.env.PATH}`, CODEX_QQ_BOT_USER_PREFIX: join(home, "prefix"),
    CODEX_QQ_BOT_MANAGED_NODE_HOME: join(home, "custom/node"), CODEX_QQ_BOT_BOOTSTRAP_CACHE_DIR: join(home, "cache"),
    CODEX_QQ_BOT_BOOTSTRAP_PLATFORM: "termux-proot", CODEX_QQ_BOT_BOOTSTRAP_ARCH: "arm64",
    CODEX_QQ_BOT_BOOTSTRAP_NODE_STRATEGY: "official-archive", CODEX_QQ_BOT_BOOTSTRAP_PACKAGE_MANAGER: "none",
    CODEX_QQ_BOT_BOOTSTRAP_FORCE_NODE_INSTALL: "1", CODEX_QQ_BOT_NODE_DIST_URL: `file://${dist}`,
    CODEX_QQ_BOT_INSTALL_NAPCAT: "skip", CODEX_QQ_BOT_DOWNLOAD_ATTEMPTS: "1"
  };
}

test("a Node archive that cannot execute leaves the previous runtime intact", async (t) => {
  const home = await workspace(t);
  const env = await nodeFixture(home, false);
  await executable(join(env.CODEX_QQ_BOT_MANAGED_NODE_HOME, "bin/node"), "printf 'old runtime\\n'");
  const result = await run("bash", [join(root, "scripts/bootstrap-environment.sh"), "--all"], env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /旧版本未改动/);
  assert.match(await readFile(join(env.CODEX_QQ_BOT_MANAGED_NODE_HOME, "bin/node"), "utf8"), /old runtime/);
});

test("managed Node uses immutable version URLs, custom paths and cached manifests offline", async (t) => {
  const home = await workspace(t);
  const env = await nodeFixture(home, true);
  await executable(join(env.CODEX_QQ_BOT_MANAGED_NODE_HOME, "bin/node"), "printf 'old runtime\\n'");
  const first = await run("bash", [join(root, "scripts/bootstrap-environment.sh"), "--all"], env);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stdout, /已安装隔离的 Node.js/);
  assert.ok((await readdir(join(home, "custom"))).some((name) => name.endsWith(".previous")));
  // Keep the manifest/verified archive cache, simulate an unavailable distribution server.
  await rm(join(home, "dist"), { recursive: true });
  const second = await run("bash", [join(root, "scripts/bootstrap-environment.sh"), "--all"], env);
  assert.equal(second.status, 0, second.stderr);
  assert.match(second.stderr, /复用同一安装源的已验证清单/);
});

test("real npm restores optional and development dependencies despite a stale project npmrc", async (t) => {
  const home = await workspace(t);
  const project = join(home, "project");
  await mkdir(project);
  for (const name of ["optional-fixture", "dev-fixture"]) {
    await mkdir(join(home, name));
    await writeFile(join(home, name, "package.json"), JSON.stringify({ name, version: "1.0.0" }));
  }
  await writeFile(join(project, "package.json"), JSON.stringify({
    name: "npm-recovery", version: "1.0.0",
    optionalDependencies: { "optional-fixture": "file:../optional-fixture" },
    devDependencies: { "dev-fixture": "file:../dev-fixture" }
  }));
  const npmrc = 'omit[]=optional\nomit[]=dev\ncache=/unwritable-cache\nignore-scripts=true\nstrict-ssl=true\n';
  await writeFile(join(project, ".npmrc"), npmrc);
  const result = await run("bash", [join(root, "scripts/install-npm.sh"), "install", "--offline", "--global=false", "--no-package-lock"], {
    HOME: home, CODEX_QQ_BOT_NPM_CACHE: join(home, "cache"), NODE_ENV: "production"
  }, { cwd: project });
  assert.equal(result.status, 0, result.stderr);
  await access(join(project, "node_modules/optional-fixture/package.json"));
  await access(join(project, "node_modules/dev-fixture/package.json"));
  assert.equal(await readFile(join(project, ".npmrc"), "utf8"), npmrc);
  await assert.rejects(access(join(project, "package-lock.json")));
});

test("OCI and legacy proot-distro interfaces both preserve the requested guest name", async (t) => {
  const home = await workspace(t);
  const calls = join(home, "calls");
  await executable(join(home, "proot-distro"), `
if [ "$1 $2" = 'install --help' ]; then
  [ "$OCI" != 1 ] || printf '%s\\n' '--name NAME'
  exit 0
fi
printf '%s\\n' "$*" >> "$CALLS"
if [ "$1" = install ]; then touch "$GUEST_READY"; exit 0; fi
if [ "$1" = login ]; then test -f "$GUEST_READY"; exit; fi
exit 1`);
  for (const oci of ["0", "1"]) {
    const env = {
      CODEX_QQ_BOT_TERMUX_TEST_MODE: "1", CODEX_QQ_BOT_TERMUX_DISTRO: "test-guest",
      CODEX_QQ_BOT_TERMUX_IMAGE: oci === "1" ? "debian:bookworm" : "",
      PATH: `${home}:${process.env.PATH}`, OCI: oci, CALLS: calls, GUEST_READY: join(home, `ready-${oci}`)
    };
    const result = await run("bash", [join(root, "scripts/termux-proot.command")], env);
    assert.equal(result.status, 0, result.stderr);
  }
  const logged = await readFile(calls, "utf8");
  assert.match(logged, /install test-guest\n/);
  assert.match(logged, /install --name test-guest debian:bookworm\n/);
});

test("Termux package recovery uses backend-specific arguments and rechecks apt mirrors", async (t) => {
  const home = await workspace(t);
  const calls = join(home, "pkg-calls");
  await executable(join(home, "pkg"), 'printf "%s\\n" "$*" >> "$CALLS"\nif [ "$TERMUX_APP_PACKAGE_MANAGER" = apt ] && [ "$1" != --check-mirror ]; then exit 1; fi');
  for (const backend of ["apt", "pacman"]) {
    const result = await run("bash", ["-c", 'set -Eeuo pipefail; source "$1"; ncc_termux_install proot-distro', "test", installer], {
      PATH: `${home}:${process.env.PATH}`, TERMUX_APP_PACKAGE_MANAGER: backend, CALLS: calls
    });
    assert.equal(result.status, 0, result.stderr);
  }
  assert.deepEqual((await readFile(calls, "utf8")).trim().split("\n"), [
    "install -y -o Acquire::Retries=3 proot-distro",
    "--check-mirror install -y -o Acquire::Retries=3 proot-distro",
    "install --noconfirm proot-distro"
  ]);
});

test("source install falls back to codeload and refuses unrelated cached metadata", async (t) => {
  const home = await workspace(t);
  const fixture = join(home, "source");
  await mkdir(join(fixture, "scripts"), { recursive: true });
  await writeFile(join(fixture, "package.json"), '{"name":"codex-qq-bot"}\n');
  for (const script of ["ncc.command", "deploy.command"]) await executable(join(fixture, "scripts", script), "exit 0");
  const archive = join(home, "source.zip");
  const zip = spawnSync("zip", ["-qr", archive, "source"], { cwd: home, encoding: "utf8" });
  assert.equal(zip.status, 0, zip.stderr);
  const body = await readFile(archive);
  const requests = [];
  const revision = "a".repeat(40);
  const url = await http(t, (req, res) => {
    requests.push(req.url);
    if (req.url === "/repository") res.end('{"default_branch":"main"}');
    else if (req.url === "/repository/commits/main") res.end(JSON.stringify({ sha: revision }));
    else if (req.url === "/archive") res.end(body);
    else { res.writeHead(503); res.end(); }
  });
  const curl = spawnSync("bash", ["-c", "command -v curl"], { encoding: "utf8" }).stdout.trim();
  await executable(join(home, "tools/curl"), `args=()
for arg in "$@"; do
 case "$arg" in
  https://github.com/*/archive/*) arg="$FIXTURE_URL/unavailable" ;;
  https://codeload.github.com/*) arg="$FIXTURE_URL/archive" ;;
 esac
 args+=("$arg")
done
exec "$REAL_CURL" "\${args[@]}"`);
  await executable(join(home, "tools/node"), "exit 88");
  const env = {
    ...cleanNetwork, PATH: `${home}/tools:${process.env.PATH}`, REAL_CURL: curl, FIXTURE_URL: url,
    CODEX_QQ_BOT_INSTALL_DIR: join(home, "installed"), CODEX_QQ_BOT_INSTALL_STATE_DIR: join(home, "cache"),
    CODEX_QQ_BOT_NCC_BIN: join(home, "ncc"), CODEX_QQ_BOT_REPOSITORY_API_URL: `${url}/repository`,
    CODEX_QQ_BOT_DOWNLOAD_ATTEMPTS: "1"
  };
  const first = await run("bash", [installer, "--download-only"], env);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stderr, /codeload/);
  await access(join(home, "installed/package.json"));
  assert.ok(requests.includes("/archive"));
  const second = await run("bash", [installer, "--download-only"], { ...env, CODEX_QQ_BOT_REPOSITORY_API_URL: `${url}/another-repository` });
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /无法读取最新提交/);
  assert.doesNotMatch(second.stderr, /将使用已缓存/);
  await access(join(home, "installed/package.json"));
});
