// Built-in agent definitions and detection.
//
// Each AgentDef carries two install paths: `project_path` (relative, used when
// installing into a repo) and `global_path` (joined under $HOME, used for
// `--global`). `detect_dir` is the per-user probe used by auto-detection;
// it's empty for target-only agents (e.g. "universal") that the user must
// opt into with `-a`.
//
// `aliases` holds deprecated/alternate names. Looking up an agent by alias
// works but emits a warning so the user migrates to the canonical name.

use std::path::PathBuf;

#[derive(Debug, Clone, Copy)]
pub struct AgentDef {
    pub name: &'static str,
    pub display: &'static str,
    pub aliases: &'static [&'static str],
    pub project_path: &'static str,
    pub global_path: &'static str,
    pub detect_dir: &'static str,
    pub binary: Option<&'static str>,
}

#[rustfmt::skip]
pub const AGENT_DEFS: &[AgentDef] = &[
    // --- Original 12 (paths fixed for amplify->augment, aider->.aider-desk, copilot) ---
    AgentDef { name: "claude",     display: "Claude Code",     aliases: &[],           project_path: ".claude/skills",     global_path: ".claude/skills",          detect_dir: ".claude",          binary: Some("claude") },
    AgentDef { name: "cursor",     display: "Cursor",          aliases: &[],           project_path: ".cursor/skills",     global_path: ".cursor/skills",          detect_dir: ".cursor",          binary: Some("cursor") },
    AgentDef { name: "opencode",   display: "OpenCode",        aliases: &[],           project_path: ".opencode/skills",   global_path: ".config/opencode/skills", detect_dir: ".config/opencode", binary: Some("opencode") },
    AgentDef { name: "cline",      display: "Cline",           aliases: &[],           project_path: ".cline/skills",      global_path: ".cline/skills",           detect_dir: ".cline",           binary: None },
    AgentDef { name: "codex",      display: "Codex",           aliases: &[],           project_path: ".codex/skills",      global_path: ".codex/skills",           detect_dir: ".codex",           binary: Some("codex") },
    AgentDef { name: "windsurf",   display: "Windsurf",        aliases: &[],           project_path: ".windsurf/skills",   global_path: ".codeium/windsurf/skills", detect_dir: ".windsurf",       binary: None },
    AgentDef { name: "continue",   display: "Continue",        aliases: &[],           project_path: ".continue/skills",   global_path: ".continue/skills",        detect_dir: ".continue",        binary: None },
    AgentDef { name: "copilot",    display: "GitHub Copilot",  aliases: &[],           project_path: ".agents/skills",     global_path: ".copilot/skills",         detect_dir: ".copilot",         binary: None },
    AgentDef { name: "aider",      display: "AiderDesk",       aliases: &[],           project_path: ".aider-desk/skills", global_path: ".aider-desk/skills",      detect_dir: ".aider-desk",      binary: None },
    AgentDef { name: "roo",        display: "Roo",             aliases: &[],           project_path: ".roo/skills",        global_path: ".roo/skills",             detect_dir: ".roo",             binary: None },
    AgentDef { name: "augment",    display: "Augment Code",    aliases: &["amplify"],  project_path: ".augment/skills",    global_path: ".augment/skills",         detect_dir: ".augment",         binary: None },
    AgentDef { name: "zed",        display: "Zed",             aliases: &[],           project_path: ".zed/skills",        global_path: ".zed/skills",             detect_dir: ".zed",             binary: Some("zed") },

    // --- Tier 1 additions (verified against the agent's own docs) ---
    AgentDef { name: "gemini-cli", display: "Gemini CLI",      aliases: &[],           project_path: ".agents/skills",     global_path: ".gemini/skills",          detect_dir: ".gemini",          binary: Some("gemini") },
    AgentDef { name: "goose",      display: "Goose",           aliases: &[],           project_path: ".goose/skills",      global_path: ".config/goose/skills",    detect_dir: ".config/goose",    binary: Some("goose") },
    AgentDef { name: "kilo",       display: "Kilo Code",       aliases: &[],           project_path: ".kilocode/skills",   global_path: ".kilocode/skills",        detect_dir: ".kilocode",        binary: None },
    AgentDef { name: "warp",       display: "Warp",            aliases: &[],           project_path: ".agents/skills",     global_path: ".agents/skills",          detect_dir: ".warp",            binary: Some("warp") },
    AgentDef { name: "amp",        display: "Amp",             aliases: &[],           project_path: ".agents/skills",     global_path: ".config/agents/skills",   detect_dir: ".config/agents",   binary: Some("amp") },
    AgentDef { name: "qwen-code",  display: "Qwen Code",       aliases: &[],           project_path: ".qwen/skills",       global_path: ".qwen/skills",            detect_dir: ".qwen",            binary: None },
    AgentDef { name: "crush",      display: "Crush",           aliases: &[],           project_path: ".crush/skills",      global_path: ".config/crush/skills",    detect_dir: ".config/crush",    binary: Some("crush") },
    AgentDef { name: "openhands",  display: "OpenHands",       aliases: &[],           project_path: ".openhands/skills",  global_path: ".openhands/skills",       detect_dir: ".openhands",       binary: None },
    AgentDef { name: "kiro-cli",   display: "Kiro CLI",        aliases: &[],           project_path: ".kiro/skills",       global_path: ".kiro/skills",            detect_dir: ".kiro",            binary: None },
    AgentDef { name: "tabnine-cli", display: "Tabnine CLI",    aliases: &[],           project_path: ".tabnine/agent/skills", global_path: ".tabnine/agent/skills", detect_dir: ".tabnine",       binary: None },

    // --- Tier 2/3 additions (paths from skills npm README; not all independently verified) ---
    AgentDef { name: "aider-desk",     display: "AiderDesk",       aliases: &[],   project_path: ".aider-desk/skills",     global_path: ".aider-desk/skills",            detect_dir: ".aider-desk",         binary: None },
    AgentDef { name: "antigravity",    display: "Antigravity",     aliases: &[],   project_path: ".agents/skills",         global_path: ".gemini/antigravity/skills",    detect_dir: ".gemini/antigravity", binary: None },
    AgentDef { name: "bob",            display: "IBM Bob",         aliases: &[],   project_path: ".bob/skills",            global_path: ".bob/skills",                   detect_dir: ".bob",                binary: None },
    AgentDef { name: "openclaw",       display: "OpenClaw",        aliases: &[],   project_path: "skills",                 global_path: ".openclaw/skills",              detect_dir: ".openclaw",           binary: None },
    AgentDef { name: "codearts-agent", display: "CodeArts Agent",  aliases: &[],   project_path: ".codeartsdoer/skills",   global_path: ".codeartsdoer/skills",          detect_dir: ".codeartsdoer",       binary: None },
    AgentDef { name: "codebuddy",      display: "CodeBuddy",       aliases: &[],   project_path: ".codebuddy/skills",      global_path: ".codebuddy/skills",             detect_dir: ".codebuddy",          binary: None },
    AgentDef { name: "codemaker",      display: "Codemaker",       aliases: &[],   project_path: ".codemaker/skills",      global_path: ".codemaker/skills",             detect_dir: ".codemaker",          binary: None },
    AgentDef { name: "codestudio",     display: "Code Studio",     aliases: &[],   project_path: ".codestudio/skills",     global_path: ".codestudio/skills",            detect_dir: ".codestudio",         binary: None },
    AgentDef { name: "command-code",   display: "Command Code",    aliases: &[],   project_path: ".commandcode/skills",    global_path: ".commandcode/skills",           detect_dir: ".commandcode",        binary: None },
    AgentDef { name: "cortex",         display: "Cortex Code",     aliases: &[],   project_path: ".cortex/skills",         global_path: ".snowflake/cortex/skills",      detect_dir: ".cortex",             binary: None },
    AgentDef { name: "deepagents",     display: "Deep Agents",     aliases: &[],   project_path: ".agents/skills",         global_path: ".deepagents/agent/skills",      detect_dir: ".deepagents",         binary: None },
    AgentDef { name: "devin",          display: "Devin",           aliases: &[],   project_path: ".devin/skills",          global_path: ".config/devin/skills",          detect_dir: ".devin",              binary: None },
    AgentDef { name: "dexto",          display: "Dexto",           aliases: &[],   project_path: ".agents/skills",         global_path: ".agents/skills",                detect_dir: ".dexto",              binary: None },
    AgentDef { name: "droid",          display: "Droid (Factory)", aliases: &[],   project_path: ".factory/skills",        global_path: ".factory/skills",               detect_dir: ".factory",            binary: None },
    AgentDef { name: "firebender",     display: "Firebender",      aliases: &[],   project_path: ".agents/skills",         global_path: ".firebender/skills",            detect_dir: ".firebender",         binary: None },
    AgentDef { name: "forgecode",      display: "ForgeCode",       aliases: &[],   project_path: ".forge/skills",          global_path: ".forge/skills",                 detect_dir: ".forge",              binary: None },
    AgentDef { name: "hermes-agent",   display: "Hermes Agent",    aliases: &[],   project_path: ".hermes/skills",         global_path: ".hermes/skills",                detect_dir: ".hermes",             binary: None },
    AgentDef { name: "iflow-cli",      display: "iFlow CLI",       aliases: &[],   project_path: ".iflow/skills",          global_path: ".iflow/skills",                 detect_dir: ".iflow",              binary: None },
    AgentDef { name: "junie",          display: "Junie",           aliases: &[],   project_path: ".junie/skills",          global_path: ".junie/skills",                 detect_dir: ".junie",              binary: None },
    AgentDef { name: "kimi-cli",       display: "Kimi Code CLI",   aliases: &[],   project_path: ".agents/skills",         global_path: ".config/agents/skills",         detect_dir: ".kimi",               binary: None },
    AgentDef { name: "kode",           display: "Kode",            aliases: &[],   project_path: ".kode/skills",           global_path: ".kode/skills",                  detect_dir: ".kode",               binary: None },
    AgentDef { name: "mcpjam",         display: "MCPJam",          aliases: &[],   project_path: ".mcpjam/skills",         global_path: ".mcpjam/skills",                detect_dir: ".mcpjam",             binary: None },
    AgentDef { name: "mistral-vibe",   display: "Mistral Vibe",    aliases: &[],   project_path: ".vibe/skills",           global_path: ".vibe/skills",                  detect_dir: ".vibe",               binary: None },
    AgentDef { name: "mux",            display: "Mux",             aliases: &[],   project_path: ".mux/skills",            global_path: ".mux/skills",                   detect_dir: ".mux",                binary: None },
    AgentDef { name: "neovate",        display: "Neovate",         aliases: &[],   project_path: ".neovate/skills",        global_path: ".neovate/skills",               detect_dir: ".neovate",            binary: None },
    AgentDef { name: "pi",             display: "Pi",              aliases: &[],   project_path: ".pi/skills",             global_path: ".pi/agent/skills",              detect_dir: ".pi",                 binary: None },
    AgentDef { name: "pochi",          display: "Pochi",           aliases: &[],   project_path: ".pochi/skills",          global_path: ".pochi/skills",                 detect_dir: ".pochi",              binary: None },
    AgentDef { name: "qoder",          display: "Qoder",           aliases: &[],   project_path: ".qoder/skills",          global_path: ".qoder/skills",                 detect_dir: ".qoder",              binary: None },
    AgentDef { name: "replit",         display: "Replit",          aliases: &[],   project_path: ".agents/skills",         global_path: ".config/agents/skills",         detect_dir: ".replit",             binary: None },
    AgentDef { name: "rovodev",        display: "Rovo Dev",        aliases: &[],   project_path: ".rovodev/skills",        global_path: ".rovodev/skills",               detect_dir: ".rovodev",            binary: None },
    AgentDef { name: "trae",           display: "Trae",            aliases: &[],   project_path: ".trae/skills",           global_path: ".trae/skills",                  detect_dir: ".trae",               binary: None },
    AgentDef { name: "trae-cn",        display: "Trae CN",         aliases: &[],   project_path: ".trae/skills",           global_path: ".trae-cn/skills",               detect_dir: ".trae-cn",            binary: None },
    AgentDef { name: "zencoder",       display: "Zencoder",        aliases: &[],   project_path: ".zencoder/skills",       global_path: ".zencoder/skills",              detect_dir: ".zencoder",           binary: None },
    AgentDef { name: "adal",           display: "AdaL",            aliases: &[],   project_path: ".adal/skills",           global_path: ".adal/skills",                  detect_dir: ".adal",               binary: None },
    AgentDef { name: "universal",      display: "Universal",       aliases: &[],   project_path: ".agents/skills",         global_path: ".config/agents/skills",         detect_dir: "",                    binary: None },
];

