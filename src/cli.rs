// CLI entry point. Mirrors main.c's flag parsing and dispatch.
//
// Uses `lexopt` for argument iteration (no derive macros, no async, ~3 kLOC
// dep). Help text is copied verbatim from print_usage in main.c so users see
// the same output. Exit codes match: 0 on success, 1 for usage errors,
// 255 (sign-extended -1) for install_*/remove_* internal failures.

use crate::agent;
use crate::install::{self, InstallOptions, RemoveOptions};
use crate::ROSIE_VERSION;
use lexopt::prelude::*;

fn print_usage(prog: &str) {
    println!("rosie - A robot helper for agent skills v{ROSIE_VERSION}\n");
    println!("Usage: {prog} <command> [options] [arguments]\n");
    println!("Commands:");
    println!("  install [<owner/repo>|<./path>] [skill]");
    println!("                                Install skills from a GitHub repository, or symlink a");
    println!("                                local directory (./path, /path, ~/path) into .agents/skills/.");
    println!("                                With --ref, installs the repo's README.md (or a specific");
    println!("                                SKILL.md via --skill) as a reference under .agents/references/");
    println!("                                and indexes it in AGENTS.md (or CLAUDE.md / GEMINI.md /");
    println!("                                .github/copilot-instructions.md, whichever the project uses).");
    println!("                                With no args, reinstalls from .agents/rosie.lock");
    println!("  update [skill-name]           Re-resolve lockfile entries; reinstall those that changed");
    println!("  remove <skill-name>           Remove an installed skill or reference");
    println!("  list [owner/repo]             List skills in a repo (or installed skills if no arg)");
    println!("  agents                  List detected agents");
    println!("  help                    Show this help message");
    println!();
    println!("Options:");
    println!("  -a, --agent <name>      Target specific agent (can be repeated)");
    println!("  -g, --global            Install to home directory (~/.agent/skills/)");
    println!("  -l, --local             Install to current directory (default, uses symlinks)");
    println!("  -r, --ref               Install as a reference (README or SKILL.md) instead of a skill");
    println!("  -s, --skill <name>      For --ref: install a specific SKILL.md as the reference");
    println!("  -n, --name <name>       For --ref: override the default install name (owner-repo[-skill])");
    println!("  -N, --npm               For --ref: source from node_modules/<pkg>/ (.md files)");
    println!("  -I, --include <path>    For --npm: file or directory to include (repeatable; replaces default scope)");
    println!("  -y, --yes               Skip confirmation prompt");
    println!("  -v, --verbose           Enable verbose output");
    println!("  -h, --help              Show this help message");
    println!("  -V, --version           Print version and exit");
    println!();
    println!("Security options (defaults all on; see docs/security):");
    println!("  --no-strip-comments     Disable markdown-comment stripping on reference installs");
    println!("  --no-strip-invisible    Disable invisible-Unicode stripping on refs and skills");
    println!("  --no-strip              Shorthand: disable both comment + invisible stripping");
    println!("  --no-retag-detect       Skip the tag-rewrite check on `rosie update`");
    println!("  --audit                 Force-emit the audit log on stdout (default: auto-detect agent context)");
    println!("  --no-audit              Suppress audit log on stdout (the JS API still returns it)");
    println!();
    println!("Examples:");
    println!("  {prog} install vercel-labs/agent-skills");
    println!("  {prog} install anthropics/skills pdf");
    println!("  {prog} install owner/repo -a claude -a cursor");
    println!("  {prog} install owner/repo@v1.0.0");
    println!("  {prog} install ./skills/my-custom-skill   # symlink a local skill");
    println!("  {prog} install vercel/next.js --ref       # install README as a reference");
    println!("  {prog} install anthropics/skills --ref --skill pdf   # install a SKILL.md as a reference");
    println!("  {prog} install react --ref --npm                # symlink react's README + docs/ from node_modules");
    println!("  {prog} install @tanstack/react-query --ref --npm    # scoped npm package");
    println!("  {prog} install zod --ref --npm --include README.md  # only README");
    println!("  {prog} install                    # reinstall from .agents/rosie.lock");
    println!("  {prog} update                     # update all lockfile entries");
    println!("  {prog} update slack-gif-creator   # update one skill");
    println!("  {prog} list                       # show installed skills");
    println!("  {prog} list vercel-labs/agent-skills");
    println!("  {prog} remove vercel-react-best-practices");
    println!("  {prog} agents");
}

