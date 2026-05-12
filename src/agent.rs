// Built-in agent definitions and detection.
//
// Mirrors agent.c. Agents are detected by looking for `~/.<config_dir>` in
// the user's HOME. Install paths depend on the --global flag: global writes
// to `~/.<config_dir>/skills`, local writes to `./.<config_dir>/skills`.

use std::path::PathBuf;

#[derive(Debug, Clone, Copy)]
pub struct AgentDef {
    pub name: &'static str,
    pub display: &'static str,
    pub config_dir: &'static str,
    pub skills_dir: &'static str,
    pub binary: Option<&'static str>,
}

pub const AGENT_DEFS: &[AgentDef] = &[
    AgentDef { name: "claude",   display: "Claude Code",     config_dir: ".claude",   skills_dir: "skills", binary: Some("claude") },
    AgentDef { name: "cursor",   display: "Cursor",          config_dir: ".cursor",   skills_dir: "skills", binary: Some("cursor") },
    AgentDef { name: "opencode", display: "OpenCode",        config_dir: ".opencode", skills_dir: "skills", binary: Some("opencode") },
    AgentDef { name: "cline",    display: "Cline",           config_dir: ".cline",    skills_dir: "skills", binary: None },
    AgentDef { name: "codex",    display: "Codex",           config_dir: ".codex",    skills_dir: "skills", binary: Some("codex") },
    AgentDef { name: "windsurf", display: "Windsurf",        config_dir: ".windsurf", skills_dir: "skills", binary: None },
    AgentDef { name: "continue", display: "Continue",        config_dir: ".continue", skills_dir: "skills", binary: None },
    AgentDef { name: "copilot",  display: "GitHub Copilot",  config_dir: ".github",   skills_dir: "skills", binary: None },
    AgentDef { name: "aider",    display: "Aider",           config_dir: ".aider",    skills_dir: "skills", binary: Some("aider") },
    AgentDef { name: "roo",      display: "Roo",             config_dir: ".roo",      skills_dir: "skills", binary: None },
    AgentDef { name: "amplify",  display: "Amplify",         config_dir: ".amplify",  skills_dir: "skills", binary: None },
    AgentDef { name: "zed",      display: "Zed",             config_dir: ".zed",      skills_dir: "skills", binary: Some("zed") },
];

#[derive(Debug, Clone)]
pub struct Agent {
    pub def: AgentDef,
    /// Where rosie will install/symlink skills for this agent. Relative
    /// ("./.claude/skills") for local installs, absolute ("~/.claude/skills"-
    /// expanded) for global installs.
    pub install_path: PathBuf,
    /// True if HOME has a `~/.<config_dir>/` directory or the user passed
    /// the agent explicitly via -a.
    pub detected: bool,
}

pub fn find_agent_def(name: &str) -> Option<&'static AgentDef> {
    AGENT_DEFS.iter().find(|d| d.name == name)
}

/// Where rosie will write/symlink skills for a given agent. The local form
/// rooted at "." is what gets written; callers cd into the project dir
/// first, so relative paths resolve correctly.
pub fn install_path(def: &AgentDef, global: bool) -> Option<PathBuf> {
    let base = if global {
        crate::os::home_dir()?
    } else {
        ".".to_string()
    };
    let mut p = PathBuf::from(base);
    p.push(def.config_dir);
    p.push(def.skills_dir);
    Some(p)
}

/// Detect all agents by checking HOME for their config directories. Returns
/// agents whose install_path uses the `global` flag for the target location.
pub fn detect_agents(global: bool) -> Vec<Agent> {
    let mut out = Vec::new();
    let home = match crate::os::home_dir() {
        Some(h) => h,
        None => {
            crate::log::error("Cannot determine home directory");
            return out;
        }
    };

    for def in AGENT_DEFS {
        let probe = PathBuf::from(&home).join(def.config_dir);
        if crate::os::is_dir(&probe) {
            if let Some(path) = install_path(def, global) {
                crate::log::debug(&format!(
                    "Detected agent: {} ({})",
                    def.display,
                    probe.display()
                ));
                out.push(Agent {
                    def: *def,
                    install_path: path,
                    detected: true,
                });
            }
        }
    }

    out
}

/// Build an AgentList from explicit names (mirrors `-a foo -a bar`).
pub fn agents_from_names(names: &[&str], global: bool) -> Vec<Agent> {
    let mut out = Vec::new();
    for &name in names {
        match find_agent_def(name) {
            Some(def) => {
                if let Some(path) = install_path(def, global) {
                    out.push(Agent {
                        def: *def,
                        install_path: path,
                        detected: true,
                    });
                }
            }
            None => crate::log::error(&format!("Unknown agent: {name}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_count() {
        assert_eq!(AGENT_DEFS.len(), 12);
    }

    #[test]
    fn lookup() {
        assert!(find_agent_def("claude").is_some());
        assert!(find_agent_def("notathing").is_none());
    }
}
