// Package-spec parsing + tarball-URL construction + the branch-then-tag
// fallback download. Mirrors download.c.
//
// Supported spec forms:
//   owner/repo[@ref][#skill]           — remote, default ref "main"
//   ./<path>, /<abs>, ~/<rel>, .., .   — local symlinkable skill
//   file://<rel>                       — same, from a lockfile source
//   npm:<pkg>[#<rel-path>]             — npm-ref source (from lockfile)

use crate::os;
use crate::util;
use std::path::{Path, PathBuf};

pub const LOCAL_SOURCE_PREFIX: &str = "file://";
pub const NPM_SOURCE_PREFIX: &str = "npm:";

#[derive(Debug, Clone)]
pub struct PackageSpec {
    pub owner: Option<String>,
    pub repo: Option<String>,
    pub ref_: Option<String>, // defaulted to "main" for remote specs
    pub ref_explicit: bool,
    pub skill_in_spec: Option<String>,
    pub is_local: bool,
    pub local_path: Option<String>,
}

impl PackageSpec {
    pub fn is_remote(&self) -> bool {
        !self.is_local
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefKind {
    Branch,
    Tag,
}

pub fn source_is_local(source: &str) -> bool {
    source.starts_with(LOCAL_SOURCE_PREFIX)
}

pub fn source_local_path(source: &str) -> Option<&str> {
    source.strip_prefix(LOCAL_SOURCE_PREFIX)
}

pub fn source_is_npm(source: &str) -> bool {
    source.starts_with(NPM_SOURCE_PREFIX)
}

pub fn source_npm_after_prefix(source: &str) -> Option<&str> {
    source.strip_prefix(NPM_SOURCE_PREFIX)
}

/// Split "npm:<pkg>#<file>" into (pkg, file). file is None when no #.
pub fn source_npm_split(source: &str) -> Option<(String, Option<String>)> {
    let body = source_npm_after_prefix(source)?;
    // Last '#' (defensive; npm names contain no '#').
    if let Some(idx) = body.rfind('#') {
        let pkg = body[..idx].to_string();
        let file = if idx + 1 < body.len() {
            Some(body[idx + 1..].to_string())
        } else {
            None
        };
        Some((pkg, file))
    } else {
        Some((body.to_string(), None))
    }
}

/// True if the user-supplied argument is a local path rather than owner/repo.
/// Mirrors `looks_like_local_path` from download.c — leading characters that
/// can't appear in a GitHub owner.
fn looks_like_local_path(spec: &str) -> bool {
    if spec.is_empty() {
        return false;
    }
    if spec == "." {
        return true;
    }
    let b = spec.as_bytes();
    if b[0] == b'/' {
        return true;
    }
    if b.len() >= 2 && b[0] == b'~' && b[1] == b'/' {
        return true;
    }
    if b.len() >= 2 && b[0] == b'.' && b[1] == b'/' {
        return true;
    }
    if b.len() >= 3 && b[0] == b'.' && b[1] == b'.' && b[2] == b'/' {
        return true;
    }
    false
}

/// Resolve a user-supplied path to a "./<rel>" form rooted at the current
/// working directory. Expands a leading `~/`, canonicalizes via std::fs::
/// canonicalize, rejects paths outside the cwd.
fn canonicalize_local_path(user_path: &str) -> Option<String> {
    if user_path.is_empty() {
        return None;
    }

    let expanded: PathBuf = if let Some(rest) = user_path.strip_prefix("~/") {
        match os::home_dir() {
            Some(h) => PathBuf::from(h).join(rest),
            None => {
                crate::log::error("Cannot expand ~ (HOME not set)");
                return None;
            }
        }
    } else {
        PathBuf::from(user_path)
    };

    let abs = match std::fs::canonicalize(&expanded) {
        Ok(p) => p,
        Err(_) => {
            crate::log::error(&format!("Cannot resolve path: {user_path}"));
            return None;
        }
    };

    let cwd = match os::current_dir() {
        Ok(p) => p,
        Err(_) => {
            crate::log::error("Cannot get current directory");
            return None;
        }
    };

    let rel = match abs.strip_prefix(&cwd) {
        Ok(p) => p,
        Err(_) => {
            crate::log::error(&format!(
                "Local skill path is outside the project: {user_path}"
            ));
            return None;
        }
    };

    let rel_str = rel.to_string_lossy();
    if rel_str.is_empty() || rel_str == "" {
        Some(".".to_string())
    } else {
        Some(format!("./{rel_str}"))
    }
}

pub fn parse(spec: &str) -> Option<PackageSpec> {
    // Local-path / file:// shortcut.
    let local_input: Option<&str> = if source_is_local(spec) {
        source_local_path(spec)
    } else if looks_like_local_path(spec) {
        Some(spec)
    } else {
        None
    };
    if let Some(p) = local_input {
        let canonical = canonicalize_local_path(p)?;
        return Some(PackageSpec {
            owner: None,
            repo: None,
            ref_: None,
            ref_explicit: false,
            skill_in_spec: None,
            is_local: true,
            local_path: Some(canonical),
        });
    }

    let work = spec.to_string();

    // @ref suffix
    let (work, ref_, ref_explicit) = match work.split_once('@') {
        Some((head, tail)) => (head.to_string(), tail.to_string(), true),
        None => (work, "main".to_string(), false),
    };

    // #skill suffix (after stripping @ref)
    let (work, skill_in_spec) = match work.split_once('#') {
        Some((head, tail)) if !tail.is_empty() => (head.to_string(), Some(tail.to_string())),
        Some((head, _)) => (head.to_string(), None),
        None => (work, None),
    };

    // owner/repo
    let (owner, repo) = match work.split_once('/') {
        Some((o, r)) => (o.to_string(), r.to_string()),
        None => {
            crate::log::error(&format!("Invalid package spec: {spec} (expected owner/repo)"));
            return None;
        }
    };
    if owner.is_empty() || repo.is_empty() {
        crate::log::error(&format!(
            "Invalid package spec: {spec} (empty owner or repo)"
        ));
        return None;
    }

    Some(PackageSpec {
        owner: Some(owner),
        repo: Some(repo),
        ref_: Some(ref_),
        ref_explicit,
        skill_in_spec,
        is_local: false,
        local_path: None,
    })
}

// ---- URL building ----------------------------------------------------------

pub fn build_tarball_url(spec: &PackageSpec, kind: RefKind) -> Option<String> {
    let owner = spec.owner.as_ref()?;
    let repo = spec.repo.as_ref()?;
    let r = spec.ref_.as_ref()?;
    let kind_segment = match kind {
        RefKind::Tag => "tags",
        RefKind::Branch => "heads",
    };
    let base = crate::http::github_base_url();
    Some(format!(
        "{base}/{owner}/{repo}/archive/refs/{kind_segment}/{r}.tar.gz"
    ))
}

// ---- tarball download with branch-then-tag fallback -----------------------

/// Download the package tarball. Tries refs/heads/<ref> first; on 404
/// falls back to refs/tags/<ref>. Returns 0 on success, -1 on failure.
pub fn download_package_tarball(spec: &PackageSpec, output_path: &Path) -> i32 {
    let url = match build_tarball_url(spec, RefKind::Branch) {
        Some(u) => u,
        None => return -1,
    };
    let status = crate::http::fetch_to_file(&url, output_path);

    if status < 0 {
        return -1;
    }
    if status < 400 {
        return 0;
    }
    if status != 404 {
        crate::log::error(&format!("HTTP error: {status}"));
        return -1;
    }

    let ref_name = spec.ref_.as_deref().unwrap_or("");
    crate::log::debug(&format!(
        "Ref '{ref_name}' not found as branch, trying as tag"
    ));
    let url = match build_tarball_url(spec, RefKind::Tag) {
        Some(u) => u,
        None => return -1,
    };
    let status = crate::http::fetch_to_file(&url, output_path);
    if status < 0 {
        return -1;
    }
    if status >= 400 {
        crate::log::error(&format!(
            "Ref '{ref_name}' not found as branch or tag (HTTP {status})"
        ));
        return -1;
    }
    0
}

/// Build "<base>.tmp" — convenience wrapper used by install.rs.
pub fn tmp_archive_path(dest_dir: &Path, name: &str) -> PathBuf {
    let mut p = dest_dir.to_path_buf();
    p.push(name);
    util::tmp_path_for(&p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_basic() {
        let s = parse("foo/bar").unwrap();
        assert_eq!(s.owner.as_deref(), Some("foo"));
        assert_eq!(s.repo.as_deref(), Some("bar"));
        assert_eq!(s.ref_.as_deref(), Some("main"));
        assert!(!s.ref_explicit);
    }

    #[test]
    fn parse_pinned() {
        let s = parse("foo/bar@v1.0.0").unwrap();
        assert_eq!(s.ref_.as_deref(), Some("v1.0.0"));
        assert!(s.ref_explicit);
    }

    #[test]
    fn parse_with_skill() {
        let s = parse("foo/bar#my-skill@main").unwrap();
        assert_eq!(s.ref_.as_deref(), Some("main"));
        assert!(s.ref_explicit);
        assert_eq!(s.skill_in_spec.as_deref(), Some("my-skill"));
    }

    #[test]
    fn parse_invalid() {
        crate::log::clear_last_error();
        assert!(parse("foo").is_none());
        assert!(crate::log::last_error_message().is_some());
    }

    #[test]
    fn npm_split() {
        let (p, f) = source_npm_split("npm:react#README.md").unwrap();
        assert_eq!(p, "react");
        assert_eq!(f.as_deref(), Some("README.md"));
        let (p, f) = source_npm_split("npm:@tanstack/react-query#docs/x.md").unwrap();
        assert_eq!(p, "@tanstack/react-query");
        assert_eq!(f.as_deref(), Some("docs/x.md"));
    }

    #[test]
    fn url_build() {
        let spec = parse("vercel/next.js@v14.0.0").unwrap();
        // Use a deterministic base URL for the test.
        std::env::set_var("ROSIE_GITHUB_BASE_URL", "https://example.test");
        assert_eq!(
            build_tarball_url(&spec, RefKind::Tag).unwrap(),
            "https://example.test/vercel/next.js/archive/refs/tags/v14.0.0.tar.gz"
        );
        std::env::remove_var("ROSIE_GITHUB_BASE_URL");
    }
}
