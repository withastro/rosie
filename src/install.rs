// Install orchestration. Direct port of install.c.
//
// Public functions return i32 (0 = ok, non-zero = err) so the wasm
// JSON-envelope wrapper stays one line. Internal helpers use Result for
// ergonomics.

use crate::agent::{self, Agent};
use crate::agentsmd;
use crate::archive;
use crate::audit::{self, AuditChange, AuditKind, Operation};
use crate::download::{
    self, source_is_local, source_is_npm, source_local_path, source_npm_split, PackageSpec,
};
use crate::link::rosie_create_link;
use crate::lockfile::{self, LockKind, Lockfile};
use crate::npm;
use crate::os;
use crate::resolve::{self, ResolvedRef};
use crate::sanitize::{self, SanitizeOpts};
use crate::skill::{self, Skill};
use crate::util;
use std::io::Write;
use std::path::{Path, PathBuf};

// Local install storage directories.
pub const LOCAL_AGENTS_DIR: &str = ".agents";
pub const LOCAL_SKILLS_DIR: &str = ".agents/skills";
pub const LOCAL_REFERENCES_DIR: &str = ".agents/references";

// ---------------------------------------------------------------------------
// Options structs — mirror InstallOptions / RemoveOptions in install.h.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct InstallOptions {
    pub spec: Option<String>,
    pub skill_name: Option<String>,
    pub agent_names: Vec<String>,
    pub global: bool,
    pub yes: bool,
    pub list_only: bool,
    pub override_pinned: bool,
    pub pinned: bool,
    pub is_reference: bool,
    pub name_override: Option<String>,
    pub is_npm: bool,
    pub include_paths: Vec<String>,
    pub skip_lockfile: bool,
    pub strip_comments: bool,
    pub strip_invisible: bool,
    pub retag_detect: bool,
    pub force_audit: bool,
    pub suppress_audit: bool,
}

impl Default for InstallOptions {
    fn default() -> Self {
        Self {
            spec: None,
            skill_name: None,
            agent_names: Vec::new(),
            global: false,
            yes: false,
            list_only: false,
            override_pinned: false,
            pinned: false,
            is_reference: false,
            name_override: None,
            is_npm: false,
            include_paths: Vec::new(),
            skip_lockfile: false,
            strip_comments: true,
            strip_invisible: true,
            retag_detect: true,
            force_audit: false,
            suppress_audit: false,
        }
    }
}

