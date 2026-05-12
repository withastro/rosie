// rosie-wasm — cdylib that mirrors wasm/api.c byte-for-byte on the wire.
//
// Seven exported functions return a malloc'd char* JSON envelope:
//   {"ok": true, "data": <result>}        on success
//   {"ok": false, "error": "<message>"}   on failure
//
// JS reads the string via UTF8ToString and calls rosie_free to release it.
//
// In addition we expose:
//   - asyncify_buf_ptr / asyncify_buf_size: the 64 KB stack-saving buffer
//     used by the JS-side asyncify state machine.
//   - rosie_malloc / rosie_free: bridge to Rust's allocator so the JS shim
//     can hand back ownership of out-buffers from fetch_to_buffer.
//   - _initialize: stub that calls __wasm_call_ctors to run wasi-libc
//     startup. Node WASI's wasi.initialize(instance) dispatches it.

#![allow(clippy::missing_safety_doc)]

use rosie::install::{self, InstallOptions, RemoveOptions};
use std::ffi::{CStr, CString};
use std::os::raw::c_char;

// ---- _initialize stub + wasi-libc constructors ---------------------------

extern "C" {
    fn __wasm_call_ctors();
}

#[no_mangle]
pub extern "C" fn _initialize() {
    unsafe { __wasm_call_ctors(); }
}

// ---- Allocator export ----------------------------------------------------
//
// The JS shim allocates wasm-memory buffers for fetch_to_buffer return values
// by calling rosie_malloc(size). Rust takes ownership later via
// Vec::from_raw_parts inside http::fetch_to_buffer.

#[no_mangle]
pub extern "C" fn rosie_malloc(size: usize) -> *mut u8 {
    if size == 0 {
        return std::ptr::null_mut();
    }
    let mut v: Vec<u8> = Vec::with_capacity(size);
    let ptr = v.as_mut_ptr();
    std::mem::forget(v);
    ptr
}

#[no_mangle]
pub unsafe extern "C" fn rosie_free(ptr: *mut u8, size: usize) {
    if !ptr.is_null() && size > 0 {
        let _ = Vec::from_raw_parts(ptr, size, size);
    }
}

/// Free a NUL-terminated C string that one of the rosie_api_* functions
/// returned. The JSON envelopes are produced via CString::into_raw, so this
/// is the only correct way to release them. JS calls it via Module._free.
#[no_mangle]
pub unsafe extern "C" fn rosie_free_cstring(ptr: *mut c_char) {
    if !ptr.is_null() {
        let _ = CString::from_raw(ptr);
    }
}

// ---- Asyncify buffer -----------------------------------------------------
//
// Asyncify needs a writable region with an 8-byte [stack_start, stack_end]
// header at its start. The JS shim writes the header at startup and passes
// `asyncify_buf_ptr()` to asyncify_start_unwind / asyncify_start_rewind.

const ASYNCIFY_BUF_SIZE: usize = 65_536;
static mut ASYNCIFY_BUF: [u8; ASYNCIFY_BUF_SIZE] = [0; ASYNCIFY_BUF_SIZE];

#[no_mangle]
pub extern "C" fn asyncify_buf_ptr() -> *mut u8 {
    // `addr_of_mut!` instead of `&mut ASYNCIFY_BUF` avoids the 2024-edition
    // static_mut_refs lint. Taking a raw pointer is safe; only deref
    // would be unsafe, and we hand the pointer to JS which never derefs
    // it directly — asyncify_start_unwind reads the buffer header.
    std::ptr::addr_of_mut!(ASYNCIFY_BUF) as *mut u8
}

#[no_mangle]
pub extern "C" fn asyncify_buf_size() -> usize {
    ASYNCIFY_BUF_SIZE
}

// ---- JSON envelope -------------------------------------------------------

struct JsonBuf(String);

