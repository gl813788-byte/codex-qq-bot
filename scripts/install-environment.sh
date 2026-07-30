#!/usr/bin/env bash

# Shared, side-effect-free host detection for the public installer and ncc
# bootstrap. Keep this file sourceable: callers own `set -e` and output policy.

ncc_env_first_os_release_value() {
  local key="$1"
  local file="${2:-/etc/os-release}"
  [ -r "$file" ] || return 0
  sed -n "s/^${key}=//p" "$file" | head -n 1 | sed 's/^"//; s/"$//'
}

ncc_env_detect_arch() {
  if [ -n "${CODEX_QQ_BOT_BOOTSTRAP_ARCH:-}" ]; then
    printf '%s\n' "$CODEX_QQ_BOT_BOOTSTRAP_ARCH"
    return
  fi
  case "$(uname -m 2>/dev/null || true)" in
    x86_64|amd64) printf 'x64\n' ;;
    arm64|aarch64) printf 'arm64\n' ;;
    armv7l|armv8l) printf 'armv7\n' ;;
    i386|i486|i586|i686) printf 'x86\n' ;;
    riscv64) printf 'riscv64\n' ;;
    *) printf 'unknown\n' ;;
  esac
}

ncc_env_is_native_termux() {
  case "${CODEX_QQ_BOT_BOOTSTRAP_PLATFORM:-}" in
    termux) return 0 ;;
    termux-proot) return 1 ;;
  esac
  case "${CODEX_QQ_BOT_BOOTSTRAP_OS:-}" in
    termux|android-termux) return 0 ;;
  esac
  [ -n "${TERMUX_VERSION:-}" ] && return 0
  [ -n "${TERMUX_APP__APP_VERSION_NAME:-}" ] && return 0
  case "${PREFIX:-}" in
    /data/data/*com.termux*/files/usr|/data/user/*/*com.termux*/files/usr) return 0 ;;
  esac
  if command -v pkg >/dev/null 2>&1; then
    case "$(command -v pkg 2>/dev/null || true)" in
      /data/data/*com.termux*|/data/user/*/*com.termux*)
        # PRoot-Distro binds the Termux prefix into a normal Linux guest and
        # appends it to PATH. A guest still has its own /etc/os-release, while
        # native Termux normally does not expose a distro /etc/os-release.
        [ ! -r /etc/os-release ] && return 0
        ;;
    esac
  fi
  return 1
}

ncc_env_android_kernel() {
  local kernel_text=""
  kernel_text="$(uname -r 2>/dev/null || true)"
  kernel_text="$kernel_text $(sed -n '1p' /proc/version 2>/dev/null || true)"
  case "$kernel_text" in
    *[Aa]ndroid*) return 0 ;;
  esac
  [ -x /system/bin/getprop ] || [ -r /system/build.prop ]
}

ncc_env_is_termux_proot() {
  case "${CODEX_QQ_BOT_BOOTSTRAP_PLATFORM:-}" in
    termux-proot) return 0 ;;
    termux) return 1 ;;
  esac
  case "${CODEX_QQ_BOT_BOOTSTRAP_OS:-}" in
    termux-proot|proot) return 0 ;;
  esac
  [ "${CODEX_QQ_BOT_UNDER_TERMUX:-0}" = "1" ] && return 0
  ncc_env_is_native_termux && return 1
  if [ -d /data/data/com.termux/files/usr ] || [ -d /data/user/0/com.termux/files/usr ]; then
    [ -r /etc/os-release ] && return 0
  fi
  ncc_env_android_kernel && [ -r /etc/os-release ]
}

ncc_env_is_wsl() {
  case "${CODEX_QQ_BOT_BOOTSTRAP_PLATFORM:-}" in
    wsl) return 0 ;;
  esac
  [ -n "${WSL_DISTRO_NAME:-}" ] && return 0
  local text=""
  text="$(cat /proc/sys/kernel/osrelease /proc/version 2>/dev/null || true)"
  case "$text" in
    *[Mm]icrosoft*|*WSL*) return 0 ;;
  esac
  return 1
}

ncc_env_is_container() {
  case "${CODEX_QQ_BOT_BOOTSTRAP_PLATFORM:-}" in
    container) return 0 ;;
  esac
  [ -f /.dockerenv ] && return 0
  [ -f /run/.containerenv ] && return 0
  local text=""
  text="$(cat /proc/1/cgroup 2>/dev/null || true)"
  case "$text" in
    *docker*|*containerd*|*kubepods*|*lxc*) return 0 ;;
  esac
  return 1
}

