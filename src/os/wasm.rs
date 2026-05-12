// Wasm impl of the os module. Every fs/env/time call dispatches to a JS-side
// extern "C" function. The JS shim binds these to Node fs / time / env APIs
// (see wasm/shim.js).
//
// Why not std::fs? The spike showed that wasm-opt --asyncify corrupts
// wasi-libc internals when it instruments indirect calls. We side-step the
// whole problem by routing OS work through hand-written imports instead.

use std::path::{Path, PathBuf};

pub type Result<T> = std::result::Result<T, OsError>;

#[derive(Debug)]
pub struct OsError(pub String);

impl std::fmt::Display for OsError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for OsError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileKind {
    File,
    Dir,
    Symlink,
    Other,
}

#[derive(Debug, Clone)]
pub struct Meta {
    pub kind: FileKind,
    pub size: u64,
    pub mode: u32,
}

// ---------------------------------------------------------------------------
// extern declarations — the JS shim must export these on the `env` namespace.
// ---------------------------------------------------------------------------

extern "C" {
    // File ops
    fn rosie_fs_write(path_ptr: *const u8, path_len: usize, data_ptr: *const u8, data_len: usize) -> i32;
    fn rosie_fs_read(
        path_ptr: *const u8,
        path_len: usize,
        out_buf_ptr: *mut *mut u8,
        out_len: *mut usize,
    ) -> i32;
    fn rosie_fs_create_dir_all(path_ptr: *const u8, path_len: usize) -> i32;
    fn rosie_fs_read_dir(
        path_ptr: *const u8,
        path_len: usize,
        out_buf_ptr: *mut *mut u8,
        out_len: *mut usize,
    ) -> i32;
    fn rosie_fs_metadata(
        path_ptr: *const u8,
        path_len: usize,
        follow_symlinks: i32,
        out_kind: *mut i32,
        out_size: *mut u64,
        out_mode: *mut u32,
    ) -> i32;
    fn rosie_fs_remove_file(path_ptr: *const u8, path_len: usize) -> i32;
    fn rosie_fs_remove_dir_all(path_ptr: *const u8, path_len: usize) -> i32;
    fn rosie_fs_copy(
        src_ptr: *const u8,
        src_len: usize,
        dst_ptr: *const u8,
        dst_len: usize,
    ) -> i32;
    fn rosie_fs_rename(
        src_ptr: *const u8,
        src_len: usize,
        dst_ptr: *const u8,
        dst_len: usize,
    ) -> i32;
    fn rosie_fs_read_link(
        path_ptr: *const u8,
        path_len: usize,
        out_buf_ptr: *mut *mut u8,
        out_len: *mut usize,
    ) -> i32;
    fn rosie_create_link_extern(
        target_ptr: *const u8,
        target_len: usize,
        link_ptr: *const u8,
        link_len: usize,
        is_dir: i32,
    ) -> i32;
    fn rosie_fs_set_mode(path_ptr: *const u8, path_len: usize, mode: u32) -> i32;

    // OS / env / time
    fn rosie_home_dir(out_buf_ptr: *mut *mut u8, out_len: *mut usize) -> i32;
    fn rosie_temp_dir(out_buf_ptr: *mut *mut u8, out_len: *mut usize) -> i32;
    fn rosie_now_unix_seconds() -> i64;
    fn rosie_getenv(
        name_ptr: *const u8,
        name_len: usize,
        out_buf_ptr: *mut *mut u8,
        out_len: *mut usize,
    ) -> i32;
    fn rosie_current_dir(out_buf_ptr: *mut *mut u8, out_len: *mut usize) -> i32;
    fn rosie_set_current_dir(path_ptr: *const u8, path_len: usize) -> i32;
}

fn path_bytes(path: &Path) -> Vec<u8> {
    path.to_string_lossy().into_owned().into_bytes()
}

/// Take ownership of an `out_buf_ptr` / `out_len` pair returned by a JS
/// import. The JS side calls `rosie_malloc` for these buffers so we can
/// reconstruct a Vec<u8> and free via Rust's allocator on drop.
unsafe fn take_owned_bytes(ptr: *mut u8, len: usize) -> Vec<u8> {
    if ptr.is_null() || len == 0 {
        return Vec::new();
    }
    Vec::from_raw_parts(ptr, len, len)
}

fn err_from_status(context: &str, status: i32) -> OsError {
    OsError(format!("{context}: rc={status}"))
}

// ---------------------------------------------------------------------------
// File ops
// ---------------------------------------------------------------------------

pub fn write(path: &Path, bytes: &[u8]) -> Result<()> {
    let p = path_bytes(path);
    let rc = unsafe { rosie_fs_write(p.as_ptr(), p.len(), bytes.as_ptr(), bytes.len()) };
    if rc == 0 {
        Ok(())
    } else {
        Err(err_from_status(&format!("write {}", path.display()), rc))
    }
}

