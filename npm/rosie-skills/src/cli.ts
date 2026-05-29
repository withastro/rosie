// CLI entry point. Ported from src/cli.rs (and main.c's dispatch).
//
// Exit codes match the Rust binary: 0 on success, 1 for usage errors, 255
// (negative cast to u8) for install/remove internal failures. bin.ts maps a
// negative return to 255.

import * as fs from "node:fs";
import { parseArgs } from "node:util";
import * as agent from "./agent.js";
import * as audit from "./audit.js";
import * as install from "./install.js";
import { InstallOptions, RemoveOptions } from "./install.js";
import * as log from "./log.js";
import * as os from "./os.js";

export const ROSIE_VERSION = readVersion();

function readVersion(): string {
  try {
    const url = new URL("../package.json", import.meta.url);
    const pkg = JSON.parse(fs.readFileSync(url, "utf8")) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function printUsage(prog: string): void {
  const p = (s: string) => process.stdout.write(s + "\n");
  p(`rosie - A robot helper for agent skills v${ROSIE_VERSION}\n`);
  p(`Usage: ${prog} <command> [options] [arguments]\n`);
  p("Commands:");
  p("  install [<owner/repo>|<./path>] [skill]");
  p("                                Install skills from a GitHub repository, or symlink a");
  p("                                local directory (./path, /path, ~/path) into .agents/skills/.");
  p("                                With --ref, installs the repo's README.md (or a specific");
  p("                                SKILL.md via --skill) as a reference under .agents/references/");
  p("                                and indexes it in AGENTS.md (or CLAUDE.md / GEMINI.md /");
  p("                                .github/copilot-instructions.md, whichever the project uses).");
  p("                                With no args, reinstalls from .agents/rosie.lock");
  p("  update [skill-name]           Re-resolve lockfile entries; reinstall those that changed");
  p("  remove <skill-name>           Remove an installed skill or reference");
  p("  list [owner/repo]             List skills in a repo (or installed skills if no arg)");
  p("  agents                  List detected agents");
  p("  help                    Show this help message");
  p("");
  p("Options:");
  p("  -a, --agent <name>      Target specific agent (can be repeated)");
  p("  -g, --global            Install to home directory (~/.<agent>/skills/).");
  p("                          Also accepted for local-path installs to symlink");
  p("                          the source straight into each agent's home dir.");
  p("  -l, --local             Install to current directory (default, uses symlinks)");
  p("  -r, --ref               Install as a reference (README or SKILL.md) instead of a skill");
  p("  -s, --skill <name>      For --ref: install a specific SKILL.md as the reference");
  p("  -n, --name <name>       For --ref: override the default install name (owner-repo[-skill])");
  p("  -N, --npm               For --ref: source from node_modules/<pkg>/ (.md files)");
  p("  -I, --include <path>    For --npm: file or directory to include (repeatable; replaces default scope)");
  p("  -y, --yes               Skip confirmation prompt");
  p("  -v, --verbose           Enable verbose output");
  p("  -h, --help              Show this help message");
  p("  -V, --version           Print version and exit");
  p("");
  p("Security options (defaults all on; see docs/security):");
  p("  --no-strip-comments     Disable markdown-comment stripping on reference installs");
  p("  --no-strip-invisible    Disable invisible-Unicode stripping on refs and skills");
  p("  --no-strip              Shorthand: disable both comment + invisible stripping");
  p("  --no-retag-detect       Skip the tag-rewrite check on `rosie update`");
  p("  --audit                 Force-emit the audit log on stdout (default: auto-detect agent context)");
  p("  --no-audit              Suppress audit log on stdout (the JS API still returns it)");
  p("");
  p("Examples:");
  p(`  ${prog} install vercel-labs/agent-skills`);
  p(`  ${prog} install anthropics/skills pdf`);
  p(`  ${prog} install owner/repo -a claude -a cursor`);
  p(`  ${prog} install owner/repo@v1.0.0`);
  p(`  ${prog} install ./skills/my-custom-skill   # symlink a local skill`);
  p(`  ${prog} install ~/skills/my-skill -g       # symlink a local skill globally`);
  p(`  ${prog} install vercel/next.js --ref       # install README as a reference`);
  p(`  ${prog} install anthropics/skills --ref --skill pdf   # install a SKILL.md as a reference`);
  p(`  ${prog} install react --ref --npm                # symlink react's README + docs/ from node_modules`);
  p(`  ${prog} install @tanstack/react-query --ref --npm    # scoped npm package`);
  p(`  ${prog} install zod --ref --npm --include README.md  # only README`);
  p(`  ${prog} install                    # reinstall from .agents/rosie.lock`);
  p(`  ${prog} install -g                 # reinstall from ~/.agents/rosie.lock`);
  p(`  ${prog} update                     # update all lockfile entries`);
  p(`  ${prog} update slack-gif-creator   # update one skill`);
  p(`  ${prog} list                       # show installed skills`);
  p(`  ${prog} list vercel-labs/agent-skills`);
  p(`  ${prog} remove vercel-react-best-practices`);
  p(`  ${prog} agents`);
}

function printAgents(): void {
  const p = (s: string) => process.stdout.write(s + "\n");
  p("Detected agents:");
  const detected = agent.detectAgents(true);
  if (detected.length === 0) {
    p("  (no agents detected)");
  } else {
    for (const a of detected) {
      p(`  ${a.def.display} (${a.installPath})`);
    }
  }
  p("");
  p("Supported agents:");
  for (const d of agent.AGENT_DEFS) {
    p(`  ${d.name.padEnd(12)} ${d.display}`);
  }
}

// ---- minimal lexopt-like parser -------------------------------------------

// parseArgs token shape (only the fields we read).
interface OptionToken {
  kind: string;
  name?: string;
}

// Resolve the project/global scope from `-g`/`-l` in the order given, since
// `--local` overrides a prior `--global` and vice versa. parseArgs's `values`
// loses ordering, so we walk the tokens.
function resolveGlobalLocal(tokens: OptionToken[], def: boolean): boolean {
  let g = def;
  for (const t of tokens) {
    if (t.kind !== "option") continue;
    if (t.name === "global") g = true;
    else if (t.name === "local") g = false;
  }
  return g;
}

// Apply --cwd as a global pre-pass; returns remaining args (or null on error).
function applyCwd(raw: string[]): string[] | null {
  const out: string[] = [];
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "--cwd") {
      const val = raw[i + 1];
      if (val === undefined) {
        log.error("--cwd requires a path argument");
        return null;
      }
      i++;
      try {
        os.setCurrentDir(val);
      } catch (e) {
        log.error(`Failed to chdir: ${e instanceof Error ? e.message : String(e)}`);
        return null;
      }
    } else {
      out.push(raw[i]);
    }
  }
  return out;
}

