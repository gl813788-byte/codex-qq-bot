#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
resource_values="$(node "$project_dir/scripts/resource-profile.mjs" --shell)"
while IFS='=' read -r resource_key resource_value; do
  case "$resource_key" in
    NCC_HUB_HEAP_MB) resource_heap="$resource_value" ;;
    NCC_CODEX_MAX_CONCURRENCY) export CODEX_REMOTE_CONTACT_CODEX_MAX_CONCURRENCY="${CODEX_REMOTE_CONTACT_CODEX_MAX_CONCURRENCY:-$resource_value}" ;;
    NCC_CODEX_MAX_PENDING) export CODEX_REMOTE_CONTACT_CODEX_MAX_PENDING="${CODEX_REMOTE_CONTACT_CODEX_MAX_PENDING:-$resource_value}" ;;
    NCC_ONEBOT_MAX_CONCURRENCY) export CODEX_REMOTE_CONTACT_ONEBOT_MAX_CONCURRENCY="${CODEX_REMOTE_CONTACT_ONEBOT_MAX_CONCURRENCY:-$resource_value}" ;;
    NCC_ONEBOT_MAX_PENDING) export CODEX_REMOTE_CONTACT_ONEBOT_MAX_PENDING="${CODEX_REMOTE_CONTACT_ONEBOT_MAX_PENDING:-$resource_value}" ;;
    NCC_IMAGE_MAX_BYTES) export CODEX_REMOTE_CONTACT_QQ_IMAGE_MAX_BYTES="${CODEX_REMOTE_CONTACT_QQ_IMAGE_MAX_BYTES:-$resource_value}" ;;
    NCC_COMPRESSED_IMAGE_MAX_EDGE) export CODEX_REMOTE_CONTACT_QQ_COMPRESSED_IMAGE_MAX_EDGE="${CODEX_REMOTE_CONTACT_QQ_COMPRESSED_IMAGE_MAX_EDGE:-$resource_value}" ;;
  esac
done <<< "$resource_values"
printf '[启动资源检测] Hub 堆 %s MiB，模型并发 %s，图片预算 %s 字节，压缩最长边 %spx。\n' \
  "$resource_heap" "$CODEX_REMOTE_CONTACT_CODEX_MAX_CONCURRENCY" "$CODEX_REMOTE_CONTACT_QQ_IMAGE_MAX_BYTES" "$CODEX_REMOTE_CONTACT_QQ_COMPRESSED_IMAGE_MAX_EDGE"
case "${NODE_OPTIONS:-}" in
  *--max-old-space-size*|*--max_old_space_size*) ;;
  *) export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=$resource_heap" ;;
esac
exec node "$project_dir/src/server.js"
