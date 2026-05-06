#!/bin/bash
# Run this on your new Ubuntu server (Oracle Cloud, DigitalOcean, etc.)
# Usage: curl -sSL https://raw.githubusercontent.com/bueneey/chud/main/scripts/server-setup.sh | bash
# Or: bash server-setup.sh (after cloning the repo)

set -e
echo "[Chud] Installing Node 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git

echo "[Chud] Node version: $(node -v)"
echo "[Chud] Run these next (after adding .env):"
echo "  npm install && npm run build"
echo "  sudo npm install -g pm2"
echo "  pm2 start 'NODE_ENV=production DATA_DIR=./data node backend/dist/index.js' --name chud-backend"
echo "  pm2 start 'DATA_DIR=./data node clawdbot/dist/index.js' --name chud-bot"
echo "  pm2 save && pm2 startup"
