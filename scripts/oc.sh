#!/usr/bin/env bash
# OpenClaw CLI — must run on Node 22+.
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "nvm not found at \$NVM_DIR/nvm.sh" >&2
  exit 1
fi
# shellcheck source=/dev/null
. "$NVM_DIR/nvm.sh"
nvm use 22.22.2 >/dev/null
NODE_HOME="$NVM_DIR/versions/node/$(nvm version)"
export PATH="$NODE_HOME/bin:$PATH"
exec openclaw "$@"
