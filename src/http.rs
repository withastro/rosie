// HTTP client.
//
// Native: ureq with rustls (no system OpenSSL or libcurl).
// Wasm:   extern "C" calls to JS-side imports (filled in Phase 10).
//
// The public surface is two blocking functions that mirror the C version:
//   - fetch_to_file(url, output_path) -> i32 (HTTP status; -1 on transport)
//   - fetch_to_buffer(url, accept)    -> (status, Vec<u8>) (status; -1 on transport)
//
// Status >= 400 is returned to the caller, not collapsed into an error —
// the install flow needs to distinguish 404 (try branch then tag) from
// network failure.

#[cfg(not(target_arch = "wasm32"))]
mod native {
    use crate::os;
    use std::path::Path;
    use std::process::Command;
    use std::sync::OnceLock;

    /// Read ROSIE_GITHUB_BASE_URL or default to github.com. Same as
    /// download.c / resolve.c helpers — needed so tests can point us at a
    /// local mock server.
    pub fn github_base_url() -> String {
        os::getenv("ROSIE_GITHUB_BASE_URL")
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "https://github.com".to_string())
    }

    /// Resolve a GitHub token for authenticating private-repo downloads.
    ///
    /// Order of precedence:
    ///   1. `GH_TOKEN` — what the gh CLI itself checks first
    ///   2. `GITHUB_TOKEN` — the conventional Actions / CI variable
    ///   3. `gh auth token` — falls back to whatever the locally installed
    ///      gh CLI is logged into (covers macOS keychain storage etc.)
    ///
    /// Cached for the process lifetime so we don't fork `gh` on every request.
    pub fn github_token() -> Option<String> {
        static CACHED: OnceLock<Option<String>> = OnceLock::new();
        CACHED
            .get_or_init(|| {
                for var in ["GH_TOKEN", "GITHUB_TOKEN"] {
                    if let Some(t) = os::getenv(var).filter(|s| !s.is_empty()) {
                        crate::log::debug(&format!("Using GitHub token from ${var}"));
                        return Some(t);
                    }
                }
                match Command::new("gh").args(["auth", "token"]).output() {
                    Ok(out) if out.status.success() => {
                        let tok = String::from_utf8_lossy(&out.stdout).trim().to_string();
                        if tok.is_empty() {
                            None
                        } else {
                            crate::log::debug("Using GitHub token from `gh auth token`");
                            Some(tok)
                        }
                    }
                    _ => None,
                }
            })
            .clone()
    }

    /// Authority component of a URL, lowercased and without userinfo / port.
    /// Cheap hand-rolled parser — ureq already pulls in `url` but we keep this
    /// self-contained so tests don't need a network stack.
    fn host_of(url: &str) -> Option<String> {
        let after_scheme = url.split_once("://")?.1;
        let authority = after_scheme.split(['/', '?', '#']).next()?;
        let authority = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
        let host = authority.split_once(':').map_or(authority, |(h, _)| h);
        if host.is_empty() {
            None
        } else {
            Some(host.to_ascii_lowercase())
        }
    }

    /// Whether it's safe to attach an `Authorization` header for `url`.
    /// We only do so on the github.com control plane — codeload redirects
    /// arrive pre-signed via a `?token=` query param and don't need (and
    /// shouldn't receive) the user's token. ureq's default
    /// `RedirectAuthHeaders::Never` already strips it on redirect, but the
    /// initial request is what we control here.
    fn should_send_token(url: &str) -> bool {
        let host = match host_of(url) {
            Some(h) => h,
            None => return false,
        };
        if matches!(host.as_str(), "github.com" | "api.github.com") {
            return true;
        }
        // Tests / GHES point at a custom base URL — trust that host too.
        if let Some(base_host) = host_of(&github_base_url()) {
            if base_host != "github.com" && host == base_host {
                return true;
            }
        }
        false
    }

    /// base64-encode without pulling in another dependency. Short input only —
    /// this is for `x-access-token:<token>`, never more than a few hundred bytes.
    fn base64_encode(input: &[u8]) -> String {
        const TABLE: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
        for chunk in input.chunks(3) {
            let b0 = chunk[0];
            let b1 = chunk.get(1).copied().unwrap_or(0);
            let b2 = chunk.get(2).copied().unwrap_or(0);
            out.push(TABLE[(b0 >> 2) as usize] as char);
            out.push(TABLE[(((b0 & 0b11) << 4) | (b1 >> 4)) as usize] as char);
            if chunk.len() > 1 {
                out.push(TABLE[(((b1 & 0b1111) << 2) | (b2 >> 6)) as usize] as char);
            } else {
                out.push('=');
            }
            if chunk.len() > 2 {
                out.push(TABLE[(b2 & 0b111111) as usize] as char);
            } else {
                out.push('=');
            }
        }
        out
    }

    fn with_github_auth(mut req: ureq::Request, url: &str) -> ureq::Request {
        if should_send_token(url) {
            if let Some(t) = github_token() {
                // Use HTTP Basic with the `x-access-token` user — works for
                // both api.github.com and the git smart-HTTP endpoint, whereas
                // `Authorization: Bearer …` is rejected by the latter with
                // "invalid credentials".
                let encoded = base64_encode(format!("x-access-token:{t}").as_bytes());
                req = req.set("Authorization", &format!("Basic {encoded}"));
            }
        }
        req
    }

    /// Returns (http_status, ()). On transport failure returns -1; on HTTP
    /// failure the partial file is removed (matches curl behavior in C).
    pub fn fetch_to_file(url: &str, output_path: &Path) -> i32 {
        crate::log::debug(&format!("Downloading: {url}"));

        let agent = ureq::AgentBuilder::new()
            .redirects(10)
            .user_agent("rosie/1.0")
            .build();
        let req = with_github_auth(agent.get(url), url);
        let response = match req.call() {
            Ok(r) => r,
            Err(ureq::Error::Status(code, r)) => {
                // HTTP error; bubble the status up. Drain body to free conn.
                let _ = r.into_string();
                return code as i32;
            }
            Err(e) => {
                crate::log::error(&format!("Download failed: {e}"));
                return -1;
            }
        };
        let status = response.status() as i32;

        let mut body = Vec::new();
        if let Err(e) = response.into_reader().read_to_end(&mut body) {
            crate::log::error(&format!("Download failed: {e}"));
            let _ = os::remove_file(output_path);
            return -1;
        }
        if status >= 400 {
            let _ = os::remove_file(output_path);
            return status;
        }
        if let Err(e) = os::write(output_path, &body) {
            crate::log::error(&format!("Cannot create file: {e}"));
            return -1;
        }
        crate::log::debug(&format!("Downloaded to: {}", output_path.display()));
        status
    }

    /// Buffered fetch — for the smart-HTTP info/refs response. `accept` is
    /// set as the Accept header when non-empty. Returns (status, body).
    pub fn fetch_to_buffer(url: &str, accept: Option<&str>) -> (i32, Vec<u8>) {
        crate::log::debug(&format!("Fetching refs: {url}"));
        let agent = ureq::AgentBuilder::new()
            .redirects(10)
            // git smart-HTTP servers sometimes gate on git-shaped UA.
            .user_agent("git/rosie-1.0")
            .build();
        let mut req = with_github_auth(agent.get(url), url);
        if let Some(a) = accept {
            req = req.set("Accept", a);
        }
        match req.call() {
            Ok(r) => {
                let status = r.status() as i32;
                let mut body = Vec::new();
                if let Err(e) = r.into_reader().read_to_end(&mut body) {
                    crate::log::debug(&format!("info/refs read failed: {e}"));
                    return (-1, Vec::new());
                }
                (status, body)
            }
            Err(ureq::Error::Status(code, r)) => {
                let body = r.into_string().unwrap_or_default().into_bytes();
                (code as i32, body)
            }
            Err(e) => {
                crate::log::debug(&format!("info/refs fetch failed: {e}"));
                (-1, Vec::new())
            }
        }
    }

    use std::io::Read;

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn host_of_basic() {
            assert_eq!(host_of("https://github.com/x/y"), Some("github.com".into()));
            assert_eq!(
                host_of("https://API.GitHub.com/repos/x"),
                Some("api.github.com".into())
            );
            assert_eq!(
                host_of("https://user:pw@github.com:443/x"),
                Some("github.com".into())
            );
            assert_eq!(host_of("not a url"), None);
        }

        #[test]
        fn should_send_token_github_hosts() {
            assert!(should_send_token("https://github.com/o/r/archive/refs/heads/main.tar.gz"));
            assert!(should_send_token("https://api.github.com/repos/o/r"));
            assert!(!should_send_token(
                "https://codeload.github.com/o/r/tar.gz/refs/heads/main"
            ));
            assert!(!should_send_token("https://evil.example/o/r"));
        }

        #[test]
        fn base64_encode_matches_rfc4648() {
            assert_eq!(base64_encode(b""), "");
            assert_eq!(base64_encode(b"f"), "Zg==");
            assert_eq!(base64_encode(b"fo"), "Zm8=");
            assert_eq!(base64_encode(b"foo"), "Zm9v");
            assert_eq!(base64_encode(b"foob"), "Zm9vYg==");
            assert_eq!(base64_encode(b"x-access-token:abc"), "eC1hY2Nlc3MtdG9rZW46YWJj");
        }

        #[test]
        fn should_send_token_respects_base_url() {
            std::env::set_var("ROSIE_GITHUB_BASE_URL", "https://ghes.internal.example");
            assert!(should_send_token("https://ghes.internal.example/o/r/archive/main.tar.gz"));
            assert!(!should_send_token("https://other.example/o/r"));
            std::env::remove_var("ROSIE_GITHUB_BASE_URL");
        }
    }
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use std::path::Path;

    pub fn github_base_url() -> String {
        // The env-var override is unused on wasm; the JS shim resolves the
        // base URL however it likes. We still need the function for callers.
        crate::os::getenv("ROSIE_GITHUB_BASE_URL")
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "https://github.com".to_string())
    }

    // `wasm_import_module = "env"` keeps these as host imports under rustc 1.96,
    // which no longer auto-imports undefined extern symbols. See src/os/wasm.rs.
    // ("env" also matches the asyncify-imports names passed to wasm-opt.)
    #[link(wasm_import_module = "env")]
    extern "C" {
        fn rosie_fetch_to_file(
            url_ptr: *const u8,
            url_len: usize,
            path_ptr: *const u8,
            path_len: usize,
        ) -> i32;
        fn rosie_fetch_to_buffer(
            url_ptr: *const u8,
            url_len: usize,
            accept_ptr: *const u8,
            accept_len: usize,
            out_buf_ptr: *mut *mut u8,
            out_len: *mut usize,
        ) -> i32;
    }

    pub fn fetch_to_file(url: &str, output_path: &Path) -> i32 {
        let path_str = output_path.to_string_lossy();
        unsafe {
            rosie_fetch_to_file(
                url.as_ptr(),
                url.len(),
                path_str.as_ptr(),
                path_str.len(),
            )
        }
    }

    pub fn fetch_to_buffer(url: &str, accept: Option<&str>) -> (i32, Vec<u8>) {
        let (a_ptr, a_len) = match accept {
            Some(s) => (s.as_ptr(), s.len()),
            None => (std::ptr::null(), 0),
        };
        let mut buf: *mut u8 = std::ptr::null_mut();
        let mut len: usize = 0;
        let status = unsafe {
            rosie_fetch_to_buffer(
                url.as_ptr(),
                url.len(),
                a_ptr,
                a_len,
                &mut buf as *mut *mut u8,
                &mut len as *mut usize,
            )
        };
        if status < 400 && !buf.is_null() && len > 0 {
            // Take ownership of the JS-allocated buffer.
            let v = unsafe { Vec::from_raw_parts(buf, len, len) };
            (status, v)
        } else {
            (status, Vec::new())
        }
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub use native::*;

#[cfg(target_arch = "wasm32")]
pub use wasm::*;
