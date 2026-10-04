# One-Click Installation and Environment Plans

English | [简体中文](INSTALLATION_CN.md)

This is the single reference for installer behavior, upgrades, and interrupted-run recovery. See the [configuration reference](CONFIGURATION.md) for Hub settings, [operations](OPERATIONS.md) for post-install startup and troubleshooting, and [Deploy with Codex](DEPLOY_WITH_CODEX.md) when Codex should operate the deployment.

## Choose an entry

| Current condition | Recommended command | Default result |
| --- | --- | --- |
| Node.js/npm is available | `npx -y "codex-qq-bot@$(npm view codex-qq-bot@latest version --prefer-online)"` | Download/upgrade source, then complete environment, Codex, npm dependencies, and `verify` |
| pnpm is available | `pnpm dlx "codex-qq-bot@$(npm view codex-qq-bot@latest version --prefer-online)"` | Same as the npm entry |
| Node.js is absent | Download completely, then run the command below | Continue through environment preparation; use `--download-only` for source only |
| Source is already present | `./一键部署.command` | Detect the environment and enter first-run setup or the daily menu |
| A prior run was interrupted | Repeat the same command | Validate completed stages and continue at the first unfinished stage |

The npm/pnpm command resolves the exact online registry version before execution, avoiding a stale `_npx` executable cache. Add `--download-only` to the npm/pnpm entry when only source is wanted. Run on Windows from inside WSL.

Download the entire bootstrap before executing it (including dependency preparation by default):

```bash
installer="$(mktemp "${TMPDIR:-$HOME}/codex-qq-bot-install.XXXXXX")" &&
curl --disable -fSL --retry 3 --connect-timeout 15 --max-time 180 \
  https://raw.githubusercontent.com/gl813788-byte/codex-qq-bot/main/install.sh -o "$installer" &&
bash "$installer" --prepare
```

## Installation stages

The installer writes a completion marker only after each validated stage succeeds:

1. Resolve the default branch and exact commit.
2. Resume, validate, and extract the source ZIP.
3. Switch source safely while retaining data, runtime state, local configuration, and a complete upgrade backup.
4. Detect platform, distribution, architecture, libc, package manager, and privilege mode.
5. Install or reuse PRoot on native Termux; use the current system everywhere else.
6. Install base tools, Node.js 20+, and the official Codex CLI, then actually run `codex --version`.
7. Install project npm dependencies; skip only when the dependency fingerprint and `npm ls` both validate.
8. Run `npm run verify`; only then mark environment preparation complete.
9. Let `ncc` continue Codex login, OneBot, owner QQ, and group allowlist setup.

Source, Node, and npm downloads use their respective caches. Damaged downloads are quarantined, and extraction always starts from a clean temporary directory. Interrupting verification does not invalidate dependencies, so the next run repeats verification only. Git worktrees, local changes, unrelated non-empty directories, and a different global `ncc` are not overwritten.

## Environment decision table

| Environment | Node/Codex plan | System-package privilege | QQ/OneBot plan |
| --- | --- | --- | --- |
| macOS x64/arm64 | SHA-256-verified official Node in a user directory; official Codex through npm | Homebrew, without sudo | External compatible OneBot |
| Native glibc Linux x64/arm64 | Official Node in a user directory; official Codex through npm | root, sudo, or doas | apt-get/dnf can install official NapCat Rootless; other distributions use external OneBot |
| musl Linux such as Alpine | Distribution `nodejs`/`npm`; verify Node 20+ after installation | root, sudo, or doas | External compatible OneBot |
| Windows WSL | Install and run inside the WSL distribution | Distribution privilege model | External OneBot on Windows or another host |
| Linux container | Install and run inside the container | Container privilege model | OneBot outside the container |
| Native Termux | Android host prepares only `proot-distro`; Node, Codex, and the Hub run in managed Debian | Must be the normal Termux app user; do not use `su` | External OneBot on the phone or another host |
| Existing Termux PRoot Ubuntu/Debian | Use the current guest directly; never nest PRoot | uid 0 is treated as virtual root | External compatible OneBot |
| Unmanaged Android shell / real Android root | Stop and direct the user to normal Termux | No automatic elevation | Do not install |

Only native, non-WSL, non-container, non-Termux/PRoot, glibc, x64/arm64 apt-get/dnf Linux automatically invokes NapCat's official Rootless installer. With `CODEX_QQ_BOT_INSTALL_NAPCAT=required`, any other environment fails early; `skip` always selects an external OneBot.

An unprivileged Linux user without sudo/doas can reuse existing dependencies. If a system package is missing, the installer reports the exact blocker instead of bypassing permissions. uid 0 inside PRoot is virtual root and is not the same as real Android root.

## Termux and existing virtual environments

On native Termux, global `ncc` points to `scripts/termux-proot.command`. That entry:

1. Confirms the shell is not Android `su`/root.
2. Installs or reuses `proot-distro` through `pkg`.
3. Installs or reuses `CODEX_QQ_BOT_TERMUX_DISTRO`, defaulting to `debian`.
4. Binds the real Termux project directory to `/opt/codex-qq-bot` in the guest.
5. Installs Node, Codex, project dependencies, and runs verification inside the guest.
6. Enters the same guest and project directory on every later `ncc`.

When already inside a manually entered Ubuntu/Debian PRoot, the detector reads the guest `/etc/os-release` and deploys directly without creating another PRoot layer. Do not run `su` first in native Termux; PRoot provides the isolated virtual root that the guest needs.

