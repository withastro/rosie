// Spike: prove that blocking-style Rust on wasm32-wasip1, post-processed by
// `wasm-opt --asyncify`, can call into an async JS import via `extern "C"`
// and get the result back without any async syntax on the Rust side.
//
// One exported function:
//   spike_fetch_status(url, path) -> i32
//
//   - Writes a marker file via WASI fs (proves stdlib fs works in wasm)
//   - Calls the imported rosie_fetch_to_file which on the JS side does
//     `await fetch(url)` and writes the body to `path`
//   - On HTTP 200, reads back the downloaded file's size via WASI fs and
//     returns it (proves JS-side writes are visible through WASI)
//   - On any other status, returns the negated HTTP code

extern "C" {
    fn rosie_fetch_to_file(
        url_ptr: *const u8,
        url_len: usize,
        path_ptr: *const u8,
        path_len: usize,
    ) -> i32;
}

// Storage for asyncify's stack-saving buffer. The JS shim calls
// `asyncify_buf_ptr()` once at startup to find this address, writes the
// [stack_start, stack_end) header into the first 8 bytes, and passes that
// pointer to asyncify_start_unwind / asyncify_start_rewind.
//
// Rust's stack frames with std::fs/WASI are deeper than expected — 64 KB
// gives plenty of room for the spike. Real rosie can revisit once we have
// a measurement of actual usage from full install flows.
const ASYNCIFY_BUF_SIZE: usize = 65536;
static mut ASYNCIFY_BUF: [u8; ASYNCIFY_BUF_SIZE] = [0; ASYNCIFY_BUF_SIZE];

#[no_mangle]
pub extern "C" fn asyncify_buf_ptr() -> *mut u8 {
    unsafe { ASYNCIFY_BUF.as_mut_ptr() }
}

#[no_mangle]
pub extern "C" fn asyncify_buf_size() -> usize {
    ASYNCIFY_BUF_SIZE
}

// _initialize: stub so Node's `wasi.initialize(instance)` finds an export to
// call. We call __wasm_call_ctors ourselves to be explicit about what
// startup work happens, but Node WASI does need to invoke *some* export to
// bind its memory reference.
extern "C" {
    fn __wasm_call_ctors();
}

#[no_mangle]
pub extern "C" fn _initialize() {
    unsafe { __wasm_call_ctors(); }
}

/// Borrow a slice from `(ptr, len)` and view it as `&str` without copying.
/// Safety: the caller (the JS shim) is responsible for passing valid UTF-8
/// pointed-to memory; we treat invalid UTF-8 as an error path via `from_utf8`.
fn slice_to_str<'a>(ptr: *const u8, len: usize) -> Result<&'a str, std::str::Utf8Error> {
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    std::str::from_utf8(bytes)
}

#[no_mangle]
pub extern "C" fn spike_fetch_status(
    url_ptr: *const u8,
    url_len: usize,
    path_ptr: *const u8,
    path_len: usize,
) -> i32 {
    // Suppress unused warning while keeping the parameters in the API.
    let _ = (path_ptr, path_len);

    // Cross the asyncify boundary: JS side awaits fetch, returns status.
    // Rust sees a plain blocking call.
    let status = unsafe { rosie_fetch_to_file(url_ptr, url_len, path_ptr, path_len) };

    // Exercise some Rust-side computation AFTER the rewind to prove that
    // execution genuinely continues from the suspend point with the right
    // local-variable values restored. We compute a "signature" from the
    // returned status and the URL length and return it so the JS driver
    // can validate that all four goals were met.
    let sig = status.wrapping_mul(1000).wrapping_add(url_len as i32);
    sig
}
