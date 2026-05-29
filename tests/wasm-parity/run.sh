#!/usr/bin/env bash
# Drives the wasm-mode regression subset against the same mock server the
# native regression suite uses.

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
PORT="${PORT:-8765}"

# Build the TS dist if it's missing.
if [ ! -f "$REPO_ROOT/npm/rosie-skills/dist/index.js" ]; then
    (cd "$REPO_ROOT/npm/rosie-skills" && npm install --silent && npm run build)
fi

python3 "$REPO_ROOT/tests/regression/lib/mock_server.py" \
    --port "$PORT" \
    --root "$REPO_ROOT/tests/regression/fixtures/repos" \
    >/tmp/rosie-wasm-mock.log 2>&1 &
MOCK_PID=$!
trap "kill $MOCK_PID 2>/dev/null || true" EXIT
sleep 0.3

PORT=$PORT node "$HERE/run.mjs"
