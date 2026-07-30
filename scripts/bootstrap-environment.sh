#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENVIRONMENT_DETECTOR="$PROJECT_DIR/scripts/install-environment.sh"
MODE="all"
DRY_RUN="${CODEX_QQ_BOT_BOOTSTRAP_DRY_RUN:-0}"
FORCE_MISSING=" ${CODEX_QQ_BOT_BOOTSTRAP_FORCE_MISSING:-} "
FORCE_NODE_INSTALL="${CODEX_QQ_BOT_BOOTSTRAP_FORCE_NODE_INSTALL:-0}"
FORCE_NAPCAT_INSTALL="${CODEX_QQ_BOT_BOOTSTRAP_FORCE_NAPCAT_INSTALL:-0}"
USER_PREFIX="${CODEX_QQ_BOT_USER_PREFIX:-${HOME:?HOME 未设置}/.local}"
MANAGED_NODE_HOME="${CODEX_QQ_BOT_MANAGED_NODE_HOME:-$USER_PREFIX/share/codex-qq-bot/node}"
CACHE_DIR="${CODEX_QQ_BOT_BOOTSTRAP_CACHE_DIR:-${XDG_CACHE_HOME:-$HOME/.cache}/codex-qq-bot/bootstrap}"
NAPCAT_HOME="${CODEX_QQ_BOT_NAPCAT_HOME:-$HOME/Napcat}"
NAPCAT_MODE="${CODEX_QQ_BOT_INSTALL_NAPCAT:-auto}"
NODE_MAJOR="${CODEX_QQ_BOT_NODE_MAJOR:-22}"
NAPCAT_INSTALLER_URL="${CODEX_QQ_BOT_NAPCAT_INSTALLER_URL:-https://raw.githubusercontent.com/NapNeko/NapCat-Installer/main/script/install.sh}"
TERMUX_PROOT_SCRIPT="$PROJECT_DIR/scripts/termux-proot.command"

[ -f "$ENVIRONMENT_DETECTOR" ] || {
  printf '[环境自举] 错误：缺少环境探测器：%s\n' "$ENVIRONMENT_DETECTOR" >&2
  exit 1
}
# shellcheck source=install-environment.sh
source "$ENVIRONMENT_DETECTOR"

export PATH="$MANAGED_NODE_HOME/bin:$USER_PREFIX/bin:$PATH"

log() {
  printf '[环境自举] %s\n' "$*"
}

warn() {
  printf '[环境自举] 提示：%s\n' "$*" >&2
}

die() {
  printf '[环境自举] 错误：%s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Codex QQ Bot 环境自举器

用法：
  bash scripts/bootstrap-environment.sh [--all|--base-only|--check|--dry-run]

  --all        按系统/虚拟环境补齐基础工具、Node.js 20+、Codex CLI 和 QQ 运行依赖（默认）
  --base-only  只补齐进入 ncc 所需的基础工具
  --check      报告系统、发行版、架构、root/虚拟 root 和安装策略，不安装
  --dry-run    打印当前平台的完整安装计划，不修改系统

环境变量：
  CODEX_QQ_BOT_INSTALL_NAPCAT=auto|required|skip
  CODEX_QQ_BOT_NODE_MAJOR=22
  CODEX_QQ_BOT_BOOTSTRAP_CACHE_DIR=<目录>
  CODEX_QQ_BOT_TERMUX_DISTRO=debian
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --all) MODE="all" ;;
    --base-only) MODE="base" ;;
    --check) MODE="check" ;;
    --dry-run) DRY_RUN="1" ;;
    -h|--help) usage; exit 0 ;;
    *) die "不认识的参数：$1" ;;
  esac
  shift
done

has_command() {
  local command_name="$1"
  case "$FORCE_MISSING" in
    *" $command_name "*) return 1 ;;
  esac
  command -v "$command_name" >/dev/null 2>&1
}

