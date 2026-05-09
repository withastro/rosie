# rosie - A robot helper for agent skills

<p align="center">
  <img src="rosie.png" alt="Rosie the Robot">
</p>

A fast, cross-platform package manager for AI agent skills. Think npm, but for skills.

## Install

### Homebrew (macOS)

```bash
brew tap matthewp/rosie
brew install rosie
```

### AUR (Arch Linux)

```bash
yay -S rosie
# or
paru -S rosie
```

### FreeBSD (pkg)

Add the rosie repository, then install:

```bash
sudo mkdir -p /usr/local/etc/pkg/repos
cat <<'EOF' | sudo tee /usr/local/etc/pkg/repos/rosie.conf
rosie: {
  url: "https://matthewp.github.io/rosie/freebsd/",
  enabled: yes,
  signature_type: "none"
}
EOF

sudo pkg update
sudo pkg install rosie
```

### Debian / Ubuntu (apt)

Pick the codename matching your distro: `noble` for Ubuntu 24.04 / Debian 13+, `jammy` for Ubuntu 22.04.

```bash
echo "deb [trusted=yes] https://matthewp.github.io/rosie/debian noble main" | \
  sudo tee /etc/apt/sources.list.d/rosie.list
sudo apt update
sudo apt install rosie
```

### Build from source

#### Dependencies

- libcurl
- libarchive
- pkg-config

On Debian/Ubuntu:
```bash
sudo apt install libcurl4-openssl-dev libarchive-dev pkg-config
```

On macOS:
```bash
brew install curl libarchive pkg-config
```

On Arch:
```bash
sudo pacman -S curl libarchive pkgconf
```

#### Build

```bash
git clone https://github.com/matthewp/rosie
cd rosie
make
sudo make install  # installs to /usr/local/bin
```

## Usage

### Install skills from a GitHub repository

```bash
rosie install owner/repo
```

This will:
1. Resolve the latest semver tag for the repo (or fall back to the default branch if none)
2. Download the repository as a tarball
3. Find all skills (directories containing `SKILL.md`)
4. Detect which agents you have installed
5. Copy skills to each agent's skills directory
6. Record what was installed in `.agents/rosie.lock`

### Examples

```bash
# Install to all detected agents (auto-resolves to latest semver tag)
rosie install vercel-labs/agent-skills

# Install a specific skill from a repo
rosie install anthropics/skills pdf

# Install to specific agent(s)
rosie install owner/repo -a claude
rosie install owner/repo -a claude -a cursor

# Pin to a specific branch or tag (recorded as "pinned" in the lockfile)
rosie install owner/repo@v1.0.0
rosie install owner/repo@develop

# Install a repo's README as a reference (see "References" below)
rosie install colinhacks/zod --ref

# Install a specific SKILL.md as a reference (frontmatter stripped)
rosie install anthropics/skills --ref --skill pdf

# Override the default install name
rosie install owner/repo --ref --name custom-name

# Reinstall everything in .agents/rosie.lock (e.g. on a fresh clone)
rosie install

# Update lockfile entries — auto entries advance to latest, pinned entries
# refresh their SHA only. Works for both skills and references.
rosie update
rosie update slack-gif-creator       # Update one skill

# List skills + references (no arg = installed in this project; with arg = available in repo)
rosie list
rosie list owner/repo

# Remove an installed skill or reference
rosie remove skill-name
rosie remove skill-name -a claude    # Remove from specific agent

# Skip confirmation prompt
rosie install owner/repo -y

# See detected agents
rosie agents
```

### References

References are an alternative to skills, inspired by Vercel's
[finding](https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals)
that an always-loaded `AGENTS.md` index pointing at on-demand reference docs
outperformed `SKILL.md`-style progressive disclosure on their evals.

A reference is a single markdown doc copied into
`.agents/references/<name>/REFERENCE.md` and indexed by title in a Rosie-managed
`<references>` block in your project's agent-instructions file. Rosie picks
`AGENTS.md` if it exists, otherwise `CLAUDE.md`, otherwise creates `AGENTS.md`.

```bash
rosie install vercel/next.js --ref
```

Adds a block to `AGENTS.md` (or `CLAUDE.md`):

