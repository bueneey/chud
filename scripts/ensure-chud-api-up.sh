#!/usr/bin/env bash
# If nothing answers on :4000, start npm run dev (run from repo root in another terminal, or use this).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
if curl -sS -m 2 "http://127.0.0.1:4000/api/balance" >/dev/null 2>&1; then
  echo "OK: Chud API already up on http://127.0.0.1:4000"
  exit 0
fi
echo "Port 4000 quiet — starting Chud (npm run dev). Leave this running."
cd "$REPO"
exec npm run dev