pub fn read(path: &Path) -> Result<Vec<u8>> {
    let p = path_bytes(path);
    let mut buf: *mut u8 = std::ptr::null_mut();
    let mut len: usize = 0;
    let rc = unsafe {
        rosie_fs_read(
            p.as_ptr(),
            p.len(),
            &mut buf as *mut *mut u8,
            &mut len as *mut usize,
        )
    };
    if rc != 0 {
        return Err(err_from_status(&format!("read {}", path.display()), rc));
    }
    Ok(unsafe { take_owned_bytes(buf, len) })
}

pub fn read_to_string(path: &Path) -> Result<String> {
    let bytes = read(path)?;
    String::from_utf8(bytes).map_err(|_| OsError(format!("non-utf8 contents in {}", path.display())))
}

pub fn copy(src: &Path, dst: &Path) -> Result<()> {
    let s = path_bytes(src);
    let d = path_bytes(dst);
    let rc = unsafe { rosie_fs_copy(s.as_ptr(), s.len(), d.as_ptr(), d.len()) };
    if rc == 0 {
        Ok(())
    } else {
        Err(err_from_status(
            &format!("copy {} -> {}", src.display(), dst.display()),
            rc,
        ))
    }
}

pub fn rename(src: &Path, dst: &Path) -> Result<()> {
    let s = path_bytes(src);
    let d = path_bytes(dst);
    let rc = unsafe { rosie_fs_rename(s.as_ptr(), s.len(), d.as_ptr(), d.len()) };
    if rc == 0 {
        Ok(())
    } else {
        Err(err_from_status(
            &format!("rename {} -> {}", src.display(), dst.display()),
            rc,
        ))
    }
}

pub fn remove_file(path: &Path) -> Result<()> {
    let p = path_bytes(path);
    let rc = unsafe { rosie_fs_remove_file(p.as_ptr(), p.len()) };
    if rc == 0 {
        Ok(())
    } else {
        Err(err_from_status(&format!("remove_file {}", path.display()), rc))
    }
}

pub fn remove_dir_all(path: &Path) -> Result<()> {
    let p = path_bytes(path);
    let rc = unsafe { rosie_fs_remove_dir_all(p.as_ptr(), p.len()) };
    if rc == 0 {
        Ok(())
    } else {
        Err(err_from_status(
            &format!("remove_dir_all {}", path.display()),
            rc,
        ))
    }
}

pub fn create_dir_all(path: &Path) -> Result<()> {
    let p = path_bytes(path);
    let rc = unsafe { rosie_fs_create_dir_all(p.as_ptr(), p.len()) };
    if rc == 0 {
        Ok(())
    } else {
        Err(err_from_status(
            &format!("create_dir_all {}", path.display()),
            rc,
        ))
    }
}

pub fn read_dir(path: &Path) -> Result<Vec<String>> {
    let p = path_bytes(path);
    let mut buf: *mut u8 = std::ptr::null_mut();
    let mut len: usize = 0;
    let rc = unsafe {
        rosie_fs_read_dir(
            p.as_ptr(),
            p.len(),
            &mut buf as *mut *mut u8,
            &mut len as *mut usize,
        )
    };
    if rc != 0 {
        return Err(err_from_status(&format!("read_dir {}", path.display()), rc));
    }
    let blob = unsafe { take_owned_bytes(buf, len) };
    // Newline-separated names. Empty trailing entries ignored.
    let names: Vec<String> = blob
        .split(|&b| b == b'\n')
        .filter(|s| !s.is_empty())
        .map(|s| String::from_utf8_lossy(s).into_owned())
        .collect();
    Ok(names)
}

// ---------------------------------------------------------------------------
// metadata
// ---------------------------------------------------------------------------

fn metadata_inner(path: &Path, follow_symlinks: bool) -> Result<Meta> {
    let p = path_bytes(path);
    let mut kind: i32 = 0;
    let mut size: u64 = 0;
    let mut mode: u32 = 0;
    let rc = unsafe {
        rosie_fs_metadata(
            p.as_ptr(),
            p.len(),
            if follow_symlinks { 1 } else { 0 },
            &mut kind as *mut i32,
            &mut size as *mut u64,
            &mut mode as *mut u32,
        )
    };
    if rc != 0 {
        return Err(err_from_status(&format!("stat {}", path.display()), rc));
    }
    let kind = match kind {
        1 => FileKind::Dir,
        2 => FileKind::Symlink,
        3 => FileKind::File,
        _ => FileKind::Other,
    };
    Ok(Meta { kind, size, mode })
}

pub fn metadata(path: &Path) -> Result<Meta> {
    metadata_inner(path, true)
}

pub fn symlink_metadata(path: &Path) -> Result<Meta> {
    metadata_inner(path, false)
}

pub fn exists(path: &Path) -> bool {
    metadata(path).is_ok()
}

pub fn is_dir(path: &Path) -> bool {
    matches!(metadata(path), Ok(m) if m.kind == FileKind::Dir)
}

pub fn is_file(path: &Path) -> bool {
    matches!(metadata(path), Ok(m) if m.kind == FileKind::File)
}

