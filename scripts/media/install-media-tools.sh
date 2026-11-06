#!/usr/bin/env bash
# Installs, checks or removes the optional local media components the QQ Hub
# uses to watch videos and hear voice messages:
#   - dsh-video-storyboard (npm, Apache-2.0): numbered storyboard sheets with a
#     timestamped transcript index, readable by any vision model
#   - sherpa-onnx-node (npm, Apache-2.0) with SenseVoice-Small int8 (speech:
#     zh/en/ja/ko/yue, emotion, sound event), Silero VAD and CED-tiny
#     (AudioSet sound tagging)
#   - @meting/core (npm, MIT): song facts, lyrics and stream URLs from
#     NetEase Cloud Music, QQ Music, Kugou and Kuwo
#   - essentia.js (npm, AGPL-3.0, MTG/UPF): tempo, key, danceability and
#     pitch analysis, run only inside the media worker child process
#   - yt-dlp (Unlicense) for public video links such as Bilibili
# Everything goes into one directory (default runtime/media-tools); nothing
# is installed globally. Model downloads are pinned by size and SHA-256; npm
# versions below are minimums that `update` raises to new releases.
#
#   bash scripts/media/install-media-tools.sh \
#     [status|install|check|update|update-all|apply-pending|uninstall]
#
# check          compare installed components with their latest releases
# update         install new releases allowed by CODEX_REMOTE_CONTACT_MEDIA_AUTO_UPDATE
#                (compatible = same major / same 0.x minor, all = every release),
#                self-test, and roll back on failure
# update-all     the same for every new release, including major versions
# apply-pending  run `update` only when the Hub marked updates as pending
#                (controllers call this before starting the stack)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TOOLS_DIR="${CODEX_REMOTE_CONTACT_MEDIA_TOOLS_DIR:-$PROJECT_DIR/runtime/media-tools}"
GITHUB_BASE="${CODEX_REMOTE_CONTACT_MEDIA_GITHUB_BASE:-https://github.com}"
STORYBOARD_VERSION="0.6.7"
SHERPA_VERSION="2.0.1"
METING_VERSION="1.6.2"
ESSENTIA_VERSION="0.1.3"
PINS="dsh-video-storyboard=$STORYBOARD_VERSION,sherpa-onnx-node=$SHERPA_VERSION,@meting/core=$METING_VERSION,essentia.js=$ESSENTIA_VERSION"
UPDATES="$SCRIPT_DIR/media-updates.mjs"

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
  check "dsh-video-storyboard $(installed_version dsh-video-storyboard)（看视频）" "$TOOLS_DIR/node_modules/dsh-video-storyboard/bin/storyboard.mjs"
  check "sherpa-onnx-node $(installed_version sherpa-onnx-node)（听声音）" "$TOOLS_DIR/node_modules/sherpa-onnx-node/package.json"
  check "SenseVoice 语音模型" "$TOOLS_DIR/models/sense-voice/model.int8.onnx"
  check "Silero VAD" "$TOOLS_DIR/models/silero_vad.onnx"
  check "CED 声音分类模型" "$TOOLS_DIR/models/audio-tagging/model.int8.onnx"
  check "@meting/core $(installed_version @meting/core)（音乐解析：网易云/QQ音乐/酷狗/酷我）" "$TOOLS_DIR/node_modules/@meting/core/package.json"
  check "essentia.js $(installed_version essentia.js)（节奏/调性/音高分析）" "$TOOLS_DIR/node_modules/essentia.js/package.json"
  if [ -x "$TOOLS_DIR/bin/yt-dlp" ] || have yt-dlp; then printf '  [✓] yt-dlp %s（视频链接下载/解析）\n' "$(cat "$TOOLS_DIR/bin/yt-dlp.version" 2>/dev/null || true)"; else printf '  [ ] yt-dlp\n'; ok=1; fi
  printf '自动更新：%s\n' "$(update_mode_label)"
  if [ -f "$TOOLS_DIR/update-pending" ]; then
    printf '  有新版本等待更新（ncc media check 查看，ncc media update 立即更新）\n'
  fi
  if [ "$ok" -ne 0 ]; then
    printf '缺少的组件可运行：npm run ncc -- media install\n'
  fi
  return 0
}

installed_version() {
  local manifest="$TOOLS_DIR/node_modules/$1/package.json"
  [ -f "$manifest" ] || return 0
  sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest" | head -n 1
}

update_mode() {
  case "$(printf '%s' "${CODEX_REMOTE_CONTACT_MEDIA_AUTO_UPDATE:-compatible}" | tr '[:upper:]' '[:lower:]')" in
    0|off|false|no|disabled) printf 'off' ;;
    check|notify|report) printf 'check' ;;
    all|latest|major) printf 'all' ;;
    *) printf 'compatible' ;;
  esac
}

update_mode_label() {
  case "$(update_mode)" in
    off) printf '已关闭' ;;
    check) printf '只检查，不自动安装' ;;
    all) printf '自动安装所有新版本（含大版本）' ;;
    *) printf '自动安装兼容的新版本（大版本需 ncc media update-all）' ;;
  esac
}

