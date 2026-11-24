#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

if ! command -v node &> /dev/null; then
  echo "[ERR] Node.js is not installed! Download LTS from: https://nodejs.org/"
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "[INFO] First run - installing dependencies..."
  npm install
fi

node index.js "$@"