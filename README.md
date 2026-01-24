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
1. Download the repository as a tarball
2. Find all skills (directories containing `SKILL.md`)
3. Detect which agents you have installed
4. Copy skills to each agent's skills directory

### Examples

```bash
# Install to all detected agents
rosie install vercel-labs/agent-skills

# Install a specific skill from a repo
rosie install anthropics/skills pdf

# Install to specific agent(s)
rosie install owner/repo -a claude
rosie install owner/repo -a claude -a cursor

# Install a specific branch or tag
rosie install owner/repo@v1.0.0
rosie install owner/repo@develop

# List skills without installing
rosie list owner/repo

# Remove an installed skill
rosie remove skill-name
rosie remove skill-name -a claude    # Remove from specific agent

# Skip confirmation prompt
rosie install owner/repo -y

# See detected agents
rosie agents
```

### Options

| Flag | Description |
|------|-------------|
| `-a, --agent <name>` | Install to specific agent (can be repeated) |
| `-g, --global` | Install globally to `~/.agent/skills/` (copies files) |
| `-l, --local` | Install locally (default, uses symlinks) |
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
    ├── install.c     # Install orchestration
    ├── download.c    # HTTP fetching (libcurl)
    ├── archive.c     # Tarball extraction (libarchive)
    ├── skill.c       # SKILL.md discovery and parsing
    ├── agent.c       # Agent detection
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