# yt-dlp's version, recorded next to the binary so update checks never have
# to start Python.
record_ytdlp_version() {
  local bin="$TOOLS_DIR/bin/yt-dlp" version
  [ -x "$bin" ] || return 0
  version="$("$bin" --version 2>/dev/null | head -n 1 || true)"
  [ -n "$version" ] && printf '%s\n' "$version" >"$bin.version"
  return 0
}

ensure_ytdlp_version_file() {
  [ -x "$TOOLS_DIR/bin/yt-dlp" ] && [ ! -s "$TOOLS_DIR/bin/yt-dlp.version" ] && record_ytdlp_version
  return 0
}

install_npm_packages() {
  have node || die "需要 Node.js 20+"
  have npm || die "需要 npm"
  mkdir -p "$TOOLS_DIR"
  # Keeps versions a previous update installed; raises older ones to the pins.
  node "$UPDATES" manifest --tools "$TOOLS_DIR" --pins "$PINS" >/dev/null \
    || die "无法写入 $TOOLS_DIR/package.json"
  require_memory "安装 npm 组件"
  log "安装 npm 组件（dsh-video-storyboard、sherpa-onnx-node、@meting/core、essentia.js）"
  npm_install || die "npm 安装失败"
}

npm_install() {
  (cd "$TOOLS_DIR" && npm install --no-audit --no-fund --omit=dev --no-package-lock)
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
  local force="${1:-}" bin="$TOOLS_DIR/bin" asset tmp expected
  mkdir -p "$bin"
  if [ "$force" != "force" ] && [ -x "$bin/yt-dlp" ] && "$bin/yt-dlp" --version >/dev/null 2>&1; then
    log "yt-dlp 已存在：$("$bin/yt-dlp" --version)"
    record_ytdlp_version
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
  record_ytdlp_version
  log "yt-dlp $("$bin/yt-dlp" --version 2>/dev/null || echo '?') 已安装"
}

self_test() {
  local sample="$TOOLS_DIR/models/sense-voice/selftest.wav" output
  local board="$TOOLS_DIR/node_modules/dsh-video-storyboard/bin/storyboard.mjs"
  if [ -f "$board" ]; then
    # Without arguments the CLI only loads its modules and prints usage.
    output="$(node "$board" 2>&1 || true)"
    printf '%s' "$output" | grep -qi 'usage' || die "看视频组件自检失败：$(printf '%s' "$output" | tail -c 300)"
    log "自检通过：看视频组件可以加载"
  fi
  [ -f "$sample" ] || return 0
  require_memory "语音识别自检"
  log "自检：转写一段示例语音"
  output="$(node "$PROJECT_DIR/scripts/media/qq-media-worker.mjs" transcribe --tools "$TOOLS_DIR" --input "$sample" --threads 2 --tags 1 2>&1 || true)"
  if printf '%s' "$output" | grep -q '"ok":true'; then
    log "自检通过：$(printf '%s' "$output" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s.trim().split("\n").pop());console.log(`${v.text||"(无文字)"}（${v.elapsedMs}ms）`)}catch{console.log("已返回结果")}})')"
  else
    die "自检失败：$(printf '%s' "$output" | tail -c 400)"
  fi
  if [ -f "$TOOLS_DIR/node_modules/essentia.js/package.json" ]; then
    require_memory "声音分析自检"
    log "自检：分析示例音频的节奏和调性"
    output="$(node --max-old-space-size=256 "$PROJECT_DIR/scripts/media/qq-media-worker.mjs" analyze --tools "$TOOLS_DIR" --input "$sample" --mode music --threads 2 --tags 1 2>&1 || true)"
    if printf '%s' "$output" | grep -q '"ok":true' && printf '%s' "$output" | grep -q '"essentia":true'; then
      log "自检通过：$(printf '%s' "$output" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const v=JSON.parse(s.trim().split("\n").pop());const m=v.music||{};console.log(`调性 ${m.key?.key||"?"} ${m.key?.scale||""}，速度 ${Math.round(m.rhythm?.bpm||0)} BPM${(v.essentiaErrors||[]).length?`；部分算法失败：${v.essentiaErrors.join("；")}`:""}（${v.elapsedMs}ms）`)}catch{console.log("已返回结果")}})')"
    else
      die "声音分析自检失败：$(printf '%s' "$output" | tail -c 400)"
    fi
  fi
}

json_field() {
  node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=JSON.parse(s||"{}")[process.argv[1]];process.stdout.write(typeof v==="object"?JSON.stringify(v):String(v??""))})' "$1"
}

