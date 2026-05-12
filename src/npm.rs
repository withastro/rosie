// Walks `node_modules/<pkg>/` for *.md files used as references, plus the
// slug helpers that turn package + file path into a stable install name.

use crate::os;
use std::path::{Path, PathBuf};

const MAX_WALK_DEPTH: u32 = 16;

/// Walk the package root for *.md files. Layout matches `npm_collect_files`
/// from npm.c:
///   - When `include_paths` is empty: default scope is README at root +
///     `docs/**/*.md`.
///   - Otherwise each `include` is interpreted relative to pkg_root. .md
///     paths are taken as exact files; anything else is a directory walked
///     recursively for *.md.
/// nested `node_modules` is always skipped. Results are deduplicated.
pub fn collect_files(pkg_root: &Path, include_paths: &[&str]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();

    if !include_paths.is_empty() {
        for inc in include_paths {
            if inc.is_empty() {
                continue;
            }
            let abs = pkg_root.join(inc);
            let meta = match os::symlink_metadata(&abs) {
                Ok(m) => m,
                Err(_) => {
                    crate::log::info(&format!(
                        "warning: --include path not found in package: {inc}"
                    ));
                    continue;
                }
            };
            match meta.kind {
                os::FileKind::File => {
                    if inc.ends_with(".md") {
                        push_unique(&mut out, inc.to_string());
                    } else {
                        crate::log::info(&format!(
                            "warning: --include file is not a .md file: {inc}"
                        ));
                    }
                }
                os::FileKind::Dir => walk_for_md(pkg_root, inc, &mut out, 0),
                _ => {}
            }
        }
        return out;
    }

    // Default scope: README + docs/**.md
    if let Some(readme) = find_readme(pkg_root) {
        push_unique(&mut out, readme);
    }
    let docs = pkg_root.join("docs");
    if os::is_dir(&docs) {
        walk_for_md(pkg_root, "docs", &mut out, 0);
    }
    out
}

/// Case-insensitive lookup for README.md (or readme.md / Readme.md / ...) at
/// the package root. Returns the actual filename or None.
fn find_readme(pkg_root: &Path) -> Option<String> {
    let entries = os::read_dir(pkg_root).ok()?;
    for name in entries {
        if !name.eq_ignore_ascii_case("readme.md") {
            continue;
        }
        let full = pkg_root.join(&name);
        if os::is_file(&full) {
            return Some(name);
        }
    }
    None
}

fn push_unique(out: &mut Vec<String>, s: String) {
    if !out.iter().any(|x| x == &s) {
        out.push(s);
    }
}

/// Append every *.md under `<pkg_root>/<rel_prefix>` (excluding nested
/// node_modules) to `out`, with the path stored relative to pkg_root.
fn walk_for_md(pkg_root: &Path, rel_prefix: &str, out: &mut Vec<String>, depth: u32) {
    if depth > MAX_WALK_DEPTH {
        return;
    }
    let abs_dir: PathBuf = if rel_prefix.is_empty() {
        pkg_root.to_path_buf()
    } else {
        pkg_root.join(rel_prefix)
    };
    let entries = match os::read_dir(&abs_dir) {
        Ok(v) => v,
        Err(_) => return,
    };
    for name in entries {
        if name == "node_modules" {
            continue;
        }
        let child_rel = if rel_prefix.is_empty() {
            name.clone()
        } else {
            // We use forward slashes in lockfile / display paths.
            format!("{rel_prefix}/{name}")
        };
        let child_abs = pkg_root.join(&child_rel);
        let meta = match os::symlink_metadata(&child_abs) {
            Ok(m) => m,
            Err(_) => continue,
        };
        match meta.kind {
            os::FileKind::Dir => walk_for_md(pkg_root, &child_rel, out, depth + 1),
            os::FileKind::File if name.ends_with(".md") => {
                push_unique(out, child_rel);
            }
            _ => {}
        }
    }
}

// ---- slug helpers ----------------------------------------------------------

/// "@tanstack/react-query" -> "tanstack-react-query"
/// "react"               -> "react"
pub fn pkg_slug(pkg: &str) -> String {
    let s = pkg.strip_prefix('@').unwrap_or(pkg);
    s.chars()
        .map(|c| match c {
            '/' => '-',
            other => other.to_ascii_lowercase(),
        })
        .collect()
}

/// "docs/hooks.md" -> "docs-hooks"
/// "README.md"     -> "readme"
pub fn file_slug(rel_path: &str) -> String {
    let trimmed = rel_path.strip_suffix(".md").unwrap_or(rel_path);
    trimmed
        .chars()
        .map(|c| match c {
            '/' => '-',
            other => other.to_ascii_lowercase(),
        })
        .collect()
}

/// "<pkg-slug>-<file-slug>"
pub fn ref_name(pkg: &str, rel_path: &str) -> String {
    format!("{}-{}", pkg_slug(pkg), file_slug(rel_path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slug_examples_from_design() {
        assert_eq!(pkg_slug("@tanstack/react-query"), "tanstack-react-query");
        assert_eq!(pkg_slug("react"), "react");
        assert_eq!(file_slug("docs/hooks.md"), "docs-hooks");
        assert_eq!(file_slug("README.md"), "readme");
        assert_eq!(ref_name("react", "README.md"), "react-readme");
        assert_eq!(ref_name("react", "docs/hooks.md"), "react-docs-hooks");
        assert_eq!(
            ref_name("@tanstack/react-query", "README.md"),
            "tanstack-react-query-readme"
        );
    }
}