```markdown
<!-- rosie:references:start -->
<references>
- [Next.js — The React Framework](./.agents/references/vercel-next.js/REFERENCE.md)
</references>
<!-- rosie:references:end -->
```

The agent loads referenced files on demand based on the title. Titles are
re-extracted from the first H1 of each `REFERENCE.md` on every rebuild — edit
the H1 in the file, and the next install/update/remove will pick up the new
title. Default install name is `owner-repo` (or `owner-repo-skillname` when
combined with `--skill`); override with `--name`.

References use the same lockfile, the same `pin`/`auto` semantics, and the
same `update` command as skills. They're not symlinked into agent dirs —
`AGENTS.md` is the index, so the doc is project-scoped (`--global` is rejected
for `--ref`).

#### npm packages as references

Many libraries ship rich docs as `.md` files inside their npm package
(TanStack, tRPC, Vercel libs, Next.js, etc.). Rosie can install those
straight from your `node_modules/`:

```bash
rosie install react --ref --npm
rosie install @tanstack/react-query --ref --npm

# Override the default file scope (repeatable; replaces the default):
rosie install react --ref --npm --include README.md
rosie install zod --ref --npm --include README.md --include guides
```

What gets installed:

- **Default scope**: `README.md` at the package root (case-insensitive) plus
  every `*.md` under `docs/` (recursive). Nested `node_modules/` are always
  excluded.
- **One reference per matched file**, named `<pkg-slug>-<file-slug>` with
  slashes turned into dashes. Examples:
  - `react/README.md` → `react-readme`
  - `react/docs/hooks.md` → `react-docs-hooks`
  - `@tanstack/react-query/README.md` → `tanstack-react-query-readme`
- **Symlinks** from `.agents/references/<name>/REFERENCE.md` into
  `node_modules/<pkg>/<file>` — no copying, so file edits flow through
  immediately.
- **Lockfile**: `source` is `npm:<pkg>#<rel-path>`, the SHA column holds the
  installed npm version (read from `node_modules/<pkg>/package.json`),
  `ref` is `-`, `pin` is always `auto` (npm pinning is `package.json`'s
  job).

`rosie update` re-reads each npm package's version, walks the file set
again (default scope plus any previously recorded files), drops dead
refs, adds new ones, and refreshes the version on every entry. Run it
after `npm update` to keep the agent in sync.

`--name`, `--skill`, `--global`, and `@version` in the spec are all
rejected with `--npm`.

### Lockfile

When you install a skill or reference locally, rosie records what it installed
in `.agents/rosie.lock`:

```
# rosie-lock v1
slack-gif-creator   anthropics/skills          main    5128e186...  2026-05-02T14:32:18Z auto skill
theme-factory       anthropics/skills          v1.0.0  a1b2c3d4...  2026-05-02T14:35:01Z pin  skill
vercel-next.js      vercel/next.js             v15.1.0 9f8e7d6c...  2026-05-09T10:00:00Z auto ref
acme-widgets        acme/widget-skills#widgets v2.3.0  1234abcd...  2026-05-09T10:05:00Z pin  ref
```

One line per entry: `<name> <source> <ref> <sha> <installed-at> <pin|auto> <skill|ref>`.
The lockfile is small, line-oriented (so it diffs cleanly), and meant to be
checked into git.

`auto` entries were installed without an explicit ref — `rosie update` will
advance them to the highest semver tag upstream. `pin` entries were installed
with an explicit `@ref` and `rosie update` will leave the ref alone, only
refreshing the SHA.

The trailing `skill|ref` field marks the install kind. Reference entries from
a specific SKILL.md encode the skill name in the source as `owner/repo#skill`
so reinstall and update round-trip cleanly. Legacy lockfiles without a header
are read as v0 (skill-only) and rewritten as v1 on the next mutating command.

### Options

| Flag | Description |
|------|-------------|
| `-a, --agent <name>` | Install to specific agent (can be repeated) |
| `-g, --global` | Install globally to `~/.agent/skills/` (copies files) |
| `-l, --local` | Install locally (default, uses symlinks) |
| `-r, --ref` | Install as a reference (README, or a SKILL.md via `--skill`) |
| `-s, --skill <name>` | With `--ref`: install a specific SKILL.md as the reference |
| `-n, --name <name>` | With `--ref`: override the default install name |
| `-N, --npm` | With `--ref`: source from `node_modules/<pkg>/` (`.md` files) |
| `-I, --include <path>` | With `--npm`: file or directory to include (repeatable; replaces default scope) |
| `-y, --yes` | Skip confirmation prompt |
| `-v, --verbose` | Enable verbose output |

