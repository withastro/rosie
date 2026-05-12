// Git smart-HTTP info/refs resolver. Direct port of resolve.c.
//
// Queries `<base>/<owner>/<repo>/info/refs?service=git-upload-pack`, parses
// the pkt-line response, and exposes:
//   - resolve_latest_tag(spec):    highest semver tag (skipping pre-releases)
//   - resolve_ref(spec, ref_name): SHA for a specific branch or tag name
//
// Used by install_package's auto-pin behavior (no @ref → latest tag) and by
// `rosie update` to refresh SHAs.

use crate::download::PackageSpec;

#[derive(Debug, Clone)]
pub struct ResolvedRef {
    pub ref_: String,
    pub sha: String,
    pub is_tag: bool,
}

#[derive(Debug, Clone)]
struct RawRef {
    sha: String, // 40-char hex
    name: String,
}

// ---- pkt-line parser ------------------------------------------------------

fn hex_value(c: u8) -> i32 {
    match c {
        b'0'..=b'9' => (c - b'0') as i32,
        b'a'..=b'f' => (c - b'a' + 10) as i32,
        b'A'..=b'F' => (c - b'A' + 10) as i32,
        _ => -1,
    }
}

fn parse_pkt_len(bytes: &[u8]) -> Option<usize> {
    if bytes.len() < 4 {
        return None;
    }
    let mut v: usize = 0;
    for &b in &bytes[..4] {
        let h = hex_value(b);
        if h < 0 {
            return None;
        }
        v = v * 16 + h as usize;
    }
    Some(v)
}

fn parse_refs(body: &[u8]) -> Option<Vec<RawRef>> {
    let mut out: Vec<RawRef> = Vec::new();
    let mut pos = 0;
    while pos + 4 <= body.len() {
        let len = match parse_pkt_len(&body[pos..]) {
            Some(n) => n,
            None => {
                crate::log::debug(&format!("Malformed pkt-line at offset {pos}"));
                return None;
            }
        };
        if len == 0 {
            pos += 4;
            continue;
        }
        if len < 4 || pos + len > body.len() {
            crate::log::debug(&format!("Bad pkt length {len} at offset {pos}"));
            return None;
        }
        let data_start = pos + 4;
        let data_end = pos + len;
        let mut data = &body[data_start..data_end];
        pos = data_end;

        // Strip trailing CR/LF.
        while let Some(&last) = data.last() {
            if last == b'\n' || last == b'\r' {
                data = &data[..data.len() - 1];
            } else {
                break;
            }
        }

        // Service header lines start with '#'.
        if data.first() == Some(&b'#') {
            continue;
        }

        // First ref line: "<sha> <name>\0<capabilities>"
        let effective = data.iter().position(|&b| b == 0).unwrap_or(data.len());
        let data = &data[..effective];

        if data.len() < 42 || data[40] != b' ' {
            continue;
        }
        let sha_ok = data[..40].iter().all(|&b| hex_value(b) >= 0);
        if !sha_ok {
            continue;
        }
        let sha = std::str::from_utf8(&data[..40]).ok()?.to_string();
        let name = std::str::from_utf8(&data[41..]).ok()?.to_string();
        out.push(RawRef { sha, name });
    }
    Some(out)
}

// ---- semver --------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SemVer {
    major: i32,
    minor: i32,
    patch: i32,
    has_prerelease: bool,
}

/// Accept "1.2.3", "v1.2.3", optionally followed by "-..." (prerelease) or
/// "+..." (build). Reject anything else (e.g. "1.2", "v1", "release-2026").
fn parse_semver(s: &str) -> Option<SemVer> {
    let mut s = s.as_bytes();
    if matches!(s.first(), Some(b'v') | Some(b'V')) {
        s = &s[1..];
    }
    fn take_num(s: &[u8]) -> Option<(i32, &[u8])> {
        let mut i = 0;
        while i < s.len() && s[i].is_ascii_digit() {
            i += 1;
        }
        if i == 0 {
            return None;
        }
        let n = std::str::from_utf8(&s[..i]).ok()?.parse::<i32>().ok()?;
        Some((n, &s[i..]))
    }

    let (major, rest) = take_num(s)?;
    if rest.first() != Some(&b'.') {
        return None;
    }
    let (minor, rest) = take_num(&rest[1..])?;
    if rest.first() != Some(&b'.') {
        return None;
    }
    let (patch, rest) = take_num(&rest[1..])?;
    let has_prerelease = match rest.first() {
        None => false,
        Some(&b'-') => true,
        Some(&b'+') => false,
        _ => return None,
    };
    Some(SemVer {
        major,
        minor,
        patch,
        has_prerelease,
    })
}

fn semver_cmp(a: &SemVer, b: &SemVer) -> std::cmp::Ordering {
    a.major
        .cmp(&b.major)
        .then(a.minor.cmp(&b.minor))
        .then(a.patch.cmp(&b.patch))
        // Prereleases sort below their corresponding release (semver §11).
        .then(b.has_prerelease.cmp(&a.has_prerelease))
}