#[derive(Debug, Clone)]
pub struct Agent {
    pub def: AgentDef,
    /// Where rosie will install/symlink skills for this agent. Relative
    /// (e.g. ".claude/skills") for local installs, absolute (joined under
    /// $HOME) for global installs.
    pub install_path: PathBuf,
    /// True if `$HOME/<detect_dir>` exists or the user passed `-a <name>`.
    pub detected: bool,
}

/// Look up an agent by name or alias. When matching by alias, emit a
/// deprecation warning so users migrate to the canonical name.
pub fn find_agent_def(name: &str) -> Option<&'static AgentDef> {
    if let Some(d) = AGENT_DEFS.iter().find(|d| d.name == name) {
        return Some(d);
    }
    if let Some(d) = AGENT_DEFS.iter().find(|d| d.aliases.contains(&name)) {
        crate::log::warn(&format!(
            "agent name '{}' is deprecated; use '{}'",
            name, d.name
        ));
        return Some(d);
    }
    None
}

/// Where rosie will write/symlink skills for a given agent.
pub fn install_path(def: &AgentDef, global: bool) -> Option<PathBuf> {
    if global {
        let home = crate::os::home_dir()?;
        Some(PathBuf::from(home).join(def.global_path))
    } else {
        Some(PathBuf::from(def.project_path))
    }
}

/// Detect all agents by checking `$HOME/<detect_dir>`. Agents with an empty
/// `detect_dir` are skipped — those are target-only (use `-a <name>`).
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
        if def.detect_dir.is_empty() {
            continue;
        }
        let probe = PathBuf::from(&home).join(def.detect_dir);
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
        assert_eq!(AGENT_DEFS.len(), 57);
    }

    #[test]
    fn lookup() {
        assert!(find_agent_def("claude").is_some());
        assert!(find_agent_def("notathing").is_none());
    }

    #[test]
    fn alias_resolves() {
        let d = find_agent_def("amplify").expect("amplify alias should resolve");
        assert_eq!(d.name, "augment");
    }

    #[test]
    fn unique_names() {
        let mut names: Vec<&str> = AGENT_DEFS.iter().map(|d| d.name).collect();
        names.sort();
        let len = names.len();
        names.dedup();
        assert_eq!(names.len(), len, "duplicate agent names in AGENT_DEFS");
    }
}