fn print_agents() {
    println!("Detected agents:");
    let detected = agent::detect_agents(true);
    if detected.is_empty() {
        println!("  (no agents detected)");
    } else {
        for a in &detected {
            println!("  {} ({})", a.def.display, a.install_path.display());
        }
    }
    println!();
    println!("Supported agents:");
    for d in agent::AGENT_DEFS {
        println!("  {:<12} {}", d.name, d.display);
    }
}

/// Apply --cwd as a global pre-pass. Returns the remaining args with --cwd
/// stripped, or an error string for bad/missing values.
fn apply_cwd(raw: Vec<std::ffi::OsString>) -> Result<Vec<std::ffi::OsString>, String> {
    let mut out = Vec::with_capacity(raw.len());
    let mut iter = raw.into_iter();
    while let Some(a) = iter.next() {
        if a == "--cwd" {
            let val = iter
                .next()
                .ok_or_else(|| "--cwd requires a path argument".to_string())?;
            let path = std::path::PathBuf::from(val);
            crate::os::set_current_dir(&path).map_err(|e| format!("Failed to chdir: {e}"))?;
        } else {
            out.push(a);
        }
    }
    Ok(out)
}

/// Entry point used by `src/bin/rosie.rs`. Reads argv from the OS.
pub fn main() -> i32 {
    run(std::env::args_os().collect())
}

/// Run with an explicit argv (program name as `args[0]`). The wasm CLI
/// dispatch (`rosie_api_main` in the wasm crate) calls this directly with
/// args plucked from a null-separated string.
pub fn run(args: Vec<std::ffi::OsString>) -> i32 {
    let raw = args;
    let raw = match apply_cwd(raw) {
        Ok(v) => v,
        Err(e) => {
            crate::log::error(&e);
            return 1;
        }
    };

    if raw.len() < 2 {
        print_usage("rosie");
        return 1;
    }

    let prog = raw[0].to_string_lossy().into_owned();
    let command = raw[1].to_string_lossy().into_owned();
    let cmd_args: Vec<std::ffi::OsString> = raw.into_iter().skip(2).collect();

    match command.as_str() {
        "install" => cmd_install(&prog, cmd_args, false),
        "update" => cmd_update(cmd_args),
        "remove" => cmd_remove(&prog, cmd_args),
        "list" => cmd_install(&prog, cmd_args, true),
        "agents" => {
            print_agents();
            0
        }
        "help" | "--help" | "-h" => {
            print_usage(&prog);
            0
        }
        "--version" | "-V" => {
            println!("{ROSIE_VERSION}");
            0
        }
        _ => {
            crate::log::error(&format!("Unknown command: {command}"));
            println!("Run 'rosie help' for usage.");
            1
        }
    }
}

// Sentinel used inside per-command parsers to bail out cleanly after
// printing --help.
const HELP_SENTINEL: &str = "__help__";

fn handle_parse(res: Result<(), lexopt::Error>) -> Option<i32> {
    match res {
        Ok(()) => None,
        Err(lexopt::Error::Custom(msg)) if msg.to_string() == HELP_SENTINEL => Some(0),
        Err(e) => {
            crate::log::error(&format!("{e}"));
            Some(1)
        }
    }
}

