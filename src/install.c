#include "install.h"
#include "download.h"
#include "archive.h"
#include "skill.h"
#include "agent.h"
#include "lockfile.h"
#include "resolve.h"
#include "util.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <dirent.h>
#include <limits.h>
#include <sys/stat.h>

// Local install storage directory
#define LOCAL_AGENTS_DIR ".agents"
#define LOCAL_SKILLS_DIR ".agents/skills"

int install_skill_to_agent(const Skill *skill, const Agent *agent) {
    if (!skill || !agent) return -1;

    // Create target directory: agent_install_path/skill_name/
    char *target_dir = path_join(agent->install_path, skill->name);

    log_debug("Installing %s to %s", skill->name, target_dir);

    // Ensure parent directory exists
    if (make_dirs(agent->install_path) != 0) {
        log_error("Cannot create directory: %s", agent->install_path);
        spm_free(target_dir);
        return -1;
    }

    // Copy skill directory
    if (copy_dir_recursive(skill->path, target_dir) != 0) {
        log_error("Failed to copy skill: %s", skill->name);
        spm_free(target_dir);
        return -1;
    }

    spm_free(target_dir);
    return 0;
}

// Install skill to local .agents/skills/ and symlink to agent
int install_skill_local(const Skill *skill, const Agent *agent, const char *canonical_path) {
    if (!skill || !agent || !canonical_path) return -1;

    // Ensure agent skills directory exists
    if (make_dirs(agent->install_path) != 0) {
        log_error("Cannot create directory: %s", agent->install_path);
        return -1;
    }

    // Create symlink: .claude/skills/skill-name -> ../../.agents/skills/skill-name
    char *link_path = path_join(agent->install_path, skill->name);

    // Remove existing symlink or directory if present
    struct stat st;
    if (lstat(link_path, &st) == 0) {
        if (S_ISLNK(st.st_mode)) {
            unlink(link_path);
        } else if (S_ISDIR(st.st_mode)) {
            // Don't overwrite existing non-symlink directory
            log_debug("Skipping %s (already exists as directory)", link_path);
            spm_free(link_path);
            return 0;
        }
    }

    // Calculate relative path from agent skills dir to canonical path
    // e.g., from ".claude/skills" to ".agents/skills/skill-name"
    // Result: "../../.agents/skills/skill-name"
    char *relative_target = path_join("../..", canonical_path);

    log_debug("Symlink: %s -> %s", link_path, relative_target);

    if (symlink(relative_target, link_path) != 0) {
        log_error("Failed to create symlink: %s", link_path);
        spm_free(link_path);
        spm_free(relative_target);
        return -1;
    }

    spm_free(link_path);
    spm_free(relative_target);
    return 0;
}

// Copy skill to canonical .agents/skills/ location
static char *install_to_canonical(const Skill *skill) {
    char *canonical_dir = path_join(LOCAL_SKILLS_DIR, skill->name);

    log_debug("Installing to canonical path: %s", canonical_dir);

    // Ensure parent directory exists
    if (make_dirs(LOCAL_SKILLS_DIR) != 0) {
        log_error("Cannot create directory: %s", LOCAL_SKILLS_DIR);
        spm_free(canonical_dir);
        return NULL;
    }

    // Copy skill directory
    if (copy_dir_recursive(skill->path, canonical_dir) != 0) {
        log_error("Failed to copy skill: %s", skill->name);
        spm_free(canonical_dir);
        return NULL;
    }

    return canonical_dir;
}

