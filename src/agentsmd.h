#ifndef SPM_AGENTSMD_H
#define SPM_AGENTSMD_H

#include "lockfile.h"

// Return the path of the agent-instructions file Rosie should write the
// references block into. Detection order:
//   1. AGENTS.md if it exists in the current directory
//   2. CLAUDE.md if it exists
//   3. AGENTS.md (default — created on first write)
// Returns a pointer to a static string; do not free.
const char *agentsmd_target_path(void);

// Extract the first H1 (line starting with "# ") from a markdown file,
// skipping any leading YAML frontmatter. Returns a malloc'd, trimmed string,
// or NULL if no H1 found or the file cannot be read. Caller frees.
char *agentsmd_extract_first_h1(const char *markdown_path);

// Rewrite the Rosie-managed <references> block inside the target file (see
// agentsmd_target_path). Reads existing file, replaces content between the
// "<!-- rosie:references:start -->" and "<!-- rosie:references:end -->"
// markers (or appends a new block if markers are absent), and writes the
// result atomically via .tmp + rename.
//
// Iterates lf->entries filtered to LOCK_REF, sorted by name. For each ref the
// title is re-extracted from the first H1 of its REFERENCE.md (falling back to
// the install name). When no LOCK_REF entries exist the block is removed
// entirely. Returns 0 on success.
int agentsmd_rebuild_block(const Lockfile *lf);

#endif // SPM_AGENTSMD_H
