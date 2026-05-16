// rosie-skills — typed JS API.
//
// Each function maps to a CLI subcommand. Options correspond 1:1 with CLI
// flags. By default the library is silent; failures throw with a descriptive
// message. Pass `onLog` to observe progress.
//
// Example:
//   import * as rosie from 'rosie-skills';
//   await rosie.install('anthropics/skills');
//   const skills = await rosie.list();

import { callApi, loadModule } from "./wasm-loader.js";

export type { LogEvent, LogLevel, OnLog } from "./wasm-loader.js";
import type { OnLog } from "./wasm-loader.js";

export interface Skill {
  /** Local name of the skill in `.agents/skills/`. */
  name: string;
  /** Source the skill was installed from (`owner/repo`, `file://path`, or `npm:pkg#file`). */
  source: string;
  /** Git ref that pinned this entry, when applicable. */
  ref: string | null;
  /** Resolved commit SHA, when applicable. */
  sha: string | null;
  /** True if installed as a reference (under `.agents/references/`) rather than a skill. */
  isReference: boolean;
}

export interface Agent {
  /** Internal name (e.g. `"claude"`, `"cursor"`). */
  name: string;
  /** Human-readable name (e.g. `"Claude Code"`). */
  display: string;
  /** True if detected on this machine (e.g. `~/.claude/` exists). */
  detected: boolean;
  /** Install path used when detected; `null` otherwise. */
  installPath: string | null;
}

/**
 * Per-skill record of what happened during an install/update. Returned
 * inside `InstallResult.skills`. For reference installs (`kind: "reference"`),
 * `installedAgents` and `failedAgents` are always empty — references go to
 * `.agents/references/`, not to any agent's directory.
 */
export interface SkillResult {
  /** The skill or reference name as recorded in the lockfile. */
  name: string;
  /**
   * `"skill"` for entries copied into `.agents/skills/` and symlinked into
   * detected agents. `"reference"` for entries (`--ref`, `--ref --npm`)
   * written under `.agents/references/`.
   */
  kind: "skill" | "reference";
  /** Agent `name` values (e.g. `"claude"`) that received a working symlink. */
  installedAgents: string[];
  /**
   * Agents where the symlink couldn't be created — usually because the
   * agent's `skills/` directory has restrictive permissions, already
   * contains a non-symlink entry at that path, or the user is missing
   * write access. The skill still installs to `.agents/skills/` and to
   * the other agents; failures here are reported but non-fatal.
   */
  failedAgents: string[];
}

/**
 * Path of the project's agent-instructions file (`AGENTS.md`, `CLAUDE.md`,
 * `GEMINI.md`, or `.github/copilot-instructions.md`) that rosie wrote the
 * references block into during a call. `null` when nothing was written —
 * pure-skill installs and remove operations leave instruction files
 * untouched.
 */
export type InstalledInstruction =
  | "AGENTS.md"
  | "CLAUDE.md"
  | "GEMINI.md"
  | ".github/copilot-instructions.md"
  | null;

/**
 * Severity tier for an `AuditFinding`. `"high"` is rosie raising an explicit
 * supply-chain warning (e.g. a `tag_rewritten` event). Future versions may
 * introduce additional levels.
 */
export type AuditSeverity = "high";

/**
 * A finding rosie itself raised during the operation, independent of any
 * change record. The canonical example is `tag_rewritten`: a pinned tag's
 * resolved SHA changed between install and update, which usually indicates
 * the publisher rewrote the tag (a supply-chain attack vector).
 */
export interface AuditFinding {
  severity: AuditSeverity;
  /** Stable identifier of the finding type. Currently `"tag_rewritten"` only. */
  kind: "tag_rewritten" | string;
  /** Skill or reference the finding applies to. */
  skill: string;
  /** Ref name (tag or branch) at the time of the finding. */
  ref: string;
  oldSha: string;
  newSha: string;
}

/**
 * Description of a single skill or reference rosie installed or updated.
 * For first installs, `content` carries the full sanitized body. For
 * updates against existing on-disk content, `diff` carries a unified diff.
 */
export interface AuditChange {
  name: string;
  kind: "skill" | "reference";
  source: string;
  ref: string;
  sha: string;
  operation: "install" | "update";
  /** Full sanitized body. Populated for first-time installs only. */
  content: string | null;
  /** Unified diff against the prior on-disk content. Populated for updates only. */
  diff: string | null;
}