export async function main(): Promise<number> {
  return run(process.argv.slice(1));
}

// Run with explicit argv (args[0] = program name).
export async function run(args: string[]): Promise<number> {
  const raw = applyCwd(args);
  if (raw === null) return 1;

  if (raw.length < 2) {
    printUsage("rosie");
    return 1;
  }

  const prog = raw[0];
  const command = raw[1];
  const cmdArgs = raw.slice(2);

  switch (command) {
    case "install":
      return cmdInstall(prog, cmdArgs, false);
    case "update":
      return cmdUpdate(cmdArgs);
    case "remove":
      return cmdRemove(prog, cmdArgs);
    case "list":
      return cmdInstall(prog, cmdArgs, true);
    case "agents":
      printAgents();
      return 0;
    case "help":
    case "--help":
    case "-h":
      printUsage(prog);
      return 0;
    case "--version":
    case "-V":
      process.stdout.write(`${ROSIE_VERSION}\n`);
      return 0;
    default:
      log.error(`Unknown command: ${command}`);
      process.stdout.write("Run 'rosie help' for usage.\n");
      return 1;
  }
}

// Drain the audit accumulator and print to stdout if appropriate. Mirrors
// cli.rs::emit_audit_if_appropriate.
function emitAuditIfAppropriate(opts: InstallOptions): void {
  const a = audit.drain();
  if (audit.isEmpty(a)) return;
  if (opts.suppressAudit) return;
  const inContext = os.isAgentContext();
  if (!inContext && !opts.forceAudit) return;
  process.stdout.write(audit.formatForStdout(a) + "\n");
}

