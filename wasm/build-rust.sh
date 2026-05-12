#!/usr/bin/env bash
# Build the Rust wasm crate to wasm32-wasip1 and post-process with
# wasm-opt --asyncify. Output: npm/rosie-skills/wasm/rosie.{js,wasm}.
#
# Tooling: requires `cargo` with the wasm32-wasip1 target, plus `wasm-opt`
# (pinned via the local binaryen npm dep in wasm/spike/, or system).
#
# Build via `cd wasm && ./build-rust.sh`. This script (and shim.js) replace
# the emscripten-based wasm/build.sh in Phase 16.

set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
OUT_DIR="$REPO_ROOT/npm/rosie-skills/wasm"

# Pick wasm-opt: local (preferred, pinned to binaryen 121) or system.
WASM_OPT=""
if [ -x "$HERE/spike/node_modules/.bin/wasm-opt" ]; then
    WASM_OPT="$HERE/spike/node_modules/.bin/wasm-opt"
elif command -v wasm-opt >/dev/null 2>&1; then
    WASM_OPT="$(command -v wasm-opt)"
else
    echo "wasm-opt not found." >&2
    echo "Either install binaryen (apt install binaryen) or run" >&2
    echo "  (cd $HERE/spike && npm install)" >&2
    exit 1
fi

mkdir -p "$OUT_DIR"

echo ">>> cargo build --release --target wasm32-wasip1"
cd "$HERE"
cargo build --release --quiet

RAW="$HERE/target/wasm32-wasip1/release/rosie_wasm.wasm"
if [ ! -f "$RAW" ]; then
    echo "expected build output not found: $RAW" >&2
    exit 1
fi

echo ">>> wasm-opt --asyncify"
# --asyncify-imports declares which JS-side imports may suspend. We list the
# HTTP fetch pair. Filesystem ops are sync from rosie's perspective (the JS
# shim does them synchronously via Node's fs sync API).
"$WASM_OPT" --asyncify \
    --pass-arg=asyncify-imports@env.rosie_fetch_to_file,env.rosie_fetch_to_buffer \
    --enable-bulk-memory \
    --enable-bulk-memory-opt \
    --enable-multivalue \
    --enable-nontrapping-float-to-int \
    --enable-sign-ext \
    -O2 \
    "$RAW" \
    -o "$OUT_DIR/rosie.wasm"

# Drop the JS shim into the same directory so wasm-loader.ts can import it.
cp "$HERE/shim.js" "$OUT_DIR/rosie.js"

echo ">>> built $OUT_DIR/rosie.wasm ($(stat -c %s "$OUT_DIR/rosie.wasm") bytes)"
echo ">>> shim   $OUT_DIR/rosie.js"
