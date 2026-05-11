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

export interface BaseOptions {
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
}

export interface RemoveOptions extends BaseOptions {
  /** Restrict to specific agent(s). Mirrors `-a`. */
  agent?: string | string[];
  /** Remove from global install. Mirrors `--global`. */
  global?: boolean;
}

export async function list(opts: BaseOptions = {}): Promise<Skill[]> {
  const mod = await loadModule(opts.onLog);
  return callApi<Skill[]>(mod, "rosie_api_list_installed");
}

export async function agents(opts: BaseOptions = {}): Promise<Agent[]> {
  const mod = await loadModule(opts.onLog);
  return callApi<Agent[]>(mod, "rosie_api_agents");
}

/**
 * Install a skill or reference. With no `spec`, reinstalls everything in
 * `.agents/rosie.lock` (matches the CLI's `rosie install` with no args).
 */
export async function install(spec: string, opts: InstallOptions = {}): Promise<void> {
  const mod = await loadModule(opts.onLog);
  const agents = Array.isArray(opts.agent) ? opts.agent.join(",") : opts.agent ?? "";
  const includes = (opts.include ?? []).join("\n");
  await callApi<null>(mod, "rosie_api_install", [
    spec,
    opts.skill ?? "",
    agents,
    opts.name ?? "",
    includes,
    opts.ref ? 1 : 0,
    opts.npm ? 1 : 0,
    opts.global ? 1 : 0,
  ]);
}

/** Reinstall everything from `.agents/rosie.lock`. */
export async function installFromLockfile(opts: InstallOptions = {}): Promise<void> {
  return install("", opts);
}

export async function remove(skillName: string, opts: RemoveOptions = {}): Promise<void> {
  const mod = await loadModule(opts.onLog);
  const agents = Array.isArray(opts.agent) ? opts.agent.join(",") : opts.agent ?? "";
  await callApi<null>(mod, "rosie_api_remove", [skillName, agents, opts.global ? 1 : 0]);
}

/** Update one skill (by name) or all entries if no name is given. */
export async function update(skillName?: string, opts: BaseOptions = {}): Promise<void> {
  const mod = await loadModule(opts.onLog);
  await callApi<null>(mod, "rosie_api_update", [skillName ?? ""]);
}