// Link a hand-authored skill that already lives in the working tree at
// canonical_rel (a "./<rel>" path under the current working directory).
// Creates the canonical symlink at .agents/skills/<name> pointing at the
// user's directory, mirrors that into each target agent, and writes a
// "file://<canonical_rel>" lockfile entry. Used by install_package() when the
// CLI arg is a local path, and by install_from_lockfile() when reinstalling
// a file:// entry on a fresh clone.
static int install_local(const char *canonical_rel, const InstallOptions *opts) {
    if (opts->global) {
        log_error("Local skills cannot be installed globally; drop --global");
        return -1;
    }

    if (!dir_exists(canonical_rel)) {
        log_error("Local skill directory not found: %s", canonical_rel);
        return -1;
    }

    char *skill_md = path_join(canonical_rel, "SKILL.md");
    Skill *skill = parse_skill_file(skill_md);
    spm_free(skill_md);
    if (!skill || !skill->name) {
        log_error("No valid SKILL.md in %s", canonical_rel);
        if (skill) skill_free(skill);
        return -1;
    }

    if (opts->skill_name && strcmp(skill->name, opts->skill_name) != 0) {
        log_error("Skill name mismatch: SKILL.md declares '%s', expected '%s'",
                  skill->name, opts->skill_name);
        skill_free(skill);
        return -1;
    }

    log_info("Linking local skill: %s (%s)", skill->name, canonical_rel);

    AgentList *agents;
    if (opts->agent_names && opts->agent_count > 0) {
        agents = agents_from_names(opts->agent_names, opts->agent_count, false);
    } else {
        agents = detect_agents(false);
    }
    if (agents->count == 0) {
        log_error("No agents detected. Use --agent to specify target agent.");
        skill_free(skill);
        agent_list_free(agents);
        return -1;
    }

    if (opts->list_only) {
        log_info("Found 1 skill:");
        skill_print(skill);
        skill_free(skill);
        agent_list_free(agents);
        return 0;
    }

    if (!opts->yes) {
        printf("\nLink %s -> %s/%s for %d agent(s)? [Y/n] ",
               canonical_rel, LOCAL_SKILLS_DIR, skill->name, agents->count);
        fflush(stdout);
        char response[16];
        if (fgets(response, sizeof(response), stdin)) {
            char *trimmed = str_trim(response);
            if (trimmed[0] != '\0' && trimmed[0] != 'y' && trimmed[0] != 'Y') {
                log_info("Cancelled.");
                skill_free(skill);
                agent_list_free(agents);
                return 0;
            }
        }
    }

    if (make_dirs(LOCAL_SKILLS_DIR) != 0) {
        log_error("Cannot create directory: %s", LOCAL_SKILLS_DIR);
        skill_free(skill);
        agent_list_free(agents);
        return -1;
    }

    // The canonical symlink lives at .agents/skills/<name>. Its target is the
    // user's directory, expressed relative to .agents/skills/ — so we strip
    // the "./" from canonical_rel and prefix "../.." to climb back to repo root.
    char *canonical_link = path_join(LOCAL_SKILLS_DIR, skill->name);
    const char *rel_for_link = canonical_rel;
    if (rel_for_link[0] == '.' && rel_for_link[1] == '/') rel_for_link += 2;
    char *canonical_target;
    if (rel_for_link[0] == '\0' || strcmp(rel_for_link, ".") == 0) {
        canonical_target = str_dup("../..");
    } else {
        canonical_target = path_join("../..", rel_for_link);
    }

    struct stat st;
    if (lstat(canonical_link, &st) == 0) {
        if (S_ISLNK(st.st_mode)) {
            char buf[PATH_MAX];
            ssize_t n = readlink(canonical_link, buf, sizeof(buf) - 1);
            if (n < 0) n = 0;
            buf[n] = '\0';

            if (n > 0 && strcmp(buf, canonical_target) == 0) {
                log_debug("Canonical symlink already correct: %s", canonical_link);
            } else if (unlink(canonical_link) != 0 ||
                       symlink(canonical_target, canonical_link) != 0) {
                log_error("Failed to update symlink: %s", canonical_link);
                spm_free(canonical_link);
                spm_free(canonical_target);
                skill_free(skill);
                agent_list_free(agents);
                return -1;
            }
        } else {
            log_error("Refusing to overwrite existing non-symlink at %s",
                      canonical_link);
            spm_free(canonical_link);
            spm_free(canonical_target);
            skill_free(skill);
            agent_list_free(agents);
            return -1;
        }
    } else if (symlink(canonical_target, canonical_link) != 0) {
        log_error("Failed to create symlink: %s -> %s",
                  canonical_link, canonical_target);
        spm_free(canonical_link);
        spm_free(canonical_target);
        skill_free(skill);
        agent_list_free(agents);
        return -1;
    }

    log_info("  %s -> %s", canonical_link, canonical_target);

    int linked = 0;
    for (int j = 0; j < agents->count; j++) {
        if (install_skill_local(skill, &agents->agents[j], canonical_link) == 0) {
            linked++;
        }
    }
    log_info("    symlink -> %d agent(s)", linked);

    Lockfile *lf = lockfile_load(LOCAL_AGENTS_DIR);
    char *now = lockfile_now_iso8601();
    size_t source_len = strlen("file://") + strlen(canonical_rel) + 1;
    char *source = spm_malloc(source_len);
    snprintf(source, source_len, "file://%s", canonical_rel);

    lockfile_upsert(lf, skill->name, source, "-", "-", now, true);

    if (lockfile_save(lf) != 0) {
        log_error("Warning: failed to write %s", lf->path);
    }
    lockfile_free(lf);
    spm_free(source);
    spm_free(now);

    log_info("Linked %s.", skill->name);

    spm_free(canonical_link);
    spm_free(canonical_target);
    skill_free(skill);
    agent_list_free(agents);
    return 0;
}

