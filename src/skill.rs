// Skill discovery and SKILL.md frontmatter parsing.
//
// SKILL.md format:
//   ---
//   name: skill-name
//   description: Some description
//   ---
//   <body>
//
// Only `name` and `description` are parsed — everything else is ignored.

use crate::os;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone)]
pub struct Skill {
    pub name: String,
    pub description: Option<String>,
    /// Directory containing the SKILL.md.
    pub path: PathBuf,
    /// Path to the SKILL.md file itself.
    pub skill_file: PathBuf,
}

/// Search paths checked in order when looking inside a *package* for the
/// skills it ships. Intentionally narrow: `skills/` is the convention, and
/// the recursive fallback below catches anything off-convention. We do not
/// scan agent-specific directories like `.agents/skills`, `.claude/skills`,
/// `.cursor/skills`, etc. — those are consumer-side install destinations,
/// so a project that committed its installed third-party skills would have
/// them mistakenly republished.
const SKILL_SEARCH_PATHS: &[&str] = &["skills"];

/// Parse SKILL.md frontmatter. Returns None on read error or when no name
/// can be derived from frontmatter or the parent directory name.
pub fn parse_skill_file(path: &Path) -> Option<Skill> {
    let contents = match os::read_to_string(path) {
        Ok(s) => s,
        Err(_) => {
            crate::log::debug(&format!("Cannot open: {}", path.display()));
            return None;
        }
    };

    let mut name: Option<String> = None;
    let mut description: Option<String> = None;
    let mut in_frontmatter = false;
    let mut closed_frontmatter = false;

    for line in contents.lines() {
        let trimmed = line.trim();
        if trimmed == "---" {
            if !in_frontmatter {
                in_frontmatter = true;
                continue;
            }
            closed_frontmatter = true;
            break;
        }
        if !in_frontmatter {
            continue;
        }
        if let Some(idx) = trimmed.find(':') {
            let key = trimmed[..idx].trim();
            let mut value = trimmed[idx + 1..].trim();
            // Strip matching quotes.
            if value.len() >= 2 {
                let first = value.as_bytes()[0];
                let last = value.as_bytes()[value.len() - 1];
                if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
                    value = &value[1..value.len() - 1];
                }
            }
            match key {
                "name" => name = Some(value.to_string()),
                "description" => description = Some(value.to_string()),
                _ => {}
            }
        }
    }

    // If no name from frontmatter, fall back to the parent directory name.
    if name.is_none() {
        if let Some(parent) = path.parent() {
            if let Some(dir_name) = parent.file_name() {
                if let Some(s) = dir_name.to_str() {
                    name = Some(s.to_string());
                }
            }
        }
    }

    let name = name?;
    let dir = path
        .parent()
        .map(|p| p.to_path_buf())
        .unwrap_or_else(|| PathBuf::from("."));

    // We don't strictly need closed_frontmatter; the C code is also lenient.
    let _ = closed_frontmatter;

    Some(Skill {
        name,
        description,
        path: dir,
        skill_file: path.to_path_buf(),
    })
}

/// Return the body of a markdown file with leading YAML frontmatter stripped.
/// Returns the full file contents when no frontmatter is present, or None on
/// read error. Mirrors `skill_strip_yaml_frontmatter` from skill.c.
pub fn strip_yaml_frontmatter(path: &Path) -> Option<String> {
    let contents = os::read_to_string(path).ok()?;
    let bytes = contents.as_bytes();
    // Must begin with "---" followed by \n or \r.
    if bytes.len() < 4 || &bytes[..3] != b"---" || (bytes[3] != b'\n' && bytes[3] != b'\r') {
        return Some(contents);
    }
    // Walk lines looking for a sole "---" terminator.
    let mut i = 3;
    while i < bytes.len() && (bytes[i] == b'\r' || bytes[i] == b'\n') {
        i += 1;
    }
    while i < bytes.len() {
        let line_start = i;
        let line_end = bytes[line_start..]
            .iter()
            .position(|&b| b == b'\n')
            .map(|j| line_start + j);
        let raw_end = line_end.unwrap_or(bytes.len());
        let mut check_end = raw_end;
        if check_end > line_start && bytes[check_end - 1] == b'\r' {
            check_end -= 1;
        }
        if check_end - line_start == 3 && &bytes[line_start..line_start + 3] == b"---" {
            // Skip past the closing delimiter line.
            let body_start = match line_end {
                Some(le) => le + 1,
                None => raw_end,
            };
            return Some(contents[body_start..].to_string());
        }
        match line_end {
            Some(le) => i = le + 1,
            None => break,
        }
    }
    crate::log::debug(&format!("Unterminated frontmatter in {}", path.display()));
    Some(contents)
}