ncc_env_detect_platform() {
  if [ -n "${CODEX_QQ_BOT_BOOTSTRAP_PLATFORM:-}" ]; then
    printf '%s\n' "$CODEX_QQ_BOT_BOOTSTRAP_PLATFORM"
    return
  fi
  case "${CODEX_QQ_BOT_BOOTSTRAP_OS:-}" in
    termux|android-termux) printf 'termux\n'; return ;;
    termux-proot|proot) printf 'termux-proot\n'; return ;;
    wsl|container|macos|linux|android|unknown)
      printf '%s\n' "$CODEX_QQ_BOT_BOOTSTRAP_OS"
      return
      ;;
  esac
  if ncc_env_is_native_termux; then
    printf 'termux\n'
    return
  fi
  if ncc_env_is_termux_proot; then
    printf 'termux-proot\n'
    return
  fi
  if ncc_env_is_wsl; then
    printf 'wsl\n'
    return
  fi
  case "$(uname -s 2>/dev/null || true)" in
    Darwin) printf 'macos\n' ;;
    Linux)
      if ncc_env_is_container; then
        printf 'container\n'
      else
        printf 'linux\n'
      fi
      ;;
    Android) printf 'android\n' ;;
    *) printf 'unknown\n' ;;
  esac
}

ncc_env_detect_kernel_os() {
  case "$(ncc_env_detect_platform)" in
    macos) printf 'macos\n' ;;
    termux|android) printf 'android\n' ;;
    termux-proot|wsl|container|linux) printf 'linux\n' ;;
    *) printf 'unknown\n' ;;
  esac
}

ncc_env_detect_distro_id() {
  if [ -n "${CODEX_QQ_BOT_BOOTSTRAP_DISTRO_ID:-}" ]; then
    printf '%s\n' "$CODEX_QQ_BOT_BOOTSTRAP_DISTRO_ID"
    return
  fi
  case "$(ncc_env_detect_platform)" in
    termux) printf 'termux\n'; return ;;
    macos) printf 'macos\n'; return ;;
    android) printf 'android\n'; return ;;
  esac
  local value=""
  value="$(ncc_env_first_os_release_value ID)"
  printf '%s\n' "${value:-unknown}"
}

ncc_env_detect_distro_version() {
  if [ -n "${CODEX_QQ_BOT_BOOTSTRAP_DISTRO_VERSION:-}" ]; then
    printf '%s\n' "$CODEX_QQ_BOT_BOOTSTRAP_DISTRO_VERSION"
    return
  fi
  local value=""
  value="$(ncc_env_first_os_release_value VERSION_ID)"
  printf '%s\n' "${value:-unknown}"
}

ncc_env_detect_package_manager() {
  if [ -n "${CODEX_QQ_BOT_BOOTSTRAP_PACKAGE_MANAGER:-}" ]; then
    printf '%s\n' "$CODEX_QQ_BOT_BOOTSTRAP_PACKAGE_MANAGER"
    return
  fi
  local platform=""
  platform="$(ncc_env_detect_platform)"
  if [ "$platform" = "termux" ] && command -v pkg >/dev/null 2>&1; then
    printf 'pkg\n'
  elif [ "$platform" = "macos" ] && command -v brew >/dev/null 2>&1; then
    printf 'brew\n'
  elif command -v apt-get >/dev/null 2>&1; then
    printf 'apt-get\n'
  elif command -v dnf >/dev/null 2>&1; then
    printf 'dnf\n'
  elif command -v yum >/dev/null 2>&1; then
    printf 'yum\n'
  elif command -v apk >/dev/null 2>&1; then
    printf 'apk\n'
  elif command -v pacman >/dev/null 2>&1; then
    printf 'pacman\n'
  elif command -v zypper >/dev/null 2>&1; then
    printf 'zypper\n'
  elif command -v brew >/dev/null 2>&1; then
    printf 'brew\n'
  else
    printf 'none\n'
  fi
}

ncc_env_detect_libc() {
  if [ -n "${CODEX_QQ_BOT_BOOTSTRAP_LIBC:-}" ]; then
    printf '%s\n' "$CODEX_QQ_BOT_BOOTSTRAP_LIBC"
    return
  fi
  case "$(ncc_env_detect_platform)" in
    macos) printf 'darwin\n'; return ;;
    termux|android) printf 'bionic\n'; return ;;
  esac
  if getconf GNU_LIBC_VERSION >/dev/null 2>&1; then
    printf 'glibc\n'
  elif ldd --version 2>&1 | head -n 1 | grep -qi musl; then
    printf 'musl\n'
  else
    printf 'unknown\n'
  fi
}