impl JsonBuf {
    fn new() -> Self {
        JsonBuf(String::new())
    }
    fn push_str(&mut self, s: &str) {
        self.0.push_str(s);
    }
    fn push_char(&mut self, c: char) {
        self.0.push(c);
    }
    fn push_bool(&mut self, v: bool) {
        self.0.push_str(if v { "true" } else { "false" });
    }
    fn push_null(&mut self) {
        self.0.push_str("null");
    }
    /// Emit a JSON string literal (with quotes). Encodes \"  \\  \n  \r  \t
    /// and \u00xx for other control chars; lets non-ASCII bytes through.
    fn push_string(&mut self, s: &str) {
        self.0.push('"');
        for c in s.chars() {
            match c {
                '"' => self.0.push_str("\\\""),
                '\\' => self.0.push_str("\\\\"),
                '\n' => self.0.push_str("\\n"),
                '\r' => self.0.push_str("\\r"),
                '\t' => self.0.push_str("\\t"),
                c if (c as u32) < 0x20 => {
                    self.0.push_str(&format!("\\u{:04x}", c as u32));
                }
                c => self.0.push(c),
            }
        }
        self.0.push('"');
    }
    /// Sentinel-aware string emit: "-" becomes null. Mirrors the C envelope.
    fn push_string_or_null(&mut self, s: &str) {
        if s == "-" {
            self.push_null();
        } else {
            self.push_string(s);
        }
    }
}

fn envelope_ok(data: &str) -> *mut c_char {
    let mut out = String::from("{\"ok\":true,\"data\":");
    out.push_str(data);
    out.push('}');
    CString::new(out).unwrap().into_raw()
}

fn envelope_err(msg: &str) -> *mut c_char {
    let mut buf = JsonBuf::new();
    buf.push_str("{\"ok\":false,\"error\":");
    buf.push_string(msg);
    buf.push_char('}');
    CString::new(buf.0).unwrap().into_raw()
}

fn envelope_err_from_last(default: &str) -> *mut c_char {
    let msg = rosie::log::last_error_message().unwrap_or_else(|| default.to_string());
    envelope_err(&msg)
}

/// Build the JSON body for an install-shape result, drawing per-skill agent
/// outcomes from the report buffer. Shape:
///   {
///     "skills": [
///       { "name": "...", "kind": "skill"|"reference",
///         "installedAgents": [...], "failedAgents": [...] }
///     ],
///     "installedAgents": [...],     // union across all skills, deduped
///     "failedAgents":    [...],     // union across all skills, deduped
///     "installedInstruction": "AGENTS.md" | "CLAUDE.md" | ... | null
///   }
fn install_result_json() -> String {
    let reports = rosie::report::drain();
    let instruction_file = rosie::report::take_instruction_file();

    let mut all_ok: Vec<String> = Vec::new();
    let mut all_fail: Vec<String> = Vec::new();
    for r in &reports {
        for n in &r.installed_agents {
            if !all_ok.iter().any(|x| x == n) {
                all_ok.push(n.clone());
            }
        }
        for n in &r.failed_agents {
            if !all_fail.iter().any(|x| x == n) {
                all_fail.push(n.clone());
            }
        }
    }

    let mut buf = JsonBuf::new();
    buf.push_str("{\"skills\":[");
    for (i, r) in reports.iter().enumerate() {
        if i > 0 {
            buf.push_char(',');
        }
        buf.push_str("{\"name\":");
        buf.push_string(&r.skill_name);
        buf.push_str(",\"kind\":");
        buf.push_string(r.kind.as_str());
        buf.push_str(",\"installedAgents\":");
        push_str_array(&mut buf, &r.installed_agents);
        buf.push_str(",\"failedAgents\":");
        push_str_array(&mut buf, &r.failed_agents);
        buf.push_char('}');
    }
    buf.push_str("],\"installedAgents\":");
    push_str_array(&mut buf, &all_ok);
    buf.push_str(",\"failedAgents\":");
    push_str_array(&mut buf, &all_fail);
    buf.push_str(",\"installedInstruction\":");
    match instruction_file {
        Some(s) => buf.push_string(&s),
        None => buf.push_null(),
    }
    buf.push_char('}');
    buf.0
}

fn push_str_array(buf: &mut JsonBuf, items: &[String]) {
    buf.push_char('[');
    for (i, s) in items.iter().enumerate() {
        if i > 0 {
            buf.push_char(',');
        }
        buf.push_string(s);
    }
    buf.push_char(']');
}