/**
 * Structured record of everything an `install` / `update` did, plus any
 * findings rosie raised. When running inside an AI-agent context the CLI
 * also writes a formatted version of this to stdout so the agent can
 * review it before continuing. See docs/security.
 */
export interface Audit {
  schemaVersion: 1;
  command: "install" | "update";
  findings: AuditFinding[];
  changes: AuditChange[];
}

/**
 * Returned by `install`, `installFromLockfile`, and `update`. `skills` is
 * per-skill detail; `installedAgents` / `failedAgents` are deduped unions
 * across every skill in the call.
 */
export interface InstallResult {
  /** One record per skill the operation touched. */
  skills: SkillResult[];
  /** Union of every agent that successfully received any skill. Deduped. */
  installedAgents: string[];
  /** Union of every agent that failed at least once. Deduped. */
  failedAgents: string[];
  /**
   * Which instruction file (if any) had its references block rewritten
   * during this call. See `InstalledInstruction`.
   */
  installedInstruction: InstalledInstruction;
  /**
   * Structured audit of every change rosie made + findings it raised. Always
   * present on results from `install` / `update`. See `Audit` for the shape.
   */
  audit: Audit;
}

export interface BaseOptions {
  /**
   * Run with this directory as the working directory — same as if you `cd`'d
   * there before invoking the CLI. All relative paths (`.agents/rosie.lock`,
   * `.agents/skills/`, etc.) resolve against it. Defaults to `process.cwd()`.
   *
   * Implementation note: this calls `process.chdir()` for the duration of
   * the call and restores afterwards. Be mindful of concurrent callers that
   * depend on `process.cwd()`.
   */
  cwd?: string;
  /** Receives progress + error logs as they happen. Silent by default. */
  onLog?: OnLog;
}

/**
 * Defenses applied to installed content. All default to `true`; pass `false`
 * to opt out. See docs/security for the threat model and exact rules.
 */
export interface SecurityOptions {
  /**
   * Strip HTML and link-form markdown comments from reference content
   * (outside fenced code blocks). Default `true`. Skills are not affected.
   * Mirrors CLI `--no-strip-comments`.
   */
  stripComments?: boolean;
  /**
   * Strip invisible Unicode (zero-width, bidi overrides, Unicode Tag block)
   * from both reference and skill content. Default `true`. Mirrors CLI
   * `--no-strip-invisible`.
   */
  stripInvisible?: boolean;
  /**
   * On `update`, flag pinned tags whose SHA changed since install as a
   * `tag_rewritten` finding in the audit. Default `true`. Mirrors CLI
   * `--no-retag-detect`.
   */
  retagDetect?: boolean;
  /**
   * Force emission of the wrapped audit text on stdout even when no agent
   * context is detected. The `audit` field on the result is unaffected.
   * Mutually exclusive with `suppressAudit`. Mirrors CLI `--audit`.
   */
  forceAudit?: boolean;
  /**
   * Suppress emission of the wrapped audit text on stdout even when an
   * agent context is detected. The `audit` field on the result is
   * unaffected. Mutually exclusive with `forceAudit`. Mirrors CLI
   * `--no-audit`.
   */
  suppressAudit?: boolean;
}

export interface InstallOptions extends BaseOptions, SecurityOptions {
  /** Install as a reference (under `.agents/references/`) instead of a skill. Mirrors `--ref`. */
  ref?: boolean;
  /** For `--ref`: install a specific SKILL.md as the reference. */
  skill?: string;
  /** Restrict to specific agent(s). Mirrors `-a`. */
  agent?: string | string[];
  /** For `--ref`: override the default install name. Mirrors `--name`. */
  name?: string;
  /** Source from `node_modules/<pkg>/` instead of GitHub. Mirrors `--npm`. */
  npm?: boolean;
  /** For `--npm`: file or directory paths to include (repeatable). Mirrors `--include`. */
  include?: string[];
  /** Install globally to `~/.<agent>/skills/` instead of `./.agents/skills/`. Mirrors `--global`. */
  global?: boolean;
  /**
   * When `false`, the install runs but `.agents/rosie.lock` is not read or
   * written. Defaults to `true`. Mirrors `--no-lockfile`.
   */
  lockfile?: boolean;
}

export interface RemoveOptions extends BaseOptions {
  /** Restrict to specific agent(s). Mirrors `-a`. */
  agent?: string | string[];
  /** Remove from global install. Mirrors `--global`. */
  global?: boolean;
  /** When `false`, don't update `.agents/rosie.lock`. Mirrors `--no-lockfile`. */
  lockfile?: boolean;
}

