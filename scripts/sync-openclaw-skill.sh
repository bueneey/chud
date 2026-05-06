#!/usr/bin/env bash
# OpenClaw refuses skills that symlink outside ~/.openclaw/workspace/skills — copy instead.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)/openclaw-skill"
SKILLS="${OPENCLAW_SKILLS_DIR:-$HOME/.openclaw/workspace/skills}"
for name in chud-trading lobbi-trading; do
  mkdir -p "$SKILLS/$name"
  rsync -a --delete "$REPO/" "$SKILLS/$name/"
  echo "Synced → $SKILLS/$name"
done
echo "Restart gateway: oc gateway restart"