async function cmdInstall(prog: string, args: string[], listOnly: boolean): Promise<number> {
  audit.clear();
  audit.setCommand("install");
  const opts = install.defaultInstallOptions();
  opts.listOnly = listOnly;

  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      tokens: true,
      options: {
        agent: { type: "string", short: "a", multiple: true },
        global: { type: "boolean", short: "g" },
        local: { type: "boolean", short: "l" },
        ref: { type: "boolean", short: "r" },
        skill: { type: "string", short: "s" },
        name: { type: "string", short: "n" },
        npm: { type: "boolean", short: "N" },
        include: { type: "string", short: "I", multiple: true },
        yes: { type: "boolean", short: "y" },
        verbose: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
        "no-lockfile": { type: "boolean" },
        "no-strip-comments": { type: "boolean" },
        "no-strip-invisible": { type: "boolean" },
        "no-strip": { type: "boolean" },
        "no-retag-detect": { type: "boolean" },
        audit: { type: "boolean" },
        "no-audit": { type: "boolean" },
      },
    });
  } catch (e) {
    log.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
  const { values, positionals: positional, tokens } = parsed;

  if (values.help) {
    printUsage(prog);
    return 0;
  }
  if (values.verbose) log.setVerbose(true);

  opts.agentNames = values.agent ?? [];
  opts.global = resolveGlobalLocal(tokens, false);
  opts.isReference = values.ref ?? false;
  opts.skillName = values.skill ?? null;
  opts.nameOverride = values.name ?? null;
  opts.isNpm = values.npm ?? false;
  opts.includePaths = values.include ?? [];
  opts.yes = values.yes ?? false;
  opts.skipLockfile = values["no-lockfile"] ?? false;
  const noStrip = values["no-strip"] ?? false;
  opts.stripComments = !((values["no-strip-comments"] ?? false) || noStrip);
  opts.stripInvisible = !((values["no-strip-invisible"] ?? false) || noStrip);
  opts.retagDetect = !(values["no-retag-detect"] ?? false);
  opts.forceAudit = values.audit ?? false;
  opts.suppressAudit = values["no-audit"] ?? false;

  if (opts.forceAudit && opts.suppressAudit) {
    log.error("--audit and --no-audit are mutually exclusive");
    return 1;
  }
  if (opts.isReference && opts.global) {
    log.error("--ref is project-scoped; --global is not supported");
    return 1;
  }
  if (opts.nameOverride !== null && !opts.isReference) {
    log.error("--name is only valid with --ref");
    return 1;
  }
  if (opts.isNpm) {
    if (!opts.isReference) {
      log.error("--npm requires --ref");
      return 1;
    }
    if (opts.nameOverride !== null) {
      log.error("--name is not supported with --npm; names are derived per file");
      return 1;
    }
    if (opts.skillName !== null) {
      log.error("--skill does not apply to --npm packages");
      return 1;
    }
  }
  if (opts.includePaths.length > 0 && !opts.isNpm) {
    log.error("--include only applies to --npm");
    return 1;
  }

  if (positional.length === 0) {
    if (listOnly) {
      return install.listInstalledSkills(opts.global);
    }
    const rc = await install.installFromLockfile(opts);
    emitAuditIfAppropriate(opts);
    return rc;
  }

  opts.spec = positional[0];
  if (opts.skillName === null && positional.length > 1) {
    opts.skillName = positional[1];
  }

  if (opts.isNpm) {
    const spec = positional[0];
    const scan = spec.startsWith("@") ? spec.slice(1) : spec;
    if (scan.includes("@")) {
      const head = spec.split("@")[0];
      log.error(`--npm does not accept @version; the version is read from node_modules/${head}/package.json`);
      return 1;
    }
  }

  const rc = await install.installPackage(opts);
  emitAuditIfAppropriate(opts);
  return rc;
}

async function cmdUpdate(args: string[]): Promise<number> {
  audit.clear();
  audit.setCommand("update");
  const opts = install.defaultInstallOptions();

  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      tokens: true,
      options: {
        agent: { type: "string", short: "a", multiple: true },
        yes: { type: "boolean", short: "y" },
        verbose: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
        "no-lockfile": { type: "boolean" },
        "no-strip-comments": { type: "boolean" },
        "no-strip-invisible": { type: "boolean" },
        "no-strip": { type: "boolean" },
        "no-retag-detect": { type: "boolean" },
        audit: { type: "boolean" },
        "no-audit": { type: "boolean" },
      },
    });
  } catch (e) {
    log.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
  const { values, positionals: positional } = parsed;

  if (values.help) {
    process.stdout.write("Usage: rosie update [skill-name]\n");
    process.stdout.write("  Re-resolve and reinstall lockfile entries that have changed upstream.\n");
    return 0;
  }
  if (values.verbose) log.setVerbose(true);

  opts.agentNames = values.agent ?? [];
  opts.yes = values.yes ?? false;
  opts.skipLockfile = values["no-lockfile"] ?? false;
  const noStrip = values["no-strip"] ?? false;
  opts.stripComments = !((values["no-strip-comments"] ?? false) || noStrip);
  opts.stripInvisible = !((values["no-strip-invisible"] ?? false) || noStrip);
  opts.retagDetect = !(values["no-retag-detect"] ?? false);
  opts.forceAudit = values.audit ?? false;
  opts.suppressAudit = values["no-audit"] ?? false;

  if (opts.forceAudit && opts.suppressAudit) {
    log.error("--audit and --no-audit are mutually exclusive");
    return 1;
  }
  const only = positional.length > 0 ? positional[0] : null;
  const rc = await install.updateSkills(opts, only);
  emitAuditIfAppropriate(opts);
  return rc;
}

function cmdRemove(prog: string, args: string[]): number {
  const opts: RemoveOptions = install.defaultRemoveOptions();

  let parsed;
  try {
    parsed = parseArgs({
      args,
      allowPositionals: true,
      strict: true,
      tokens: true,
      options: {
        agent: { type: "string", short: "a", multiple: true },
        global: { type: "boolean", short: "g" },
        local: { type: "boolean", short: "l" },
        yes: { type: "boolean", short: "y" },
        verbose: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
        "no-lockfile": { type: "boolean" },
      },
    });
  } catch (e) {
    log.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
  const { values, positionals: positional, tokens } = parsed;

  if (values.help) {
    printUsage(prog);
    return 0;
  }
  if (values.verbose) log.setVerbose(true);

  opts.agentNames = values.agent ?? [];
  opts.global = resolveGlobalLocal(tokens, false);
  opts.yes = values.yes ?? false;
  opts.skipLockfile = values["no-lockfile"] ?? false;

  if (positional.length === 0) {
    log.error("Missing skill name");
    process.stdout.write("Usage: rosie remove <skill-name>\n");
    return 1;
  }
  opts.skillName = positional[0];
  return install.removeSkill(opts);
}
