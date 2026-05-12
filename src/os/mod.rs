// OS-interaction boundary.
//
// Every fs / env / time call in rosie goes through this module. The native
// impl wraps `std::fs`, `std::env`, etc. The wasm impl declares `extern "C"`
// stubs that dispatch to JS via the shim — this is required because
// `std::fs` is unsafe under wasm-opt --asyncify (wasi-libc gets corrupted by
// the unwind-instrumentation pass).
//
// Rule: no code outside this module is allowed to import `std::fs`,
// `std::env`, or `std::time`. Path manipulation (`std::path::PathBuf`) is
// pure CPU work and stays free for everyone.

#[cfg(not(target_arch = "wasm32"))]
mod native;
#[cfg(not(target_arch = "wasm32"))]
pub use native::*;

#[cfg(target_arch = "wasm32")]
mod wasm;
#[cfg(target_arch = "wasm32")]
pub use wasm::*;
