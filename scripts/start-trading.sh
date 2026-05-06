#!/usr/bin/env bash
# Start Chud with one website + clawbot trading. Kills stale processes and removes lock.
set -e
cd "$(dirname "$0")/.."
echo "==> Stopping any existing processes..."
pkill -9 -f "chud" 2>/dev/null || true
pkill -9 -f "clawdbot" 2>/dev/null || true
pkill -9 -f "tsx watch" 2>/dev/null || true
pkill -9 -f "vite" 2>/dev/null || true
pkill -9 -f "concurrently" 2>/dev/null || true
lsof -ti:4000 | xargs kill -9 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
sleep 2
rm -f data/.cycle-lock
echo "==> Starting backend + web + clawbot..."
npm run dev:all
