#!/usr/bin/env bash

set -Eeuo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BOOTSTRAP_SCRIPT="$PROJECT_DIR/scripts/bootstrap-environment.sh"
DEPLOY_SCRIPT="$PROJECT_DIR/scripts/deploy.command"

log() {
  printf '[安装续跑] %s\n' "$*"
}

[ -f "$BOOTSTRAP_SCRIPT" ] || {
  printf '[安装续跑] 错误：缺少环境自举器：%s\n' "$BOOTSTRAP_SCRIPT" >&2
  exit 1
}

log "阶段 1/2：检查并补齐当前平台运行依赖。"
bash "$BOOTSTRAP_SCRIPT" --base-only
export PATH="$HOME/.local/share/codex-qq-bot/node/bin:$HOME/.local/bin:$PATH"
command -v zsh >/dev/null 2>&1 || {
  printf '[安装续跑] 错误：zsh 安装后仍不可用。\n' >&2
  exit 1
}

log "阶段 2/2：继续 Node/Codex/npm/verify 阶段。"
exec zsh "$DEPLOY_SCRIPT" --prepare-only
