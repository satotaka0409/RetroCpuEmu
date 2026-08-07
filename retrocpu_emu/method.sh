#!/bin/bash
# WSL 上での補助スクリプト（Docker は使わない）

set -euo pipefail

export CURRENT_UID=$(id -u)
export CURRENT_GID=$(id -g)
export UID_GID="${CURRENT_UID}:${CURRENT_GID}"

cmd="${1:-}"

case "${cmd}" in
  typescript)
    echo "Typescript / Node.js Initializing (WSL)..."
    npm cache clean --force --loglevel=error || true
    sudo rm -rf /usr/lib/node_modules
    sudo apt remove -y nodejs node-typescript || true
    sudo rm -rf ./node_modules
    sudo rm -rf ~/.npm
    sudo rm -rf /usr/local/bin/npm
    sudo rm -rf /usr/local/bin/npx
    sudo apt update
    curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
    sudo apt install -y nodejs
    sudo npm install -g npm@latest
    npm install
    sudo chown -R "${UID_GID}" ./node_modules || true
    ;;
  install)
    echo "npm install..."
    npm install
    ;;
  dev)
    echo "Starting Vite on WSL (http://127.0.0.1:5173)..."
    npm run dev
    ;;
  test)
    npm test
    ;;
  build)
    npm run build
    ;;
  *)
    echo "Usage: $0 {typescript|install|dev|test|build}"
    exit 1
    ;;
esac