static char *create_temp_dir(void) {
    char *tmp = get_temp_dir();
    char *template = path_join(tmp, "rosie-XXXXXX");
    spm_free(tmp);

    char *dir = mkdtemp(template);
    if (!dir) {
        log_error("Cannot create temp directory");
        spm_free(template);
        return NULL;
    }

    return template;  // mkdtemp modifies in place
}

static int remove_dir_recursive(const char *path) {
    DIR *dir = opendir(path);
    if (!dir) return -1;

    struct dirent *entry;
    while ((entry = readdir(dir)) != NULL) {
        if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) {
            continue;
        }

        char *full_path = path_join(path, entry->d_name);
        struct stat st;

        if (lstat(full_path, &st) == 0) {
            if (S_ISDIR(st.st_mode)) {
                remove_dir_recursive(full_path);
            } else {
                unlink(full_path);
            }
        }

        spm_free(full_path);
    }

    closedir(dir);
    return rmdir(path);
}

int install_package(const InstallOptions *opts) {
    if (!opts || !opts->spec) {
        log_error("No package specified");
        return -1;
    }

    // Parse package spec
    PackageSpec *spec = package_spec_parse(opts->spec);
    if (!spec) {
        return -1;
    }

    // Local-path install: skip the entire download/extract pipeline and just
    // create symlinks pointing at the user's working tree.
    if (spec->is_local) {
        int rc = install_local(spec->local_path, opts);
        package_spec_free(spec);
        return rc;
    }

    log_info("Installing %s/%s...", spec->owner, spec->repo);

    // Resolve the ref before downloading. If the user didn't pin a ref, pick
    // the highest semver tag (and fall back to the default branch if none).
    // Either way, we want a SHA in the lockfile, so always try to resolve.
    ResolvedRef *resolved = NULL;
    if (!spec->ref_explicit) {
        resolved = resolve_latest_tag(spec);
        if (resolved) {
            log_info("Resolved %s/%s -> %s", spec->owner, spec->repo, resolved->ref);
            spm_free(spec->ref);
            spec->ref = str_dup(resolved->ref);
        } else {
            log_debug("No semver tags for %s/%s, using %s", spec->owner, spec->repo, spec->ref);
            resolved = resolve_ref(spec, spec->ref);  // capture SHA of default branch
        }
    } else {
        resolved = resolve_ref(spec, spec->ref);
    }
    if (!resolved) {
        log_debug("Could not resolve SHA for %s, lockfile entry will use stub",
                  spec->ref);
    }

    // Create temp directory
    char *temp_dir = create_temp_dir();
    if (!temp_dir) {
        resolved_ref_free(resolved);
        package_spec_free(spec);
        return -1;
    }

    // Download tarball (tries branch, then tag on 404)
    char *tarball_path = path_join(temp_dir, "package.tar.gz");
    log_info("Downloading...");

    if (download_package_tarball(spec, tarball_path) != 0) {
        log_error("Failed to download package");
        spm_free(tarball_path);
        remove_dir_recursive(temp_dir);
        spm_free(temp_dir);
        resolved_ref_free(resolved);
        package_spec_free(spec);
        return -1;
    }

    // Extract tarball
    log_info("Extracting...");
    if (extract_tarball(tarball_path, temp_dir) != 0) {
        log_error("Failed to extract package");
        spm_free(tarball_path);
        remove_dir_recursive(temp_dir);
        spm_free(temp_dir);
        resolved_ref_free(resolved);
        package_spec_free(spec);
        return -1;
    }

    // Get the root directory name (GitHub creates repo-branch/)
    char *root_dir = get_archive_root_dir(tarball_path);
    spm_free(tarball_path);

    char *extracted_path;
    if (root_dir) {
        extracted_path = path_join(temp_dir, root_dir);
        spm_free(root_dir);
    } else {
        extracted_path = str_dup(temp_dir);
    }

    // Discover skills in extracted package
    log_info("Discovering skills...");
    SkillList *skills = discover_skills(extracted_path);

    if (skills->count == 0) {
        log_error("No skills found in package");
        skill_list_free(skills);
        spm_free(extracted_path);
        remove_dir_recursive(temp_dir);
        spm_free(temp_dir);
        resolved_ref_free(resolved);
        package_spec_free(spec);
        return -1;
    }

    // Filter to specific skill if requested
    if (opts->skill_name) {
        int found = -1;
        for (int i = 0; i < skills->count; i++) {
            if (strcmp(skills->skills[i].name, opts->skill_name) == 0) {
                found = i;
                break;
            }
        }

        if (found < 0) {
            log_error("Skill '%s' not found in package", opts->skill_name);
            log_info("Available skills:");
            skill_list_print(skills);
            skill_list_free(skills);
            spm_free(extracted_path);
            remove_dir_recursive(temp_dir);
            spm_free(temp_dir);
            resolved_ref_free(resolved);
            package_spec_free(spec);
            return -1;
        }

        // Keep only the requested skill
        Skill keep = skills->skills[found];
        for (int i = 0; i < skills->count; i++) {
            if (i != found) {
                spm_free(skills->skills[i].name);
                spm_free(skills->skills[i].description);
                spm_free(skills->skills[i].path);
                spm_free(skills->skills[i].skill_file);
            }
        }
        skills->skills[0] = keep;
        skills->count = 1;
    }

    log_info("Found %d skill(s):", skills->count);
    skill_list_print(skills);

    // If list-only, stop here
    if (opts->list_only) {
        skill_list_free(skills);
        spm_free(extracted_path);
        remove_dir_recursive(temp_dir);
        spm_free(temp_dir);
        resolved_ref_free(resolved);
        package_spec_free(spec);
        return 0;
    }

    // Get target agents
    AgentList *agents;
    if (opts->agent_names && opts->agent_count > 0) {
        agents = agents_from_names(opts->agent_names, opts->agent_count, opts->global);
    } else {
        agents = detect_agents(opts->global);
    }

    if (agents->count == 0) {
        log_error("No agents detected. Use --agent to specify target agent.");
        agent_list_free(agents);
        skill_list_free(skills);
        spm_free(extracted_path);
        remove_dir_recursive(temp_dir);
        spm_free(temp_dir);
        resolved_ref_free(resolved);
        package_spec_free(spec);
        return -1;
    }

    log_info("Target agents:");
    for (int i = 0; i < agents->count; i++) {
        log_info("  %s (%s)", agents->agents[i].def->display, agents->agents[i].install_path);
    }

    // Confirm installation (unless --yes)
    if (!opts->yes) {
        printf("\nProceed with installation? [Y/n] ");
        fflush(stdout);

        char response[16];
        if (fgets(response, sizeof(response), stdin)) {
            char *trimmed = str_trim(response);
            if (trimmed[0] != '\0' && trimmed[0] != 'y' && trimmed[0] != 'Y') {
                log_info("Installation cancelled.");
                agent_list_free(agents);
                skill_list_free(skills);
                spm_free(extracted_path);
                remove_dir_recursive(temp_dir);
                spm_free(temp_dir);
                resolved_ref_free(resolved);
                package_spec_free(spec);
                return 0;
            }
        }
    }

    // Install skills
    int installed = 0;

    if (opts->global) {
        // Global install: copy directly to each agent's skills directory
        for (int i = 0; i < skills->count; i++) {
            for (int j = 0; j < agents->count; j++) {
                if (install_skill_to_agent(&skills->skills[i], &agents->agents[j]) == 0) {
                    installed++;
                }
            }
        }
        log_info("Installed %d skill(s) to %d agent(s).", installed, agents->count);
    } else {
        // Local install: copy to .agents/skills/, symlink to each agent.
        // Record each successful install in .agents/rosie.lock.
        size_t source_len = strlen(spec->owner) + strlen(spec->repo) + 2;
        char *source = spm_malloc(source_len);
        snprintf(source, source_len, "%s/%s", spec->owner, spec->repo);

        Lockfile *lf = lockfile_load(LOCAL_AGENTS_DIR);
        char *now = lockfile_now_iso8601();
        bool effective_pinned = opts->override_pinned ? opts->pinned : spec->ref_explicit;

        for (int i = 0; i < skills->count; i++) {
            char *canonical = install_to_canonical(&skills->skills[i]);
            if (!canonical) continue;

            log_info("  %s", canonical);
            log_info("    symlink -> %d agent(s)", agents->count);

            for (int j = 0; j < agents->count; j++) {
                if (install_skill_local(&skills->skills[i], &agents->agents[j], canonical) == 0) {
                    installed++;
                }
            }

            const char *sha = (resolved && resolved->sha) ? resolved->sha : "-";
            lockfile_upsert(lf, skills->skills[i].name, source, spec->ref, sha, now,
                            effective_pinned);

            spm_free(canonical);
        }

        if (lockfile_save(lf) != 0) {
            log_error("Warning: failed to write %s", lf->path);
        }
        lockfile_free(lf);
        spm_free(source);
        spm_free(now);

        log_info("Installed %d skill(s) via symlinks.", installed);
    }

    // Cleanup
    agent_list_free(agents);
    skill_list_free(skills);
    spm_free(extracted_path);
    remove_dir_recursive(temp_dir);
    spm_free(temp_dir);
    resolved_ref_free(resolved);
    package_spec_free(spec);

    return 0;
}