fn cmd_install(prog: &str, args: Vec<std::ffi::OsString>, list_only: bool) -> i32 {
    crate::audit::clear();
    crate::audit::set_command(crate::audit::Operation::Install);
    let mut opts = InstallOptions::default();
    opts.list_only = list_only;
    let mut positional: Vec<String> = Vec::new();

    let mut parser = lexopt::Parser::from_args(args);
    let parse_res: Result<(), lexopt::Error> = (|| -> Result<(), lexopt::Error> {
        while let Some(arg) = parser.next()? {
            match arg {
                Short('a') | Long("agent") => {
                    opts.agent_names.push(parser.value()?.string()?);
                }
                Short('g') | Long("global") => opts.global = true,
                Short('l') | Long("local") => opts.global = false,
                Short('r') | Long("ref") => opts.is_reference = true,
                Short('s') | Long("skill") => {
                    opts.skill_name = Some(parser.value()?.string()?);
                }
                Short('n') | Long("name") => {
                    opts.name_override = Some(parser.value()?.string()?);
                }
                Short('N') | Long("npm") => opts.is_npm = true,
                Short('I') | Long("include") => {
                    opts.include_paths.push(parser.value()?.string()?);
                }
                Short('y') | Long("yes") => opts.yes = true,
                Short('v') | Long("verbose") => crate::log::set_verbose(true),
                Short('h') | Long("help") => {
                    print_usage(prog);
                    return Err(lexopt::Error::Custom(HELP_SENTINEL.into()));
                }
                Long("no-lockfile") => opts.skip_lockfile = true,
                Long("no-strip-comments") => opts.strip_comments = false,
                Long("no-strip-invisible") => opts.strip_invisible = false,
                Long("no-strip") => {
                    opts.strip_comments = false;
                    opts.strip_invisible = false;
                }
                Long("no-retag-detect") => opts.retag_detect = false,
                Long("audit") => opts.force_audit = true,
                Long("no-audit") => opts.suppress_audit = true,
                Value(v) => positional.push(v.string()?),
                _ => return Err(arg.unexpected()),
            }
        }
        Ok(())
    })();
    if let Some(rc) = handle_parse(parse_res) {
        return rc;
    }

    if opts.force_audit && opts.suppress_audit {
        crate::log::error("--audit and --no-audit are mutually exclusive");
        return 1;
    }

    // Validation parallels main.c's cmd_install checks.
    if opts.is_reference && opts.global {
        crate::log::error("--ref is project-scoped; --global is not supported");
        return 1;
    }
    if opts.name_override.is_some() && !opts.is_reference {
        crate::log::error("--name is only valid with --ref");
        return 1;
    }
    if opts.is_npm {
        if !opts.is_reference {
            crate::log::error("--npm requires --ref");
            return 1;
        }
        if opts.name_override.is_some() {
            crate::log::error("--name is not supported with --npm; names are derived per file");
            return 1;
        }
        if opts.skill_name.is_some() {
            crate::log::error("--skill does not apply to --npm packages");
            return 1;
        }
    }
    if !opts.include_paths.is_empty() && !opts.is_npm {
        crate::log::error("--include only applies to --npm");
        return 1;
    }

    if positional.is_empty() {
        if list_only {
            return install::list_installed_skills();
        }
        let rc = install::install_from_lockfile(&opts);
        emit_audit_if_appropriate(&opts);
        return rc;
    }

    opts.spec = Some(positional[0].clone());
    if opts.skill_name.is_none() && positional.len() > 1 {
        opts.skill_name = Some(positional[1].clone());
    }

    if opts.is_npm {
        // Reject @version in spec; npm versions are read from package.json.
        let spec = positional[0].as_str();
        let scan = spec.strip_prefix('@').unwrap_or(spec);
        if scan.contains('@') {
            let head = spec.split('@').next().unwrap_or(spec);
            crate::log::error(&format!(
                "--npm does not accept @version; the version is read from node_modules/{head}/package.json"
            ));
            return 1;
        }
    }

    let rc = install::install_package(&opts);
    emit_audit_if_appropriate(&opts);
    rc
}

