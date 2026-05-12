// In-flight install/update reports.
//
// install_package and friends append a record per skill as they run; the
// wasm API wrapper (rosie_api_install / rosie_api_update) drains and
// serializes the buffer at the end of each call. The CLI flow just lets
// it accumulate and discards (the static is single-process anyway).
//
// Why a side-channel instead of a return value: install_package's public
// signature is `i32` (mirrors the C ABI on the wasm boundary). Adding a
// structured return value here would either change the boundary or force
// install_from_lockfile / update_skills to thread a `&mut Vec<...>` everywhere.
// The side-channel keeps the install code unchanged in shape.

use std::sync::Mutex;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReportKind {
    Skill,
    Reference,
}

impl ReportKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ReportKind::Skill => "skill",
            ReportKind::Reference => "reference",
        }
    }
}

#[derive(Debug, Clone)]
pub struct InstallReport {
    pub skill_name: String,
    pub kind: ReportKind,
    /// Agent `name` field values (e.g. "claude", "cursor") that received
    /// a working copy of the skill. Always empty for references — those
    /// land in `.agents/references/`, not in agent-specific dirs.
    pub installed_agents: Vec<String>,
    /// Agent `name` field values where install_skill_local / _to_agent
    /// returned a non-zero status. Always empty for references.
    pub failed_agents: Vec<String>,
}

static REPORTS: Mutex<Vec<InstallReport>> = Mutex::new(Vec::new());
static INSTRUCTION_FILE: Mutex<Option<String>> = Mutex::new(None);

pub fn push(report: InstallReport) {
    REPORTS.lock().unwrap().push(report);
}

pub fn drain() -> Vec<InstallReport> {
    std::mem::take(&mut *REPORTS.lock().unwrap())
}

/// Record that agentsmd::rebuild_block actually wrote (created or
/// modified) the project's agent-instructions file. Called from the
/// agentsmd module. `None` means no instruction file was touched.
pub fn set_instruction_file(path: Option<String>) {
    *INSTRUCTION_FILE.lock().unwrap() = path;
}

pub fn take_instruction_file() -> Option<String> {
    std::mem::take(&mut *INSTRUCTION_FILE.lock().unwrap())
}

pub fn clear() {
    REPORTS.lock().unwrap().clear();
    *INSTRUCTION_FILE.lock().unwrap() = None;
}
