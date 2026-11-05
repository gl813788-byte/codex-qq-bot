#!/usr/bin/env bash
# Installs, checks or removes the optional local media components the QQ Hub
# uses to watch videos and hear voice messages:
#   - dsh-video-storyboard (npm, Apache-2.0): numbered storyboard sheets with a
#     timestamped transcript index, readable by any vision model
#   - sherpa-onnx-node (npm, Apache-2.0) with SenseVoice-Small int8 (speech:
#     zh/en/ja/ko/yue, emotion, sound event), Silero VAD and CED-tiny
#     (AudioSet sound tagging)
#   - yt-dlp (Unlicense) for public video links such as Bilibili
# Everything goes into one directory (default runtime/media-tools); nothing
# is installed globally. Downloads are pinned by size and SHA-256.
#
#   bash scripts/media/install-media-tools.sh [status|install|uninstall]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TOOLS_DIR="${CODEX_REMOTE_CONTACT_MEDIA_TOOLS_DIR:-$PROJECT_DIR/runtime/media-tools}"
GITHUB_BASE="${CODEX_REMOTE_CONTACT_MEDIA_GITHUB_BASE:-https://github.com}"
STORYBOARD_VERSION="0.6.7"
SHERPA_VERSION="2.0.1"

SENSE_VOICE_URL="$GITHUB_BASE/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2"
SENSE_VOICE_SHA256="7305f7905bfcf77fa0b39388a313f3da35c68d971661a65475b56fb2162c8e63"
SENSE_VOICE_DIR="sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09"
VAD_URL="$GITHUB_BASE/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx"
VAD_SHA256="9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6"
CED_URL="$GITHUB_BASE/k2-fsa/sherpa-onnx/releases/download/audio-tagging-models/sherpa-onnx-ced-tiny-audio-tagging-2024-04-19.tar.bz2"
CED_SHA256="84baf315b57d61aa69480c4fee878dab54cbc7be3e877db334e65d8b087e23c3"
CED_DIR="sherpa-onnx-ced-tiny-audio-tagging-2024-04-19"
YTDLP_BASE="$GITHUB_BASE/yt-dlp/yt-dlp/releases/latest/download"

log() { printf '[media] %s\n' "$*"; }

