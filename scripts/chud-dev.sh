#!/usr/bin/env bash
# Chud site + API + bot loop — use Node 20 (Solana / this repo).
set -euo pipefail
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "nvm not found at \$NVM_DIR/nvm.sh" >&2
  exit 1
fi
# shellcheck source=/dev/null
. "$NVM_DIR/nvm.sh"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"
if ! nvm use 20.11.0 >/dev/null 2>&1; then
  nvm install 20.11.0
  nvm use 20.11.0 >/dev/null
fi
exec npm run dev