run_privileged() {
  if [ "$(id -u)" -eq 0 ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  elif command -v doas >/dev/null 2>&1; then
    doas "$@"
  else
    die "当前是无 root、无 sudo/doas 的普通用户，无法安装缺失的系统包：$*"
  fi
}

install_packages() {
  [ "$#" -gt 0 ] || return 0
  local manager="$1"
  shift
  if [ "$DRY_RUN" = "1" ]; then
    log "计划通过 $manager 安装：$*"
    return 0
  fi
  case "$manager" in
    brew) brew install "$@" ;;
    pkg) pkg install -y "$@" ;;
    apt-get)
      run_privileged apt-get update
      run_privileged apt-get install -y "$@"
      ;;
    dnf) run_privileged dnf install -y "$@" ;;
    yum) run_privileged yum install -y "$@" ;;
    apk) run_privileged apk add --no-cache "$@" ;;
    pacman) run_privileged pacman -Sy --needed --noconfirm "$@" ;;
    zypper) run_privileged zypper --non-interactive install -y "$@" ;;
    *) die "没有检测到受支持的包管理器，无法补齐：$*" ;;
  esac
}

append_package_for_command() {
  local manager="$1"
  local command_name="$2"
  local package_name="$3"
  has_command "$command_name" || MISSING_PACKAGES+=("$package_name")
}

ensure_base_tools() {
  local manager="$1"
  MISSING_PACKAGES=()
  append_package_for_command "$manager" curl curl
  append_package_for_command "$manager" git git
  append_package_for_command "$manager" unzip unzip
  append_package_for_command "$manager" zip zip
  append_package_for_command "$manager" jq jq
  append_package_for_command "$manager" zsh zsh
  append_package_for_command "$manager" screen screen
  append_package_for_command "$manager" tar tar
  case "$manager" in
    pkg)
      append_package_for_command "$manager" xz xz-utils
      append_package_for_command "$manager" pgrep procps
      has_command sha256sum || MISSING_PACKAGES+=(coreutils)
      ;;
    apt-get)
      append_package_for_command "$manager" xz xz-utils
      append_package_for_command "$manager" pgrep procps
      has_command sha256sum || MISSING_PACKAGES+=(coreutils)
      ;;
    dnf|yum)
      append_package_for_command "$manager" xz xz
      append_package_for_command "$manager" pgrep procps-ng
      has_command sha256sum || MISSING_PACKAGES+=(coreutils)
      ;;
    pacman)
      append_package_for_command "$manager" xz xz
      append_package_for_command "$manager" pgrep procps-ng
      has_command sha256sum || MISSING_PACKAGES+=(coreutils)
      ;;
    apk)
      append_package_for_command "$manager" xz xz
      append_package_for_command "$manager" pgrep procps
      has_command sha256sum || MISSING_PACKAGES+=(coreutils)
      ;;
    zypper)
      append_package_for_command "$manager" xz xz
      append_package_for_command "$manager" pgrep procps
      has_command sha256sum || MISSING_PACKAGES+=(coreutils)
      ;;
  esac
  if [ "${#MISSING_PACKAGES[@]}" -gt 0 ]; then
    log "检测到缺失的基础工具，开始自动补齐。"
    install_packages "$manager" "${MISSING_PACKAGES[@]}"
  else
    log "基础下载、解压和终端工具已齐全。"
  fi
}

node_is_usable() {
  [ "$FORCE_NODE_INSTALL" != "1" ] || return 1
  has_command node && has_command npm && [ "$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || printf '0')" -ge 20 ]
}

install_node_from_packages() {
  local manager="$1"
  if [ "$DRY_RUN" = "1" ]; then
    case "$manager" in
      pkg) log "计划通过 Termux pkg 安装 nodejs-lts（不会使用不兼容 Android/Bionic 的 Linux 压缩包）。" ;;
      apk) log "计划通过 apk 安装 nodejs 与 npm（不会使用面向 glibc 的 Linux 压缩包）。" ;;
      *) log "计划通过 $manager 安装 Node.js 与 npm。" ;;
    esac
    return
  fi
  case "$manager" in
    pkg)
      if ! install_packages pkg nodejs-lts; then
        warn "nodejs-lts 不可用，改试 Termux nodejs。"
        install_packages pkg nodejs
      fi
      ;;
    apk) install_packages apk nodejs npm ;;
    apt-get) install_packages apt-get nodejs npm ;;
    dnf|yum) install_packages "$manager" nodejs npm ;;
    pacman) install_packages pacman nodejs npm ;;
    zypper) install_packages zypper nodejs npm ;;
    *) die "当前平台必须通过系统包安装 Node.js，但包管理器 $manager 不受支持。" ;;
  esac
  FORCE_NODE_INSTALL="0"
  node_is_usable || die "系统包已安装，但 Node.js/npm 仍不可用或版本低于 20。请启用包含 Node.js 20+ 的软件源后重试。"
  log "已通过 $manager 准备 Node.js $(node --version)。"
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

