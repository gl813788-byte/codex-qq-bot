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
source "$SCRIPT_DIR/../install.sh"
DISTRO="${CODEX_QQ_BOT_TERMUX_DISTRO:-debian}"
GUEST_IMAGE="${CODEX_QQ_BOT_TERMUX_IMAGE:-}"
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
  /sdcard|/sdcard/*|/storage/*|*/storage/shared|*/storage/shared/*)
    die "请将项目放在 Termux 私有 HOME 下；共享存储/SD 卡不支持安装所需的执行权限和符号链接。" ;;
esac

ensure_native_termux() {
  [ "${CODEX_QQ_BOT_TERMUX_TEST_MODE:-0}" = 1 ] && return
  [ "$(bash "$SCRIPT_DIR/install-environment.sh" --platform)" = termux ] && return
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
  ncc_termux_install proot-distro
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
  local -a install_command=(proot-distro install)
  # OCI-based proot-distro uses an image source and a separate local name.
  # Older releases still accept distro aliases; preserve both interfaces.
  local install_help
  install_help="$(proot-distro install --help 2>&1 || true)"
  if [[ "$install_help" == *--name* ]]; then
    install_command+=(--name "$DISTRO" "${GUEST_IMAGE:-$DISTRO}")
  elif [ -n "$GUEST_IMAGE" ]; then
    die "当前 proot-distro 不支持自定义 OCI/本地镜像，请用 pkg 更新 proot-distro 后重试；现有容器已保留。"
  else
    install_command+=("$DISTRO")
  fi
  if ! "${install_command[@]}"; then
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
  )
  if [ "$DRY_RUN" = "1" ]; then
    printf '[Termux 安装方案] 计划进入 PRoot：'
    printf '%q ' "${command[@]}" -- "$command_path" "$@"
    printf '\n'
    return
  fi
  local key value target
  for key in http_proxy https_proxy all_proxy no_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY NO_PROXY \
    CODEX_QQ_BOT_NPM_REGISTRY npm_config_registry NPM_CONFIG_REGISTRY \
    CODEX_QQ_BOT_NODE_DIST_URL CODEX_QQ_BOT_NODE_MAJOR CODEX_QQ_BOT_DOWNLOAD_TIMEOUT \
    CODEX_QQ_BOT_METADATA_TIMEOUT CODEX_QQ_BOT_CONNECT_TIMEOUT CODEX_QQ_BOT_DOWNLOAD_ATTEMPTS; do
    value="${!key:-}"
    [ -z "$value" ] || command+=(--env "$key=$value")
  done
  for key in SSL_CERT_FILE CURL_CA_BUNDLE NODE_EXTRA_CA_CERTS REQUESTS_CA_BUNDLE npm_config_cafile NPM_CONFIG_CAFILE; do
    value="${!key:-}"
    [ -n "$value" ] || continue
    [ -f "$value" ] || die "$key 指向不可读取的证书文件，请修正后重试。"
    case "$value" in *:*) die "$key 文件路径不能包含冒号。" ;; esac
    target="/tmp/codex-qq-bot-${key}.pem"
    command+=(--bind "$value:$target" --env "$key=$target")
  done
  command+=(-- "$command_path" "$@")
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
run_guest /usr/bin/env bash "$GUEST_PROJECT_DIR/一键部署.command" "${NCC_ARGS[@]}"