fn peeled_sha_for(refs: &[RawRef], tag_idx: usize) -> &str {
    let peeled = format!("{}^{{}}", refs[tag_idx].name);
    for r in refs {
        if r.name == peeled {
            return &r.sha;
        }
    }
    &refs[tag_idx].sha
}

// ---- public API ----------------------------------------------------------

fn fetch_refs(owner: &str, repo: &str) -> Option<Vec<u8>> {
    let base = crate::http::github_base_url();
    let url = format!("{base}/{owner}/{repo}/info/refs?service=git-upload-pack");
    let (status, body) = crate::http::fetch_to_buffer(
        &url,
        Some("application/x-git-upload-pack-advertisement"),
    );
    if status < 0 {
        crate::log::debug("info/refs fetch failed: transport error");
        return None;
    }
    if status >= 400 {
        crate::log::debug(&format!("info/refs fetch failed: HTTP {status}"));
        return None;
    }
    Some(body)
}

pub fn resolve_latest_tag(spec: &PackageSpec) -> Option<ResolvedRef> {
    let owner = spec.owner.as_deref()?;
    let repo = spec.repo.as_deref()?;
    let body = fetch_refs(owner, repo)?;
    let refs = parse_refs(&body)?;

    let prefix = "refs/tags/";
    let mut best: Option<(usize, SemVer)> = None;

    for (i, r) in refs.iter().enumerate() {
        let tag = match r.name.strip_prefix(prefix) {
            Some(t) => t,
            None => continue,
        };
        if tag.ends_with("^{}") {
            continue;
        }
        let sv = match parse_semver(tag) {
            Some(v) => v,
            None => continue,
        };
        if sv.has_prerelease {
            continue;
        }
        match &best {
            None => best = Some((i, sv)),
            Some((_, b)) if semver_cmp(&sv, b).is_gt() => best = Some((i, sv)),
            _ => {}
        }
    }

    let (idx, _) = best?;
    let name = refs[idx].name.clone();
    let tag = name.strip_prefix(prefix).unwrap_or(&name).to_string();
    Some(ResolvedRef {
        ref_: tag,
        sha: peeled_sha_for(&refs, idx).to_string(),
        is_tag: true,
    })
}

pub fn resolve_ref(spec: &PackageSpec, ref_name: &str) -> Option<ResolvedRef> {
    let owner = spec.owner.as_deref()?;
    let repo = spec.repo.as_deref()?;
    let body = fetch_refs(owner, repo)?;
    let refs = parse_refs(&body)?;

    let branch_path = format!("refs/heads/{ref_name}");
    let tag_path = format!("refs/tags/{ref_name}");

    if let Some((i, _)) = refs.iter().enumerate().find(|(_, r)| r.name == branch_path) {
        return Some(ResolvedRef {
            ref_: ref_name.to_string(),
            sha: refs[i].sha.clone(),
            is_tag: false,
        });
    }
    if let Some((i, _)) = refs.iter().enumerate().find(|(_, r)| r.name == tag_path) {
        return Some(ResolvedRef {
            ref_: ref_name.to_string(),
            sha: peeled_sha_for(&refs, i).to_string(),
            is_tag: true,
        });
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semver_accepts_v_prefix() {
        let a = parse_semver("v1.2.3").unwrap();
        assert_eq!(
            a,
            SemVer {
                major: 1,
                minor: 2,
                patch: 3,
                has_prerelease: false
            }
        );
    }

    #[test]
    fn semver_rejects_partial() {
        assert!(parse_semver("1.2").is_none());
        assert!(parse_semver("v1").is_none());
        assert!(parse_semver("release-2026").is_none());
    }

    #[test]
    fn semver_orders_prerelease_below() {
        let release = parse_semver("1.0.0").unwrap();
        let pre = parse_semver("1.0.0-rc.1").unwrap();
        assert!(semver_cmp(&pre, &release).is_lt());
    }

    #[test]
    fn pkt_line_smoke() {
        // Build a minimal pkt-line stream: service header, flush, ref line, flush.
        fn pkt(payload: &[u8]) -> Vec<u8> {
            let mut out = format!("{:04x}", payload.len() + 4).into_bytes();
            out.extend_from_slice(payload);
            out
        }
        let mut body = pkt(b"# service=git-upload-pack\n");
        body.extend_from_slice(b"0000");
        body.extend_from_slice(&pkt(
            b"1111111111111111111111111111111111111111 refs/heads/main\0caps\n",
        ));
        body.extend_from_slice(&pkt(b"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa refs/tags/v1.0.0\n"));
        body.extend_from_slice(b"0000");

        let refs = parse_refs(&body).unwrap();
        // Only the two real refs; service header skipped.
        assert_eq!(refs.len(), 2);
        assert_eq!(refs[0].name, "refs/heads/main");
        assert_eq!(refs[0].sha, "1".repeat(40));
        assert_eq!(refs[1].name, "refs/tags/v1.0.0");
    }
}