install_managed_node() {
  local os="$1"
  local arch="$2"
  local platform=""
  case "$os:$arch" in
    linux:x64) platform="linux-x64" ;;
    linux:arm64) platform="linux-arm64" ;;
    macos:x64) platform="darwin-x64" ;;
    macos:arm64) platform="darwin-arm64" ;;
    *) die "当前平台没有可用的 Node.js 官方二进制：$os/$arch" ;;
  esac

  local dist_url="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  if [ "$DRY_RUN" = "1" ]; then
    log "计划从 Node.js 官方发行页安装 v${NODE_MAJOR}.x（$platform），并校验 SHA-256。"
    return 0
  fi

  mkdir -p "$CACHE_DIR" "$USER_PREFIX/share/codex-qq-bot"
  local sums_file="$CACHE_DIR/node-v${NODE_MAJOR}-SHASUMS256.txt"
  curl -fL --retry 3 "$dist_url/SHASUMS256.txt" -o "$sums_file"
  local archive_name=""
  archive_name="$(awk -v suffix="-$platform.tar.xz" '$2 ~ suffix "$" { print $2; exit }' "$sums_file")"
  [ -n "$archive_name" ] || die "Node.js 校验清单里没有 $platform 安装包。"
  local expected=""
  expected="$(awk -v name="$archive_name" '$2 == name { print $1; exit }' "$sums_file")"
  local archive_file="$CACHE_DIR/$archive_name"
  local partial_file="${archive_file}.part"
  if [ ! -f "$archive_file" ] || [ "$(sha256_file "$archive_file" 2>/dev/null || true)" != "$expected" ]; then
    if [ -f "$partial_file" ]; then
      if [ "$(sha256_file "$partial_file" 2>/dev/null || true)" = "$expected" ]; then
        log "Node.js 下载片段已经完整，直接复用。"
      else
        log "发现未完成的 Node.js 下载，正在从断点续传。"
        if ! curl -fL --retry 3 --continue-at - "$dist_url/$archive_name" -o "$partial_file"; then
          if [ "$(sha256_file "$partial_file" 2>/dev/null || true)" = "$expected" ]; then
            log "服务端结束了续传请求，但本地文件校验完整，继续使用。"
          else
            warn "Node.js 断点续传失败，隔离旧片段并改为一次完整重下。"
            mv "$partial_file" "${partial_file}.invalid-$(date +%Y%m%d%H%M%S)-$$"
            curl -fL --retry 3 "$dist_url/$archive_name" -o "$partial_file"
          fi
        fi
      fi
    else
      curl -fL --retry 3 "$dist_url/$archive_name" -o "$partial_file"
    fi
    if [ "$(sha256_file "$partial_file" 2>/dev/null || true)" != "$expected" ]; then
      warn "续传结果摘要不匹配，隔离片段后进行完整重下。"
      mv "$partial_file" "${partial_file}.invalid-$(date +%Y%m%d%H%M%S)-$$"
      curl -fL --retry 3 "$dist_url/$archive_name" -o "$partial_file"
    fi
    [ "$(sha256_file "$partial_file" 2>/dev/null || true)" = "$expected" ] ||
      die "Node.js 完整重下后 SHA-256 仍不匹配，已保留片段供排查。"
    mv "$partial_file" "$archive_file"
  fi
  [ "$(sha256_file "$archive_file")" = "$expected" ] || die "Node.js 安装包 SHA-256 校验失败。"

  local stage="$USER_PREFIX/share/codex-qq-bot/node.new.$$"
  local previous="$USER_PREFIX/share/codex-qq-bot/node.previous.$$"
  rm -rf "$stage" "$previous"
  mkdir -p "$stage"
  tar -xJf "$archive_file" --strip-components=1 -C "$stage"
  if [ -e "$MANAGED_NODE_HOME" ]; then
    mv "$MANAGED_NODE_HOME" "$previous"
  fi
  mv "$stage" "$MANAGED_NODE_HOME"
  rm -rf "$previous"
  export PATH="$MANAGED_NODE_HOME/bin:$USER_PREFIX/bin:$PATH"
  hash -r
  FORCE_NODE_INSTALL="0"
  node_is_usable || die "Node.js 安装完成后仍不可用。"
  log "已安装隔离的 Node.js $(node --version)：$MANAGED_NODE_HOME"
}

