#!/usr/bin/env bash
# Wipe Chud runtime data (trades, claw state, logs, chat, coach, outbox, cycle lock).
# Default matches npm run dev:backend (DATA_DIR=../data from backend/ → repo ./data).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DATA="$REPO/data"
if [[ -n "${DATA_DIR:-}" ]]; then
  if [[ "${DATA_DIR}" = /* ]]; then
    DATA="$DATA_DIR"
  elif [[ "${DATA_DIR}" == ../* ]]; then
    DATA="$REPO/${DATA_DIR#../}"
  else
    DATA="$REPO/$DATA_DIR"
  fi
fi
mkdir -p "$DATA"
for f in trades.json state.json logs.json chud-outbox.json coach-messages.json chud-chat.json; do
  rm -f "$DATA/$f"
done
rm -f "$DATA"/chud-chat-*.json
rm -f "$DATA/.cycle-lock"
echo "Chud data reset: $DATA"
echo "  removed: trades, state, logs, outbox, coach, chat (legacy + per-tab), .cycle-lock"
echo "Next: stop any server on :4000, then: npm run dev"
