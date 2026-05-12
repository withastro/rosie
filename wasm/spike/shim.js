#!/usr/bin/env node
// Asyncify spike driver.
//
// Instantiates spike.opt.wasm with:
//   - wasi_snapshot_preview1: Node's built-in WASI (gives us std::fs etc.)
//   - env.rosie_fetch_to_file: hand-written async import wrapped with the
//     asyncify state-machine protocol so the wasm stack can suspend while
//     fetch() awaits, then resume with the result
//
// Pass criteria (printed to stdout):
//   PASS: HTTP 200, file size <N> bytes

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { WASI } = require('node:wasi');

const TARGET_URL = 'http://127.0.0.1:8765/fake-org/skills/archive/refs/heads/main.tar.gz';
const TARGET_PATH = '/tmp/spike-download.tar.gz';

// ---- Asyncify runtime ------------------------------------------------------
//
// State 0 = normal, 1 = unwinding (saving stack to buffer), 2 = rewinding
// (restoring stack from buffer). The transformed wasm uses these to bail
// out of all frames on suspend and re-walk them on resume.

const STATE_NORMAL = 0;
const STATE_UNWINDING = 1;
const STATE_REWINDING = 2;

let memory;             // WebAssembly.Memory (set after instantiation)
let instance;           // WebAssembly.Instance (set after instantiation)
let asyncifyBufStart;   // start of the buffer's stack region
let asyncifyBufEnd;     // end of the buffer's stack region
let asyncifyDataPtr;    // pointer to the 8-byte header that asyncify uses
let pendingPromise = null;
let pendingResult = 0;  // value to return from the async import on rewind

function decodeStr(ptr, len) {
    const view = new Uint8Array(memory.buffer, ptr, len);
    return new TextDecoder('utf-8').decode(view);
}

function asyncifyState() {
    return instance.exports.asyncify_get_state();
}

// Wrap an async function so calls from wasm transparently suspend the
// wasm stack via asyncify. On the first wasm-side call (state 0) we kick
// off the promise and start unwinding. After the promise resolves, the
// driver calls back into the same export with state set to rewind; the
// wrapper's second call then returns the stashed result.
function makeAsyncImport(asyncFn) {
    return function (...args) {
        const state = asyncifyState();
        if (state === STATE_REWINDING) {
            // Re-entry during rewind: stop rewinding (so subsequent code
            // sees state==normal) and return the stashed value. The
            // wasm-opt asyncify pass does NOT emit calls to
            // asyncify_stop_rewind itself — it's our responsibility to
            // transition state back to normal at the right moment, which
            // is here, just before resuming the original caller.
            instance.exports.asyncify_stop_rewind();
            return pendingResult;
        }
        if (state !== STATE_NORMAL) {
            throw new Error(`unexpected asyncify state on import entry: ${state}`);
        }
        // Normal entry: kick off the real async work and tell wasm to unwind.
        pendingPromise = asyncFn(...args);
        instance.exports.asyncify_start_unwind(asyncifyDataPtr);
        return 0;  // ignored — the function never actually completes here
    };
}

// ---- Custom imports --------------------------------------------------------

const rosie_fetch_to_file = makeAsyncImport(async (urlPtr, urlLen, pathPtr, pathLen) => {
    const url = decodeStr(urlPtr, urlLen);
    const filePath = decodeStr(pathPtr, pathLen);
    try {
        const res = await fetch(url, { redirect: 'follow' });
        if (res.ok) {
            const body = Buffer.from(await res.arrayBuffer());
            fs.writeFileSync(filePath, body);
        }
        return res.status;
    } catch (e) {
        process.stderr.write(`fetch error: ${e.message}\n`);
        return -1;
    }
});

// ---- Instantiation ---------------------------------------------------------