/// Drain the audit accumulator and print to stdout if the operation should
/// produce visible audit output. The decision: emit when an agent context
/// is detected (env vars) or forced via --audit, unless suppressed via
/// --no-audit. The structured InstallResult.audit field is unaffected by
/// this gate — only the human-visible stdout emission is.
fn emit_audit_if_appropriate(opts: &InstallOptions) {
    let audit = crate::audit::drain();
    if audit.is_empty() {
        return;
    }
    if opts.suppress_audit {
        return;
    }
    let in_context = crate::os::is_agent_context();
    if !in_context && !opts.force_audit {
        return;
    }
    println!("{}", crate::audit::format_for_stdout(&audit));
}

fn cmd_update(args: Vec<std::ffi::OsString>) -> i32 {
    crate::audit::clear();
    crate::audit::set_command(crate::audit::Operation::Update);
    let mut opts = InstallOptions::default();
    let mut positional: Vec<String> = Vec::new();

    let mut parser = lexopt::Parser::from_args(args);
    let parse_res: Result<(), lexopt::Error> = (|| -> Result<(), lexopt::Error> {
        while let Some(arg) = parser.next()? {
            match arg {
                Short('a') | Long("agent") => {
                    opts.agent_names.push(parser.value()?.string()?);
                }
                Short('y') | Long("yes") => opts.yes = true,
                Short('v') | Long("verbose") => crate::log::set_verbose(true),
                Short('h') | Long("help") => {
                    println!("Usage: rosie update [skill-name]");
                    println!("  Re-resolve and reinstall lockfile entries that have changed upstream.");
                    return Err(lexopt::Error::Custom(HELP_SENTINEL.into()));
                }
                Long("no-lockfile") => opts.skip_lockfile = true,
                Long("no-strip-comments") => opts.strip_comments = false,
                Long("no-strip-invisible") => opts.strip_invisible = false,
                Long("no-strip") => {
                    opts.strip_comments = false;
                    opts.strip_invisible = false;
                }
                Long("no-retag-detect") => opts.retag_detect = false,
                Long("audit") => opts.force_audit = true,
                Long("no-audit") => opts.suppress_audit = true,
                Value(v) => positional.push(v.string()?),
                _ => return Err(arg.unexpected()),
            }
        }
        Ok(())
    })();
    if let Some(rc) = handle_parse(parse_res) {
        return rc;
    }
    if opts.force_audit && opts.suppress_audit {
        crate::log::error("--audit and --no-audit are mutually exclusive");
        return 1;
    }
    let only = positional.first().map(String::as_str);
    let rc = install::update_skills(&opts, only);
    emit_audit_if_appropriate(&opts);
    rc
}

fn cmd_remove(prog: &str, args: Vec<std::ffi::OsString>) -> i32 {
    let mut opts = RemoveOptions::default();
    let mut positional: Vec<String> = Vec::new();

    let mut parser = lexopt::Parser::from_args(args);
    let parse_res: Result<(), lexopt::Error> = (|| -> Result<(), lexopt::Error> {
        while let Some(arg) = parser.next()? {
            match arg {
                Short('a') | Long("agent") => {
                    opts.agent_names.push(parser.value()?.string()?);
                }
                Short('g') | Long("global") => opts.global = true,
                Short('l') | Long("local") => opts.global = false,
                Short('y') | Long("yes") => opts.yes = true,
                Short('v') | Long("verbose") => crate::log::set_verbose(true),
                Short('h') | Long("help") => {
                    print_usage(prog);
                    return Err(lexopt::Error::Custom(HELP_SENTINEL.into()));
                }
                Long("no-lockfile") => opts.skip_lockfile = true,
                Value(v) => positional.push(v.string()?),
                _ => return Err(arg.unexpected()),
            }
        }
        Ok(())
    })();
    if let Some(rc) = handle_parse(parse_res) {
        return rc;
    }
    if positional.is_empty() {
        crate::log::error("Missing skill name");
        println!("Usage: rosie remove <skill-name>");
        return 1;
    }
    opts.skill_name = positional.remove(0);
    install::remove_skill(&opts)
}
