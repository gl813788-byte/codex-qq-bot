#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
NCC_SCRIPT="$PROJECT_DIR/scripts/ncc.command"
BOOTSTRAP_SCRIPT="$PROJECT_DIR/scripts/bootstrap-environment.sh"
ENVIRONMENT_DETECTOR="$PROJECT_DIR/scripts/install-environment.sh"
TERMUX_PROOT_SCRIPT="$PROJECT_DIR/scripts/termux-proot.command"

log() {
  printf '\n[一键部署] %s\n' "$*"
}

die() {
  printf '\n[一键部署] 错误：%s\n' "$*" >&2
  exit 1
}

[ -f "$NCC_SCRIPT" ] || die "找不到仓库 ncc：$NCC_SCRIPT"
if [ -f "$ENVIRONMENT_DETECTOR" ] &&
  [ "$(bash "$ENVIRONMENT_DETECTOR" --platform)" = "termux" ]; then
  [ -x "$TERMUX_PROOT_SCRIPT" ] || die "缺少 Termux PRoot 入口：$TERMUX_PROOT_SCRIPT"
  log "已识别原生 Termux，将在受管 PRoot Debian 中安装和运行 Codex QQ Bot。"
  exec bash "$TERMUX_PROOT_SCRIPT" "$@"
fi
if [ -f "$BOOTSTRAP_SCRIPT" ]; then
  log "正在自举首次启动需要的下载、解压和终端工具。"
  bash "$BOOTSTRAP_SCRIPT" --base-only
fi
log "正在进入 ncc。首次运行会自动部署，完成后再运行就是日常功能菜单。"
exec bash "$NCC_SCRIPT" "$@"
