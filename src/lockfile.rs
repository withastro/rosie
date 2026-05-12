// .agents/rosie.lock — whitespace-separated entries with a v1 header.
//
// The format is locked down by the regression suite; even whitespace
// changes break tests. Layout:
//
//   # rosie-lock v1
//   <name> <source> <ref> <sha> <iso8601_ts> <pin|auto> <skill|ref>
//
// Entries are sorted by name on save for stable diffs (the suite ordering
// is alphabetical).

use crate::os;
use crate::util;
use std::path::{Path, PathBuf};

pub const LOCKFILE_NAME: &str = "rosie.lock";
pub const LOCKFILE_VERSION: u32 = 1;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LockKind {
    Skill,
    Ref,
}

impl LockKind {
    fn as_str(self) -> &'static str {
        match self {
            LockKind::Skill => "skill",
            LockKind::Ref => "ref",
        }
    }
}

#[derive(Debug, Clone)]
pub struct LockEntry {
    pub skill_name: String,
    pub source: String,
    pub ref_: String,
    pub sha: String,
    pub installed_at: String,
    pub pinned: bool,
    pub kind: LockKind,
}

#[derive(Debug, Clone)]
pub struct Lockfile {
    pub entries: Vec<LockEntry>,
    pub path: PathBuf,
}

impl Lockfile {
    /// Load `<dir>/rosie.lock`. Returns an empty lockfile if the file is
    /// missing — same as the C version.
    pub fn load(dir: &Path) -> Self {
        let path = dir.join(LOCKFILE_NAME);
        let mut entries = Vec::new();

        if let Ok(contents) = os::read_to_string(&path) {
            for line in contents.lines() {
                let trimmed = line.trim();
                if trimmed.is_empty() || trimmed.starts_with('#') {
                    continue;
                }
                let parts: Vec<&str> = trimmed.split_whitespace().collect();
                if parts.len() < 5 {
                    crate::log::debug(&format!("skipping malformed lockfile line: {trimmed}"));
                    continue;
                }
                let pinned = parts.get(5).copied() == Some("pin");
                let kind = if parts.get(6).copied() == Some("ref") {
                    LockKind::Ref
                } else {
                    LockKind::Skill
                };
                entries.push(LockEntry {
                    skill_name: parts[0].to_string(),
                    source: parts[1].to_string(),
                    ref_: parts[2].to_string(),
                    sha: parts[3].to_string(),
                    installed_at: parts[4].to_string(),
                    pinned,
                    kind,
                });
            }
        }

        Lockfile { entries, path }
    }

    pub fn find(&self, skill_name: &str) -> Option<&LockEntry> {
        self.entries.iter().find(|e| e.skill_name == skill_name)
    }

    pub fn find_mut(&mut self, skill_name: &str) -> Option<&mut LockEntry> {
        self.entries.iter_mut().find(|e| e.skill_name == skill_name)
    }

    /// Insert or replace by skill name.
    #[allow(clippy::too_many_arguments)]
    pub fn upsert(
        &mut self,
        skill_name: &str,
        source: &str,
        ref_: &str,
        sha: &str,
        installed_at: &str,
        pinned: bool,
        kind: LockKind,
    ) {
        if let Some(e) = self.find_mut(skill_name) {
            e.source = source.to_string();
            e.ref_ = ref_.to_string();
            e.sha = sha.to_string();
            e.installed_at = installed_at.to_string();
            e.pinned = pinned;
            e.kind = kind;
            return;
        }
        self.entries.push(LockEntry {
            skill_name: skill_name.to_string(),
            source: source.to_string(),
            ref_: ref_.to_string(),
            sha: sha.to_string(),
            installed_at: installed_at.to_string(),
            pinned,
            kind,
        });
    }

    /// Remove an entry by name. Returns true if present.
    pub fn remove(&mut self, skill_name: &str) -> bool {
        let before = self.entries.len();
        self.entries.retain(|e| e.skill_name != skill_name);
        self.entries.len() != before
    }

    /// Atomic save: write to .tmp then rename. Entries are sorted by name
    /// first for stable diffs.
    pub fn save(&mut self) -> Result<(), os::OsError> {
        self.entries.sort_by(|a, b| a.skill_name.cmp(&b.skill_name));

        let mut out = String::new();
        out.push_str(&format!("# rosie-lock v{}\n", LOCKFILE_VERSION));
        for e in &self.entries {
            out.push_str(&format!(
                "{} {} {} {} {} {} {}\n",
                e.skill_name,
                e.source,
                e.ref_,
                e.sha,
                e.installed_at,
                if e.pinned { "pin" } else { "auto" },
                e.kind.as_str(),
            ));
        }

        let tmp = util::tmp_path_for(&self.path);
        os::write(&tmp, out.as_bytes())?;
        os::rename(&tmp, &self.path)
    }
}

/// Current UTC time as ISO 8601 ("2026-05-02T14:32:18Z").
pub fn now_iso8601() -> String {
    let unix = os::now_unix_seconds();
    iso8601_from_unix(unix)
}

/// Pure-function ISO 8601 formatter (broken out for testability).
pub fn iso8601_from_unix(unix_seconds: i64) -> String {
    let dt = time::OffsetDateTime::from_unix_timestamp(unix_seconds)
        .unwrap_or_else(|_| time::OffsetDateTime::UNIX_EPOCH);
    let (y, m, d) = (dt.year(), dt.month() as u8, dt.day());
    let (hh, mm, ss) = (dt.hour(), dt.minute(), dt.second());
    format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn round_trip() {
        let dir = std::env::temp_dir().join(format!("rosie-lockfile-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(LOCKFILE_NAME);
        let mut f = std::fs::File::create(&path).unwrap();
        write!(
            f,
            "# rosie-lock v1\n\
             alpha fake/org main - 2025-01-01T00:00:00Z auto skill\n\
             beta fake/org v1.0.0 abcdef 2025-01-02T00:00:00Z pin ref\n"
        )
        .unwrap();
        drop(f);

        let mut lf = Lockfile::load(&dir);
        assert_eq!(lf.entries.len(), 2);
        assert_eq!(lf.entries[0].skill_name, "alpha");
        assert!(!lf.entries[0].pinned);
        assert_eq!(lf.entries[0].kind, LockKind::Skill);
        assert_eq!(lf.entries[1].kind, LockKind::Ref);
        assert!(lf.entries[1].pinned);

        // Save and re-load should produce identical content.
        lf.save().unwrap();
        let contents = std::fs::read_to_string(&path).unwrap();
        assert!(contents.starts_with("# rosie-lock v1\n"));
        assert!(contents.contains("alpha fake/org main - 2025-01-01T00:00:00Z auto skill\n"));
        assert!(contents.contains("beta fake/org v1.0.0 abcdef 2025-01-02T00:00:00Z pin ref\n"));

        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn iso8601_known_value() {
        // 2025-01-01T00:00:00Z
        assert_eq!(iso8601_from_unix(1735689600), "2025-01-01T00:00:00Z");
    }
}
