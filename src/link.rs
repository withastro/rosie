// Symlink / junction creation.
//
// The actual platform-specific logic lives in `os::create_link`. This module
// is a thin wrapper that returns i32 (mirroring rosie_create_link in
// link.c) and emits a log_error on failure.

use std::path::Path;

/// Create a directory-or-file link from `link_path` to `target`. Returns 0
/// on success, -1 on failure (with a log::error already emitted).
pub fn rosie_create_link(target: &Path, link_path: &Path, is_dir: bool) -> i32 {
    match crate::os::create_link(target, link_path, is_dir) {
        Ok(()) => 0,
        Err(e) => {
            crate::log::error(&format!("{e}"));
            -1
        }
    }
}
