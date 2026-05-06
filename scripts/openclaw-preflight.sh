#!/usr/bin/env bash
# Run while Chud backend is up: npm run dev (from repo root).
set -euo pipefail
BASE="${LOBBI_AGENT_BASE_URL:-http://127.0.0.1:4000}"
echo "==> $BASE/api/agent/info"
curl -sS "$BASE/api/agent/info" | head -c 600
echo
echo "==> $BASE/api/agent/position"
curl -sS "$BASE/api/agent/position" | head -c 600
echo
echo "==> $BASE/api/agent/candidates (may take a few seconds)"
curl -sS -m 60 "$BASE/api/agent/candidates" | head -c 800
echo
echo "OK — if JSON looks sane, OpenClaw http tool can reach this backend."