ensure_node() {
  if node_is_usable; then
    log "Node.js 与 npm 已满足要求：$(node --version)"
    return
  fi
  local strategy="$3"
  local manager="$4"
  if [ "$strategy" = "official-archive" ]; then
    log "没有可用的 Node.js 20+，开始安装项目自管版本。"
    install_managed_node "$1" "$2"
  else
    log "没有可用的 Node.js 20+，按当前平台使用系统包。"
    install_node_from_packages "$manager"
  fi
}

codex_is_usable() {
  has_command codex && codex --version >/dev/null 2>&1
}

ensure_codex() {
  if codex_is_usable; then
    log "Codex CLI 已安装：$(command -v codex)"
    return
  fi
  if has_command codex; then
    warn "现有 Codex CLI 无法正常启动，将在用户隔离目录中重新安装。"
  fi
  if [ "$DRY_RUN" = "1" ]; then
    log "计划用 npm 安装 Codex CLI 到 $USER_PREFIX。"
    return
  fi
  npm install --global --prefix "$USER_PREFIX" @openai/codex
  export PATH="$USER_PREFIX/bin:$PATH"
  hash -r
  codex_is_usable || die "Codex CLI 安装后仍无法启动。当前环境可能不在官方支持范围；原生 Termux 请使用 ncc 自动管理的 PRoot Debian。"
  log "Codex CLI 已安装：$(command -v codex)"
}

ensure_termux_proot_host() {
  if has_command proot-distro; then
    log "Termux PRoot 管理器已安装：$(command -v proot-distro)"
    return
  fi
  if [ "$DRY_RUN" = "1" ]; then
    log "计划通过 pkg 安装 proot-distro，并在受管 Debian 中安装 Codex 与 Hub 依赖。"
    return
  fi
  install_packages pkg proot-distro
  has_command proot-distro || die "proot-distro 安装后仍不可用。"
}

napcat_is_installed() {
  [ "$FORCE_NAPCAT_INSTALL" != "1" ] || return 1
  [ -x "$NAPCAT_HOME/opt/QQ/qq" ] && [ -d "$NAPCAT_HOME/opt/QQ/resources/app/app_launcher/napcat" ]
}

ensure_napcat() {
  local platform="$1"
  local manager="$2"
  local policy="$3"
  case "$NAPCAT_MODE" in
    skip)
      log "已按配置跳过 NapCat；将复用用户提供的 OneBot。"
      return
      ;;
    auto|required) ;;
    *) die "CODEX_QQ_BOT_INSTALL_NAPCAT 只能是 auto、required 或 skip。" ;;
  esac
  if napcat_is_installed; then
    log "已找到 NapCat：$NAPCAT_HOME"
    return
  fi
  if [ "$policy" != "official-rootless" ]; then
    if [ "$NAPCAT_MODE" = "required" ]; then
      die "当前平台不适合自动安装桌面 LinuxQQ/NapCat：$platform/$manager；请使用兼容的外部 OneBot。"
    fi
    case "$platform" in
      termux|termux-proot)
        warn "Android/Termux 不自动安装桌面 LinuxQQ/NapCat；Hub 将使用手机内或其他设备提供的兼容 OneBot。"
        ;;
      wsl)
        warn "WSL 不自动安装桌面 LinuxQQ/NapCat；请在 Windows 或独立 Linux 环境运行 OneBot。"
        ;;
      container)
        warn "容器环境不自动安装桌面 LinuxQQ/NapCat；请把 Hub 连接到容器外的 OneBot。"
        ;;
      *)
        warn "当前平台不在 NapCat 官方 Shell 自动安装范围内；Hub 依赖已补齐，请配置兼容 OneBot。"
        ;;
    esac
    return
  fi
  if [ "$DRY_RUN" = "1" ]; then
    log "计划下载 NapCat 官方安装器并以 Rootless Shell 模式安装 LinuxQQ、NapCat 和运行库。"
    return
  fi

  mkdir -p "$CACHE_DIR"
  local installer="$CACHE_DIR/napcat-installer.sh"
  curl -fL --retry 3 "$NAPCAT_INSTALLER_URL" -o "${installer}.part"
  mv "${installer}.part" "$installer"
  bash -n "$installer" || die "NapCat 官方安装脚本语法检查失败。"
  local work_dir=""
  work_dir="$(mktemp -d "${TMPDIR:-/tmp}/codex-qq-bot-napcat.XXXXXX")"
  (
    cd "$work_dir"
    TERM="${TERM:-xterm}" bash "$installer" --docker n --cli n --proxy 0
  )
  rm -rf "$work_dir"
  FORCE_NAPCAT_INSTALL="0"
  napcat_is_installed || die "NapCat 官方安装器执行完成，但没有找到 $NAPCAT_HOME/opt/QQ/qq。"
  log "NapCat、LinuxQQ 与图形运行依赖已安装：$NAPCAT_HOME"
}