export interface UpdateOptions extends BaseOptions, SecurityOptions {
  /** When `false`, don't write changes back to `.agents/rosie.lock`. Mirrors `--no-lockfile`. */
  lockfile?: boolean;
}

// Wrap a call with process.chdir to the requested cwd, restoring on exit.
async function withCwd<T>(cwd: string | undefined, fn: () => Promise<T>): Promise<T> {
  if (!cwd) return fn();
  const orig = process.cwd();
  process.chdir(cwd);
  try {
    return await fn();
  } finally {
    process.chdir(orig);
  }
}

export async function list(opts: BaseOptions = {}): Promise<Skill[]> {
  return withCwd(opts.cwd, async () => {
    const mod = await loadModule(opts.onLog);
    return callApi<Skill[]>(mod, "rosie_api_list_installed");
  });
}

export async function agents(opts: BaseOptions = {}): Promise<Agent[]> {
  return withCwd(opts.cwd, async () => {
    const mod = await loadModule(opts.onLog);
    return callApi<Agent[]>(mod, "rosie_api_agents");
  });
}

/**
 * Install a skill or reference. With no `spec`, reinstalls everything in
 * `.agents/rosie.lock` (matches the CLI's `rosie install` with no args).
 */
export async function install(spec: string, opts: InstallOptions = {}): Promise<InstallResult> {
  if (opts.forceAudit && opts.suppressAudit) {
    throw new Error("rosie-skills: forceAudit and suppressAudit are mutually exclusive");
  }
  return withCwd(opts.cwd, async () => {
    const mod = await loadModule(opts.onLog);
    const agents = Array.isArray(opts.agent) ? opts.agent.join(",") : opts.agent ?? "";
    const includes = (opts.include ?? []).join("\n");
    const skipLockfile = opts.lockfile === false ? 1 : 0;
    return await callApi<InstallResult>(mod, "rosie_api_install", [
      spec,
      opts.skill ?? "",
      agents,
      opts.name ?? "",
      includes,
      opts.ref ? 1 : 0,
      opts.npm ? 1 : 0,
      opts.global ? 1 : 0,
      skipLockfile,
      tristate(opts.stripComments),
      tristate(opts.stripInvisible),
      tristate(opts.retagDetect),
      tristate(opts.forceAudit),
      tristate(opts.suppressAudit),
    ]);
  });
}

/** Map an optional boolean to the wasm tristate convention: undefined → -1
 *  (use rust default), true → 1, false → 0. */
function tristate(v: boolean | undefined): number {
  if (v === undefined) return -1;
  return v ? 1 : 0;
}

/** Reinstall everything from `.agents/rosie.lock`. */
export async function installFromLockfile(opts: InstallOptions = {}): Promise<InstallResult> {
  return install("", opts);
}

export async function remove(skillName: string, opts: RemoveOptions = {}): Promise<void> {
  return withCwd(opts.cwd, async () => {
    const mod = await loadModule(opts.onLog);
    const agents = Array.isArray(opts.agent) ? opts.agent.join(",") : opts.agent ?? "";
    const skipLockfile = opts.lockfile === false ? 1 : 0;
    await callApi<null>(mod, "rosie_api_remove", [
      skillName,
      agents,
      opts.global ? 1 : 0,
      skipLockfile,
    ]);
  });
}

/**
 * Update one skill (by name) or all entries if no name is given. Returns
 * the same `InstallResult` shape `install` returns — `skills` covers every
 * entry that was re-resolved (including those that ended up unchanged).
 */
export async function update(skillName?: string, opts: UpdateOptions = {}): Promise<InstallResult> {
  if (opts.forceAudit && opts.suppressAudit) {
    throw new Error("rosie-skills: forceAudit and suppressAudit are mutually exclusive");
  }
  return withCwd(opts.cwd, async () => {
    const mod = await loadModule(opts.onLog);
    const skipLockfile = opts.lockfile === false ? 1 : 0;
    return await callApi<InstallResult>(mod, "rosie_api_update", [
      skillName ?? "",
      skipLockfile,
      tristate(opts.stripComments),
      tristate(opts.stripInvisible),
      tristate(opts.retagDetect),
      tristate(opts.forceAudit),
      tristate(opts.suppressAudit),
    ]);
  });
}
