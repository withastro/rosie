// Block-rewriter inside the project's agent-instructions file
// (AGENTS.md / CLAUDE.md / GEMINI.md / .github/copilot-instructions.md).
//
// Mirrors agentsmd.c. The block markers are HTML comments:
//   <!-- rosie:references:start -->
//   ...
//   <!-- rosie:references:end -->

use crate::lockfile::{LockEntry, LockKind, Lockfile};
use crate::os;
use crate::util;
use std::path::{Path, PathBuf};

const BLOCK_START: &str = "<!-- rosie:references:start -->";
const BLOCK_END: &str = "<!-- rosie:references:end -->";
const LOCAL_REFERENCES_DIR: &str = ".agents/references";

/// Detection order: AGENTS.md → CLAUDE.md → GEMINI.md → .github/copilot-
/// instructions.md. Falls back to AGENTS.md (will be created on first write).
pub fn target_path() -> PathBuf {
    let candidates: [&str; 4] = [
        "AGENTS.md",
        "CLAUDE.md",
        "GEMINI.md",
        ".github/copilot-instructions.md",
    ];
    for c in candidates {
        let p = PathBuf::from(c);
        if os::is_file(&p) {
            return p;
        }
    }
    PathBuf::from("AGENTS.md")
}

/// Extract the first H1 (line starting with "# "), skipping leading YAML
/// frontmatter. Returns None on read error or when no H1 is found.
pub fn extract_first_h1(path: &Path) -> Option<String> {
    let contents = os::read_to_string(path).ok()?;
    let mut in_frontmatter = false;
    let mut seen_first = false;
    for line in contents.lines() {
        let line = line.trim_end_matches('\r');
        if line == "---" {
            if !seen_first {
                in_frontmatter = true;
                seen_first = true;
                continue;
            }
            if in_frontmatter {
                in_frontmatter = false;
                continue;
            }
        }
        seen_first = true;
        if in_frontmatter {
            continue;
        }
        if let Some(rest) = line.strip_prefix("# ") {
            let title = rest.trim();
            if !title.is_empty() {
                return Some(title.to_string());
            }
        }
    }
    None
}

fn build_block_body(lf: &Lockfile) -> Option<String> {
    let mut refs: Vec<&LockEntry> = lf
        .entries
        .iter()
        .filter(|e| e.kind == LockKind::Ref)
        .collect();
    if refs.is_empty() {
        return None;
    }
    refs.sort_by(|a, b| a.skill_name.cmp(&b.skill_name));

    let mut out = String::from("<references>\n");
    for e in refs {
        let ref_dir = util::path_join(LOCAL_REFERENCES_DIR, &e.skill_name);
        let ref_file = util::path_join(&ref_dir, "REFERENCE.md");
        let title = extract_first_h1(&PathBuf::from(&ref_file))
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| e.skill_name.clone());
        out.push_str(&format!("- [{}](./{})\n", title, ref_file));
    }
    out.push_str("</references>");
    Some(out)
}

fn atomic_write(target: &Path, contents: &str) -> Result<(), os::OsError> {
    let tmp = util::tmp_path_for(target);
    os::write(&tmp, contents.as_bytes())?;
    os::rename(&tmp, target)
}

/// Rebuild the rosie-managed `<references>` block in the project's agent-
/// instructions file. Returns 0 on success (including the no-op case),
/// non-zero on error.
pub fn rebuild_block(lf: &Lockfile) -> i32 {
    let target = target_path();
    let existing = os::read_to_string(&target).ok();
    let created = existing.is_none();
    let existing = existing.unwrap_or_default();

    let body = build_block_body(lf);
    let want_block = body.is_some();

    let start_idx = existing.find(BLOCK_START);
    let end_idx = existing.find(BLOCK_END);

    if start_idx.is_some() && end_idx.is_none() {
        crate::log::error(&format!(
            "Found {BLOCK_START} without matching {BLOCK_END} in {}; skipping rebuild",
            target.display()
        ));
        return -1;
    }

    let new_contents: String = match (start_idx, end_idx) {
        (Some(s), Some(e)) => {
            let mut prefix = existing[..s].to_string();
            let suffix_start = e + BLOCK_END.len();
            let suffix = &existing[suffix_start..];
            if let Some(body) = body.as_ref() {
                prefix.push_str(BLOCK_START);
                prefix.push('\n');
                prefix.push_str(body);
                prefix.push('\n');
                prefix.push_str(BLOCK_END);
            } else if prefix.ends_with("\n\n") {
                prefix.pop();
            }
            prefix.push_str(suffix);
            prefix
        }
        _ if want_block => {
            let mut out = existing.clone();
            if !out.is_empty() && !out.ends_with('\n') {
                out.push('\n');
            }
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(BLOCK_START);
            out.push('\n');
            out.push_str(body.as_ref().unwrap());
            out.push('\n');
            out.push_str(BLOCK_END);
            out.push('\n');
            out
        }
        _ => {
            // No block to write and none exists. Leave the file alone.
            return 0;
        }
    };

    if let Err(e) = atomic_write(&target, &new_contents) {
        crate::log::error(&format!("Failed to write {}: {e}", target.display()));
        return -1;
    }
    // Record which file we touched so the wasm/JS API can surface it as
    // InstallResult.installedInstruction.
    crate::report::set_instruction_file(Some(target.to_string_lossy().into_owned()));
    if created {
        crate::log::info(&format!(
            "Created {} with references block",
            target.display()
        ));
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_h1_skips_frontmatter() {
        let dir = std::env::temp_dir().join(format!(
            "rosie-agentsmd-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("R.md");
        std::fs::write(&p, "---\nname: x\n---\n\n# Title here\n\nbody\n").unwrap();
        assert_eq!(extract_first_h1(&p).as_deref(), Some("Title here"));
        std::fs::remove_dir_all(&dir).ok();
    }
}
