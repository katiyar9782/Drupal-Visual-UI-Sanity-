#!/usr/bin/env bash
set -e
cd -- "$(dirname -- "$0")"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"
  nvm use 22 >/dev/null 2>&1 || true
fi
if ! command -v node >/dev/null; then echo 'Install Node.js 22 first.'; read -r -p 'Press Enter to close'; exit 1; fi
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0])>=22?0:1)'; then echo 'Node.js 22 or later is required. Use Node 22 for this release.'; read -r -p 'Press Enter to close'; exit 1; fi
if [ ! -d node_modules/playwright ]; then npm ci; fi
node src/ui-server.js --open