async function main() {
    const wasmPath = path.join(__dirname, 'spike.opt.wasm');
    const wasmBytes = fs.readFileSync(wasmPath);
    const module = await WebAssembly.compile(wasmBytes);

    const wasi = new WASI({
        version: 'preview1',
        args: ['spike'],
        env: {},
        preopens: { '/tmp': '/tmp' },
    });

    instance = await WebAssembly.instantiate(module, {
        wasi_snapshot_preview1: wasi.wasiImport,
        env: {
            rosie_fetch_to_file,
        },
    });

    memory = instance.exports.memory;

    // Run the wasi-reactor init flow. Our wasm exports both _initialize
    // (a Rust stub that calls __wasm_call_ctors) and the underlying ctors
    // export — wasi.initialize() binds Node's WASI module to our memory
    // and dispatches _initialize, which in turn runs wasi-libc's startup.
    wasi.initialize(instance);

    // Configure the asyncify buffer: write [stack_start, stack_end] into
    // the first 8 bytes of the buffer, then point the runtime at it.
    const bufPtr = instance.exports.asyncify_buf_ptr();
    const bufSize = instance.exports.asyncify_buf_size();
    asyncifyDataPtr = bufPtr;
    asyncifyBufStart = bufPtr + 8;
    asyncifyBufEnd = bufPtr + bufSize;

    // Place url + path strings just above the asyncify buffer. Grow memory
    // first if the target offset isn't yet allocated.
    const enc = new TextEncoder();
    const urlBytes = enc.encode(TARGET_URL);
    const pathBytes = enc.encode(TARGET_PATH);
    const scratchPtr = asyncifyBufEnd;
    const scratchEnd = scratchPtr + urlBytes.length + pathBytes.length + 64;
    const PAGE = 65536;
    const havePages = memory.buffer.byteLength / PAGE;
    const needPages = Math.ceil(scratchEnd / PAGE);
    if (needPages > havePages) {
        memory.grow(needPages - havePages);
    }

    if (process.env.SPIKE_DEBUG) {
        process.stderr.write(`[debug] bufPtr=${bufPtr} bufSize=${bufSize} scratch=${scratchPtr}..${scratchEnd}\n`);
        process.stderr.write(`[debug] memory: had ${havePages}p, need ${needPages}p, now ${memory.buffer.byteLength / PAGE}p\n`);
    }

    const view32 = new Uint32Array(memory.buffer);
    view32[asyncifyDataPtr / 4] = asyncifyBufStart;
    view32[asyncifyDataPtr / 4 + 1] = asyncifyBufEnd;

    const u8 = new Uint8Array(memory.buffer);
    u8.set(urlBytes, scratchPtr);
    u8.set(pathBytes, scratchPtr + urlBytes.length);
    const urlPtr = scratchPtr;
    const pathPtr = scratchPtr + urlBytes.length;

    // First invocation: will unwind through the async import.
    let result = instance.exports.spike_fetch_status(
        urlPtr, urlBytes.length, pathPtr, pathBytes.length
    );

    // Resume loop: as long as wasm has unwound, await the pending promise
    // and rewind it back in. In a more complex program this could loop
    // many times; here we expect exactly one round-trip.
    while (asyncifyState() === STATE_UNWINDING) {
        const value = await pendingPromise;
        pendingResult = value;
        if (process.env.SPIKE_DEBUG) {
            const cur = view32[asyncifyDataPtr / 4];
            const end = view32[asyncifyDataPtr / 4 + 1];
            process.stderr.write(`[debug] after unwind: cur=${cur} (offset ${cur - bufPtr}), end=${end}, promise value=${value}\n`);
        }
        instance.exports.asyncify_stop_unwind();
        instance.exports.asyncify_start_rewind(asyncifyDataPtr);
        result = instance.exports.spike_fetch_status(
            urlPtr, urlBytes.length, pathPtr, pathBytes.length
        );
    }

    // Validate: the returned signature must equal status*1000 + url_len.
    // status should be 200; url_len is the URL byte length. If the rewind
    // restored locals correctly, Rust computes this with the right values.
    const urlLen = urlBytes.length;
    const expected = 200 * 1000 + urlLen;
    const downloadedSize = fs.existsSync(TARGET_PATH) ? fs.statSync(TARGET_PATH).size : -1;

    if (result !== expected) {
        console.log(`FAIL: signature ${result} != expected ${expected} (status*1000 + ${urlLen})`);
        console.log(`      downloaded file size on disk: ${downloadedSize}`);
        process.exit(1);
    }

    console.log(`PASS: HTTP 200, signature ${result}, downloaded ${downloadedSize} bytes to ${TARGET_PATH}`);
}

main().catch((e) => {
    console.error('FAIL:', e);
    process.exit(1);
});
