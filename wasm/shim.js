// rosie-wasm JS shim. Replaces the emscripten-generated rosie.js.
//
// Responsibilities:
//   1. Load and instantiate rosie.wasm with WASI + custom env imports.
//   2. Provide the JS-side asyncify runtime (state machine + buffer setup)
//      so blocking-style Rust can "await" fetch().
//   3. Implement every rosie_* extern that the Rust os::wasm module
//      declares — file system, HTTP, env, time, link creation.
//   4. Expose an emscripten-compatible `Module` object so the existing
//      wasm-loader.ts can drive us via ccall/cwrap. The ABI surface
//      (rosie_api_* exports + JSON envelope + Module.__rosieLog__) is
//      identical to the old emcc build.

// ES module — the rosie-skills npm package is "type": "module".

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { WASI } from 'node:wasi';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WASM_PATH = path.join(__dirname, 'rosie.wasm');

// ---------------------------------------------------------------------------
// createRosie({ noInitialRun?, print?, printErr?, arguments?, onAbort? })
// ---------------------------------------------------------------------------

async function createRosie(opts = {}) {
    const wasmBytes = fs.readFileSync(WASM_PATH);
    const module = await WebAssembly.compile(wasmBytes);

    const wasi = new WASI({
        version: 'preview1',
        args: opts.arguments ?? ['rosie'],
        env: process.env,
        preopens: { '/': '/', '/tmp': '/tmp' },
    });

    // Per-instance state owned by the closure below. Captured before
    // instantiation because the import functions reference it.
    let memory = null;
    let exports = null;
    let pendingPromise = null;
    let pendingResult = 0;

    function ensureViews() {
        // memory.buffer is replaced after memory.grow(), so views are
        // refreshed lazily on each access.
        return {
            u8: new Uint8Array(memory.buffer),
            u32: new Uint32Array(memory.buffer),
            i32: new Int32Array(memory.buffer),
            u64: new BigUint64Array(memory.buffer),
        };
    }

    function decodeStr(ptr, len) {
        if (ptr === 0 || len === 0) return '';
        const u8 = new Uint8Array(memory.buffer, ptr, len);
        return new TextDecoder('utf-8').decode(u8);
    }

    function decodeCStr(ptr) {
        if (ptr === 0) return null;
        const u8 = new Uint8Array(memory.buffer);
        let end = ptr;
        while (u8[end] !== 0) end++;
        return new TextDecoder('utf-8').decode(u8.subarray(ptr, end));
    }

    // Allocate `bytes.length` of wasm memory and copy bytes in. Caller is
    // responsible for either freeing or transferring ownership.
    function allocWasm(bytes) {
        const len = bytes.length;
        const ptr = exports.rosie_malloc(len);
        if (ptr === 0 && len > 0) return 0;
        new Uint8Array(memory.buffer).set(bytes, ptr);
        return ptr;
    }

    // Owned-buffer return for FS/env imports. Writes a fresh buffer into
    // wasm memory, stores (ptr, len) at the out-pointers, returns 0.
    function setOwnedBytes(outBufPtr, outLenPtr, bytes) {
        const ptr = allocWasm(bytes);
        const { u32 } = ensureViews();
        u32[outBufPtr >> 2] = ptr;
        u32[outLenPtr >> 2] = bytes.length;
        return 0;
    }

    // ---- Asyncify state machine ----
    const STATE_NORMAL = 0;
    const STATE_UNWINDING = 1;
    const STATE_REWINDING = 2;

    let asyncifyDataPtr = 0;

    function asyncifyState() {
        return exports.asyncify_get_state();
    }

    function wrapAsync(asyncFn) {
        return function (...args) {
            const state = asyncifyState();
            if (state === STATE_REWINDING) {
                // Re-entry during rewind: stop the rewind and return the
                // value the promise resolved with. Asyncify_stop_rewind is
                // not auto-emitted by wasm-opt — the import handler MUST
                // call it. (Confirmed in the spike.)
                exports.asyncify_stop_rewind();
                return pendingResult;
            }
            if (state !== STATE_NORMAL) {
                throw new Error(`unexpected asyncify state on import entry: ${state}`);
            }
            pendingPromise = asyncFn(...args);
            exports.asyncify_start_unwind(asyncifyDataPtr);
            return 0;
        };
    }

    // ---- Imports ----
    const envImports = {};

    // HTTP (asyncify-wrapped)
    envImports.rosie_fetch_to_file = wrapAsync(async (urlPtr, urlLen, pathPtr, pathLen) => {
        const url = decodeStr(urlPtr, urlLen);
        const filePath = decodeStr(pathPtr, pathLen);
        try {
            const res = await fetch(url, {
                redirect: 'follow',
                headers: { 'User-Agent': 'rosie/1.0' },
            });
            if (res.ok) {
                const body = Buffer.from(await res.arrayBuffer());
                fs.writeFileSync(filePath, body);
            }
            return res.status;
        } catch (e) {
            process.stderr.write(`fetch_to_file error: ${e.message}\n`);
            return -1;
        }
    });

    // fetch_to_buffer needs to allocate wasm memory for the response body and
    // hand the pointer back. We can't safely call wasm exports (rosie_malloc)
    // while asyncify state is "unwinding" — the asyncify pass may have
    // instrumented Rust's allocator and the saved-state buffer is mid-use.
    // Instead we stash the bytes in module scope and write them to wasm
    // memory only AFTER stop_rewind has dropped state back to NORMAL.

    let pendingFetchBuffer = null; // { status, bytes }

    envImports.rosie_fetch_to_buffer = function (
        urlPtr,
        urlLen,
        acceptPtr,
        acceptLen,
        outBufPtr,
        outLenPtr
    ) {
        const state = asyncifyState();
        if (state === STATE_REWINDING) {
            exports.asyncify_stop_rewind();
            const r = pendingFetchBuffer;
            pendingFetchBuffer = null;
            if (r && r.bytes) {
                setOwnedBytes(outBufPtr, outLenPtr, r.bytes);
            }
            return r ? r.status : -1;
        }
        if (state !== STATE_NORMAL) {
            throw new Error(`unexpected asyncify state on fetch_to_buffer: ${state}`);
        }
        const url = decodeStr(urlPtr, urlLen);
        const accept = acceptLen > 0 ? decodeStr(acceptPtr, acceptLen) : null;
        pendingPromise = (async () => {
            try {
                const headers = { 'User-Agent': 'git/rosie-1.0' };
                if (accept) headers['Accept'] = accept;
                const res = await fetch(url, { headers, redirect: 'follow' });
                let bytes = null;
                if (res.ok) bytes = new Uint8Array(await res.arrayBuffer());
                pendingFetchBuffer = { status: res.status, bytes };
                return res.status;
            } catch (e) {
                process.stderr.write(`fetch_to_buffer error: ${e.message}\n`);
                pendingFetchBuffer = { status: -1, bytes: null };
                return -1;
            }
        })();
        exports.asyncify_start_unwind(asyncifyDataPtr);
        return 0;
    };

    // ---- File system ----
    envImports.rosie_fs_write = (pathPtr, pathLen, dataPtr, dataLen) => {
        const p = decodeStr(pathPtr, pathLen);
        const data = Buffer.from(new Uint8Array(memory.buffer, dataPtr, dataLen));
        try {
            fs.writeFileSync(p, data);
            return 0;
        } catch (e) {
            return -1;
        }
    };

    envImports.rosie_fs_read = (pathPtr, pathLen, outBufPtr, outLenPtr) => {
        const p = decodeStr(pathPtr, pathLen);
        try {
            const buf = fs.readFileSync(p);
            return setOwnedBytes(outBufPtr, outLenPtr, buf);
        } catch (e) {
            return -1;
        }
    };

    envImports.rosie_fs_create_dir_all = (pathPtr, pathLen) => {
        const p = decodeStr(pathPtr, pathLen);
        try {
            fs.mkdirSync(p, { recursive: true });
            return 0;
        } catch (e) {
            return -1;
        }
    };

    envImports.rosie_fs_read_dir = (pathPtr, pathLen, outBufPtr, outLenPtr) => {
        const p = decodeStr(pathPtr, pathLen);
        try {
            const names = fs.readdirSync(p);
            const blob = Buffer.from(names.join('\n'));
            return setOwnedBytes(outBufPtr, outLenPtr, blob);
        } catch (e) {
            return -1;
        }
    };

    envImports.rosie_fs_metadata = (
        pathPtr,
        pathLen,
        followSymlinks,
        outKind,
        outSize,
        outMode
    ) => {
        const p = decodeStr(pathPtr, pathLen);
        try {
            const stat = followSymlinks ? fs.statSync(p) : fs.lstatSync(p);
            let kind = 4; // Other
            if (stat.isSymbolicLink()) kind = 2;
            else if (stat.isDirectory()) kind = 1;
            else if (stat.isFile()) kind = 3;
            const { i32, u64 } = ensureViews();
            i32[outKind >> 2] = kind;
            u64[outSize >> 3] = BigInt(stat.size);
            // Mask the unix mode bits; on Windows fall back to a sensible default.
            const mode = typeof stat.mode === 'number' ? stat.mode & 0o7777 : 0o644;
            new Uint32Array(memory.buffer)[outMode >> 2] = mode;
            return 0;
        } catch (e) {
            return -1;
        }
    };

    envImports.rosie_fs_remove_file = (pathPtr, pathLen) => {
        const p = decodeStr(pathPtr, pathLen);
        try {
            fs.unlinkSync(p);
            return 0;
        } catch (e) {
            return -1;
        }
    };

    envImports.rosie_fs_remove_dir_all = (pathPtr, pathLen) => {
        const p = decodeStr(pathPtr, pathLen);
        try {
            fs.rmSync(p, { recursive: true, force: true });
            return 0;
        } catch (e) {
            return -1;
        }
    };

    envImports.rosie_fs_copy = (srcPtr, srcLen, dstPtr, dstLen) => {
        const src = decodeStr(srcPtr, srcLen);
        const dst = decodeStr(dstPtr, dstLen);
        try {
            fs.copyFileSync(src, dst);
            return 0;
        } catch (e) {
            return -1;
        }
    };

    envImports.rosie_fs_rename = (srcPtr, srcLen, dstPtr, dstLen) => {
        const src = decodeStr(srcPtr, srcLen);
        const dst = decodeStr(dstPtr, dstLen);
        try {
            fs.renameSync(src, dst);
            return 0;
        } catch (e) {
            return -1;
        }
    };

    envImports.rosie_fs_read_link = (pathPtr, pathLen, outBufPtr, outLenPtr) => {
        const p = decodeStr(pathPtr, pathLen);
        try {
            const target = fs.readlinkSync(p);
            return setOwnedBytes(outBufPtr, outLenPtr, Buffer.from(target));
        } catch (e) {
            return -1;
        }
    };

    envImports.rosie_create_link_extern = (
        targetPtr,
        targetLen,
        linkPtr,
        linkLen,
        isDir
    ) => {
        const target = decodeStr(targetPtr, targetLen);
        const linkPath = decodeStr(linkPtr, linkLen);
        try {
            if (process.platform === 'win32') {
                // Junctions need absolute targets.
                const absTarget = path.isAbsolute(target)
                    ? target
                    : path.resolve(path.dirname(linkPath), target);
                if (isDir) {
                    fs.symlinkSync(absTarget, linkPath, 'junction');
                } else {
                    try {
                        fs.linkSync(absTarget, linkPath);
                    } catch {
                        fs.copyFileSync(absTarget, linkPath);
                    }
                }
            } else {
                fs.symlinkSync(target, linkPath);
            }
            return 0;
        } catch (e) {
            return -1;
        }
    };

    envImports.rosie_fs_set_mode = (pathPtr, pathLen, mode) => {
        const p = decodeStr(pathPtr, pathLen);
        try {
            fs.chmodSync(p, mode);
            return 0;
        } catch (e) {
            return -1;
        }
    };

    envImports.rosie_fs_canonicalize = (pathPtr, pathLen, outBufPtr, outLenPtr) => {
        const p = decodeStr(pathPtr, pathLen);
        try {
            const real = fs.realpathSync(p);
            return setOwnedBytes(outBufPtr, outLenPtr, Buffer.from(real));
        } catch (e) {
            return -1;
        }
    };

    // ---- OS / env / time ----
    envImports.rosie_home_dir = (outBufPtr, outLenPtr) => {
        const h = process.env.HOME || process.env.USERPROFILE || '';
        if (!h) return -1;
        return setOwnedBytes(outBufPtr, outLenPtr, Buffer.from(h));
    };

    envImports.rosie_temp_dir = (outBufPtr, outLenPtr) => {
        return setOwnedBytes(outBufPtr, outLenPtr, Buffer.from(os.tmpdir()));
    };

    envImports.rosie_now_unix_seconds = () => BigInt(Math.floor(Date.now() / 1000));

    envImports.rosie_getenv = (namePtr, nameLen, outBufPtr, outLenPtr) => {
        const name = decodeStr(namePtr, nameLen);
        const val = process.env[name];
        if (val === undefined) return -1;
        return setOwnedBytes(outBufPtr, outLenPtr, Buffer.from(val));
    };

    envImports.rosie_current_dir = (outBufPtr, outLenPtr) => {
        return setOwnedBytes(outBufPtr, outLenPtr, Buffer.from(process.cwd()));
    };

    envImports.rosie_set_current_dir = (pathPtr, pathLen) => {
        try {
            process.chdir(decodeStr(pathPtr, pathLen));
            return 0;
        } catch (e) {
            return -1;
        }
    };

    // ---- Log bridge (sync) ----
    // The Rust side stores a callback that calls dispatch_log_to_js whenever
    // log::info/error/debug fires. We route through Module.__rosieLog__ so
    // wasm-loader.ts can swap callbacks per-call.
    envImports.dispatch_log_to_js = (level, messagePtr, messageLen) => {
        if (Module.__rosieLog__) {
            const msg = decodeStr(messagePtr, messageLen);
            Module.__rosieLog__(level, msg);
        }
    };

    const instance = await WebAssembly.instantiate(module, {
        wasi_snapshot_preview1: wasi.wasiImport,
        env: envImports,
    });

    memory = instance.exports.memory;
    exports = instance.exports;

    // Run wasi-libc startup (constructors). Without this, anything that
    // walked through wasi-libc would hit uninitialized internals.
    wasi.initialize(instance);

    // Initialize the asyncify data buffer header.
    const bufPtr = exports.asyncify_buf_ptr();
    const bufSize = exports.asyncify_buf_size();
    asyncifyDataPtr = bufPtr;
    const u32 = new Uint32Array(memory.buffer);
    u32[asyncifyDataPtr >> 2] = bufPtr + 8;
    u32[(asyncifyDataPtr >> 2) + 1] = bufPtr + bufSize;

    // ---- Module shape (emscripten-compatible) ----

    const Module = {
        // emscripten's _free only takes a pointer. Our owned-buffer pairs
        // need (ptr, len), so map _free to rosie_free_cstring — which is
        // what the TS wrapper actually uses (to release JSON envelopes).
        _free: (ptr) => exports.rosie_free_cstring(ptr),
        get HEAPU8() {
            return new Uint8Array(memory.buffer);
        },
        UTF8ToString: (ptr) => decodeCStr(ptr) ?? '',
        __rosieLog__: null,
        ccall: (name, returnType, argTypes, args, opts) =>
            doCcall(name, returnType, argTypes, args, opts),
        cwrap: (name, returnType, argTypes, opts) =>
            (...args) => doCcall(name, returnType, argTypes, args, opts),
    };

    function marshalArg(type, value) {
        if (type === 'number') return [value, null];
        if (type === 'string') {
            if (value === null || value === undefined || value === '') {
                return [0, null];
            }
            const bytes = Buffer.from(String(value), 'utf-8');
            const ptr = exports.rosie_malloc(bytes.length + 1);
            const u8 = new Uint8Array(memory.buffer);
            u8.set(bytes, ptr);
            u8[ptr + bytes.length] = 0;
            return [ptr, { ptr, len: bytes.length + 1 }];
        }
        throw new Error(`unsupported arg type: ${type}`);
    }

    function freeMarshalled(handle) {
        if (handle) exports.rosie_free(handle.ptr, handle.len);
    }

    function unmarshalReturn(returnType, raw) {
        if (returnType === 'number') return raw;
        if (returnType === 'string') {
            if (raw === 0) return '';
            return decodeCStr(raw) ?? '';
        }
        return raw;
    }

    function doCcall(name, returnType, argTypes, args, opts) {
        const fn = exports[name];
        if (!fn) throw new Error(`wasm export not found: ${name}`);
        const handles = [];
        const marshalled = [];
        try {
            for (let i = 0; i < (argTypes ?? []).length; i++) {
                const [val, handle] = marshalArg(argTypes[i], args[i]);
                marshalled.push(val);
                handles.push(handle);
            }
            const async = !!(opts && opts.async);
            if (async) {
                return doAsyncCall(fn, marshalled, returnType).finally(() => {
                    for (const h of handles) freeMarshalled(h);
                });
            }
            const raw = fn(...marshalled);
            const out = unmarshalReturn(returnType, raw);
            for (const h of handles) freeMarshalled(h);
            return out;
        } catch (e) {
            for (const h of handles) freeMarshalled(h);
            throw e;
        }
    }

    async function doAsyncCall(fn, marshalled, returnType) {
        let raw = fn(...marshalled);
        // Pump asyncify until execution is back to normal.
        while (asyncifyState() === STATE_UNWINDING) {
            const value = await pendingPromise;
            pendingResult = value;
            exports.asyncify_stop_unwind();
            exports.asyncify_start_rewind(asyncifyDataPtr);
            raw = fn(...marshalled);
        }
        return unmarshalReturn(returnType, raw);
    }

    return Module;
}

export default createRosie;
export { createRosie };
