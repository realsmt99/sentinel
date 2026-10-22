#!/usr/bin/env bash
# Sentinel demo reset (< 30 s): removes kill-switch flags, puts shop back on sentinel-shop:vulnerable
# (PHP 8.3.30), clears services + run tables (the threat_intel cache is kept unless --clear-intel),
# closes open sentinel/* PRs and deletes their branches (skipped when GitHub is not configured).
#
# Uses the running Sentinel API when it answers (so the reset waits for in-flight work), otherwise runs
# the same code directly.   Usage: scripts/reset.sh [--clear-intel]
set -euo pipefail
cd "$(dirname "$0")/.."

clear_intel=false
if [[ "${1:-}" == "--clear-intel" ]]; then
  clear_intel=true
fi

agent_url="${AGENT_URL:-}"
if [[ -z "$agent_url" && -f .env ]]; then
  agent_url="$(grep -E '^AGENT_URL=' .env | tail -n 1 | cut -d= -f2- | tr -d '"' || true)"
fi
agent_url="${agent_url:-http://localhost:8000}"

if curl -fsS -m 3 "$agent_url/health" >/dev/null 2>&1; then
  echo "Resetting through the Sentinel API at $agent_url ..."
  curl -sS -m 300 -X POST "$agent_url/demo/reset?wait=true&clear_intel=$clear_intel"
  echo
else
  echo "Sentinel API not running, resetting directly ..."
  cd sentinel
  if $clear_intel; then
    uv run python -m sentinel.reset --clear-intel
  else
    uv run python -m sentinel.reset
  fi
fi
