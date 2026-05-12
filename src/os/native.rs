// Native impl of the os module. Thin wrappers around std::fs / std::env /
// std::time that present a uniform API to the rest of the crate.

use std::path::{Path, PathBuf};

pub type Result<T> = std::result::Result<T, OsError>;

#[derive(Debug)]
pub struct OsError(pub String);

impl OsError {
    fn new<S: Into<String>>(s: S) -> Self {
        OsError(s.into())
    }
    fn from_io(context: &str, err: std::io::Error) -> Self {
        OsError(format!("{context}: {err}"))
    }
}

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

// ---- file ops --------------------------------------------------------------

pub fn write(path: &Path, bytes: &[u8]) -> Result<()> {
    std::fs::write(path, bytes)
        .map_err(|e| OsError::from_io(&format!("write {}", path.display()), e))
}

pub fn read(path: &Path) -> Result<Vec<u8>> {
    std::fs::read(path).map_err(|e| OsError::from_io(&format!("read {}", path.display()), e))
}

pub fn read_to_string(path: &Path) -> Result<String> {
    std::fs::read_to_string(path)
        .map_err(|e| OsError::from_io(&format!("read {}", path.display()), e))
}

pub fn copy(src: &Path, dst: &Path) -> Result<()> {
    std::fs::copy(src, dst).map(|_| ()).map_err(|e| {
        OsError::from_io(&format!("copy {} -> {}", src.display(), dst.display()), e)
    })
}

pub fn rename(src: &Path, dst: &Path) -> Result<()> {
    std::fs::rename(src, dst).map_err(|e| {
        OsError::from_io(&format!("rename {} -> {}", src.display(), dst.display()), e)
    })
}

pub fn remove_file(path: &Path) -> Result<()> {
    std::fs::remove_file(path)
        .map_err(|e| OsError::from_io(&format!("remove_file {}", path.display()), e))
}

pub fn remove_dir_all(path: &Path) -> Result<()> {
    std::fs::remove_dir_all(path)
        .map_err(|e| OsError::from_io(&format!("remove_dir_all {}", path.display()), e))
}

pub fn create_dir_all(path: &Path) -> Result<()> {
    std::fs::create_dir_all(path)
        .map_err(|e| OsError::from_io(&format!("create_dir_all {}", path.display()), e))
}

pub fn read_dir(path: &Path) -> Result<Vec<String>> {
    let entries = std::fs::read_dir(path)
        .map_err(|e| OsError::from_io(&format!("read_dir {}", path.display()), e))?;
    let mut names = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| OsError::from_io("read_dir entry", e))?;
        if let Some(name) = entry.file_name().to_str() {
            names.push(name.to_string());
        }
    }
    Ok(names)
}

// ---- metadata --------------------------------------------------------------

fn meta_from_std(meta: std::fs::Metadata) -> Meta {
    let kind = if meta.file_type().is_symlink() {
        FileKind::Symlink
    } else if meta.is_dir() {
        FileKind::Dir
    } else if meta.is_file() {
        FileKind::File
    } else {
        FileKind::Other
    };
    Meta {
        kind,
        size: meta.len(),
        mode: mode_from_meta(&meta),
    }
}

#[cfg(unix)]
fn mode_from_meta(meta: &std::fs::Metadata) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    meta.permissions().mode()
}

#[cfg(windows)]
fn mode_from_meta(meta: &std::fs::Metadata) -> u32 {
    if meta.permissions().readonly() {
        0o444
    } else {
        0o644
    }
}

pub fn metadata(path: &Path) -> Result<Meta> {
    std::fs::metadata(path)
        .map(meta_from_std)
        .map_err(|e| OsError::from_io(&format!("stat {}", path.display()), e))
}

pub fn symlink_metadata(path: &Path) -> Result<Meta> {
    std::fs::symlink_metadata(path)
        .map(meta_from_std)
        .map_err(|e| OsError::from_io(&format!("lstat {}", path.display()), e))
}

pub fn exists(path: &Path) -> bool {
    std::fs::metadata(path).is_ok()
}

pub fn is_dir(path: &Path) -> bool {
    matches!(metadata(path), Ok(m) if m.kind == FileKind::Dir)
}

pub fn is_file(path: &Path) -> bool {
    matches!(metadata(path), Ok(m) if m.kind == FileKind::File)
}

pub fn read_link(path: &Path) -> Result<String> {
    let target = std::fs::read_link(path)
        .map_err(|e| OsError::from_io(&format!("readlink {}", path.display()), e))?;
    target
        .to_str()
        .map(String::from)
        .ok_or_else(|| OsError::new(format!("non-utf8 symlink target at {}", path.display())))
}

