// Built-in agent definitions and detection. Ported from src/agent.rs.
//
// Each AgentDef carries two install paths: projectPath (relative, used when
// installing into a repo) and globalPath (joined under $HOME, for --global).
// detectDir is the per-user probe used by auto-detection; empty for
// target-only agents (e.g. "universal") that need an explicit -a.

import * as path from "node:path";
import * as os from "./os.js";
import * as log from "./log.js";

export interface AgentDef {
  name: string;
  display: string;
  aliases: string[];
  projectPath: string;
  globalPath: string;
  detectDir: string;
  binary: string | null;
}

export const AGENT_DEFS: AgentDef[] = [
  // --- Original 12 ---
  { name: "claude", display: "Claude Code", aliases: [], projectPath: ".claude/skills", globalPath: ".claude/skills", detectDir: ".claude", binary: "claude" },
  { name: "cursor", display: "Cursor", aliases: [], projectPath: ".cursor/skills", globalPath: ".cursor/skills", detectDir: ".cursor", binary: "cursor" },
  { name: "opencode", display: "OpenCode", aliases: [], projectPath: ".opencode/skills", globalPath: ".config/opencode/skills", detectDir: ".config/opencode", binary: "opencode" },
  { name: "cline", display: "Cline", aliases: [], projectPath: ".cline/skills", globalPath: ".cline/skills", detectDir: ".cline", binary: null },
  { name: "codex", display: "Codex", aliases: [], projectPath: ".codex/skills", globalPath: ".codex/skills", detectDir: ".codex", binary: "codex" },
  { name: "windsurf", display: "Windsurf", aliases: [], projectPath: ".windsurf/skills", globalPath: ".codeium/windsurf/skills", detectDir: ".windsurf", binary: null },
  { name: "continue", display: "Continue", aliases: [], projectPath: ".continue/skills", globalPath: ".continue/skills", detectDir: ".continue", binary: null },
  { name: "copilot", display: "GitHub Copilot", aliases: [], projectPath: ".agents/skills", globalPath: ".copilot/skills", detectDir: ".copilot", binary: null },
  { name: "aider", display: "AiderDesk", aliases: [], projectPath: ".aider-desk/skills", globalPath: ".aider-desk/skills", detectDir: ".aider-desk", binary: null },
  { name: "roo", display: "Roo", aliases: [], projectPath: ".roo/skills", globalPath: ".roo/skills", detectDir: ".roo", binary: null },
  { name: "augment", display: "Augment Code", aliases: ["amplify"], projectPath: ".augment/skills", globalPath: ".augment/skills", detectDir: ".augment", binary: null },
  { name: "zed", display: "Zed", aliases: [], projectPath: ".zed/skills", globalPath: ".zed/skills", detectDir: ".zed", binary: "zed" },

  // --- Tier 1 additions ---
  { name: "gemini-cli", display: "Gemini CLI", aliases: [], projectPath: ".agents/skills", globalPath: ".gemini/skills", detectDir: ".gemini", binary: "gemini" },
  { name: "goose", display: "Goose", aliases: [], projectPath: ".goose/skills", globalPath: ".config/goose/skills", detectDir: ".config/goose", binary: "goose" },
  { name: "kilo", display: "Kilo Code", aliases: [], projectPath: ".kilocode/skills", globalPath: ".kilocode/skills", detectDir: ".kilocode", binary: null },
  { name: "warp", display: "Warp", aliases: [], projectPath: ".agents/skills", globalPath: ".agents/skills", detectDir: ".warp", binary: "warp" },
  { name: "amp", display: "Amp", aliases: [], projectPath: ".agents/skills", globalPath: ".config/agents/skills", detectDir: ".config/agents", binary: "amp" },
  { name: "qwen-code", display: "Qwen Code", aliases: [], projectPath: ".qwen/skills", globalPath: ".qwen/skills", detectDir: ".qwen", binary: null },
  { name: "crush", display: "Crush", aliases: [], projectPath: ".crush/skills", globalPath: ".config/crush/skills", detectDir: ".config/crush", binary: "crush" },
  { name: "openhands", display: "OpenHands", aliases: [], projectPath: ".openhands/skills", globalPath: ".openhands/skills", detectDir: ".openhands", binary: null },
  { name: "kiro-cli", display: "Kiro CLI", aliases: [], projectPath: ".kiro/skills", globalPath: ".kiro/skills", detectDir: ".kiro", binary: null },
  { name: "tabnine-cli", display: "Tabnine CLI", aliases: [], projectPath: ".tabnine/agent/skills", globalPath: ".tabnine/agent/skills", detectDir: ".tabnine", binary: null },

  // --- Tier 2/3 additions ---
  { name: "aider-desk", display: "AiderDesk", aliases: [], projectPath: ".aider-desk/skills", globalPath: ".aider-desk/skills", detectDir: ".aider-desk", binary: null },
  { name: "antigravity", display: "Antigravity", aliases: [], projectPath: ".agents/skills", globalPath: ".gemini/antigravity/skills", detectDir: ".gemini/antigravity", binary: null },
  { name: "bob", display: "IBM Bob", aliases: [], projectPath: ".bob/skills", globalPath: ".bob/skills", detectDir: ".bob", binary: null },
  { name: "openclaw", display: "OpenClaw", aliases: [], projectPath: "skills", globalPath: ".openclaw/skills", detectDir: ".openclaw", binary: null },
  { name: "codearts-agent", display: "CodeArts Agent", aliases: [], projectPath: ".codeartsdoer/skills", globalPath: ".codeartsdoer/skills", detectDir: ".codeartsdoer", binary: null },
  { name: "codebuddy", display: "CodeBuddy", aliases: [], projectPath: ".codebuddy/skills", globalPath: ".codebuddy/skills", detectDir: ".codebuddy", binary: null },
  { name: "codemaker", display: "Codemaker", aliases: [], projectPath: ".codemaker/skills", globalPath: ".codemaker/skills", detectDir: ".codemaker", binary: null },
  { name: "codestudio", display: "Code Studio", aliases: [], projectPath: ".codestudio/skills", globalPath: ".codestudio/skills", detectDir: ".codestudio", binary: null },
  { name: "command-code", display: "Command Code", aliases: [], projectPath: ".commandcode/skills", globalPath: ".commandcode/skills", detectDir: ".commandcode", binary: null },
  { name: "cortex", display: "Cortex Code", aliases: [], projectPath: ".cortex/skills", globalPath: ".snowflake/cortex/skills", detectDir: ".cortex", binary: null },
  { name: "deepagents", display: "Deep Agents", aliases: [], projectPath: ".agents/skills", globalPath: ".deepagents/agent/skills", detectDir: ".deepagents", binary: null },
  { name: "devin", display: "Devin", aliases: [], projectPath: ".devin/skills", globalPath: ".config/devin/skills", detectDir: ".devin", binary: null },
  { name: "dexto", display: "Dexto", aliases: [], projectPath: ".agents/skills", globalPath: ".agents/skills", detectDir: ".dexto", binary: null },
  { name: "droid", display: "Droid (Factory)", aliases: [], projectPath: ".factory/skills", globalPath: ".factory/skills", detectDir: ".factory", binary: null },
  { name: "firebender", display: "Firebender", aliases: [], projectPath: ".agents/skills", globalPath: ".firebender/skills", detectDir: ".firebender", binary: null },
  { name: "forgecode", display: "ForgeCode", aliases: [], projectPath: ".forge/skills", globalPath: ".forge/skills", detectDir: ".forge", binary: null },
  { name: "hermes-agent", display: "Hermes Agent", aliases: [], projectPath: ".hermes/skills", globalPath: ".hermes/skills", detectDir: ".hermes", binary: null },
  { name: "iflow-cli", display: "iFlow CLI", aliases: [], projectPath: ".iflow/skills", globalPath: ".iflow/skills", detectDir: ".iflow", binary: null },
  { name: "junie", display: "Junie", aliases: [], projectPath: ".junie/skills", globalPath: ".junie/skills", detectDir: ".junie", binary: null },
  { name: "kimi-cli", display: "Kimi Code CLI", aliases: [], projectPath: ".agents/skills", globalPath: ".config/agents/skills", detectDir: ".kimi", binary: null },
  { name: "kode", display: "Kode", aliases: [], projectPath: ".kode/skills", globalPath: ".kode/skills", detectDir: ".kode", binary: null },
  { name: "mcpjam", display: "MCPJam", aliases: [], projectPath: ".mcpjam/skills", globalPath: ".mcpjam/skills", detectDir: ".mcpjam", binary: null },
  { name: "mistral-vibe", display: "Mistral Vibe", aliases: [], projectPath: ".vibe/skills", globalPath: ".vibe/skills", detectDir: ".vibe", binary: null },
  { name: "mux", display: "Mux", aliases: [], projectPath: ".mux/skills", globalPath: ".mux/skills", detectDir: ".mux", binary: null },
  { name: "neovate", display: "Neovate", aliases: [], projectPath: ".neovate/skills", globalPath: ".neovate/skills", detectDir: ".neovate", binary: null },
  { name: "pi", display: "Pi", aliases: [], projectPath: ".pi/skills", globalPath: ".pi/agent/skills", detectDir: ".pi", binary: null },
  { name: "pochi", display: "Pochi", aliases: [], projectPath: ".pochi/skills", globalPath: ".pochi/skills", detectDir: ".pochi", binary: null },
  { name: "qoder", display: "Qoder", aliases: [], projectPath: ".qoder/skills", globalPath: ".qoder/skills", detectDir: ".qoder", binary: null },
  { name: "replit", display: "Replit", aliases: [], projectPath: ".agents/skills", globalPath: ".config/agents/skills", detectDir: ".replit", binary: null },
  { name: "rovodev", display: "Rovo Dev", aliases: [], projectPath: ".rovodev/skills", globalPath: ".rovodev/skills", detectDir: ".rovodev", binary: null },
  { name: "trae", display: "Trae", aliases: [], projectPath: ".trae/skills", globalPath: ".trae/skills", detectDir: ".trae", binary: null },
  { name: "trae-cn", display: "Trae CN", aliases: [], projectPath: ".trae/skills", globalPath: ".trae-cn/skills", detectDir: ".trae-cn", binary: null },
  { name: "zencoder", display: "Zencoder", aliases: [], projectPath: ".zencoder/skills", globalPath: ".zencoder/skills", detectDir: ".zencoder", binary: null },
  { name: "adal", display: "AdaL", aliases: [], projectPath: ".adal/skills", globalPath: ".adal/skills", detectDir: ".adal", binary: null },
  { name: "universal", display: "Universal", aliases: [], projectPath: ".agents/skills", globalPath: ".config/agents/skills", detectDir: "", binary: null },
];

