// String / path / small-utility helpers.
//
// Most C-side helpers (str_dup, str_trim, etc.) don't need replacement —
// Rust's String / &str cover them. The one piece worth porting is the
// hand-rolled JSON string-field reader from util.c, used to pull `version`
// out of package.json without dragging in serde.

use crate::os;
use std::path::{Path, PathBuf};

/// Joins `base` and `name`, stripping any trailing slashes on `base` and any
/// leading slashes on `name`. Mirrors `path_join` from util.c. Use this when
/// you need C-style path concatenation that produces forward-slash separators
/// (e.g. building lockfile sources). For ordinary filesystem paths, prefer
/// `PathBuf::join`.
pub fn path_join(base: &str, name: &str) -> String {
    let base = base.trim_end_matches('/');
    let name = name.trim_start_matches('/');
    if base.is_empty() {
        format!("/{name}")
    } else {
        format!("{base}/{name}")
    }
}

/// Read a top-level string field from a JSON file. Hand-rolled to avoid a
/// JSON dep. Returns None if the file is missing, the field is absent, or
/// the value isn't a string. Handles \" \\ \/ \n \t \r escapes; passes other
/// backslash escapes through verbatim (matching C behavior).
pub fn read_json_string_field(path: &Path, field: &str) -> Option<String> {
    let contents = os::read_to_string(path).ok()?;
    let bytes = contents.as_bytes();
    let mut i = 0;
    let n = bytes.len();
    while i < n {
        if bytes[i] != b'"' {
            i += 1;
            continue;
        }
        let key_start = i + 1;
        let mut p = key_start;
        while p < n && bytes[p] != b'"' {
            if bytes[p] == b'\\' && p + 1 < n {
                p += 2;
            } else {
                p += 1;
            }
        }
        if p >= n {
            return None;
        }
        let key = &bytes[key_start..p];
        let mut q = p + 1;
        while q < n && matches!(bytes[q], b' ' | b'\t' | b'\n' | b'\r') {
            q += 1;
        }
        if q < n && bytes[q] == b':' {
            q += 1;
            while q < n && matches!(bytes[q], b' ' | b'\t' | b'\n' | b'\r') {
                q += 1;
            }
            if key == field.as_bytes() {
                if q < n && bytes[q] == b'"' {
                    return Some(parse_json_string(&bytes[q + 1..]));
                }
                return None;
            }
            i = q;
            continue;
        }
        i = q;
    }
    None
}

fn parse_json_string(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() && bytes[i] != b'"' {
        if bytes[i] == b'\\' && i + 1 < bytes.len() {
            match bytes[i + 1] {
                b'"' => out.push('"'),
                b'\\' => out.push('\\'),
                b'/' => out.push('/'),
                b'n' => out.push('\n'),
                b't' => out.push('\t'),
                b'r' => out.push('\r'),
                other => out.push(other as char),
            }
            i += 2;
        } else {
            out.push(bytes[i] as char);
            i += 1;
        }
    }
    out
}

/// Build a `<base>.tmp` path for an atomic write. Used by lockfile save.
pub fn tmp_path_for(path: &Path) -> PathBuf {
    let mut s = path.as_os_str().to_owned();
    s.push(".tmp");
    PathBuf::from(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_join_basic() {
        assert_eq!(path_join("a", "b"), "a/b");
        assert_eq!(path_join("a/", "b"), "a/b");
        assert_eq!(path_join("a", "/b"), "a/b");
        assert_eq!(path_join("a/", "/b"), "a/b");
        assert_eq!(path_join("", "b"), "/b");
    }

    #[test]
    fn json_field_simple() {
        let dir = std::env::temp_dir();
        let p = dir.join("rosie-util-test-package.json");
        std::fs::write(&p, br#"{"name":"foo","version":"1.2.3"}"#).unwrap();
        assert_eq!(
            read_json_string_field(&p, "version").as_deref(),
            Some("1.2.3")
        );
        assert_eq!(read_json_string_field(&p, "name").as_deref(), Some("foo"));
        assert_eq!(read_json_string_field(&p, "missing"), None);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn json_field_with_escapes() {
        let dir = std::env::temp_dir();
        let p = dir.join("rosie-util-test-escapes.json");
        std::fs::write(&p, br#"{"v":"a\"b\\c"}"#).unwrap();
        assert_eq!(
            read_json_string_field(&p, "v").as_deref(),
            Some(r#"a"b\c"#)
        );
        let _ = std::fs::remove_file(&p);
    }
}