/// Resolve a path to its absolute, symlink-free canonical form.
pub fn canonicalize(path: &Path) -> Result<PathBuf> {
    std::fs::canonicalize(path)
        .map_err(|e| OsError::from_io(&format!("canonicalize {}", path.display()), e))
}

// ---- link creation ---------------------------------------------------------

/// Create a symbolic link from `link_path` to `target`. On Windows, `is_dir`
/// selects between a junction (directory) and a hard-link / file copy.
pub fn create_link(target: &Path, link_path: &Path, is_dir: bool) -> Result<()> {
    create_link_impl(target, link_path, is_dir)
}

#[cfg(unix)]
fn create_link_impl(target: &Path, link_path: &Path, _is_dir: bool) -> Result<()> {
    use std::os::unix::fs::symlink;
    symlink(target, link_path).map_err(|e| {
        OsError::from_io(
            &format!("symlink {} -> {}", link_path.display(), target.display()),
            e,
        )
    })
}

#[cfg(windows)]
fn create_link_impl(target: &Path, link_path: &Path, is_dir: bool) -> Result<()> {
    if is_dir {
        junction::create(target, link_path).map_err(|e| {
            OsError::from_io(
                &format!("junction {} -> {}", link_path.display(), target.display()),
                e,
            )
        })
    } else {
        if std::fs::hard_link(target, link_path).is_ok() {
            return Ok(());
        }
        std::fs::copy(target, link_path).map(|_| ()).map_err(|e| {
            OsError::from_io(
                &format!(
                    "hardlink-or-copy {} -> {}",
                    link_path.display(),
                    target.display()
                ),
                e,
            )
        })
    }
}

#[cfg(unix)]
pub fn set_mode(path: &Path, mode: u32) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    let perms = std::fs::Permissions::from_mode(mode);
    std::fs::set_permissions(path, perms)
        .map_err(|e| OsError::from_io(&format!("chmod {}", path.display()), e))
}

#[cfg(windows)]
pub fn set_mode(_path: &Path, _mode: u32) -> Result<()> {
    Ok(())
}

// ---- env / time ------------------------------------------------------------

pub fn home_dir() -> Option<String> {
    #[cfg(unix)]
    {
        if let Ok(v) = std::env::var("HOME") {
            if !v.is_empty() {
                return Some(v);
            }
        }
        None
    }
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE").ok().filter(|s| !s.is_empty())
    }
}

pub fn temp_dir() -> String {
    std::env::temp_dir().to_string_lossy().into_owned()
}

pub fn getenv(name: &str) -> Option<String> {
    std::env::var(name).ok()
}

pub fn now_unix_seconds() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

pub fn current_dir() -> Result<PathBuf> {
    std::env::current_dir().map_err(|e| OsError::from_io("getcwd", e))
}

pub fn set_current_dir(path: &Path) -> Result<()> {
    std::env::set_current_dir(path)
        .map_err(|e| OsError::from_io(&format!("chdir {}", path.display()), e))
}

/// Recursively copy a directory tree. Mirrors copy_dir_recursive from util.c.
/// Preserves the file-mode bits on regular files.
pub fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<()> {
    create_dir_all(dst)?;
    for name in read_dir(src)? {
        let src_path = src.join(&name);
        let dst_path = dst.join(&name);
        let meta = symlink_metadata(&src_path)?;
        match meta.kind {
            FileKind::Dir => copy_dir_recursive(&src_path, &dst_path)?,
            FileKind::File => {
                std::fs::copy(&src_path, &dst_path).map_err(|e| {
                    OsError::from_io(
                        &format!("copy {} -> {}", src_path.display(), dst_path.display()),
                        e,
                    )
                })?;
                #[cfg(unix)]
                {
                    let _ = set_mode(&dst_path, meta.mode);
                }
            }
            FileKind::Symlink => {
                let target = std::fs::read_link(&src_path).map_err(|e| {
                    OsError::from_io(&format!("readlink {}", src_path.display()), e)
                })?;
                create_link(&target, &dst_path, true)?;
            }
            _ => {}
        }
    }
    Ok(())
}

/// Create a uniquely-named temp directory under the system temp dir.
pub fn create_temp_dir(prefix: &str) -> Result<PathBuf> {
    use std::time::{SystemTime, UNIX_EPOCH};
    let base = std::env::temp_dir();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    let dir = base.join(format!("{prefix}-{pid}-{nanos:x}"));
    create_dir_all(&dir)?;
    Ok(dir)
}
