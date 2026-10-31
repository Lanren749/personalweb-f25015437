#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "$0")/.." && pwd)"
env_file="$project_dir/.env"
if [[ ! -f "$env_file" ]]; then
  echo "未找到本机 .env，请先在项目目录运行 npm run setup。" >&2
  exit 1
fi

printf '请输入 DeepSeek API Key（输入过程中不会显示）： '
old_stty="$(stty -g)"
stty -echo
IFS= read -r api_key
stty "$old_stty"
printf '\n'
if [[ -z "$api_key" ]]; then
  echo "未输入 API Key，配置未修改。" >&2
  exit 1
fi

tmp_file="$(mktemp "$project_dir/.env.XXXXXX")"
trap 'rm -f "$tmp_file"; unset api_key' EXIT
awk '!/^AI_KEY=/' "$env_file" > "$tmp_file"
printf 'AI_KEY=%s\n' "$api_key" >> "$tmp_file"
chmod 600 "$tmp_file"
mv "$tmp_file" "$env_file"
unset api_key
trap - EXIT
echo "本机 DeepSeek 配置已写入 .env（密钥未显示）。请重启本机服务后点击“立即更新”。"