int remove_skill(const RemoveOptions *opts) {
    if (!opts || !opts->skill_name) {
        log_error("No skill specified");
        return -1;
    }

    // Get target agents
    AgentList *agents;
    if (opts->agent_names && opts->agent_count > 0) {
        agents = agents_from_names(opts->agent_names, opts->agent_count, opts->global);
    } else {
        agents = detect_agents(opts->global);
    }

    if (agents->count == 0) {
        log_error("No agents detected. Use --agent to specify target agent.");
        agent_list_free(agents);
        return -1;
    }

    // Find which agents have this skill installed (check for symlinks or dirs)
    int found_count = 0;
    for (int i = 0; i < agents->count; i++) {
        char *skill_path = path_join(agents->agents[i].install_path, opts->skill_name);
        struct stat st;
        if (lstat(skill_path, &st) == 0) {
            found_count++;
            log_info("Found: %s (%s)", opts->skill_name, skill_path);
        }
        spm_free(skill_path);
    }

    if (found_count == 0) {
        log_error("Skill '%s' not found in any agent", opts->skill_name);
        agent_list_free(agents);
        return -1;
    }

    // Confirm removal (unless --yes)
    if (!opts->yes) {
        printf("\nRemove '%s' from %d agent(s)? [y/N] ", opts->skill_name, found_count);
        fflush(stdout);

        char response[16];
        if (fgets(response, sizeof(response), stdin)) {
            char *trimmed = str_trim(response);
            if (trimmed[0] != 'y' && trimmed[0] != 'Y') {
                log_info("Removal cancelled.");
                agent_list_free(agents);
                return 0;
            }
        }
    }

    // Remove from each agent
    int removed = 0;
    for (int i = 0; i < agents->count; i++) {
        char *skill_path = path_join(agents->agents[i].install_path, opts->skill_name);
        struct stat st;
        if (lstat(skill_path, &st) == 0) {
            log_debug("Removing: %s", skill_path);
            int result;
            if (S_ISLNK(st.st_mode)) {
                // Symlink - just unlink it
                result = unlink(skill_path);
            } else if (S_ISDIR(st.st_mode)) {
                // Directory - remove recursively
                result = remove_dir_recursive(skill_path);
            } else {
                result = unlink(skill_path);
            }

            if (result == 0) {
                removed++;
            } else {
                log_error("Failed to remove: %s", skill_path);
            }
        }
        spm_free(skill_path);
    }

    log_info("Removed '%s' from %d agent(s).", opts->skill_name, removed);

    // Drop the lockfile entry for local removes. Global installs don't write
    // a project lockfile, so leave any same-named local entry alone in that case.
    if (!opts->global) {
        Lockfile *lf = lockfile_load(LOCAL_AGENTS_DIR);
        if (lockfile_remove_entry(lf, opts->skill_name)) {
            if (lockfile_save(lf) != 0) {
                log_error("Warning: failed to update %s", lf->path);
            }
        }
        lockfile_free(lf);
    }

    agent_list_free(agents);
    return 0;
}

