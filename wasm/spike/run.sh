#!/usr/bin/env bash
# Spawns the mock server (reused from the regression suite), runs the spike,
# tears down the server. Expects `./build.sh` to have already produced
# spike.opt.wasm.

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
PORT="${PORT:-8765}"

if [ ! -f "$HERE/spike.opt.wasm" ]; then
    echo "spike.opt.wasm not found — run ./build.sh first" >&2
    exit 1
fi

# Wipe artifacts the spike will recreate, so we're not fooled by a stale
# /tmp/spike-download.tar.gz from a previous run.
rm -f /tmp/spike-pre-fetch.marker /tmp/spike-download.tar.gz

python3 "$REPO_ROOT/tests/regression/lib/mock_server.py" \
    --port "$PORT" \
    --root "$REPO_ROOT/tests/regression/fixtures/repos" \
    >/tmp/spike-mock.log 2>&1 &
MOCK_PID=$!
trap "kill $MOCK_PID 2>/dev/null || true" EXIT
sleep 0.3

# Probe — if the server didn't bind we want to fail loudly rather than
# silently retry under asyncify.
if ! curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/" | grep -q '^[2-4]'; then
    echo "mock server failed to start; log follows:" >&2
    cat /tmp/spike-mock.log >&2
    exit 2
fi

node "$HERE/shim.js"