## Local vs Global Install

**Local install (default):**
- Skills are copied to `.agents/skills/` in the current directory
- Symlinks are created in each agent's local skills directory
- Project-specific, can be version controlled

```
.agents/skills/my-skill/          # Canonical copy
.claude/skills/my-skill  -> ../../.agents/skills/my-skill
.cursor/skills/my-skill  -> ../../.agents/skills/my-skill
```

**Global install (`--global`):**
- Skills are copied directly to each agent's global skills directory
- Available across all projects

```
~/.claude/skills/my-skill/        # Direct copy
~/.cursor/skills/my-skill/        # Direct copy
```

## Supported Agents

rosie auto-detects installed agents by checking for their config directories:

| Agent | Config Directory |
|-------|------------------|
| Claude Code | `~/.claude/` |
| Cursor | `~/.cursor/` |
| OpenCode | `~/.opencode/` |
| Cline | `~/.cline/` |
| Codex | `~/.codex/` |
| Windsurf | `~/.windsurf/` |
| Continue | `~/.continue/` |
| GitHub Copilot | `~/.github/` |
| Aider | `~/.aider/` |
| Zed | `~/.zed/` |

## How It Works

```
rosie install owner/repo
       │
       ├─▶ Parse package spec (owner/repo@ref)
       │
       ├─▶ Build GitHub tarball URL
       │   https://github.com/owner/repo/archive/refs/heads/main.tar.gz
       │
       ├─▶ Download tarball (libcurl)
       │
       ├─▶ Extract to temp directory (libarchive)
       │
       ├─▶ Discover skills
       │   Search for SKILL.md in:
       │   - skills/
       │   - .agents/skills/
       │   - .claude/skills/
       │   - (and other known paths)
       │
       ├─▶ Parse YAML frontmatter
       │   ---
       │   name: skill-name
       │   description: What it does
       │   ---
       │
       ├─▶ Detect installed agents
       │   Check for ~/.claude/, ~/.cursor/, etc.
       │
       └─▶ Install skills
           Local:  Copy to .agents/skills/, symlink to each agent
           Global: Copy directly to each agent's ~/.agent/skills/
```

## Skill Format

Skills are directories containing a `SKILL.md` file with YAML frontmatter:

```
my-skill/
├── SKILL.md          # Required - agent instructions
├── scripts/          # Optional - automation helpers
└── references/       # Optional - supporting docs
```

Example `SKILL.md`:

```markdown
---
name: my-skill
description: A brief description of what this skill does
---

# My Skill

Instructions for the AI agent go here...
```

## Project Structure

```
rosie/
├── Makefile
└── src/
    ├── main.c        # CLI entry point
    ├── install.c     # Install / update / remove orchestration
    ├── download.c    # HTTP fetching (libcurl)
    ├── resolve.c     # Latest-tag and SHA resolution (smart-HTTP)
    ├── archive.c     # Tarball extraction (libarchive)
    ├── skill.c       # SKILL.md discovery and parsing
    ├── agent.c       # Agent detection
    ├── lockfile.c    # .agents/rosie.lock read/write
    └── util.c        # Path/string helpers
```

## Alternatives

Other tools in the agent skills ecosystem:

| Tool | Language | Description |
|------|----------|-------------|
| [skills](https://skills.sh) | Node.js | Vercel's official skills CLI (`npx skills`) |
| [add-skill](https://github.com/vercel-labs/add-skill) | Node.js | Vercel Labs skill installer |
| [paks](https://paks.stakpak.dev/) | - | Stakpak's agent skills manager |
| [agr](https://github.com/kasperjunge/agent-resources) | Python | Agent resources manager |
| [apm](https://github.com/danielmeppiel/apm) | - | Agent Package Manager |
| [skill-manager](https://lib.rs/crates/skill-manager) | Rust | CLI for managing AI assistant skills |
| [agent-skills-cli](https://pypi.org/project/agent-skills-cli/) | Python | Agent skills CLI |

## License

BSD 3-Clause