// Build "owner/repo@ref" — caller frees.
static char *build_spec_string(const char *source, const char *ref) {
    size_t len = strlen(source) + strlen(ref) + 2;
    char *s = spm_malloc(len);
    snprintf(s, len, "%s@%s", source, ref);
    return s;
}

// Snapshot of lockfile entry fields we need after lockfile_free. Lockfile
// entries are unstable across install_package calls (they re-load and re-save
// the lockfile), so we have to copy what we need first.
typedef struct {
    char *skill_name;
    char *source;
    char *ref;
    char *sha;
    bool pinned;
} EntrySnapshot;

static EntrySnapshot *snapshot_entries(const Lockfile *lf, int *out_count) {
    *out_count = lf->count;
    if (lf->count == 0) return NULL;
    EntrySnapshot *snap = spm_malloc((size_t)lf->count * sizeof(EntrySnapshot));
    for (int i = 0; i < lf->count; i++) {
        snap[i].skill_name = str_dup(lf->entries[i].skill_name);
        snap[i].source = str_dup(lf->entries[i].source);
        snap[i].ref = str_dup(lf->entries[i].ref);
        snap[i].sha = str_dup(lf->entries[i].sha);
        snap[i].pinned = lf->entries[i].pinned;
    }
    return snap;
}

static void free_snapshots(EntrySnapshot *snap, int count) {
    if (!snap) return;
    for (int i = 0; i < count; i++) {
        spm_free(snap[i].skill_name);
        spm_free(snap[i].source);
        spm_free(snap[i].ref);
        spm_free(snap[i].sha);
    }
    spm_free(snap);
}

