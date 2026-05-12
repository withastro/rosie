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
 * inside `InstallResult.skills`. For reference installs (`--ref`) and npm
 * references the skill goes to `.agents/references/`, not to any agent's
 * directory, so both arrays will be empty.
 */
export interface SkillResult {
  /** The skill or reference name as recorded in the lockfile. */
  name: string;
  /** Agent `name` field values (e.g. `"claude"`) that received a working symlink. */
  installedAgents: string[];
  /**
   * Agents where the symlink couldn't be created — usually because the
   * agent's `skills/` directory has restrictive permissions, already
   * contains a non-symlink entry at that path, or the user is missing
   * write access. The skill still installs to `.agents/skills/` and to the
   * other agents; failures here are reported but non-fatal.
   */
  failedAgents: string[];
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

export interface InstallOptions extends BaseOptions {
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

export interface UpdateOptions extends BaseOptions {
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
    ]);
  });
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
  return withCwd(opts.cwd, async () => {
    const mod = await loadModule(opts.onLog);
    const skipLockfile = opts.lockfile === false ? 1 : 0;
    return await callApi<InstallResult>(mod, "rosie_api_update", [
      skillName ?? "",
      skipLockfile,
    ]);
  });
}