pub fn read_link(path: &Path) -> Result<String> {
    let p = path_bytes(path);
    let mut buf: *mut u8 = std::ptr::null_mut();
    let mut len: usize = 0;
    let rc = unsafe {
        rosie_fs_read_link(
            p.as_ptr(),
            p.len(),
            &mut buf as *mut *mut u8,
            &mut len as *mut usize,
        )
    };
    if rc != 0 {
        return Err(err_from_status(&format!("readlink {}", path.display()), rc));
    }
    let blob = unsafe { take_owned_bytes(buf, len) };
    String::from_utf8(blob)
        .map_err(|_| OsError(format!("non-utf8 symlink target at {}", path.display())))
}

// ---------------------------------------------------------------------------
// link creation
// ---------------------------------------------------------------------------

pub fn create_link(target: &Path, link_path: &Path, is_dir: bool) -> Result<()> {
    let t = path_bytes(target);
    let l = path_bytes(link_path);
    let rc = unsafe {
        rosie_create_link_extern(
            t.as_ptr(),
            t.len(),
            l.as_ptr(),
            l.len(),
            if is_dir { 1 } else { 0 },
        )
    };
    if rc == 0 {
        Ok(())
    } else {
        Err(err_from_status(
            &format!("link {} -> {}", link_path.display(), target.display()),
            rc,
        ))
    }
}

pub fn set_mode(path: &Path, mode: u32) -> Result<()> {
    let p = path_bytes(path);
    let rc = unsafe { rosie_fs_set_mode(p.as_ptr(), p.len(), mode) };
    if rc == 0 {
        Ok(())
    } else {
        Err(err_from_status(&format!("chmod {}", path.display()), rc))
    }
}

// ---------------------------------------------------------------------------
// env / time
// ---------------------------------------------------------------------------

fn take_optional_string(rc: i32, ptr: *mut u8, len: usize) -> Option<String> {
    if rc != 0 {
        return None;
    }
    let blob = unsafe { take_owned_bytes(ptr, len) };
    if blob.is_empty() {
        None
    } else {
        String::from_utf8(blob).ok()
    }
}

pub fn home_dir() -> Option<String> {
    let mut buf: *mut u8 = std::ptr::null_mut();
    let mut len: usize = 0;
    let rc = unsafe { rosie_home_dir(&mut buf as *mut *mut u8, &mut len as *mut usize) };
    take_optional_string(rc, buf, len)
}

pub fn temp_dir() -> String {
    let mut buf: *mut u8 = std::ptr::null_mut();
    let mut len: usize = 0;
    let rc = unsafe { rosie_temp_dir(&mut buf as *mut *mut u8, &mut len as *mut usize) };
    take_optional_string(rc, buf, len).unwrap_or_else(|| "/tmp".to_string())
}

pub fn getenv(name: &str) -> Option<String> {
    let mut buf: *mut u8 = std::ptr::null_mut();
    let mut len: usize = 0;
    let rc = unsafe {
        rosie_getenv(
            name.as_ptr(),
            name.len(),
            &mut buf as *mut *mut u8,
            &mut len as *mut usize,
        )
    };
    take_optional_string(rc, buf, len)
}

pub fn now_unix_seconds() -> i64 {
    unsafe { rosie_now_unix_seconds() }
}

pub fn current_dir() -> Result<PathBuf> {
    let mut buf: *mut u8 = std::ptr::null_mut();
    let mut len: usize = 0;
    let rc = unsafe { rosie_current_dir(&mut buf as *mut *mut u8, &mut len as *mut usize) };
    if rc != 0 {
        return Err(err_from_status("getcwd", rc));
    }
    let s = take_optional_string(0, buf, len).unwrap_or_default();
    Ok(PathBuf::from(s))
}

pub fn set_current_dir(path: &Path) -> Result<()> {
    let p = path_bytes(path);
    let rc = unsafe { rosie_set_current_dir(p.as_ptr(), p.len()) };
    if rc == 0 {
        Ok(())
    } else {
        Err(err_from_status(&format!("chdir {}", path.display()), rc))
    }
}

// ---------------------------------------------------------------------------
// helpers used by the install flow
// ---------------------------------------------------------------------------

pub fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<()> {
    create_dir_all(dst)?;
    for name in read_dir(src)? {
        let src_path = src.join(&name);
        let dst_path = dst.join(&name);
        let meta = symlink_metadata(&src_path)?;
        match meta.kind {
            FileKind::Dir => copy_dir_recursive(&src_path, &dst_path)?,
            FileKind::File => {
                copy(&src_path, &dst_path)?;
                let _ = set_mode(&dst_path, meta.mode);
            }
            FileKind::Symlink => {
                let target = read_link(&src_path)?;
                create_link(Path::new(&target), &dst_path, true)?;
            }
            _ => {}
        }
    }
    Ok(())
}

pub fn create_temp_dir(prefix: &str) -> Result<PathBuf> {
    // `std::process::id()` is unsupported on wasm32-wasip1 — calling it
    // panics with "unsupported". Use a static counter + the wall-clock to
    // build a unique-enough name. wasm runs single-threaded.
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = now_unix_seconds() as u128;
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    let base = temp_dir();
    let dir = PathBuf::from(base).join(format!("{prefix}-{seq:x}-{nanos:x}"));
    create_dir_all(&dir)?;
    Ok(dir)
}