# Android kills the whole Termux session on a memory spike; heavy steps
# (npm install, model extraction, the ASR self-test) wait for headroom.
MIN_AVAILABLE_MB="${CODEX_REMOTE_CONTACT_MEDIA_INSTALL_MIN_MB:-1500}"
available_mb() { awk '/^MemAvailable:/ {print int($2 / 1024); exit}' /proc/meminfo 2>/dev/null || echo 0; }
require_memory() {
  local step="$1" need="${2:-$MIN_AVAILABLE_MB}" have
  [ -r /proc/meminfo ] || return 0
  have="$(available_mb)"
  if [ "${have:-0}" -lt "$need" ]; then
    die "可用内存只有 ${have}MB，${step}至少需要 ${need}MB；为避免系统杀掉整个会话，已停止。可以先停掉 Bot（ncc stop-hub / ncc stop-napcat）再安装。"
  fi
}
die() { printf '[media] 错误：%s\n' "$*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

sha256_of() {
  if have sha256sum; then sha256sum "$1" | awk '{print $1}'
  elif have shasum; then shasum -a 256 "$1" | awk '{print $1}'
  else die "需要 sha256sum 或 shasum 校验下载文件"; fi
}

download() {
  local url="$1" target="$2" expected="${3:-}"
  local partial="$target.partial"
  log "下载 $(basename "$target")"
  curl -fsSL --retry 3 --retry-delay 2 --connect-timeout 20 -C - -o "$partial" "$url" \
    || { rm -f "$partial"; die "下载失败：$url（可设置 HTTPS_PROXY 或 CODEX_REMOTE_CONTACT_MEDIA_GITHUB_BASE 镜像后重试）"; }
  if [ -n "$expected" ]; then
    local actual
    actual="$(sha256_of "$partial")"
    if [ "$actual" != "$expected" ]; then
      rm -f "$partial"
      die "$(basename "$target") 校验失败（期望 $expected，实际 $actual）"
    fi
  fi
  mv -f "$partial" "$target"
}

file_ok() { [ -s "$1" ]; }

status() {
  local ok=0
  printf '媒体组件目录：%s\n' "$TOOLS_DIR"
  check() {
    if [ -e "$2" ]; then printf '  [✓] %s\n' "$1"; else printf '  [ ] %s\n' "$1"; ok=1; fi
  }
  if have ffmpeg; then printf '  [✓] ffmpeg\n'; else printf '  [ ] ffmpeg（系统包管理器安装）\n'; ok=1; fi
  if have ffprobe; then printf '  [✓] ffprobe\n'; else printf '  [ ] ffprobe\n'; ok=1; fi
  check "dsh-video-storyboard $STORYBOARD_VERSION（看视频）" "$TOOLS_DIR/node_modules/dsh-video-storyboard/bin/storyboard.mjs"
  check "sherpa-onnx-node $SHERPA_VERSION（听声音）" "$TOOLS_DIR/node_modules/sherpa-onnx-node/package.json"
  check "SenseVoice 语音模型" "$TOOLS_DIR/models/sense-voice/model.int8.onnx"
  check "Silero VAD" "$TOOLS_DIR/models/silero_vad.onnx"
  check "CED 声音分类模型" "$TOOLS_DIR/models/audio-tagging/model.int8.onnx"
  if [ -x "$TOOLS_DIR/bin/yt-dlp" ] || have yt-dlp; then printf '  [✓] yt-dlp（视频链接下载）\n'; else printf '  [ ] yt-dlp\n'; ok=1; fi
  if [ "$ok" -ne 0 ]; then
    printf '缺少的组件可运行：npm run ncc -- media install\n'
  fi
  return 0
}

install_npm_packages() {
  have node || die "需要 Node.js 20+"
  have npm || die "需要 npm"
  mkdir -p "$TOOLS_DIR"
  cat >"$TOOLS_DIR/package.json" <<JSON
{
  "name": "codex-qq-bot-media-tools",
  "private": true,
  "description": "Optional local media components for the Codex QQ Bot Hub",
  "dependencies": {
    "dsh-video-storyboard": "$STORYBOARD_VERSION",
    "sherpa-onnx-node": "$SHERPA_VERSION"
  }
}
JSON
  require_memory "安装 npm 组件"
  log "安装 npm 组件（dsh-video-storyboard、sherpa-onnx-node）"
  (cd "$TOOLS_DIR" && npm install --no-audit --no-fund --omit=dev --no-package-lock) \
    || die "npm 安装失败"
}

install_models() {
  local models="$TOOLS_DIR/models" tmp
  mkdir -p "$models/sense-voice" "$models/audio-tagging"
  tmp="$(mktemp -d "$TOOLS_DIR/.download.XXXXXX")"
  if ! file_ok "$models/sense-voice/model.int8.onnx" || ! file_ok "$models/sense-voice/tokens.txt"; then
    download "$SENSE_VOICE_URL" "$tmp/sense-voice.tar.bz2" "$SENSE_VOICE_SHA256"
    require_memory "解压语音模型"
    tar -xjf "$tmp/sense-voice.tar.bz2" -C "$tmp"
    mv -f "$tmp/$SENSE_VOICE_DIR/model.int8.onnx" "$models/sense-voice/model.int8.onnx"
    mv -f "$tmp/$SENSE_VOICE_DIR/tokens.txt" "$models/sense-voice/tokens.txt"
    if [ -f "$tmp/$SENSE_VOICE_DIR/test_wavs/zh.wav" ]; then
      cp -f "$tmp/$SENSE_VOICE_DIR/test_wavs/zh.wav" "$models/sense-voice/selftest.wav"
    fi
  else
    log "SenseVoice 模型已存在"
  fi
  if ! file_ok "$models/silero_vad.onnx"; then
    download "$VAD_URL" "$models/silero_vad.onnx" "$VAD_SHA256"
  else
    log "Silero VAD 已存在"
  fi
  if ! file_ok "$models/audio-tagging/model.int8.onnx"; then
    download "$CED_URL" "$tmp/ced.tar.bz2" "$CED_SHA256"
    require_memory "解压声音分类模型"
    tar -xjf "$tmp/ced.tar.bz2" -C "$tmp"
    mv -f "$tmp/$CED_DIR/model.int8.onnx" "$models/audio-tagging/model.int8.onnx"
    mv -f "$tmp/$CED_DIR/class_labels_indices.csv" "$models/audio-tagging/class_labels_indices.csv"
  else
    log "CED 声音分类模型已存在"
  fi
  rm -rf "$tmp"
}

install_ytdlp() {
  local bin="$TOOLS_DIR/bin" asset tmp expected
  mkdir -p "$bin"
  if [ -x "$bin/yt-dlp" ] && "$bin/yt-dlp" --version >/dev/null 2>&1; then
    log "yt-dlp 已存在：$("$bin/yt-dlp" --version)"
    return
  fi
  # The zipapp only needs Python 3.9+; otherwise use the platform build.
  if have python3 && python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3, 9) else 1)'; then
    asset="yt-dlp"
  else
    case "$(uname -s)-$(uname -m)" in
      Linux-aarch64|Linux-arm64) asset="yt-dlp_linux_aarch64" ;;
      Linux-x86_64) asset="yt-dlp_linux" ;;
      Darwin-*) asset="yt-dlp_macos" ;;
      *) log "这台机器没有可用的 yt-dlp 构建，跳过；视频链接将无法下载"; return ;;
    esac
  fi
  tmp="$(mktemp -d "$TOOLS_DIR/.download.XXXXXX")"
  download "$YTDLP_BASE/SHA2-256SUMS" "$tmp/SHA2-256SUMS"
  expected="$(awk -v name="$asset" '$2 == name {print $1}' "$tmp/SHA2-256SUMS")"
  [ -n "$expected" ] || { rm -rf "$tmp"; die "yt-dlp 校验清单里没有 $asset"; }
  download "$YTDLP_BASE/$asset" "$tmp/yt-dlp" "$expected"
  chmod 0755 "$tmp/yt-dlp"
  mv -f "$tmp/yt-dlp" "$bin/yt-dlp"
  rm -rf "$tmp"
  log "yt-dlp $("$bin/yt-dlp" --version 2>/dev/null || echo '?') 已安装"
}