impl InstallOptions {
    pub fn sanitize_opts_reference(&self) -> SanitizeOpts {
        SanitizeOpts {
            strip_comments: self.strip_comments,
            strip_invisible: self.strip_invisible,
        }
    }
    pub fn sanitize_opts_skill(&self) -> SanitizeOpts {
        SanitizeOpts {
            strip_comments: false,
            strip_invisible: self.strip_invisible,
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct RemoveOptions {
    pub skill_name: String,
    pub agent_names: Vec<String>,
    pub global: bool,
    pub yes: bool,
    pub skip_lockfile: bool,
}

// ---------------------------------------------------------------------------
// Small i/o helpers
// ---------------------------------------------------------------------------

fn write_string_to_file(path: &Path, contents: &str) -> i32 {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            if let Err(e) = os::create_dir_all(parent) {
                crate::log::error(&format!("Cannot create directory: {e}"));
                return -1;
            }
        }
    }
    if let Err(e) = os::write(path, contents.as_bytes()) {
        crate::log::error(&format!("Cannot create {}: {e}", path.display()));
        return -1;
    }
    0
}

fn ask_yes_no(prompt: &str) -> bool {
    print!("{prompt}");
    let _ = std::io::stdout().flush();
    let mut buf = String::new();
    if std::io::stdin().read_line(&mut buf).is_err() {
        return false;
    }
    let trimmed = buf.trim();
    matches!(trimmed.chars().next(), Some('y') | Some('Y')) || trimmed.is_empty()
}

fn ask_yes_no_default_no(prompt: &str) -> bool {
    print!("{prompt}");
    let _ = std::io::stdout().flush();
    let mut buf = String::new();
    if std::io::stdin().read_line(&mut buf).is_err() {
        return false;
    }
    let trimmed = buf.trim();
    matches!(trimmed.chars().next(), Some('y') | Some('Y'))
}

// ---------------------------------------------------------------------------
// Public: install_skill_to_agent — global install (copy to ~/.<agent>/skills)
// ---------------------------------------------------------------------------

pub fn install_skill_to_agent(skill: &Skill, agent: &Agent, opts: &InstallOptions) -> i32 {
    let target_dir = agent.install_path.join(&skill.name);
    crate::log::debug(&format!(
        "Installing {} to {}",
        skill.name,
        target_dir.display()
    ));
    if let Err(e) = os::create_dir_all(&agent.install_path) {
        crate::log::error(&format!("Cannot create directory: {e}"));
        return -1;
    }
    if let Err(e) = os::copy_dir_recursive(&skill.path, &target_dir) {
        crate::log::error(&format!("Failed to copy skill: {} ({e})", skill.name));
        return -1;
    }
    if let Err(e) = sanitize::sanitize_skill_dir(&target_dir, opts.sanitize_opts_skill()) {
        crate::log::error(&format!("Failed to sanitize skill: {} ({e})", skill.name));
        return -1;
    }
    0
}

/// Local install: symlink an agent's skills dir to the canonical path.
fn install_skill_local(skill_name: &str, agent: &Agent, canonical_path: &Path) -> i32 {
    if let Err(e) = os::create_dir_all(&agent.install_path) {
        crate::log::error(&format!("Cannot create directory: {e}"));
        return -1;
    }
    let link_path = agent.install_path.join(skill_name);
    // Remove existing symlink or directory if present.
    if let Ok(m) = os::symlink_metadata(&link_path) {
        match m.kind {
            os::FileKind::Symlink => {
                let _ = os::remove_file(&link_path);
            }
            os::FileKind::Dir => {
                crate::log::debug(&format!(
                    "Skipping {} (already exists as directory)",
                    link_path.display()
                ));
                return 0;
            }
            _ => {}
        }
    }
    // Symlink target: "../../<canonical>" — one level up from .<agent>/skills/
    // gets us to .<agent>/, another to project root.
    let relative_target = PathBuf::from(format!("../../{}", canonical_path.display()));
    crate::log::debug(&format!(
        "Symlink: {} -> {}",
        link_path.display(),
        relative_target.display()
    ));
    rosie_create_link(&relative_target, &link_path, true)
}

fn install_to_canonical(skill: &Skill, opts: &InstallOptions) -> Option<PathBuf> {
    let canonical_dir = PathBuf::from(LOCAL_SKILLS_DIR).join(&skill.name);
    crate::log::debug(&format!(
        "Installing to canonical path: {}",
        canonical_dir.display()
    ));
    if let Err(e) = os::create_dir_all(Path::new(LOCAL_SKILLS_DIR)) {
        crate::log::error(&format!("Cannot create directory: {LOCAL_SKILLS_DIR}: {e}"));
        return None;
    }
    if let Err(e) = os::copy_dir_recursive(&skill.path, &canonical_dir) {
        crate::log::error(&format!("Failed to copy skill: {} ({e})", skill.name));
        return None;
    }
    if let Err(e) = sanitize::sanitize_skill_dir(&canonical_dir, opts.sanitize_opts_skill()) {
        crate::log::error(&format!("Failed to sanitize skill: {} ({e})", skill.name));
        return None;
    }
    Some(canonical_dir)
}

// ---------------------------------------------------------------------------
// Local-path install (file://… or ./path)
// ---------------------------------------------------------------------------

fn install_local(canonical_rel: &str, opts: &InstallOptions) -> i32 {
    if opts.global {
        crate::log::error("Local skills cannot be installed globally; drop --global");
        return -1;
    }
    let canonical_path = PathBuf::from(canonical_rel);
    if !os::is_dir(&canonical_path) {
        crate::log::error(&format!("Local skill directory not found: {canonical_rel}"));
        return -1;
    }
    let skill_md = canonical_path.join("SKILL.md");
    let skill = match skill::parse_skill_file(&skill_md) {
        Some(s) => s,
        None => {
            crate::log::error(&format!("No valid SKILL.md in {canonical_rel}"));
            return -1;
        }
    };
    if let Some(expected) = opts.skill_name.as_deref() {
        if skill.name != expected {
            crate::log::error(&format!(
                "Skill name mismatch: SKILL.md declares '{}', expected '{}'",
                skill.name, expected
            ));
            return -1;
        }
    }

    crate::log::info(&format!(
        "Linking local skill: {} ({})",
        skill.name, canonical_rel
    ));

    let agents = if !opts.agent_names.is_empty() {
        let names: Vec<&str> = opts.agent_names.iter().map(String::as_str).collect();
        agent::agents_from_names(&names, false)
    } else {
        agent::detect_agents(false)
    };
    if agents.is_empty() {
        crate::log::error("No agents detected. Use --agent to specify target agent.");
        return -1;
    }

    if opts.list_only {
        crate::log::info("Found 1 skill:");
        skill::print(&skill);
        return 0;
    }

    if !opts.yes {
        let prompt = format!(
            "\nLink {} -> {}/{} for {} agent(s)? [Y/n] ",
            canonical_rel,
            LOCAL_SKILLS_DIR,
            skill.name,
            agents.len()
        );
        if !ask_yes_no(&prompt) {
            crate::log::info("Cancelled.");
            return 0;
        }
    }

    if let Err(e) = os::create_dir_all(Path::new(LOCAL_SKILLS_DIR)) {
        crate::log::error(&format!("Cannot create directory: {LOCAL_SKILLS_DIR}: {e}"));
        return -1;
    }

    // canonical symlink target: ../../<canonical_rel_without_./>
    let rel_for_link = canonical_rel.strip_prefix("./").unwrap_or(canonical_rel);
    let canonical_target = if rel_for_link.is_empty() || rel_for_link == "." {
        PathBuf::from("../..")
    } else {
        PathBuf::from(format!("../../{rel_for_link}"))
    };
    let canonical_link = PathBuf::from(LOCAL_SKILLS_DIR).join(&skill.name);

    match os::symlink_metadata(&canonical_link) {
        Ok(m) if m.kind == os::FileKind::Symlink => {
            let existing = os::read_link(&canonical_link).unwrap_or_default();
            if existing == canonical_target.to_string_lossy() {
                crate::log::debug(&format!(
                    "Canonical symlink already correct: {}",
                    canonical_link.display()
                ));
            } else if os::remove_file(&canonical_link).is_err()
                || rosie_create_link(&canonical_target, &canonical_link, true) != 0
            {
                return -1;
            }
        }
        Ok(_) => {
            crate::log::error(&format!(
                "Refusing to overwrite existing non-symlink at {}",
                canonical_link.display()
            ));
            return -1;
        }
        Err(_) => {
            if rosie_create_link(&canonical_target, &canonical_link, true) != 0 {
                return -1;
            }
        }
    }

    crate::log::info(&format!(
        "  {} -> {}",
        canonical_link.display(),
        canonical_target.display()
    ));

    let mut linked = 0;
    let mut ok_agents = Vec::new();
    let mut fail_agents = Vec::new();
    for a in &agents {
        if install_skill_local(&skill.name, a, &canonical_link) == 0 {
            linked += 1;
            ok_agents.push(a.def.name.to_string());
        } else {
            fail_agents.push(a.def.name.to_string());
        }
    }
    crate::log::info(&format!("    symlink -> {linked} agent(s)"));
    crate::report::push(crate::report::InstallReport {
        kind: crate::report::ReportKind::Skill,
        skill_name: skill.name.clone(),
        installed_agents: ok_agents,
        failed_agents: fail_agents,
    });

    if !opts.skip_lockfile {
        let mut lf = Lockfile::load(Path::new(LOCAL_AGENTS_DIR));
        let now = lockfile::now_iso8601();
        let source = format!("file://{canonical_rel}");
        lf.upsert(&skill.name, &source, "-", "-", &now, true, LockKind::Skill);
        if let Err(e) = lf.save() {
            crate::log::error(&format!("Warning: failed to write {}: {e}", lf.path.display()));
        }
    }

    crate::log::info(&format!("Linked {}.", skill.name));
    0
}

// ---------------------------------------------------------------------------
// Reference helpers
// ---------------------------------------------------------------------------

fn default_ref_name(spec: &PackageSpec, skill: Option<&str>) -> String {
    let owner = spec.owner.as_deref().unwrap_or("");
    let repo = spec.repo.as_deref().unwrap_or("");
    match skill {
        Some(s) if !s.is_empty() => format!("{owner}-{repo}-{s}"),
        _ => format!("{owner}-{repo}"),
    }
}

/// Find a README.md (case-insensitive on the basename — only matches files
/// whose name lowercases to "readme.md" or starts with "readme").
fn find_readme_in_tree(root: &Path) -> Option<PathBuf> {
    let exact = root.join("README.md");
    if os::is_file(&exact) {
        return Some(exact);
    }
    let entries = os::read_dir(root).ok()?;
    for name in entries {
        if name.len() < 6 {
            continue;
        }
        let lower = name.to_ascii_lowercase();
        if lower.starts_with("readme") {
            let candidate = root.join(&name);
            if os::is_file(&candidate) {
                return Some(candidate);
            }
        }
    }
    None
}

/// Copy node_modules/<pkg>/<rel_path> into .agents/references/<name>/REFERENCE.md,
/// applying sanitize_reference on the way. Previously symlinked, but we now
/// own the content so the strip pass can run and so updates are explicit
/// (lockfile-tracked) rather than tracking `npm install` silently.
fn npm_install_one(name: &str, pkg: &str, rel_path: &str, opts: &InstallOptions) -> i32 {
    let ref_dir = PathBuf::from(LOCAL_REFERENCES_DIR).join(name);
    if let Err(e) = os::create_dir_all(&ref_dir) {
        crate::log::error(&format!("Cannot create directory: {} ({e})", ref_dir.display()));
        return -1;
    }
    let ref_file = ref_dir.join("REFERENCE.md");
    let src = PathBuf::from("node_modules").join(pkg).join(rel_path);

    // Read prior content (if any) before we overwrite, so the audit can show
    // a unified diff for updates.
    let prior = match os::symlink_metadata(&ref_file) {
        Ok(m) if matches!(m.kind, os::FileKind::File) => os::read_to_string(&ref_file).ok(),
        // Symlinks were left over from the pre-copy era. Treat as no prior.
        _ => None,
    };

    // Remove any prior install (symlink from an older rosie or a stale copy).
    if let Ok(m) = os::symlink_metadata(&ref_file) {
        if matches!(m.kind, os::FileKind::Symlink | os::FileKind::File) {
            let _ = os::remove_file(&ref_file);
        }
    }
    let body = match os::read_to_string(&src) {
        Ok(s) => s,
        Err(e) => {
            crate::log::error(&format!("Cannot read {}: {e}", src.display()));
            return -1;
        }
    };
    let body = sanitize::sanitize_reference(&body, opts.sanitize_opts_reference());
    let rc = write_string_to_file(&ref_file, &body);
    if rc != 0 {
        return rc;
    }

    let operation = if prior.is_some() {
        Operation::Update
    } else {
        Operation::Install
    };
    let (content_field, diff_field) = match (prior.as_deref(), operation) {
        (Some(old), Operation::Update) => (None, Some(audit::unified_diff(name, old, &body))),
        _ => (Some(body.clone()), None),
    };
    audit::push_change(AuditChange {
        name: name.to_string(),
        kind: AuditKind::Reference,
        source: npm_lock_source(pkg, rel_path),
        ref_name: String::new(),
        sha: String::new(),
        operation,
        content: content_field,
        diff: diff_field,
    });

    0
}

fn npm_lock_source(pkg: &str, rel_path: &str) -> String {
    format!("npm:{pkg}#{rel_path}")
}

fn install_npm_references(opts: &InstallOptions) -> i32 {
    let pkg = match opts.spec.as_deref() {
        Some(p) if !p.is_empty() => p,
        _ => {
            crate::log::error("--npm requires a package name");
            return -1;
        }
    };
    let pkg_root = PathBuf::from("node_modules").join(pkg);
    if !os::is_dir(&pkg_root) {
        crate::log::error(&format!(
            "npm package not found: {} (run `npm install {pkg}` first)",
            pkg_root.display()
        ));
        return -1;
    }
    let pjson = pkg_root.join("package.json");
    let version = match util::read_json_string_field(&pjson, "version") {
        Some(v) => v,
        None => {
            crate::log::error(&format!(
                "Cannot read version from {}/package.json",
                pkg_root.display()
            ));
            return -1;
        }
    };
    crate::log::info(&format!("Installing npm references for {pkg}@{version}..."));

    let includes: Vec<&str> = opts.include_paths.iter().map(String::as_str).collect();
    let files = npm::collect_files(&pkg_root, &includes);
    if files.is_empty() {
        crate::log::error(&format!("No matching .md files found in {}", pkg_root.display()));
        return -1;
    }

    let mut lf = if opts.skip_lockfile {
        None
    } else {
        Some(Lockfile::load(Path::new(LOCAL_AGENTS_DIR)))
    };
    let now = if opts.skip_lockfile {
        String::new()
    } else {
        lockfile::now_iso8601()
    };
    let mut installed = 0;

    for rel in &files {
        let name = npm::ref_name(pkg, rel);
        if npm_install_one(&name, pkg, rel, opts) != 0 {
            continue;
        }
        if let Some(lf) = lf.as_mut() {
            let source = npm_lock_source(pkg, rel);
            lf.upsert(&name, &source, "-", &version, &now, false, LockKind::Ref);
        }
        crate::log::info(&format!("  {name}"));
        crate::report::push(crate::report::InstallReport {
            skill_name: name.clone(),
            kind: crate::report::ReportKind::Reference,
            installed_agents: Vec::new(),
            failed_agents: Vec::new(),
        });
        installed += 1;
    }

    if let Some(mut lf) = lf {
        if let Err(e) = lf.save() {
            crate::log::error(&format!("Warning: failed to write {}: {e}", lf.path.display()));
        }
        if agentsmd::rebuild_block(&lf) != 0 {
            crate::log::error(&format!(
                "Warning: failed to update {}",
                agentsmd::target_path().display()
            ));
        }
    }

    crate::log::info(&format!("Installed {installed} npm reference(s)."));
    if installed > 0 {
        0
    } else {
        -1
    }
}

/// Install a reference (--ref) from an extracted source tree. The body comes
/// either from the repo's README (default) or from a specific skill's body
/// (with `--skill <name>`, frontmatter stripped). Writes
/// .agents/references/<name>/REFERENCE.md and records a LockKind::Ref entry.
fn install_reference_from_extracted(
    extracted: &Path,
    spec: &PackageSpec,
    opts: &InstallOptions,
    resolved: Option<&ResolvedRef>,
) -> i32 {
    let skill_name = opts
        .skill_name
        .as_deref()
        .or(spec.skill_in_spec.as_deref());

    let name = match &opts.name_override {
        Some(s) if !s.is_empty() => s.clone(),
        _ => default_ref_name(spec, skill_name),
    };

    let body: Option<String> = if let Some(s) = skill_name {
        let skills = skill::discover_skills(extracted);
        if skills.is_empty() {
            crate::log::error("No skills found in package");
            return -1;
        }
        let m = skills.iter().find(|sk| sk.name == s);
        match m {
            Some(sk) => skill::strip_yaml_frontmatter(&sk.skill_file),
            None => {
                crate::log::error(&format!("Skill '{s}' not found in package"));
                crate::log::info("Available skills:");
                skill::print_list(&skills);
                return -1;
            }
        }
    } else {
        match find_readme_in_tree(extracted) {
            Some(r) => skill::strip_yaml_frontmatter(&r),
            None => {
                crate::log::error("No README found in repository root");
                return -1;
            }
        }
    };

    let body = match body {
        Some(b) => b,
        None => {
            crate::log::error("Failed to read reference source");
            return -1;
        }
    };

    let body = sanitize::sanitize_reference(&body, opts.sanitize_opts_reference());

    let ref_dir = PathBuf::from(LOCAL_REFERENCES_DIR).join(&name);
    let ref_file = ref_dir.join("REFERENCE.md");

    let prior = os::read_to_string(&ref_file).ok();
    let operation = if prior.is_some() {
        Operation::Update
    } else {
        Operation::Install
    };

    if write_string_to_file(&ref_file, &body) != 0 {
        return -1;
    }

    let owner_audit = spec.owner.as_deref().unwrap_or("");
    let repo_audit = spec.repo.as_deref().unwrap_or("");
    let source_audit = match skill_name {
        Some(s) => format!("{owner_audit}/{repo_audit}#{s}"),
        None => format!("{owner_audit}/{repo_audit}"),
    };
    let (content_field, diff_field) = match (prior.as_deref(), operation) {
        (Some(old), Operation::Update) => (None, Some(audit::unified_diff(&name, old, &body))),
        _ => (Some(body.clone()), None),
    };
    audit::push_change(AuditChange {
        name: name.clone(),
        kind: AuditKind::Reference,
        source: source_audit,
        ref_name: spec.ref_.clone().unwrap_or_default(),
        sha: resolved.map(|r| r.sha.clone()).unwrap_or_default(),
        operation,
        content: content_field,
        diff: diff_field,
    });
    crate::log::info(&format!("  {}", ref_file.display()));
    crate::report::push(crate::report::InstallReport {
        skill_name: name.clone(),
        kind: crate::report::ReportKind::Reference,
        installed_agents: Vec::new(),
        failed_agents: Vec::new(),
    });

    // Build the lockfile source. For skill-based refs we encode the skill
    // name as "owner/repo#skill" so update/reinstall round-trip.
    let owner = spec.owner.as_deref().unwrap_or("");
    let repo = spec.repo.as_deref().unwrap_or("");
    let source = match skill_name {
        Some(s) => format!("{owner}/{repo}#{s}"),
        None => format!("{owner}/{repo}"),
    };

    if !opts.skip_lockfile {
        let mut lf = Lockfile::load(Path::new(LOCAL_AGENTS_DIR));
        let now = lockfile::now_iso8601();
        let effective_pinned = if opts.override_pinned {
            opts.pinned
        } else {
            spec.ref_explicit
        };
        let sha = resolved
            .map(|r| r.sha.as_str())
            .unwrap_or("-");
        let ref_ = spec.ref_.as_deref().unwrap_or("-");
        lf.upsert(&name, &source, ref_, sha, &now, effective_pinned, LockKind::Ref);
        if let Err(e) = lf.save() {
            crate::log::error(&format!("Warning: failed to write {}: {e}", lf.path.display()));
        }
        if agentsmd::rebuild_block(&lf) != 0 {
            crate::log::error(&format!(
                "Warning: failed to update {}",
                agentsmd::target_path().display()
            ));
        }
    }
    0
}

// ---------------------------------------------------------------------------
// Public: install_package — the main install entry point
// ---------------------------------------------------------------------------

pub fn install_package(opts: &InstallOptions) -> i32 {
    let spec_str = match opts.spec.as_deref() {
        Some(s) if !s.is_empty() => s,
        _ => {
            crate::log::error("No package specified");
            return -1;
        }
    };

    if opts.is_npm {
        return install_npm_references(opts);
    }

    let mut spec = match download::parse(spec_str) {
        Some(s) => s,
        None => return -1,
    };

    if spec.is_local {
        let canonical = spec.local_path.clone().unwrap_or_default();
        return install_local(&canonical, opts);
    }

    crate::log::info(&format!(
        "Installing {}/{}...",
        spec.owner.as_deref().unwrap_or(""),
        spec.repo.as_deref().unwrap_or("")
    ));

    // Resolve the ref before downloading. For auto installs, pick the
    // highest semver tag (and fall back to the recorded branch SHA if none).
    let resolved: Option<ResolvedRef>;
    if !spec.ref_explicit {
        if let Some(r) = resolve::resolve_latest_tag(&spec) {
            crate::log::info(&format!(
                "Resolved {}/{} -> {}",
                spec.owner.as_deref().unwrap_or(""),
                spec.repo.as_deref().unwrap_or(""),
                r.ref_
            ));
            spec.ref_ = Some(r.ref_.clone());
            resolved = Some(r);
        } else {
            crate::log::debug(&format!(
                "No semver tags for {}/{}, using {}",
                spec.owner.as_deref().unwrap_or(""),
                spec.repo.as_deref().unwrap_or(""),
                spec.ref_.as_deref().unwrap_or(""),
            ));
            let cur = spec.ref_.clone().unwrap_or_default();
            resolved = resolve::resolve_ref(&spec, &cur);
        }
    } else {
        let cur = spec.ref_.clone().unwrap_or_default();
        resolved = resolve::resolve_ref(&spec, &cur);
    }
    if resolved.is_none() {
        crate::log::debug(&format!(
            "Could not resolve SHA for {}, lockfile entry will use stub",
            spec.ref_.as_deref().unwrap_or("")
        ));
    }

    let temp_dir = match os::create_temp_dir("rosie") {
        Ok(d) => d,
        Err(e) => {
            crate::log::error(&format!("Cannot create temp directory: {e}"));
            return -1;
        }
    };
    let tarball_path = temp_dir.join("package.tar.gz");
    crate::log::info("Downloading...");
    if download::download_package_tarball(&spec, &tarball_path) != 0 {
        crate::log::error("Failed to download package");
        let _ = os::remove_dir_all(&temp_dir);
        return -1;
    }

    crate::log::info("Extracting...");
    if archive::extract_tarball(&tarball_path, &temp_dir) != 0 {
        crate::log::error("Failed to extract package");
        let _ = os::remove_dir_all(&temp_dir);
        return -1;
    }

    let extracted_path = match archive::root_dir(&tarball_path) {
        Some(root) => temp_dir.join(root),
        None => temp_dir.clone(),
    };

    if opts.is_reference {
        let rc = install_reference_from_extracted(&extracted_path, &spec, opts, resolved.as_ref());
        let _ = os::remove_dir_all(&temp_dir);
        return rc;
    }

    crate::log::info("Discovering skills...");
    let mut skills = skill::discover_skills(&extracted_path);
    if skills.is_empty() {
        crate::log::error("No skills found in package");
        let _ = os::remove_dir_all(&temp_dir);
        return -1;
    }

    if let Some(want) = opts.skill_name.as_deref() {
        let idx = skills.iter().position(|s| s.name == want);
        let Some(idx) = idx else {
            crate::log::error(&format!("Skill '{want}' not found in package"));
            crate::log::info("Available skills:");
            skill::print_list(&skills);
            let _ = os::remove_dir_all(&temp_dir);
            return -1;
        };
        let keep = skills.remove(idx);
        skills.clear();
        skills.push(keep);
    }

    crate::log::info(&format!("Found {} skill(s):", skills.len()));
    skill::print_list(&skills);

    if opts.list_only {
        let _ = os::remove_dir_all(&temp_dir);
        return 0;
    }

    let agents = if !opts.agent_names.is_empty() {
        let names: Vec<&str> = opts.agent_names.iter().map(String::as_str).collect();
        agent::agents_from_names(&names, opts.global)
    } else {
        agent::detect_agents(opts.global)
    };
    if agents.is_empty() {
        crate::log::error("No agents detected. Use --agent to specify target agent.");
        let _ = os::remove_dir_all(&temp_dir);
        return -1;
    }

    crate::log::info("Target agents:");
    for a in &agents {
        crate::log::info(&format!("  {} ({})", a.def.display, a.install_path.display()));
    }

    if !opts.yes {
        if !ask_yes_no("\nProceed with installation? [Y/n] ") {
            crate::log::info("Installation cancelled.");
            let _ = os::remove_dir_all(&temp_dir);
            return 0;
        }
    }

    let mut installed = 0;
    let owner = spec.owner.as_deref().unwrap_or("");
    let repo = spec.repo.as_deref().unwrap_or("");
    let source = format!("{owner}/{repo}");

    let ref_name_audit = spec.ref_.clone().unwrap_or_default();
    let sha_audit = resolved.as_ref().map(|r| r.sha.clone()).unwrap_or_default();

    if opts.global {
        for s in &skills {
            let new_skill_md = os::read_to_string(&s.skill_file).unwrap_or_default();
            let mut ok_agents = Vec::new();
            let mut fail_agents = Vec::new();
            for a in &agents {
                if install_skill_to_agent(s, a, opts) == 0 {
                    installed += 1;
                    ok_agents.push(a.def.name.to_string());
                } else {
                    fail_agents.push(a.def.name.to_string());
                }
            }
            crate::report::push(crate::report::InstallReport {
                skill_name: s.name.clone(),
                kind: crate::report::ReportKind::Skill,
                installed_agents: ok_agents,
                failed_agents: fail_agents,
            });
            audit::push_change(AuditChange {
                name: s.name.clone(),
                kind: AuditKind::Skill,
                source: source.clone(),
                ref_name: ref_name_audit.clone(),
                sha: sha_audit.clone(),
                operation: Operation::Install,
                content: Some(sanitize::sanitize_skill(
                    &new_skill_md,
                    opts.sanitize_opts_skill(),
                )),
                diff: None,
            });
        }
        crate::log::info(&format!(
            "Installed {installed} skill(s) to {} agent(s).",
            agents.len()
        ));
    } else {
        let mut lf = if opts.skip_lockfile {
            None
        } else {
            Some(Lockfile::load(Path::new(LOCAL_AGENTS_DIR)))
        };
        let now = if opts.skip_lockfile {
            String::new()
        } else {
            lockfile::now_iso8601()
        };
        let effective_pinned = if opts.override_pinned {
            opts.pinned
        } else {
            spec.ref_explicit
        };

        for s in &skills {
            // Read existing canonical SKILL.md (if any) before overwriting,
            // so the audit can show what changed.
            let canonical_skill_md = PathBuf::from(LOCAL_SKILLS_DIR)
                .join(&s.name)
                .join("SKILL.md");
            let prior_skill = os::read_to_string(&canonical_skill_md).ok();

            let canonical = match install_to_canonical(s, opts) {
                Some(p) => p,
                None => continue,
            };
            crate::log::info(&format!("  {}", canonical.display()));
            crate::log::info(&format!("    symlink -> {} agent(s)", agents.len()));
            let mut ok_agents = Vec::new();
            let mut fail_agents = Vec::new();
            for a in &agents {
                if install_skill_local(&s.name, a, &canonical) == 0 {
                    installed += 1;
                    ok_agents.push(a.def.name.to_string());
                } else {
                    fail_agents.push(a.def.name.to_string());
                }
            }
            crate::report::push(crate::report::InstallReport {
                skill_name: s.name.clone(),
                kind: crate::report::ReportKind::Skill,
                installed_agents: ok_agents,
                failed_agents: fail_agents,
            });

            let new_skill_md = os::read_to_string(&canonical.join("SKILL.md")).unwrap_or_default();
            let operation = if prior_skill.is_some() {
                Operation::Update
            } else {
                Operation::Install
            };
            let (content_field, diff_field) = match (prior_skill.as_deref(), operation) {
                (Some(old), Operation::Update) => {
                    (None, Some(audit::unified_diff(&s.name, old, &new_skill_md)))
                }
                _ => (Some(new_skill_md), None),
            };
            audit::push_change(AuditChange {
                name: s.name.clone(),
                kind: AuditKind::Skill,
                source: source.clone(),
                ref_name: ref_name_audit.clone(),
                sha: sha_audit.clone(),
                operation,
                content: content_field,
                diff: diff_field,
            });

            if let Some(lf) = lf.as_mut() {
                let sha = resolved
                    .as_ref()
                    .map(|r| r.sha.as_str())
                    .unwrap_or("-");
                lf.upsert(
                    &s.name,
                    &source,
                    spec.ref_.as_deref().unwrap_or("-"),
                    sha,
                    &now,
                    effective_pinned,
                    LockKind::Skill,
                );
            }
        }
        if let Some(mut lf) = lf {
            if let Err(e) = lf.save() {
                crate::log::error(&format!(
                    "Warning: failed to write {}: {e}",
                    lf.path.display()
                ));
            }
        }
        crate::log::info(&format!("Installed {installed} skill(s) via symlinks."));
    }

    let _ = os::remove_dir_all(&temp_dir);
    0
}

// ---------------------------------------------------------------------------
// Public: remove_skill
// ---------------------------------------------------------------------------

fn remove_reference(opts: &RemoveOptions) -> i32 {
    let ref_dir = PathBuf::from(LOCAL_REFERENCES_DIR).join(&opts.skill_name);
    let present = os::is_dir(&ref_dir);
    if !present {
        crate::log::info(&format!(
            "Reference '{}' has no on-disk directory; cleaning lockfile entry",
            opts.skill_name
        ));
    }
    if !opts.yes {
        let prompt = format!("\nRemove reference '{}'? [y/N] ", opts.skill_name);
        if !ask_yes_no_default_no(&prompt) {
            crate::log::info("Removal cancelled.");
            return 0;
        }
    }
    if present {
        if let Err(e) = os::remove_dir_all(&ref_dir) {
            crate::log::error(&format!("Failed to remove {}: {e}", ref_dir.display()));
        }
    }
    if !opts.skip_lockfile {
        let mut lf = Lockfile::load(Path::new(LOCAL_AGENTS_DIR));
        if lf.remove(&opts.skill_name) {
            if let Err(e) = lf.save() {
                crate::log::error(&format!(
                    "Warning: failed to update {}: {e}",
                    lf.path.display()
                ));
            }
        }
        if agentsmd::rebuild_block(&lf) != 0 {
            crate::log::error(&format!(
                "Warning: failed to update {}",
                agentsmd::target_path().display()
            ));
        }
    }
    crate::log::info(&format!("Removed reference '{}'.", opts.skill_name));
    0
}

pub fn remove_skill(opts: &RemoveOptions) -> i32 {
    if opts.skill_name.is_empty() {
        crate::log::error("No skill specified");
        return -1;
    }
    // Branch on lockfile kind first: refs aren't symlinked into agents.
    if !opts.global {
        let lf_peek = Lockfile::load(Path::new(LOCAL_AGENTS_DIR));
        if let Some(e) = lf_peek.find(&opts.skill_name) {
            if e.kind == LockKind::Ref {
                return remove_reference(opts);
            }
        }
    }

    let agents = if !opts.agent_names.is_empty() {
        let names: Vec<&str> = opts.agent_names.iter().map(String::as_str).collect();
        agent::agents_from_names(&names, opts.global)
    } else {
        agent::detect_agents(opts.global)
    };
    if agents.is_empty() {
        crate::log::error("No agents detected. Use --agent to specify target agent.");
        return -1;
    }

    let mut found_count = 0;
    for a in &agents {
        let skill_path = a.install_path.join(&opts.skill_name);
        if os::symlink_metadata(&skill_path).is_ok() {
            found_count += 1;
            crate::log::info(&format!("Found: {} ({})", opts.skill_name, skill_path.display()));
        }
    }
    if found_count == 0 {
        crate::log::error(&format!(
            "Skill '{}' not found in any agent",
            opts.skill_name
        ));
        return -1;
    }

    if !opts.yes {
        let prompt = format!(
            "\nRemove '{}' from {found_count} agent(s)? [y/N] ",
            opts.skill_name
        );
        if !ask_yes_no_default_no(&prompt) {
            crate::log::info("Removal cancelled.");
            return 0;
        }
    }

    let mut removed = 0;
    for a in &agents {
        let skill_path = a.install_path.join(&opts.skill_name);
        let meta = match os::symlink_metadata(&skill_path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        crate::log::debug(&format!("Removing: {}", skill_path.display()));
        let rc = match meta.kind {
            os::FileKind::Symlink | os::FileKind::File => os::remove_file(&skill_path),
            os::FileKind::Dir => os::remove_dir_all(&skill_path),
            _ => os::remove_file(&skill_path),
        };
        if rc.is_ok() {
            removed += 1;
        } else {
            crate::log::error(&format!("Failed to remove: {}", skill_path.display()));
        }
    }
    crate::log::info(&format!(
        "Removed '{}' from {removed} agent(s).",
        opts.skill_name
    ));

    if !opts.global && !opts.skip_lockfile {
        let mut lf = Lockfile::load(Path::new(LOCAL_AGENTS_DIR));
        if lf.remove(&opts.skill_name) {
            if let Err(e) = lf.save() {
                crate::log::error(&format!(
                    "Warning: failed to update {}: {e}",
                    lf.path.display()
                ));
            }
        }
    }
    0
}

// ---------------------------------------------------------------------------
// install_from_lockfile / update_skills helpers
// ---------------------------------------------------------------------------

fn build_spec_string(source: &str, ref_: &str) -> String {
    format!("{source}@{ref_}")
}

// ---------------------------------------------------------------------------
// install_from_lockfile
// ---------------------------------------------------------------------------

pub fn install_from_lockfile(base_opts: &InstallOptions) -> i32 {
    let lf = Lockfile::load(Path::new(LOCAL_AGENTS_DIR));
    if lf.entries.is_empty() {
        crate::log::error(&format!(
            "No lockfile entries to install ({})",
            lf.path.display()
        ));
        crate::log::info("Did you mean: rosie install <owner/repo>?");
        return 1;
    }

    let snap: Vec<lockfile::LockEntry> = lf.entries.clone();
    drop(lf);
    let count = snap.len();
    crate::log::info(&format!("Reinstalling {count} skill(s) from lockfile..."));

    let (mut ok, mut fail, mut fresh, mut present) = (0, 0, 0, 0);

    for e in &snap {
        // npm: refs are symlinks into node_modules/. Recreate the single
        // symlink for this entry. No version refresh (`rosie update` does that).
        if source_is_npm(&e.source) {
            let split = source_npm_split(&e.source);
            let (pkg, file_rel) = match split {
                Some((p, Some(f))) => (p, f),
                _ => {
                    crate::log::error(&format!("malformed npm source: {}", e.source));
                    fail += 1;
                    continue;
                }
            };
            let abs_file = PathBuf::from("node_modules").join(&pkg).join(&file_rel);
            if !os::is_file(&abs_file) {
                crate::log::info(&format!(
                    "warning: {} npm package missing locally, skipping ({})",
                    e.skill_name,
                    abs_file.display()
                ));
                continue;
            }
            if npm_install_one(&e.skill_name, &pkg, &file_rel, base_opts) == 0 {
                ok += 1;
                fresh += 1;
            } else {
                fail += 1;
            }
            continue;
        }

        // file:// entries: skip parse, just relink.
        if source_is_local(&e.source) {
            let canonical_rel = match source_local_path(&e.source) {
                Some(p) => p.to_string(),
                None => continue,
            };
            if !os::is_dir(Path::new(&canonical_rel)) {
                crate::log::info(&format!(
                    "warning: {} source missing locally, skipping ({})",
                    e.skill_name, canonical_rel
                ));
                continue;
            }
            let opts = InstallOptions {
                spec: None,
                skill_name: Some(e.skill_name.clone()),
                yes: true,
                list_only: false,
                global: false,
                override_pinned: false,
                pinned: false,
                ..base_opts.clone()
            };
            if install_local(&canonical_rel, &opts) == 0 {
                ok += 1;
            } else {
                fail += 1;
            }
            continue;
        }

        // Reference entries: pass through install_package as a ref install
        // with name_override so the recorded name is preserved.
        if e.kind == LockKind::Ref {
            let ref_md = PathBuf::from(LOCAL_REFERENCES_DIR)
                .join(&e.skill_name)
                .join("REFERENCE.md");
            if os::is_file(&ref_md) {
                crate::log::info(&format!(
                    "{}: already at {} (reference)",
                    e.skill_name, e.ref_
                ));
                present += 1;
                ok += 1;
                continue;
            }
            let spec_str = build_spec_string(&e.source, &e.ref_);
            let opts = InstallOptions {
                spec: Some(spec_str),
                skill_name: None,
                name_override: Some(e.skill_name.clone()),
                is_reference: true,
                yes: true,
                list_only: false,
                global: false,
                override_pinned: true,
                pinned: e.pinned,
                ..base_opts.clone()
            };
            if install_package(&opts) == 0 {
                ok += 1;
                fresh += 1;
            } else {
                fail += 1;
            }
            continue;
        }

        // Trust the lockfile: if .agents/skills/<name>/SKILL.md is there,
        // just relink each agent and skip download.
        let canonical = PathBuf::from(LOCAL_SKILLS_DIR).join(&e.skill_name);
        let present_on_disk = os::is_file(&canonical.join("SKILL.md"));
        if present_on_disk {
            let agents = if !base_opts.agent_names.is_empty() {
                let names: Vec<&str> = base_opts.agent_names.iter().map(String::as_str).collect();
                agent::agents_from_names(&names, false)
            } else {
                agent::detect_agents(false)
            };
            let mut linked = 0;
            let mut ok_agents = Vec::new();
            let mut fail_agents = Vec::new();
            for a in &agents {
                if install_skill_local(&e.skill_name, a, &canonical) == 0 {
                    linked += 1;
                    ok_agents.push(a.def.name.to_string());
                } else {
                    fail_agents.push(a.def.name.to_string());
                }
            }
            crate::log::info(&format!(
                "{}: already at {} ({linked} agent symlink(s))",
                e.skill_name, e.ref_
            ));
            crate::report::push(crate::report::InstallReport {
                skill_name: e.skill_name.clone(),
                kind: crate::report::ReportKind::Skill,
                installed_agents: ok_agents,
                failed_agents: fail_agents,
            });
            present += 1;
            ok += 1;
            continue;
        }

        let spec_str = build_spec_string(&e.source, &e.ref_);
        let opts = InstallOptions {
            spec: Some(spec_str),
            skill_name: Some(e.skill_name.clone()),
            yes: true,
            list_only: false,
            global: false,
            override_pinned: true,
            pinned: e.pinned,
            ..base_opts.clone()
        };
        if install_package(&opts) == 0 {
            ok += 1;
            fresh += 1;
        } else {
            fail += 1;
        }
    }

    // Refresh AGENTS.md from final lockfile state.
    let lf_final = Lockfile::load(Path::new(LOCAL_AGENTS_DIR));
    let _ = agentsmd::rebuild_block(&lf_final);

    if fail > 0 {
        crate::log::error(&format!(
            "Reinstalled {ok} ({present} already present, {fresh} fresh), {fail} failed"
        ));
        return 1;
    }
    if fresh == 0 {
        crate::log::info(&format!("All {ok} skill(s) already installed."));
    } else {
        crate::log::info(&format!(
            "Reinstalled {ok} skill(s) ({present} already present, {fresh} freshly installed)."
        ));
    }
    0
}

// ---------------------------------------------------------------------------
// update_skills
// ---------------------------------------------------------------------------

/// Reconcile a single npm package: read installed version, walk default
/// scope + previously recorded files, drop dead refs, add new ones, refresh
/// symlinks and the version column. Mutates the in-memory lockfile.
fn update_npm_package(
    lf: &mut Lockfile,
    pkg: &str,
    prev_files: &[String],
    advanced: &mut i32,
    unchanged: &mut i32,
    failed: &mut i32,
    opts: &InstallOptions,
) {
    let pkg_root = PathBuf::from("node_modules").join(pkg);
    if !os::is_dir(&pkg_root) {
        crate::log::error(&format!("update: npm package missing locally: {}", pkg_root.display()));
        *failed += 1;
        return;
    }
    let pjson = pkg_root.join("package.json");
    let version = match util::read_json_string_field(&pjson, "version") {
        Some(v) => v,
        None => {
            crate::log::error(&format!(
                "update: cannot read version from {}/package.json",
                pkg_root.display()
            ));
            *failed += 1;
            return;
        }
    };

    // Default scope + previously-recorded files.
    let mut current = npm::collect_files(&pkg_root, &[]);
    for prev in prev_files {
        let abs = pkg_root.join(prev);
        if !os::is_file(&abs) {
            continue;
        }
        if !current.iter().any(|p| p == prev) {
            current.push(prev.clone());
        }
    }

    // Drop entries for this pkg whose file is no longer in the current set.
    let mut i = 0;
    while i < lf.entries.len() {
        let e = &lf.entries[i];
        if e.kind != LockKind::Ref || !source_is_npm(&e.source) {
            i += 1;
            continue;
        }
        let (epkg, efile) = match source_npm_split(&e.source) {
            Some((p, f)) => (p, f),
            None => {
                i += 1;
                continue;
            }
        };
        if epkg != pkg {
            i += 1;
            continue;
        }
        let keep = match &efile {
            Some(f) => current.iter().any(|c| c == f),
            None => true,
        };
        if keep {
            i += 1;
            continue;
        }
        crate::log::info(&format!("{}: removed (no longer in package)", e.skill_name));
        let dir = PathBuf::from(LOCAL_REFERENCES_DIR).join(&e.skill_name);
        let _ = os::remove_dir_all(&dir);
        let dead = e.skill_name.clone();
        lf.remove(&dead);
        // Don't advance i — array shifted.
    }

    let now = lockfile::now_iso8601();
    for rel in &current {
        let name = npm::ref_name(pkg, rel);
        let source = npm_lock_source(pkg, rel);

        let (was_present, version_changed) = match lf.find(&name) {
            Some(prev) => (true, prev.sha != version),
            None => (false, false),
        };

        let _ = npm_install_one(&name, pkg, rel, opts);
        lf.upsert(&name, &source, "-", &version, &now, false, LockKind::Ref);

        if !was_present {
            crate::log::info(&format!("{name}: added"));
            *advanced += 1;
        } else if version_changed {
            *advanced += 1;
        } else {
            *unchanged += 1;
        }
    }
    crate::log::info(&format!(
        "{pkg}: refreshed at {version} ({} file(s))",
        current.len()
    ));
}

pub fn update_skills(base_opts: &InstallOptions, only_skill: Option<&str>) -> i32 {
    let lf = Lockfile::load(Path::new(LOCAL_AGENTS_DIR));
    if lf.entries.is_empty() {
        crate::log::error(&format!("No lockfile entries to update ({})", lf.path.display()));
        return 1;
    }
    let snap: Vec<lockfile::LockEntry> = lf.entries.clone();
    drop(lf);

    let mut matched = 0i32;
    let mut advanced = 0i32;
    let mut unchanged = 0i32;
    let mut failed = 0i32;

    // npm pre-pass: group entries by package, reconcile each package once.
    {
        let mut npm_lf = Lockfile::load(Path::new(LOCAL_AGENTS_DIR));
        let mut seen: Vec<String> = Vec::new();

        for e in &snap {
            if let Some(o) = only_skill {
                if e.skill_name != o {
                    continue;
                }
            }
            if !source_is_npm(&e.source) {
                continue;
            }
            let pkg = match source_npm_split(&e.source) {
                Some((p, _)) => p,
                None => continue,
            };
            if seen.iter().any(|s| s == &pkg) {
                matched += 1;
                continue;
            }

            // Collect this pkg's previously recorded files.
            let mut prev: Vec<String> = Vec::new();
            for k in &snap {
                if !source_is_npm(&k.source) {
                    continue;
                }
                if let Some((kp, Some(kf))) = source_npm_split(&k.source) {
                    if kp == pkg {
                        prev.push(kf);
                    }
                }
            }
            update_npm_package(
                &mut npm_lf,
                &pkg,
                &prev,
                &mut advanced,
                &mut unchanged,
                &mut failed,
                base_opts,
            );
            seen.push(pkg);
            matched += 1;
        }

        if let Err(e) = npm_lf.save() {
            crate::log::error(&format!(
                "Warning: failed to write {}: {e}",
                npm_lf.path.display()
            ));
        }
    }

    for e in &snap {
        if let Some(o) = only_skill {
            if e.skill_name != o {
                continue;
            }
        }
        if source_is_npm(&e.source) {
            continue;
        }
        matched += 1;

        if source_is_local(&e.source) {
            crate::log::info(&format!(
                "{}: local link, no update needed",
                e.skill_name
            ));
            unchanged += 1;
            continue;
        }

        let ps = match download::parse(&e.source) {
            Some(p) => p,
            None => {
                crate::log::error(&format!("update: cannot parse source '{}'", e.source));
                failed += 1;
                continue;
            }
        };

        let resolved = if e.pinned {
            resolve::resolve_ref(&ps, &e.ref_)
        } else {
            resolve::resolve_latest_tag(&ps).or_else(|| resolve::resolve_ref(&ps, &e.ref_))
        };

        let r = match resolved {
            Some(r) => r,
            None => {
                crate::log::error(&format!(
                    "update: cannot resolve {} for skill '{}'",
                    e.source, e.skill_name
                ));
                failed += 1;
                continue;
            }
        };

        let ref_changed = r.ref_ != e.ref_;
        let sha_changed = r.sha != e.sha;

        // Re-tag detection: a pinned tag's SHA is supposed to be immutable.
        // If the resolved SHA differs from the lockfile's recorded SHA AND
        // the ref name didn't change, the publisher rewrote the tag —
        // a common supply-chain attack vector. Flag it in the audit; the
        // update proceeds (the user may have legitimately accepted a security
        // re-tag of their own).
        if base_opts.retag_detect && r.is_tag && sha_changed && !ref_changed && e.sha != "-" {
            audit::push_finding(crate::audit::AuditFinding {
                severity: "high".into(),
                kind: "tag_rewritten".into(),
                skill: e.skill_name.clone(),
                ref_name: e.ref_.clone(),
                old_sha: e.sha.clone(),
                new_sha: r.sha.clone(),
            });
        }

        if !ref_changed && !sha_changed {
            crate::log::info(&format!("{}: up to date ({})", e.skill_name, e.ref_));
            unchanged += 1;
            continue;
        }

        if ref_changed {
            crate::log::info(&format!("{}: {} -> {}", e.skill_name, e.ref_, r.ref_));
        } else {
            crate::log::info(&format!(
                "{}: {} SHA changed ({} upstream re-tagged?)",
                e.skill_name, e.ref_, e.source
            ));
        }

        let new_spec = build_spec_string(&e.source, &r.ref_);
        let mut opts = base_opts.clone();
        opts.spec = Some(new_spec);
        opts.yes = true;
        opts.list_only = false;
        opts.global = false;
        opts.override_pinned = true;
        opts.pinned = e.pinned;
        if e.kind == LockKind::Ref {
            opts.skill_name = None;
            opts.name_override = Some(e.skill_name.clone());
            opts.is_reference = true;
        } else {
            opts.skill_name = Some(e.skill_name.clone());
        }

        let rc = install_package(&opts);
        if rc == 0 {
            advanced += 1;
        } else {
            failed += 1;
        }
    }

    let lf_final = Lockfile::load(Path::new(LOCAL_AGENTS_DIR));
    let _ = agentsmd::rebuild_block(&lf_final);

    if let Some(o) = only_skill {
        if matched == 0 {
            crate::log::error(&format!("Skill '{o}' not found in lockfile"));
            return 1;
        }
    }
    crate::log::info(&format!(
        "Update complete: {advanced} updated, {unchanged} unchanged, {failed} failed"
    ));
    if failed == 0 {
        0
    } else {
        1
    }
}

// ---------------------------------------------------------------------------
// list_installed_skills
// ---------------------------------------------------------------------------

pub fn list_installed_skills() -> i32 {
    let lf = Lockfile::load(Path::new(LOCAL_AGENTS_DIR));
    if lf.entries.is_empty() {
        println!(
            "No skills installed in this project ({} not found or empty)",
            lf.path.display()
        );
        println!("Install with: rosie install <owner/repo>");
        return 0;
    }
    let use_color = is_stdout_tty();
    println!("Installed skills ({}):", lf.path.display());
    for e in &lf.entries {
        let kind_tag = if e.kind == LockKind::Ref { "[ref]  " } else { "[skill]" };
        let (name_open, name_close) = if use_color {
            ("\x1b[1;34m", "\x1b[0m")
        } else {
            ("", "")
        };
        if source_is_local(&e.source) {
            println!(
                "  {kind_tag}  {name_open}{}{name_close}  {}  (linked)",
                e.skill_name,
                source_local_path(&e.source).unwrap_or("")
            );
        } else {
            let pin_tag = if e.pinned { "(pinned)" } else { "" };
            println!(
                "  {kind_tag}  {name_open}{}{name_close}  {}@{}  {pin_tag}",
                e.skill_name, e.source, e.ref_
            );
        }
    }
    0
}

fn is_stdout_tty() -> bool {
    use std::io::IsTerminal;
    std::io::stdout().is_terminal()
}