/// Walk a directory tree (max depth 5) for SKILL.md files and parse each.
fn find_skills_recursive(base: &Path, out: &mut Vec<Skill>, depth: u32) {
    if depth > 5 {
        return;
    }
    let entries = match os::read_dir(base) {
        Ok(v) => v,
        Err(_) => return,
    };
    for name in entries {
        if name.starts_with('.') {
            continue;
        }
        let child = base.join(&name);
        let kind = match os::metadata(&child) {
            Ok(m) => m.kind,
            Err(_) => continue,
        };
        if kind != os::FileKind::Dir {
            continue;
        }
        let skill_md = child.join("SKILL.md");
        if os::is_file(&skill_md) {
            if let Some(skill) = parse_skill_file(&skill_md) {
                out.push(skill);
                continue;
            }
        }
        find_skills_recursive(&child, out, depth + 1);
    }
}

/// Find all skills in a directory tree. Checks the root first, then each
/// path in `SKILL_SEARCH_PATHS`, then walks the whole tree if nothing was
/// found in the known locations.
pub fn discover_skills(base_dir: &Path) -> Vec<Skill> {
    let mut out = Vec::new();

    // Root-level SKILL.md.
    let root_md = base_dir.join("SKILL.md");
    if os::is_file(&root_md) {
        if let Some(s) = parse_skill_file(&root_md) {
            out.push(s);
        }
    }

    for sub in SKILL_SEARCH_PATHS {
        let search = base_dir.join(sub);
        if os::is_dir(&search) {
            crate::log::debug(&format!("Searching for skills in: {}", search.display()));
            find_skills_recursive(&search, &mut out, 0);
        }
    }

    if out.is_empty() {
        crate::log::debug("No skills in known paths, searching recursively from root");
        find_skills_recursive(base_dir, &mut out, 0);
    }

    out
}

pub fn print(skill: &Skill) {
    match &skill.description {
        Some(d) => crate::log::info(&format!("  {} - {}", skill.name, d)),
        None => crate::log::info(&format!("  {}", skill.name)),
    }
}

pub fn print_list(list: &[Skill]) {
    if list.is_empty() {
        crate::log::info("  (no skills found)");
        return;
    }
    for s in list {
        print(s);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir() -> PathBuf {
        let p = std::env::temp_dir().join(format!(
            "rosie-skill-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn parse_frontmatter() {
        let dir = tmpdir();
        let md = dir.join("foo").join("SKILL.md");
        std::fs::create_dir_all(md.parent().unwrap()).unwrap();
        std::fs::write(
            &md,
            "---\nname: my-skill\ndescription: a test skill\n---\n\n# my-skill\n",
        )
        .unwrap();
        let s = parse_skill_file(&md).expect("should parse");
        assert_eq!(s.name, "my-skill");
        assert_eq!(s.description.as_deref(), Some("a test skill"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn strip_frontmatter() {
        let dir = tmpdir();
        let md = dir.join("S.md");
        std::fs::write(&md, "---\nname: x\n---\n\n# body\n").unwrap();
        let body = strip_yaml_frontmatter(&md).unwrap();
        assert_eq!(body, "\n# body\n");
        std::fs::remove_dir_all(&dir).ok();
    }
}