self_test() {
  local sample="$TOOLS_DIR/models/sense-voice/selftest.wav"
  [ -f "$sample" ] || return 0
  require_memory "语音识别自检"
  log "自检：转写一段示例语音"
  local output
  output="$(node "$PROJECT_DIR/scripts/media/qq-media-worker.mjs" transcribe --tools "$TOOLS_DIR" --input "$sample" --threads 2 --tags 1 2>&1 || true)"
  if printf '%s' "$output" | grep -q '"ok":true'; then
    log "自检通过：$(printf '%s' "$output" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s.trim().split("\n").pop());console.log(`${v.text||"(无文字)"}（${v.elapsedMs}ms）`)}catch{console.log("已返回结果")}})')"
  else
    die "自检失败：$(printf '%s' "$output" | tail -c 400)"
  fi
}

install_all() {
  have curl || die "需要 curl"
  have tar || die "需要 tar"
  if ! have ffmpeg || ! have ffprobe; then
    die "需要 ffmpeg 和 ffprobe（Debian/Ubuntu: apt install ffmpeg；Termux: pkg install ffmpeg；macOS: brew install ffmpeg）"
  fi
  mkdir -p "$TOOLS_DIR"
  install_npm_packages
  install_models
  install_ytdlp
  self_test
  log "完成。Hub 会在一分钟内自动识别新组件，无需重启。"
  status
}

uninstall_all() {
  case "$TOOLS_DIR" in
    ""|"/"|"$HOME"|"$PROJECT_DIR") die "拒绝删除不安全的目录：$TOOLS_DIR" ;;
  esac
  [ -d "$TOOLS_DIR" ] || { log "未安装"; return; }
  [ -f "$TOOLS_DIR/package.json" ] && grep -q codex-qq-bot-media-tools "$TOOLS_DIR/package.json" \
    || die "$TOOLS_DIR 不是本项目创建的媒体组件目录，拒绝删除"
  rm -rf "$TOOLS_DIR"
  log "已删除 $TOOLS_DIR"
}

case "${1:-status}" in
  status) status ;;
  install|update) install_all ;;
  uninstall|remove) uninstall_all ;;
  *) die "用法：install-media-tools.sh [status|install|uninstall]" ;;
esac