int install_from_lockfile(const InstallOptions *base_opts) {
    Lockfile *lf = lockfile_load(LOCAL_AGENTS_DIR);
    if (lf->count == 0) {
        log_error("No lockfile entries to install (%s)", lf->path);
        log_info("Did you mean: rosie install <owner/repo>?");
        lockfile_free(lf);
        return 1;
    }

    int count;
    EntrySnapshot *snap = snapshot_entries(lf, &count);
    lockfile_free(lf);

    log_info("Reinstalling %d skill(s) from lockfile...", count);

    int ok = 0, fail = 0, fresh = 0, present = 0;
    for (int i = 0; i < count; i++) {
        // file:// entries point at a tracked working-tree directory. Don't
        // run them through install_package — there's nothing to download and
        // no sensible "spec_str" to feed back into the parser. Just relink.
        if (source_is_local(snap[i].source)) {
            const char *canonical_rel = source_local_path(snap[i].source);
            if (!dir_exists(canonical_rel)) {
                log_info("warning: %s source missing locally, skipping (%s)",
                         snap[i].skill_name, canonical_rel);
                continue;
            }
            InstallOptions opts = *base_opts;
            opts.spec = NULL;
            opts.skill_name = snap[i].skill_name;
            opts.yes = true;
            opts.list_only = false;
            opts.global = false;
            opts.override_pinned = false;
            opts.pinned = false;
            if (install_local(canonical_rel, &opts) == 0) ok++;
            else fail++;
            continue;
        }

        // Trust the lockfile: if .agents/skills/<name>/SKILL.md is already
        // there, the canonical install matches the recorded SHA. Skip the
        // download/extract/copy and just make sure each agent's symlink is
        // in place. The lockfile entry stays untouched (no installed_at
        // churn for a no-op install).
        char *canonical = path_join(LOCAL_SKILLS_DIR, snap[i].skill_name);
        char *canonical_skill_md = path_join(canonical, "SKILL.md");
        bool present_on_disk = file_exists(canonical_skill_md);
        spm_free(canonical_skill_md);

        if (present_on_disk) {
            AgentList *agents;
            if (base_opts->agent_names && base_opts->agent_count > 0) {
                agents = agents_from_names(base_opts->agent_names,
                                           base_opts->agent_count, false);
            } else {
                agents = detect_agents(false);
            }

            // install_skill_local only reads skill->name, so a name-only stub
            // is enough to recreate the agent->canonical symlinks.
            Skill stub;
            memset(&stub, 0, sizeof(stub));
            stub.name = (char *)snap[i].skill_name;

            int linked = 0;
            for (int j = 0; j < agents->count; j++) {
                if (install_skill_local(&stub, &agents->agents[j], canonical) == 0) {
                    linked++;
                }
            }
            log_info("%s: already at %s (%d agent symlink(s))",
                     snap[i].skill_name, snap[i].ref, linked);
            agent_list_free(agents);
            spm_free(canonical);
            present++;
            ok++;
            continue;
        }
        spm_free(canonical);

        char *spec_str = build_spec_string(snap[i].source, snap[i].ref);

        InstallOptions opts = *base_opts;
        opts.spec = spec_str;
        opts.skill_name = snap[i].skill_name;
        opts.yes = true;
        opts.list_only = false;
        opts.global = false;
        opts.override_pinned = true;
        opts.pinned = snap[i].pinned;

        if (install_package(&opts) == 0) { ok++; fresh++; }
        else fail++;

        spm_free(spec_str);
    }

    free_snapshots(snap, count);
    if (fail > 0) {
        log_error("Reinstalled %d (%d already present, %d fresh), %d failed",
                  ok, present, fresh, fail);
        return 1;
    }
    if (fresh == 0) {
        log_info("All %d skill(s) already installed.", ok);
    } else {
        log_info("Reinstalled %d skill(s) (%d already present, %d freshly installed).",
                 ok, present, fresh);
    }
    return 0;
}