export interface Agent {
  def: AgentDef;
  // Where rosie will install/symlink skills for this agent. Relative (e.g.
  // ".claude/skills") for local installs, absolute (under $HOME) for global.
  installPath: string;
  // True if `$HOME/<detectDir>` exists or the user passed `-a <name>`.
  detected: boolean;
}

// Look up an agent by name or alias. Matching by alias emits a deprecation
// warning so users migrate to the canonical name.
export function findAgentDef(name: string): AgentDef | undefined {
  const direct = AGENT_DEFS.find((d) => d.name === name);
  if (direct) return direct;
  const aliased = AGENT_DEFS.find((d) => d.aliases.includes(name));
  if (aliased) {
    log.warn(`agent name '${name}' is deprecated; use '${aliased.name}'`);
    return aliased;
  }
  return undefined;
}

// Where rosie will write/symlink skills for a given agent.
export function installPath(def: AgentDef, global: boolean): string | null {
  if (global) {
    const home = os.homeDir();
    if (home === null) return null;
    return path.join(home, def.globalPath);
  }
  return def.projectPath;
}

// Detect all agents by checking `$HOME/<detectDir>`. Agents with an empty
// detectDir are skipped (target-only; use -a <name>).
export function detectAgents(global: boolean): Agent[] {
  const out: Agent[] = [];
  const home = os.homeDir();
  if (home === null) {
    log.error("Cannot determine home directory");
    return out;
  }
  for (const def of AGENT_DEFS) {
    if (def.detectDir.length === 0) continue;
    const probe = path.join(home, def.detectDir);
    if (os.isDir(probe)) {
      const ip = installPath(def, global);
      if (ip !== null) {
        log.debug(`Detected agent: ${def.display} (${probe})`);
        out.push({ def, installPath: ip, detected: true });
      }
    }
  }
  return out;
}

// Build an agent list from explicit names (mirrors `-a foo -a bar`).
export function agentsFromNames(names: string[], global: boolean): Agent[] {
  const out: Agent[] = [];
  for (const name of names) {
    const def = findAgentDef(name);
    if (def) {
      const ip = installPath(def, global);
      if (ip !== null) out.push({ def, installPath: ip, detected: true });
    } else {
      log.error(`Unknown agent: ${name}`);
    }
  }
  return out;
}
