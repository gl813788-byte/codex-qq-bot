#!/usr/bin/env bash

set -Eeuo pipefail

resolve_script_path() {
  local source="${1:-$0}"
  while [ -L "$source" ]; do
    local dir=""
    dir="$(cd -P "$(dirname "$source")" && pwd)"
    source="$(readlink "$source")"
    [[ "$source" != /* ]] && source="$dir/$source"
  done
  cd -P "$(dirname "$source")" && pwd
}

SCRIPT_DIR="$(resolve_script_path "$0")"
PROJECT_DIR="${CODEX_QQ_BOT_PROJECT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
DISTRO="${CODEX_QQ_BOT_TERMUX_DISTRO:-debian}"
GUEST_PROJECT_DIR="${CODEX_QQ_BOT_TERMUX_GUEST_PROJECT_DIR:-/opt/codex-qq-bot}"
STATE_DIR="${CODEX_QQ_BOT_TERMUX_STATE_DIR:-${XDG_STATE_HOME:-$HOME/.local/state}/codex-qq-bot}"
STATE_FILE="$STATE_DIR/termux-proot-${DISTRO}.state"
DRY_RUN=0
MODE="ncc"
NCC_ARGS=()

log() {
  printf '[Termux 安装方案] %s\n' "$*"
}

warn() {
  printf '[Termux 安装方案] 提示：%s\n' "$*" >&2
}

die() {
  printf '[Termux 安装方案] 错误：%s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'EOF'
Codex QQ Bot 的 Termux/PRoot 入口

用法：
  ncc
  bash scripts/termux-proot.command [--prepare-only] [--dry-run] [ncc 参数...]

原生 Termux 只负责 proot-distro 与快捷入口。Node.js、Codex CLI、项目 npm
依赖和 Hub 都安装/运行在 Debian PRoot 中；QQ/NapCat 使用外部 OneBot。

环境变量：
  CODEX_QQ_BOT_TERMUX_DISTRO=debian
  CODEX_QQ_BOT_TERMUX_GUEST_PROJECT_DIR=/opt/codex-qq-bot
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --prepare-only)
      MODE="prepare"
      ;;
    --dry-run)
      DRY_RUN=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      NCC_ARGS+=("$1")
      ;;
  esac
  shift
done

case "$DISTRO" in
  ""|*[!A-Za-z0-9._-]*) die "PRoot 发行版名称无效：$DISTRO" ;;
esac
case "$GUEST_PROJECT_DIR" in
  *:*) die "虚拟环境中的项目目录不能包含冒号：$GUEST_PROJECT_DIR" ;;
  /*) ;;
  *) die "虚拟环境中的项目目录必须是绝对路径：$GUEST_PROJECT_DIR" ;;
esac
[ -d "$PROJECT_DIR" ] || die "项目目录不存在：$PROJECT_DIR"
case "$PROJECT_DIR" in
  *:*) die "Termux 项目目录不能包含冒号：$PROJECT_DIR" ;;
esac

ensure_native_termux() {
  case "${PREFIX:-}" in
    /data/data/*com.termux*/files/usr|/data/user/*/*com.termux*/files/usr) return ;;
  esac
  [ -n "${TERMUX_VERSION:-}" ] && return
  [ -n "${TERMUX_APP__APP_VERSION_NAME:-}" ] && return
  if [ "${CODEX_QQ_BOT_BOOTSTRAP_PLATFORM:-}" = "termux" ] || [ "${CODEX_QQ_BOT_TERMUX_TEST_MODE:-0}" = "1" ]; then
    return
  fi
  die "该入口只能从原生 Termux 运行；已经位于 PRoot Linux 时请直接运行仓库 ncc。"
}

refuse_android_root() {
  [ "${CODEX_QQ_BOT_TERMUX_TEST_MODE:-0}" != "1" ] || return 0
  if [ "$(id -u)" -eq 0 ]; then
    die "检测到 Android 真 root。proot-distro 不应在 su/root shell 中运行；请退出 su，回到普通 Termux 用户后重新执行同一个 npm/ncc 命令。"
  fi
}

ensure_proot_distro() {
  if [ "${CODEX_QQ_BOT_TERMUX_FORCE_MISSING_PROOT:-0}" != "1" ] &&
    command -v proot-distro >/dev/null 2>&1; then
    return
  fi
  if [ "$DRY_RUN" = "1" ]; then
    log "计划执行：pkg install -y proot-distro"
    return
  fi
  command -v pkg >/dev/null 2>&1 || die "没有找到 Termux pkg，无法安装 proot-distro。"
  log "正在安装 proot-distro；已下载的发行版层会由它缓存，重新运行可复用。"
  pkg install -y proot-distro
  command -v proot-distro >/dev/null 2>&1 || die "proot-distro 安装后仍不可用。"
}

guest_is_usable() {
  [ "$DRY_RUN" != "1" ] || return 1
  proot-distro login "$DISTRO" -- /bin/sh -c 'test -r /etc/os-release && command -v sh >/dev/null' >/dev/null 2>&1
}

ensure_guest() {
  if guest_is_usable; then
    log "已找到可用的 PRoot 发行版：$DISTRO"
    return
  fi
  if [ "$DRY_RUN" = "1" ]; then
    log "计划执行：proot-distro install $DISTRO"
    return
  fi
  log "没有找到可用的 $DISTRO，开始安装；下载缓存与已完成层可在中断后复用。"
  if ! proot-distro install "$DISTRO"; then
    die "PRoot 发行版安装未完成。请保留现有缓存并重新运行同一个 ncc；若反复失败，再运行 proot-distro login $DISTRO 检查具体错误。"
  fi
  guest_is_usable || die "PRoot 发行版安装结束，但 $DISTRO 无法启动。未自动删除任何现有容器。"
}

write_state() {
  [ "$DRY_RUN" != "1" ] || return 0
  mkdir -p "$STATE_DIR"
  local tmp="${STATE_FILE}.tmp.$$"
  {
    printf 'schema=1\n'
    printf 'distro=%s\n' "$DISTRO"
    printf 'project=%s\n' "$PROJECT_DIR"
    printf 'guest_project=%s\n' "$GUEST_PROJECT_DIR"
    printf 'prepared_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$tmp"
  mv "$tmp" "$STATE_FILE"
}

run_guest() {
  local command_path="$1"
  shift
  local -a command=(
    proot-distro login "$DISTRO"
    --bind "$PROJECT_DIR:$GUEST_PROJECT_DIR"
    --work-dir "$GUEST_PROJECT_DIR"
    --env "CODEX_QQ_BOT_BOOTSTRAP_PLATFORM=termux-proot"
    --env "CODEX_QQ_BOT_UNDER_TERMUX=1"
    --env "CODEX_QQ_BOT_TERMUX_GUEST_ACTIVE=1"
    --env "CODEX_QQ_BOT_INSTALL_NAPCAT=skip"
    -- "$command_path" "$@"
  )
  if [ "$DRY_RUN" = "1" ]; then
    printf '[Termux 安装方案] 计划进入 PRoot：'
    printf '%q ' "${command[@]}"
    printf '\n'
    return
  fi
  "${command[@]}"
}

ensure_native_termux
refuse_android_root
ensure_proot_distro
ensure_guest

if [ "$MODE" = "prepare" ]; then
  log "在 $DISTRO 中按阶段准备系统包、Node.js、Codex CLI、npm 依赖并运行 verify。"
  run_guest /usr/bin/env bash "$GUEST_PROJECT_DIR/scripts/prepare-environment.sh"
  write_state
  log "PRoot 环境准备完成。以后直接运行 ncc 会自动进入同一环境。"
  exit 0
fi

log "进入 $DISTRO PRoot；项目映射到 $GUEST_PROJECT_DIR。"
run_guest /usr/bin/env zsh "$GUEST_PROJECT_DIR/scripts/ncc.command" "${NCC_ARGS[@]}"
