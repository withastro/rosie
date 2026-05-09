#ifndef SPM_INSTALL_H
#define SPM_INSTALL_H

#include <stdbool.h>
#include "agent.h"
#include "skill.h"

typedef struct {
    const char *spec;           // "owner/repo" or URL
    const char *skill_name;     // Specific skill to install, or NULL for all
    const char **agent_names;   // Specific agents or NULL for auto-detect
    int agent_count;
    bool global;                // Install globally (default) or locally
    bool yes;                   // Skip confirmation prompts
    bool list_only;             // Just list skills, don't install
    // For lockfile-driven reinstalls and updates: preserve the lockfile entry's
    // original pinned flag rather than deriving it from whether @ref appears in
    // the spec string.
    bool override_pinned;
    bool pinned;
    // Reference install (--ref): write a markdown doc under .agents/references/
    // and index it in the project's AGENTS.md / CLAUDE.md instead of installing
    // a skill into agent dirs.
    bool is_reference;
    const char *name_override;  // --name <s>; only valid with is_reference
    // npm package reference (--npm): symlink .md files from
    // node_modules/<spec>/ instead of downloading a tarball. Implies
    // is_reference. include_paths is a list of --include arguments that
    // override the default file scope (README + docs/**.md).
    bool is_npm;
    const char **include_paths;
    int include_count;
} InstallOptions;

typedef struct {
    const char *skill_name;     // Name of skill to remove
    const char **agent_names;   // Specific agents or NULL for auto-detect
    int agent_count;
    bool global;                // Remove from global (default) or local
    bool yes;                   // Skip confirmation prompts
} RemoveOptions;

// Main install function
int install_package(const InstallOptions *opts);

// Install a single skill to a single agent
int install_skill_to_agent(const Skill *skill, const Agent *agent);

// Remove a skill
int remove_skill(const RemoveOptions *opts);

// Reinstall every entry in .agents/rosie.lock at its recorded ref.
// Used by `rosie install` with no args.
int install_from_lockfile(const InstallOptions *base_opts);

// Re-resolve each entry's source. Auto entries advance to the latest semver
// tag; pinned entries refresh the recorded ref's SHA only. Reinstalls when
// the resolved SHA differs from what's in the lockfile.
// If only_skill is non-NULL, restricts the operation to that one entry.
int update_skills(const InstallOptions *base_opts, const char *only_skill);

// Print the contents of .agents/rosie.lock for the current project.
// Used by `rosie list` with no args.
int list_installed_skills(void);

#endif // SPM_INSTALL_H