// ---- safe string conversion ---------------------------------------------

unsafe fn cstr_to_str(ptr: *const c_char) -> Option<&'static str> {
    if ptr.is_null() {
        return None;
    }
    CStr::from_ptr(ptr).to_str().ok()
}

unsafe fn cstr_to_owned(ptr: *const c_char) -> Option<String> {
    cstr_to_str(ptr).map(String::from)
}

fn split_csv(s: Option<&str>, sep: char) -> Vec<String> {
    match s {
        Some(s) if !s.is_empty() => s.split(sep).map(String::from).collect(),
        _ => Vec::new(),
    }
}

// ---- Public exports -----------------------------------------------------

/// JS one-shot setup. Installs a log callback that bridges into JS via the
/// implementation-defined `dispatch_log_to_js` import (see shim.js).
#[no_mangle]
pub extern "C" fn rosie_api_install_log_bridge() {
    extern "C" {
        fn dispatch_log_to_js(level: i32, message_ptr: *const u8, message_len: usize);
    }
    let cb: Box<dyn Fn(rosie::log::Level, &str) + Send + Sync> = Box::new(|level, msg| unsafe {
        dispatch_log_to_js(level as i32, msg.as_ptr(), msg.len());
    });
    rosie::log::set_callback(Some(cb));
}

#[no_mangle]
pub extern "C" fn rosie_api_set_verbose(verbose: i32) {
    rosie::log::set_verbose(verbose != 0);
}

#[no_mangle]
pub extern "C" fn rosie_api_list_installed() -> *mut c_char {
    rosie::log::clear_last_error();
    let lf = rosie::lockfile::Lockfile::load(std::path::Path::new(install::LOCAL_AGENTS_DIR));
    let mut data = JsonBuf::new();
    data.push_char('[');
    for (i, e) in lf.entries.iter().enumerate() {
        if i > 0 {
            data.push_char(',');
        }
        data.push_str("{\"name\":");
        data.push_string(&e.skill_name);
        data.push_str(",\"source\":");
        data.push_string(&e.source);
        data.push_str(",\"ref\":");
        data.push_string_or_null(&e.ref_);
        data.push_str(",\"sha\":");
        data.push_string_or_null(&e.sha);
        data.push_str(",\"isReference\":");
        data.push_bool(e.kind == rosie::lockfile::LockKind::Ref);
        data.push_char('}');
    }
    data.push_char(']');
    envelope_ok(&data.0)
}

#[no_mangle]
pub extern "C" fn rosie_api_agents() -> *mut c_char {
    rosie::log::clear_last_error();
    let detected = rosie::agent::detect_agents(true);
    let mut data = JsonBuf::new();
    data.push_char('[');
    for (i, def) in rosie::agent::AGENT_DEFS.iter().enumerate() {
        if i > 0 {
            data.push_char(',');
        }
        // Match by name (def is &AgentDef; detected entries embed AgentDef by value).
        let m = detected.iter().find(|a| a.def.name == def.name);
        data.push_str("{\"name\":");
        data.push_string(def.name);
        data.push_str(",\"display\":");
        data.push_string(def.display);
        data.push_str(",\"detected\":");
        data.push_bool(m.is_some());
        data.push_str(",\"installPath\":");
        match m {
            Some(a) => data.push_string(&a.install_path.to_string_lossy()),
            None => data.push_null(),
        }
        data.push_char('}');
    }
    data.push_char(']');
    envelope_ok(&data.0)
}

