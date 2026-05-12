// Logging contract — mirrors C's util.c log_info / log_error / log_debug.
//
// Two consumers:
//   - CLI prints to stdout/stderr.
//   - WASM API stashes through a JS callback set via `set_callback`, and
//     reads the last error from a global static so it can be put into the
//     JSON envelope returned to TypeScript.
//
// The contract that must not break:
//   - log::error always updates LAST_ERROR (even when a callback is set).
//   - clear_last_error / last_error_message are read by wasm/src/lib.rs.
//   - set_callback(None) restores default CLI behavior.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Error = 0,
    Warn = 1,
    Info = 2,
    Debug = 3,
}

pub type Callback = Box<dyn Fn(Level, &str) + Send + Sync>;

static VERBOSE: AtomicBool = AtomicBool::new(false);
static CALLBACK: Mutex<Option<Callback>> = Mutex::new(None);
static LAST_ERROR: Mutex<Option<String>> = Mutex::new(None);

pub fn set_verbose(v: bool) {
    VERBOSE.store(v, Ordering::Relaxed);
}

pub fn verbose() -> bool {
    VERBOSE.load(Ordering::Relaxed)
}

pub fn set_callback(cb: Option<Callback>) {
    *CALLBACK.lock().unwrap() = cb;
}

pub fn last_error_message() -> Option<String> {
    LAST_ERROR.lock().unwrap().clone()
}

pub fn clear_last_error() {
    *LAST_ERROR.lock().unwrap() = None;
}

fn dispatch(level: Level, message: &str) {
    if let Some(cb) = CALLBACK.lock().unwrap().as_ref() {
        cb(level, message);
        return;
    }
    match level {
        Level::Error => eprintln!("rosie: error: {}", message),
        Level::Debug => {
            if verbose() {
                println!("[debug] {}", message);
            }
        }
        _ => println!("{}", message),
    }
}

pub fn info(message: &str) {
    dispatch(Level::Info, message);
}

pub fn error(message: &str) {
    *LAST_ERROR.lock().unwrap() = Some(message.to_string());
    dispatch(Level::Error, message);
}

pub fn debug(message: &str) {
    if !verbose() && CALLBACK.lock().unwrap().is_none() {
        return;
    }
    dispatch(Level::Debug, message);
}

// Convenience macros mirroring log_info(fmt, ...) calls in C.
#[macro_export]
macro_rules! log_info {
    ($($arg:tt)*) => { $crate::log::info(&format!($($arg)*)) };
}

#[macro_export]
macro_rules! log_error {
    ($($arg:tt)*) => { $crate::log::error(&format!($($arg)*)) };
}

#[macro_export]
macro_rules! log_debug {
    ($($arg:tt)*) => { $crate::log::debug(&format!($($arg)*)) };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn last_error_round_trip() {
        clear_last_error();
        error("boom");
        assert_eq!(last_error_message().as_deref(), Some("boom"));
        clear_last_error();
        assert_eq!(last_error_message(), None);
    }
}
