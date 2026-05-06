#!/usr/bin/env bash
# One shot: point OpenClaw at Chud + copy trading skill. Run from repo root.
# You still open OpenClaw once and paste the text from openclaw-skill/PASTE-INTO-OPENCLAW.txt
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
OPENCLAW_DIR="${OPENCLAW_HOME:-$HOME/.openclaw}"
ENV_FILE="$OPENCLAW_DIR/.env"
BASE_URL="${LOBBI_AGENT_BASE_URL:-http://127.0.0.1:4000}"

mkdir -p "$OPENCLAW_DIR/workspace/skills"

echo "== Chud ↔ OpenClaw setup =="

if [[ -f "$ENV_FILE" ]] && grep -q '^[[:space:]]*LOBBI_AGENT_BASE_URL=' "$ENV_FILE" 2>/dev/null; then
  if grep -q "^LOBBI_AGENT_BASE_URL=$BASE_URL" "$ENV_FILE" 2>/dev/null; then
    echo "OK: $ENV_FILE already has LOBBI_AGENT_BASE_URL=$BASE_URL"
  else
    echo "Updating LOBBI_AGENT_BASE_URL in $ENV_FILE → $BASE_URL"
    if command -v perl >/dev/null 2>&1; then
      perl -i -pe "s|^[[:space:]]*LOBBI_AGENT_BASE_URL=.*|LOBBI_AGENT_BASE_URL=$BASE_URL|" "$ENV_FILE"
    else
      echo "Install perl or edit $ENV_FILE by hand: LOBBI_AGENT_BASE_URL=$BASE_URL"
    fi
  fi
else
  echo "Appending to $ENV_FILE"
  {
    echo ""
    echo "# Chud the Trader — agent HTTP API (added by setup-openclaw-for-chud.sh)"
    echo "LOBBI_AGENT_BASE_URL=$BASE_URL"
  } >>"$ENV_FILE"
fi

echo ""
echo "== Syncing skill into OpenClaw skills folder =="
OPENCLAW_SKILLS_DIR="$OPENCLAW_DIR/workspace/skills" "$REPO/scripts/sync-openclaw-skill.sh"

echo ""
echo "== Restart OpenClaw gateway (so it reloads env + skills) =="
if command -v oc >/dev/null 2>&1; then
  oc gateway restart && echo "Gateway restarted (oc)." || echo "oc gateway restart failed — restart OpenClaw yourself."
elif command -v openclaw >/dev/null 2>&1; then
  openclaw gateway restart 2>/dev/null && echo "Gateway restarted (openclaw)." || echo "openclaw gateway restart failed — restart OpenClaw yourself."
else
  echo "No 'oc' or 'openclaw' in PATH. Quit OpenClaw completely and open it again (or use its UI to restart gateway)."
fi

echo ""
echo "== Your Chud project (.env) =="
echo "1. Chud server must be running:  cd \"$REPO\" && npm run dev"
echo "2. For OpenClaw-only trading (recommended): set CHUD_OPENCLAW_ONLY=1 in .env and restart."
echo ""
echo "== Last step (only thing we cannot automate) =="
echo "Open OpenClaw → new chat → paste EVERYTHING in this file:"
echo "  $REPO/openclaw-skill/PASTE-INTO-OPENCLAW.txt"
echo ""
