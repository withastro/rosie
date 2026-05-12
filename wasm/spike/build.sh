#!/usr/bin/env bash
# Builds the spike Rust crate to wasm32-wasip1 and post-processes it with
# wasm-opt --asyncify. Output: spike.opt.wasm in this directory.
#
# Tooling: wasm-opt is pulled in via the local binaryen npm dep.
# Pinned at binaryen 121 (see package.json).

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

WASM_OPT="$HERE/node_modules/.bin/wasm-opt"
if [ ! -x "$WASM_OPT" ]; then
    echo "wasm-opt not found at $WASM_OPT — run 'npm install' in $HERE first" >&2
    exit 1
fi

echo ">>> cargo build --release --target wasm32-wasip1"
cargo build --release --quiet

RAW="$HERE/target/wasm32-wasip1/release/spike.wasm"
if [ ! -f "$RAW" ]; then
    echo "expected build output not found: $RAW" >&2
    exit 1
fi

OUT="$HERE/spike.opt.wasm"
echo ">>> wasm-opt --asyncify"
# --asyncify-imports declares which JS-side imports may suspend; we only
#   have one: env.rosie_fetch_to_file.
"$WASM_OPT" --asyncify \
    --pass-arg=asyncify-imports@env.rosie_fetch_to_file \
    --enable-bulk-memory \
    --enable-bulk-memory-opt \
    --enable-multivalue \
    --enable-nontrapping-float-to-int \
    --enable-sign-ext \
    -O2 \
    "$RAW" \
    -o "$OUT"

echo ">>> built $OUT ($(stat -c %s "$OUT") bytes)"