ncc_env_detect_root_mode() {
  if [ -n "${CODEX_QQ_BOT_BOOTSTRAP_ROOT_MODE:-}" ]; then
    printf '%s\n' "$CODEX_QQ_BOT_BOOTSTRAP_ROOT_MODE"
    return
  fi
  local platform=""
  platform="$(ncc_env_detect_platform)"
  if [ "$platform" = "termux" ]; then
    if [ "$(id -u)" -eq 0 ]; then
      printf 'android-root\n'
    else
      printf 'termux-user\n'
    fi
  elif [ "$platform" = "termux-proot" ] && [ "$(id -u)" -eq 0 ]; then
    printf 'virtual-root\n'
  elif [ "$(id -u)" -eq 0 ]; then
    printf 'root\n'
  elif command -v sudo >/dev/null 2>&1; then
    printf 'sudo\n'
  elif command -v doas >/dev/null 2>&1; then
    printf 'doas\n'
  else
    printf 'unprivileged\n'
  fi
}

ncc_env_detect_node_strategy() {
  if [ -n "${CODEX_QQ_BOT_BOOTSTRAP_NODE_STRATEGY:-}" ]; then
    printf '%s\n' "$CODEX_QQ_BOT_BOOTSTRAP_NODE_STRATEGY"
    return
  fi
  local platform=""
  platform="$(ncc_env_detect_platform)"
  if [ "$platform" = "termux" ]; then
    printf 'managed-proot\n'
  elif [ "$(ncc_env_detect_libc)" = "musl" ]; then
    printf 'system-package\n'
  else
    printf 'official-archive\n'
  fi
}

ncc_env_napcat_policy() {
  local platform="${1:-$(ncc_env_detect_platform)}"
  local manager="${2:-$(ncc_env_detect_package_manager)}"
  local libc="${3:-$(ncc_env_detect_libc)}"
  local arch="${4:-$(ncc_env_detect_arch)}"
  if [ "$platform" = "linux" ] &&
    { [ "$manager" = "apt-get" ] || [ "$manager" = "dnf" ]; } &&
    [ "$libc" != "musl" ] &&
    { [ "$arch" = "x64" ] || [ "$arch" = "arm64" ]; }; then
    printf 'official-rootless\n'
  else
    printf 'external-onebot\n'
  fi
}

ncc_env_platform_label() {
  case "${1:-$(ncc_env_detect_platform)}" in
    termux) printf 'Android 原生 Termux' ;;
    termux-proot) printf 'Android Termux/PRoot Linux 虚拟环境' ;;
    wsl) printf 'Windows WSL' ;;
    container) printf 'Linux 容器' ;;
    macos) printf 'macOS' ;;
    linux) printf 'Linux' ;;
    android) printf 'Android shell' ;;
    *) printf '未知平台' ;;
  esac
}

ncc_env_report() {
  local platform arch distro version manager libc root_mode node_strategy napcat_policy
  platform="$(ncc_env_detect_platform)"
  arch="$(ncc_env_detect_arch)"
  distro="$(ncc_env_detect_distro_id)"
  version="$(ncc_env_detect_distro_version)"
  manager="$(ncc_env_detect_package_manager)"
  libc="$(ncc_env_detect_libc)"
  root_mode="$(ncc_env_detect_root_mode)"
  node_strategy="$(ncc_env_detect_node_strategy)"
  napcat_policy="$(ncc_env_napcat_policy "$platform" "$manager" "$libc" "$arch")"
  printf '平台：%s（%s）\n' "$(ncc_env_platform_label "$platform")" "$platform"
  printf '发行版：%s %s\n' "$distro" "$version"
  printf '架构/Libc：%s/%s\n' "$arch" "$libc"
  printf '权限：%s（uid=%s）\n' "$root_mode" "$(id -u)"
  printf '包管理器：%s\n' "$manager"
  printf 'Node.js 策略：%s\n' "$node_strategy"
  printf 'QQ/OneBot 策略：%s\n' "$napcat_policy"
}

if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  case "${1:---report}" in
    --platform) ncc_env_detect_platform ;;
    --report) ncc_env_report ;;
    *)
      printf '用法：bash scripts/install-environment.sh [--platform|--report]\n' >&2
      exit 2
      ;;
  esac
fi