report_environment() {
  ncc_env_report
  printf 'Node.js：%s\n' "$(command -v node >/dev/null 2>&1 && node --version || printf '未安装')"
  printf 'npm：%s\n' "$(command -v npm >/dev/null 2>&1 && npm --version || printf '未安装')"
  printf 'Codex CLI：%s\n' "$(command -v codex 2>/dev/null || printf '未安装')"
  if napcat_is_installed; then
    printf 'NapCat：%s\n' "$NAPCAT_HOME"
  else
    printf 'NapCat：未安装或使用外部 OneBot\n'
  fi
}

PLATFORM_NAME="$(ncc_env_detect_platform)"
OS_NAME="$(ncc_env_detect_kernel_os)"
ARCH_NAME="$(ncc_env_detect_arch)"
DISTRO_ID="$(ncc_env_detect_distro_id)"
DISTRO_VERSION="$(ncc_env_detect_distro_version)"
PACKAGE_MANAGER="$(ncc_env_detect_package_manager)"
LIBC_NAME="$(ncc_env_detect_libc)"
ROOT_MODE="$(ncc_env_detect_root_mode)"
NODE_STRATEGY="$(ncc_env_detect_node_strategy)"
NAPCAT_POLICY="$(ncc_env_napcat_policy "$PLATFORM_NAME" "$PACKAGE_MANAGER" "$LIBC_NAME" "$ARCH_NAME")"

log "检测结果：$(ncc_env_platform_label "$PLATFORM_NAME")，${DISTRO_ID} ${DISTRO_VERSION}，$ARCH_NAME/$LIBC_NAME，权限 $ROOT_MODE，包管理器 $PACKAGE_MANAGER，Node $NODE_STRATEGY，OneBot $NAPCAT_POLICY。"
if [ "$MODE" = "check" ]; then
  report_environment
  exit 0
fi
if [ "$PLATFORM_NAME" = "termux" ] && [ "$ROOT_MODE" = "android-root" ]; then
  die "请退出 Android su/root，回到普通 Termux 用户后重试；后续需要的虚拟 root 由 PRoot 提供。"
fi
if [ "$PLATFORM_NAME" = "termux" ]; then
  ensure_termux_proot_host
  [ "$MODE" = "base" ] && exit 0
  if [ "$DRY_RUN" = "1" ]; then
    log "计划由 ncc 在 PRoot Debian 内继续 Node.js、Codex CLI、npm 依赖和项目验证；原生 Android 层不安装 Linux 二进制。"
    log "计划使用外部 OneBot；不会在 Android/PRoot 中安装桌面 LinuxQQ/NapCat。"
    exit 0
  fi
  [ -x "$TERMUX_PROOT_SCRIPT" ] || die "缺少 Termux PRoot 入口：$TERMUX_PROOT_SCRIPT"
  log "正在切换到受管 PRoot Debian 完成剩余环境准备。"
  bash "$TERMUX_PROOT_SCRIPT" --prepare-only
  exit 0
fi
if [ "$PLATFORM_NAME" = "android" ]; then
  die "检测到未受管的 Android shell。请使用普通用户的 Termux 入口；安装器会自动进入受管 PRoot Linux。"
fi
if [ "$PLATFORM_NAME" = "unknown" ]; then
  die "无法识别当前操作系统，未执行任何系统包安装。"
fi

ensure_base_tools "$PACKAGE_MANAGER"
[ "$MODE" = "base" ] && exit 0
ensure_node "$OS_NAME" "$ARCH_NAME" "$NODE_STRATEGY" "$PACKAGE_MANAGER"
ensure_codex
ensure_napcat "$PLATFORM_NAME" "$PACKAGE_MANAGER" "$NAPCAT_POLICY"
log "全套环境依赖已准备完成。"
