#include "install.h"
#include "download.h"
#include "archive.h"
#include "skill.h"
#include "agent.h"
#include "util.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <dirent.h>
#include <sys/stat.h>

// Local install storage directory
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

    log_info("Installing %s/%s...", spec->owner, spec->repo);

    // Build download URL
    char *url = build_tarball_url(spec);
    log_debug("Tarball URL: %s", url);

    // Create temp directory
    char *temp_dir = create_temp_dir();
    if (!temp_dir) {
        spm_free(url);
        package_spec_free(spec);
        return -1;
    }

    // Download tarball
    char *tarball_path = path_join(temp_dir, "package.tar.gz");
    log_info("Downloading...");

    if (download_file(url, tarball_path) != 0) {
        log_error("Failed to download package");
        spm_free(url);
        spm_free(tarball_path);
        remove_dir_recursive(temp_dir);
        spm_free(temp_dir);
        package_spec_free(spec);
        return -1;
    }

    spm_free(url);

    // Extract tarball
    log_info("Extracting...");
    if (extract_tarball(tarball_path, temp_dir) != 0) {
        log_error("Failed to extract package");
        spm_free(tarball_path);
        remove_dir_recursive(temp_dir);
        spm_free(temp_dir);
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
        // Local install: copy to .agents/skills/, symlink to each agent
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
            spm_free(canonical);
        }
        log_info("Installed %d skill(s) via symlinks.", installed);
    }

    // Cleanup
    agent_list_free(agents);
    skill_list_free(skills);
    spm_free(extracted_path);
    remove_dir_recursive(temp_dir);
    spm_free(temp_dir);
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

    agent_list_free(agents);
    return 0;
}