# New releases → install, self-test, and restore the previous versions when
# anything fails. Every step runs in a subshell so a failure (die) rolls
# back instead of leaving a half-updated directory.
update_components() {
  local all="${1:-0}" plan count npm_targets ytdlp_target ok=1 detail=""
  have node || die "需要 Node.js 20+"
  have npm || die "需要 npm"
  [ -f "$TOOLS_DIR/package.json" ] || die "还没安装媒体组件，先运行 npm run ncc -- media install"
  ensure_ytdlp_version_file
  plan="$(node "$UPDATES" targets --tools "$TOOLS_DIR" $([ "$all" = 1 ] && printf -- '--all'))" || die "检查新版本失败（网络不可用？）"
  count="$(printf '%s' "$plan" | json_field count)"
  if [ "${count:-0}" = "0" ]; then
    log "媒体组件已是最新（或没有允许自动安装的新版本；大版本用 ncc media update-all）"
    return 0
  fi
  npm_targets="$(printf '%s' "$plan" | json_field npm)"
  ytdlp_target="$(printf '%s' "$plan" | json_field ytDlp)"
  require_memory "更新媒体组件"
  log "更新：$(printf '%s' "$npm_targets" | tr -d '{}"' | tr ',' ' ')${ytdlp_target:+ yt-dlp:$ytdlp_target}"
  cp -f "$TOOLS_DIR/package.json" "$TOOLS_DIR/package.json.prev"
  if [ -x "$TOOLS_DIR/bin/yt-dlp" ]; then
    cp -f "$TOOLS_DIR/bin/yt-dlp" "$TOOLS_DIR/bin/yt-dlp.prev"
    cp -f "$TOOLS_DIR/bin/yt-dlp.version" "$TOOLS_DIR/bin/yt-dlp.version.prev" 2>/dev/null || true
  fi
  if [ "$npm_targets" != "{}" ]; then
    node "$UPDATES" manifest --tools "$TOOLS_DIR" --pins "$PINS" --targets "$npm_targets" >/dev/null || ok=0
    [ "$ok" = 1 ] && { npm_install || { ok=0; detail="npm install failed"; }; }
  fi
  if [ "$ok" = 1 ] && [ -n "$ytdlp_target" ]; then
    ( install_ytdlp force ) || { ok=0; detail="yt-dlp download failed"; }
  fi
  if [ "$ok" = 1 ]; then
    ( self_test ) || { ok=0; detail="self-test failed"; }
  fi
  local targets
  targets="$(node -e 'const n=JSON.parse(process.argv[1]||"{}");if(process.argv[2])n["yt-dlp"]=process.argv[2];console.log(JSON.stringify(n))' "$npm_targets" "$ytdlp_target")"
  if [ "$ok" != 1 ]; then
    log "更新失败（$detail），恢复到之前的版本"
    mv -f "$TOOLS_DIR/package.json.prev" "$TOOLS_DIR/package.json"
    npm_install >/dev/null 2>&1 || log "恢复 npm 组件时出错，可以再运行一次 npm run ncc -- media install"
    if [ -f "$TOOLS_DIR/bin/yt-dlp.prev" ]; then
      mv -f "$TOOLS_DIR/bin/yt-dlp.prev" "$TOOLS_DIR/bin/yt-dlp"
      [ -f "$TOOLS_DIR/bin/yt-dlp.version.prev" ] && mv -f "$TOOLS_DIR/bin/yt-dlp.version.prev" "$TOOLS_DIR/bin/yt-dlp.version"
    fi
    node "$UPDATES" record --tools "$TOOLS_DIR" --ok 0 --targets "$targets" --detail "$detail" || true
    die "媒体组件更新失败，已回滚；这些版本不会再自动重试，直到有更新的版本"
  fi
  rm -f "$TOOLS_DIR/package.json.prev" "$TOOLS_DIR/bin/yt-dlp.prev" "$TOOLS_DIR/bin/yt-dlp.version.prev"
  node "$UPDATES" record --tools "$TOOLS_DIR" --ok 1 --targets "$targets" || true
  log "媒体组件已更新。Hub 会在一分钟内用上新版本，无需重启。"
}

# Called by the controllers before the stack starts: quick no-op unless the
# Hub marked automatic updates as pending; never blocks startup on failure.
apply_pending() {
  [ -f "$TOOLS_DIR/update-pending" ] || return 0
  case "$(update_mode)" in off|check) return 0 ;; esac
  log "有媒体组件新版本等待安装，启动前先更新"
  ( update_components 0 ) || log "这次没有完成媒体组件更新（内存不足或已回滚），继续启动"
  return 0
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
  install) install_all ;;
  check)
    have node || die "需要 Node.js 20+"
    [ -d "$TOOLS_DIR" ] || die "还没安装媒体组件，先运行 npm run ncc -- media install"
    ensure_ytdlp_version_file
    CODEX_REMOTE_CONTACT_MEDIA_AUTO_UPDATE="$(update_mode)" node "$UPDATES" check --tools "$TOOLS_DIR" --mode "$(update_mode)"
    ;;
  update|upgrade) update_components 0 ;;
  update-all|upgrade-all) update_components 1 ;;
  apply-pending) apply_pending ;;
  uninstall|remove) uninstall_all ;;
  *) die "用法：install-media-tools.sh [status|install|check|update|update-all|apply-pending|uninstall]" ;;
esac