OpenAI's current Codex CLI requirements list macOS, Ubuntu/Debian, and WSL2, not native Android/Termux. The Termux plan therefore uses Debian PRoot and actually starts the official CLI during preparation. If a device kernel remains incompatible, installation stops while retaining completed stages; it never silently substitutes an unofficial Codex fork. See the [Codex CLI installation requirements](https://github.com/openai/codex/blob/main/docs/install.md) and [Termux PRoot Distro](https://github.com/termux/proot-distro).

## Inspect, resume, and troubleshoot

Inspect without changing the host:

```bash
bash scripts/install-environment.sh --report
bash scripts/bootstrap-environment.sh --check
CODEX_QQ_BOT_BOOTSTRAP_DRY_RUN=1 bash scripts/bootstrap-environment.sh --all
```

Common installer options:

| Option | Behavior |
| --- | --- |
| `--check` | Resolve remote source metadata without downloading or changing the project |
| `--prepare` | Continue from source through environment, dependencies, and `verify` |
| `--download-only` | Download/upgrade source only |
| `--install-dir <path>` | Select the project directory |
| `--archive <ZIP>` | Install from a local ZIP |
| `--launch` | Enter `ncc` after installation |

Source checkpoints and backups default to `<install-directory>.install-cache`; Node/NapCat caches default to `~/.cache/codex-qq-bot/bootstrap`; Termux PRoot state defaults to `~/.local/state/codex-qq-bot`. These are installer state, while `data/`, `runtime/`, and `config/local.env` remain project runtime data.

After a failure, first repeat the same command. If it still fails:

- Use `install-environment.sh --report` to verify native Termux, an existing PRoot, WSL, or a container was not misclassified.
- Identify whether the failure is in source, PRoot, Node/Codex, npm dependency, or `verify`.
- On Termux, run `proot-distro login <distribution>` to confirm the guest starts; do not automatically delete an existing guest.
- Codex must both exist and pass `codex --version`.
- Validate OneBot through `/get_login_info`; an open port does not prove QQ is connected.

See [installation environment variables](CONFIGURATION.md#one-click-deployment-environment) for the complete variable table.

## Network, configuration, and runtime recovery

- curl downloads have connection, total-duration, and low-speed timeouts, with up to three attempts; connection failures retry using IPv4. Ignore conflicting `.curlrc` output options while preserving environment proxies, CAs, and TLS verification. The wget fallback uses connection/read timeouts and bounded retries.
- When the GitHub API fails and Git is available, resolve the exact commit with `git ls-remote` against the same repository; the default ZIP endpoint falls back to official codeload. Metadata caches are scoped by repository/API/branch, and offline runs only reuse valid metadata from the same source. A custom API enables Git fallback only with an explicit `CODEX_QQ_BOT_GIT_URL`.
- Fragments record their source, so switching endpoints never appends unrelated bytes. Servers without range support receive a fresh download. Changed local ZIP contents are rechecked even when the filename is unchanged. Without a publisher checksum, ZIP structure checks and local SHA-256 detect corruption; they are not publisher signature verification.
- Node manifests download to a temporary file and replace the cache only after format validation. Archives use the immutable version URL and SHA-256 from the manifest. Staged Node and npm must actually run before replacing the installed runtime; the old runtime stays in an adjacent `.previous` directory for rollback. Incompatible binaries leave the old version intact.
- npm uses an isolated user cache, fetch retries, and explicit development/optional dependencies to recover from stale production or `omit=optional` settings that omit Codex platform packages. Registry authentication, proxies, and custom CAs remain in effect. Dependency fingerprints include OS, CPU architecture, and Node ABI to revalidate after host/container changes.
- apt/pkg enable download retries; apt waits for package-manager locks and runs noninteractively. Missing system CA packages are installed with base tools. Certificate verification is never disabled to work around network failures.

Explicitly configure endpoints and timeouts for your network (see the configuration reference for all variables):

```bash
export CODEX_QQ_BOT_NPM_REGISTRY=https://registry.npmjs.org
export CODEX_QQ_BOT_NODE_DIST_URL=https://nodejs.org/dist
export CODEX_QQ_BOT_CONNECT_TIMEOUT=15
export CODEX_QQ_BOT_DOWNLOAD_TIMEOUT=600
bash scripts/prepare-environment.sh
```

Termux forwards standard proxy variables, these download options, and npm registry settings into the guest, and binds certificate files referenced by `SSL_CERT_FILE`, `CURL_CA_BUNDLE`, `NODE_EXTRA_CA_CERTS`, `REQUESTS_CA_BUNDLE`, and `npm_config_cafile`. Dry-run output omits proxy credentials. The host's global npm prefix, Node paths, and complete `.npmrc` are not copied into the guest; configure private-registry authentication inside the guest.

`CODEX_QQ_BOT_TERMUX_DISTRO` names the container to reuse. New OCI-based proot-distro accepts `CODEX_QQ_BOT_TERMUX_IMAGE` for a Bash-equipped Debian/Ubuntu image or local rootfs archive. Older versions keep distro aliases and request an upgrade when a custom image is specified. Existing containers are reused first; an unbootable guest is never automatically deleted. Keep the project in Termux's private HOME: shared storage/SD cards lack the execution permissions and symlinks required by the installer.

Supported official CLI userland architectures are x64/arm64. Retries cannot guarantee installation on 32-bit ARM/x86, other CPUs, obsolete system libraries, kernels that block PRoot calls, or completely unreachable download sources. The installer reports the blocker and retains completed stages. A downloaded source ZIP can be installed with `--archive`; full offline preparation still requires existing system packages, Node/Codex, and npm caches.

Termux `pkg` distinguishes apt and pacman backends. An apt failure retries once with `pkg --check-mirror` against the configured mirror policy; pacman receives its own noninteractive flag. This follows the [official Termux pkg interface](https://github.com/termux/termux-tools/blob/master/scripts/pkg.in) without replacing the user's mirror selection policy.
