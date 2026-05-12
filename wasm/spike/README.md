# Asyncify spike — result: PASS (with one caveat)

This proves the toolchain story for the Rust rewrite's WASM build:
**blocking-style Rust → `cargo build --target wasm32-wasip1` → `wasm-opt
--asyncify` → driven from Node with a hand-written JS shim.** No async
syntax on the Rust side. No `wasm-bindgen`. No emscripten.

## What the spike proves

| Goal | Status |
|---|---|
| `cargo build --target wasm32-wasip1` produces wasm | ✓ |
| `wasm-opt --asyncify` post-processes that wasm | ✓ |
| Node instantiates with WASI imports + custom env imports | ✓ |
| Rust calls `extern "C"` import → JS does `await fetch(url)` → result returned to Rust | ✓ |
| Rust-side computation continues from the suspend point with locals restored correctly | ✓ |
| All of the above with **no async syntax in the Rust source** | ✓ |

## How to run

```bash
npm install        # one-time: installs binaryen (provides wasm-opt)
./build.sh         # cargo build + wasm-opt --asyncify
./run.sh           # starts the mock server (reused from regression suite),
                   # runs the spike, prints PASS/FAIL
```

Expected output:

```
PASS: HTTP 200, signature 200068, downloaded 426 bytes to /tmp/spike-download.tar.gz
```

The signature is `status * 1000 + url_len` — a value Rust computes *after*
the rewind, proving that resumed execution sees the correct local values.

## The caveat — WASI fs interacts badly with asyncify

The spike originally tried to use `std::fs::write` and `std::fs::metadata`
to prove WASI fs works after the asyncify boundary. Both consistently
crashed with `RuntimeError: memory access out of bounds` once the wasm
was processed by `wasm-opt --asyncify`. Without asyncify post-processing,
the same `std::fs` calls worked fine. The crash is inside wasi-libc, not
in our code.

Likely cause: asyncify, even with `--pass-arg=asyncify-imports@env.<our-import>`,
still instruments any function that *might transitively* call an async
import. wasi-libc uses indirect calls (vtable-style fd dispatch) which
asyncify can't statically prove won't reach the async import, so it adds
state-save/restore code. That instrumentation corrupts wasi-libc's
internal layout when invoked.

`--pass-arg=asyncify-ignore-indirect` made the binary smaller but didn't
fix the WASI fs crash. `asyncify-onlylist@spike_fetch_status` was silently
ignored (the function name lookup didn't match).

**Implication for the full Rust port:** route all filesystem operations
through JS-supplied `extern "C"` imports (`rosie_fs_write`, `rosie_fs_mkdir`,
`rosie_fs_symlink`, etc.) — same pattern as today's emscripten setup where
`http-lib.js` provides `wasm_create_junction`, `wasm_copy_or_link_file`,
etc. Don't try to use `std::fs` in the wasm build.

The native build is unaffected — it uses `std::fs` directly without any
of this.

## Other findings worth noting

- **Rust cdylib on wasm32-wasip1 doesn't emit `_initialize`** by default.
  Workaround: explicitly export `__wasm_call_ctors` via a link arg, plus a
  Rust-side `_initialize` stub that calls it. Without this, wasi-libc's
  startup never runs and the wasi import functions hit unmapped memory.
- **`asyncify_stop_rewind` is not called by wasm-opt-emitted code.** The
  JS-side import handler must call it explicitly when invoked during
  rewind, before returning the stashed value. Without this, the function
  hits `unreachable` instructions on the way back up.
- **wasm-opt 121 needs `--enable-bulk-memory --enable-bulk-memory-opt`**
  for Rust 1.93's output (which uses `memory.copy`).
- **Buffer size:** the asyncify-data buffer needs ~64KB for std/WASI stacks
  even though our function is tiny. 4KB hit OOB inside `asyncify_stop_rewind`.

## Files

- `Cargo.toml` — minimal cdylib, LTO off (would strip `__wasm_call_ctors`)
- `.cargo/config.toml` — link args to force-export `__wasm_call_ctors` and `_initialize`
- `src/lib.rs` — one extern import, one `#[no_mangle]` export, the asyncify buffer
- `shim.js` — Node WASI init, the asyncify state machine, the fetch import, the driver
- `build.sh` — cargo + wasm-opt invocation
- `run.sh` — starts mock server, runs shim, tears server down
- `package.json` — pins binaryen for `wasm-opt`

`spike.opt.wasm` is gitignored — produced by `build.sh`.