int update_skills(const InstallOptions *base_opts, const char *only_skill) {
    Lockfile *lf = lockfile_load(LOCAL_AGENTS_DIR);
    if (lf->count == 0) {
        log_error("No lockfile entries to update (%s)", lf->path);
        lockfile_free(lf);
        return 1;
    }

    int count;
    EntrySnapshot *snap = snapshot_entries(lf, &count);
    lockfile_free(lf);

    int matched = 0, advanced = 0, unchanged = 0, failed = 0;

    for (int i = 0; i < count; i++) {
        if (only_skill && strcmp(snap[i].skill_name, only_skill) != 0) continue;
        matched++;

        // Local links track the working tree directly — there's no upstream
        // to re-resolve. Treat them as always up to date.
        if (source_is_local(snap[i].source)) {
            log_info("%s: local link, no update needed", snap[i].skill_name);
            unchanged++;
            continue;
        }

        // Build a spec from the recorded source so we can resolve against it.
        // The ref doesn't matter for resolution; resolve_* takes only owner/repo.
        char *spec_str = str_dup(snap[i].source);
        // package_spec_parse needs owner/repo with optional @ref. Source is
        // already "owner/repo" — that's a valid spec on its own.
        PackageSpec *ps = package_spec_parse(spec_str);
        spm_free(spec_str);
        if (!ps) {
            log_error("update: cannot parse source '%s'", snap[i].source);
            failed++;
            continue;
        }

        ResolvedRef *r = NULL;
        if (snap[i].pinned) {
            // Pinned: refresh the SHA for the recorded ref. Don't move off it.
            r = resolve_ref(ps, snap[i].ref);
        } else {
            // Auto: pick the latest semver tag. If none, fall back to the
            // recorded ref (typically a branch like main).
            r = resolve_latest_tag(ps);
            if (!r) r = resolve_ref(ps, snap[i].ref);
        }
        package_spec_free(ps);

        if (!r) {
            log_error("update: cannot resolve %s for skill '%s'",
                      snap[i].source, snap[i].skill_name);
            failed++;
            continue;
        }

        bool ref_changed = strcmp(r->ref, snap[i].ref) != 0;
        bool sha_changed = strcmp(r->sha, snap[i].sha) != 0;

        if (!ref_changed && !sha_changed) {
            log_info("%s: up to date (%s)", snap[i].skill_name, snap[i].ref);
            unchanged++;
            resolved_ref_free(r);
            continue;
        }

        if (ref_changed) {
            log_info("%s: %s -> %s", snap[i].skill_name, snap[i].ref, r->ref);
        } else {
            log_info("%s: %s SHA changed (%s upstream re-tagged?)",
                     snap[i].skill_name, snap[i].ref, snap[i].source);
        }

        char *new_spec = build_spec_string(snap[i].source, r->ref);
        InstallOptions opts = *base_opts;
        opts.spec = new_spec;
        opts.skill_name = snap[i].skill_name;
        opts.yes = true;
        opts.list_only = false;
        opts.global = false;
        opts.override_pinned = true;
        opts.pinned = snap[i].pinned;  // preserve pin status across update

        int rc = install_package(&opts);
        spm_free(new_spec);
        resolved_ref_free(r);

        if (rc == 0) advanced++;
        else failed++;
    }

    free_snapshots(snap, count);

    if (only_skill && matched == 0) {
        log_error("Skill '%s' not found in lockfile", only_skill);
        return 1;
    }

    log_info("Update complete: %d updated, %d unchanged, %d failed",
             advanced, unchanged, failed);
    return failed == 0 ? 0 : 1;
}

int list_installed_skills(void) {
    Lockfile *lf = lockfile_load(LOCAL_AGENTS_DIR);
    if (lf->count == 0) {
        printf("No skills installed in this project (%s not found or empty)\n",
               lf->path);
        printf("Install with: rosie install <owner/repo>\n");
        lockfile_free(lf);
        return 0;
    }

    int use_color = isatty(fileno(stdout));
    printf("Installed skills (%s):\n", lf->path);
    for (int i = 0; i < lf->count; i++) {
        const LockEntry *e = &lf->entries[i];
        const char *name_open = use_color ? "\033[1;34m" : "";
        const char *name_close = use_color ? "\033[0m" : "";
        if (source_is_local(e->source)) {
            printf("  %s%s%s  %s  (linked)\n",
                   name_open, e->skill_name, name_close,
                   source_local_path(e->source));
        } else {
            printf("  %s%s%s  %s@%s  %s\n",
                   name_open, e->skill_name, name_close,
                   e->source, e->ref,
                   e->pinned ? "(pinned)" : "");
        }
    }
    lockfile_free(lf);
    return 0;
}