/// Argument list (all C strings):
///   spec, skill_name, agent_names_csv, name_override, include_paths_nl
/// Followed by 4 ints: is_reference, is_npm, global, skip_lockfile.
///
/// The CSV split uses ',' for agent_names_csv and '\n' for include_paths_nl.
/// Both forms accept NULL/empty to mean "no override". yes=true is implied
/// (the API never prompts).
#[no_mangle]
pub unsafe extern "C" fn rosie_api_install(
    spec: *const c_char,
    skill_name: *const c_char,
    agent_names_csv: *const c_char,
    name_override: *const c_char,
    include_paths_nl: *const c_char,
    is_reference: i32,
    is_npm: i32,
    global: i32,
    skip_lockfile: i32,
) -> *mut c_char {
    rosie::log::clear_last_error();
    rosie::report::clear();

    let opts = InstallOptions {
        spec: cstr_to_owned(spec).filter(|s| !s.is_empty()),
        skill_name: cstr_to_owned(skill_name).filter(|s| !s.is_empty()),
        agent_names: split_csv(cstr_to_str(agent_names_csv), ','),
        global: global != 0,
        yes: true,
        list_only: false,
        is_reference: is_reference != 0,
        name_override: cstr_to_owned(name_override).filter(|s| !s.is_empty()),
        is_npm: is_npm != 0,
        include_paths: split_csv(cstr_to_str(include_paths_nl), '\n'),
        skip_lockfile: skip_lockfile != 0,
        override_pinned: false,
        pinned: false,
    };

    let rc = if opts.spec.is_none() {
        install::install_from_lockfile(&opts)
    } else {
        install::install_package(&opts)
    };
    if rc != 0 {
        return envelope_err_from_last("install failed");
    }
    let result = install_result_json();
    envelope_ok(&result)
}

#[no_mangle]
pub unsafe extern "C" fn rosie_api_remove(
    skill_name: *const c_char,
    agent_names_csv: *const c_char,
    global: i32,
    skip_lockfile: i32,
) -> *mut c_char {
    rosie::log::clear_last_error();
    let name = match cstr_to_owned(skill_name).filter(|s| !s.is_empty()) {
        Some(s) => s,
        None => return envelope_err("skill name is required"),
    };
    let opts = RemoveOptions {
        skill_name: name,
        agent_names: split_csv(cstr_to_str(agent_names_csv), ','),
        global: global != 0,
        yes: true,
        skip_lockfile: skip_lockfile != 0,
    };
    let rc = install::remove_skill(&opts);
    if rc != 0 {
        return envelope_err_from_last("remove failed");
    }
    envelope_ok("null")
}

/// only_skill = null or "" → update every entry; otherwise just that one.
#[no_mangle]
pub unsafe extern "C" fn rosie_api_update(
    only_skill: *const c_char,
    skip_lockfile: i32,
) -> *mut c_char {
    rosie::log::clear_last_error();
    rosie::report::clear();
    let mut opts = InstallOptions::default();
    opts.yes = true;
    opts.global = false;
    opts.skip_lockfile = skip_lockfile != 0;
    let target = cstr_to_owned(only_skill).filter(|s| !s.is_empty());
    let rc = install::update_skills(&opts, target.as_deref());
    if rc != 0 {
        return envelope_err_from_last("update failed");
    }
    let result = install_result_json();
    envelope_ok(&result)
}

/// Set by JS to flag a Windows host. Drives platform-specific link routing.
/// Optional — defaults to POSIX behavior when unset.
#[no_mangle]
pub unsafe extern "C" fn rosie_api_set_host_platform(platform: *const c_char) {
    let _ = platform;
    // The os::wasm module decides per-call which JS import to invoke. The
    // shim itself can branch on process.platform; this export stays as a
    // no-op to preserve the C ABI surface the TS wrapper expects.
}

/// CLI entry for `npx rosie-skills ...`. The JS launcher (bin.ts) calls
/// this when the platform has no native binary and the WASM fallback
/// kicks in.
///
/// `argv` is a unit-separator-delimited (\x1f) string of args, NOT
/// including the program name — rosie::cli::run prepends "rosie" itself.
/// We use \x1f instead of \0 because the ccall path passes through a
/// NUL-terminated CStr and \0 would truncate at the first separator.
///
/// Returns the process exit code (0/1/255, sign-extended for Rust's
/// negative-i32 errors).
#[no_mangle]
pub unsafe extern "C" fn rosie_api_main(argv: *const c_char) -> i32 {
    rosie::log::clear_last_error();
    let argv = cstr_to_owned(argv).unwrap_or_default();
    let mut args: Vec<std::ffi::OsString> = vec!["rosie".into()];
    if !argv.is_empty() {
        for part in argv.split('\x1f') {
            args.push(std::ffi::OsString::from(part));
        }
    }
    rosie::cli::run(args)
}
