// Rosie — a package manager for AI agent skills.
//
// This crate is the full Rust port of the original C implementation. The
// public surface mirrors the C functions one-for-one so the wasm crate can
// expose the same `rosie_api_*` ABI without modification.
//
// Architecture:
//
//   - `os` is the one place where native and wasm diverge. Every fs/env/
//     time call goes through it. On native it wraps `std`; on wasm it
//     dispatches to JS-side `extern "C"` imports.
//   - All other modules use only `os::*`, never `std::fs` / `std::env` /
//     `std::time` directly. The rule keeps the codebase asyncify-safe.
//   - Public function signatures return `i32` at FFI-facing boundaries
//     (matching the C convention of `0 == ok`) so the wasm JSON-envelope
//     code stays a one-liner. Internal Rust code uses `Result` freely.

pub mod os;

pub mod log;
pub mod util;

pub mod agent;
pub mod agentsmd;
pub mod archive;
pub mod cli;
pub mod download;
pub mod http;
pub mod install;
pub mod link;
pub mod lockfile;
pub mod npm;
pub mod resolve;
pub mod skill;

pub const ROSIE_VERSION: &str = "0.5.6";
