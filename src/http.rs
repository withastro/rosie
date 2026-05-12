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

    /// Read ROSIE_GITHUB_BASE_URL or default to github.com. Same as
    /// download.c / resolve.c helpers — needed so tests can point us at a
    /// local mock server.
    pub fn github_base_url() -> String {
        os::getenv("ROSIE_GITHUB_BASE_URL")
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "https://github.com".to_string())
    }

    /// Returns (http_status, ()). On transport failure returns -1; on HTTP
    /// failure the partial file is removed (matches curl behavior in C).
    pub fn fetch_to_file(url: &str, output_path: &Path) -> i32 {
        crate::log::debug(&format!("Downloading: {url}"));

        let agent = ureq::AgentBuilder::new()
            .redirects(10)
            .user_agent("rosie/1.0")
            .build();
        let req = agent.get(url);
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
        let mut req = agent.get(url);
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
