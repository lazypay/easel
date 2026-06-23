#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CALLER_DIR="$PWD"
PORT="${EASEL_PORT:-43219}"
PROJECT_DIR="${EASEL_PROJECT_DIR:-${1:-$CALLER_DIR}}"
CANVAS_DIR="${EASEL_CANVAS_DIR:-$PROJECT_DIR/canvas}"

export EASEL_PROJECT_DIR="$PROJECT_DIR"
export EASEL_CANVAS_DIR="$CANVAS_DIR"

cd "$ROOT_DIR"

if [ ! -d node_modules ]; then
  npm install
fi

echo "Easel canvas: http://127.0.0.1:${PORT}"
echo "Easel canvas data: ${CANVAS_DIR}/pages/<page-id>/"
echo "Easel page assets: ${CANVAS_DIR}/pages/<page-id>/assets -> http://127.0.0.1:${PORT}/page-assets/<page-id>/"
exec npm run dev -- --host 127.0.0.1 --port "$PORT"
