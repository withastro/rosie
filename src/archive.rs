// Tar.gz extraction. Replaces libarchive with pure-Rust `tar` + `flate2`.
//
// Two entry points:
//   - extract_tarball(archive_path, dest_dir): extracts everything under
//     dest_dir, mirroring `extract_tarball` from archive.c.
//   - root_dir(archive_path): returns the first path component of the
//     first archive entry, which is GitHub's <repo>-<ref> wrapper dir.
//
// Permissions: `tar` preserves the file mode bits the archive carries.
// ACLs and FFLAGS aren't replicated (GitHub tarballs don't carry them).

use crate::os;
use flate2::read::GzDecoder;
use std::io::Read;
use std::path::{Path, PathBuf};
use tar::{Archive, EntryType};

/// Extract the tar.gz at `archive_path` into `dest_dir`. Goes through the
/// `os` module for every disk write so the wasm build's JS shim handles
/// I/O (asyncify makes std::fs unsafe in wasm; see the spike notes).
pub fn extract_tarball(archive_path: &Path, dest_dir: &Path) -> i32 {
    let bytes = match os::read(archive_path) {
        Ok(v) => v,
        Err(e) => {
            crate::log::error(&format!("Cannot open archive: {e}"));
            return -1;
        }
    };
    if let Err(e) = os::create_dir_all(dest_dir) {
        crate::log::error(&format!("Cannot create dest dir: {e}"));
        return -1;
    }

    crate::log::debug(&format!("Extracting to: {}", dest_dir.display()));

    let gz = GzDecoder::new(&bytes[..]);
    let mut ar = Archive::new(gz);

    let entries = match ar.entries() {
        Ok(e) => e,
        Err(e) => {
            crate::log::error(&format!("Error reading archive: {e}"));
            return -1;
        }
    };

    for entry in entries {
        let mut entry = match entry {
            Ok(e) => e,
            Err(e) => {
                crate::log::error(&format!("Error reading archive entry: {e}"));
                return -1;
            }
        };
        let kind = entry.header().entry_type();
        let path = match entry.path() {
            Ok(p) => p.into_owned(),
            Err(e) => {
                crate::log::error(&format!("Bad entry path: {e}"));
                return -1;
            }
        };
        let display = path.display().to_string();
        crate::log::debug(&format!("  extracting: {display}"));
        let full: PathBuf = dest_dir.join(&path);

        if let Err(rc) = extract_entry(&mut entry, &full, kind) {
            crate::log::error(&format!("Error extracting {display}: {rc}"));
            return -1;
        }
    }
    0
}

fn extract_entry<R: Read>(
    entry: &mut tar::Entry<R>,
    full: &Path,
    kind: EntryType,
) -> std::result::Result<(), os::OsError> {
    match kind {
        EntryType::Directory => os::create_dir_all(full),
        EntryType::Regular | EntryType::Continuous => {
            if let Some(parent) = full.parent() {
                os::create_dir_all(parent)?;
            }
            let mut bytes = Vec::new();
            entry
                .read_to_end(&mut bytes)
                .map_err(|e| os::OsError(format!("read entry: {e}")))?;
            os::write(full, &bytes)?;
            // Preserve file mode bits if the archive carries them.
            if let Ok(mode) = entry.header().mode() {
                let _ = os::set_mode(full, mode);
            }
            Ok(())
        }
        EntryType::Symlink => {
            if let Some(parent) = full.parent() {
                os::create_dir_all(parent)?;
            }
            let target = entry
                .link_name()
                .map_err(|e| os::OsError(format!("link_name: {e}")))?
                .ok_or_else(|| os::OsError("missing symlink target".into()))?
                .into_owned();
            os::create_link(&target, full, false)
        }
        _ => {
            // pax_global_header etc. — skip.
            Ok(())
        }
    }
}

/// Find the first path component of the first entry in the archive. GitHub
/// tarballs wrap the repo in `<repo>-<ref>/`; rosie's install flow consumes
/// this to know where the extracted content lives.
pub fn root_dir(archive_path: &Path) -> Option<String> {
    let bytes = os::read(archive_path).ok()?;
    let gz = GzDecoder::new(&bytes[..]);
    let mut ar = Archive::new(gz);
    let mut entries = ar.entries().ok()?;
    let entry = entries.next()?.ok()?;
    let path = entry.path().ok()?.into_owned();
    let first = path.components().next()?;
    Some(first.as_os_str().to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::io::Write;

    fn build_test_tarball(path: &Path) {
        let f = std::fs::File::create(path).unwrap();
        let gz = GzEncoder::new(f, Compression::default());
        let mut tar = tar::Builder::new(gz);

        let mut header = tar::Header::new_gnu();
        header.set_path("repo-main/").unwrap();
        header.set_size(0);
        header.set_mode(0o755);
        header.set_entry_type(tar::EntryType::Directory);
        header.set_cksum();
        tar.append(&header, &b""[..]).unwrap();

        let body = b"hello\n";
        let mut header = tar::Header::new_gnu();
        header.set_path("repo-main/inner.txt").unwrap();
        header.set_size(body.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        tar.append(&header, &body[..]).unwrap();
        tar.into_inner().unwrap().finish().unwrap();
    }

    #[test]
    fn round_trip() {
        let dir = std::env::temp_dir().join(format!(
            "rosie-archive-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let tarball = dir.join("t.tar.gz");
        build_test_tarball(&tarball);

        assert_eq!(root_dir(&tarball).as_deref(), Some("repo-main"));

        let out = dir.join("out");
        let rc = extract_tarball(&tarball, &out);
        assert_eq!(rc, 0);
        let inner = out.join("repo-main/inner.txt");
        assert_eq!(std::fs::read(&inner).unwrap(), b"hello\n");
        std::fs::remove_dir_all(&dir).ok();
    }
}
