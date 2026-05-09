#include "skill.h"
#include "util.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <dirent.h>
#include <sys/stat.h>

// Directories to search for skills
static const char *SKILL_SEARCH_PATHS[] = {
    "skills",
    ".agents/skills",
    ".claude/skills",
    ".cursor/skills",
    ".cline/skills",
    ".codex/skills",
    NULL
};

static Skill *skill_alloc(void) {
    Skill *skill = spm_malloc(sizeof(Skill));
    skill->name = NULL;
    skill->description = NULL;
    skill->path = NULL;
    skill->skill_file = NULL;
    return skill;
}

void skill_free(Skill *skill) {
    if (!skill) return;
    spm_free(skill->name);
    spm_free(skill->description);
    spm_free(skill->path);
    spm_free(skill->skill_file);
    spm_free(skill);
}

void skill_list_free(SkillList *list) {
    if (!list) return;
    for (int i = 0; i < list->count; i++) {
        spm_free(list->skills[i].name);
        spm_free(list->skills[i].description);
        spm_free(list->skills[i].path);
        spm_free(list->skills[i].skill_file);
    }
    spm_free(list->skills);
    spm_free(list);
}

static void skill_list_add(SkillList *list, Skill *skill) {
    if (list->count >= list->capacity) {
        list->capacity = list->capacity == 0 ? 8 : list->capacity * 2;
        list->skills = spm_realloc(list->skills, list->capacity * sizeof(Skill));
    }
    list->skills[list->count++] = *skill;
    spm_free(skill);
}

// Parse YAML frontmatter from SKILL.md
// Format:
// ---
// name: skill-name
// description: Some description
// ---
Skill *parse_skill_file(const char *skill_md_path) {
    FILE *fp = fopen(skill_md_path, "r");
    if (!fp) {
        log_debug("Cannot open: %s", skill_md_path);
        return NULL;
    }

    Skill *skill = skill_alloc();
    char line[4096];
    bool in_frontmatter = false;
    bool found_frontmatter = false;

    while (fgets(line, sizeof(line), fp)) {
        char *trimmed = str_trim(line);

        if (strcmp(trimmed, "---") == 0) {
            if (!in_frontmatter) {
                in_frontmatter = true;
                continue;
            } else {
                // End of frontmatter
                found_frontmatter = true;
                break;
            }
        }

        if (in_frontmatter) {
            // Parse key: value
            char *colon = strchr(trimmed, ':');
            if (colon) {
                *colon = '\0';
                char *key = str_trim(trimmed);
                char *value = str_trim(colon + 1);

                // Remove quotes if present
                size_t vlen = strlen(value);
                if (vlen >= 2 && ((value[0] == '"' && value[vlen-1] == '"') ||
                                  (value[0] == '\'' && value[vlen-1] == '\''))) {
                    value[vlen-1] = '\0';
                    value++;
                }

                if (strcmp(key, "name") == 0) {
                    skill->name = str_dup(value);
                } else if (strcmp(key, "description") == 0) {
                    skill->description = str_dup(value);
                }
            }
        }
    }

    fclose(fp);

    if (!found_frontmatter || !skill->name) {
        // If no name in frontmatter, derive from directory name
        if (!skill->name) {
            // Get parent directory name
            char *path_copy = str_dup(skill_md_path);
            char *last_slash = strrchr(path_copy, '/');
            if (last_slash) {
                *last_slash = '\0';
                char *dir_slash = strrchr(path_copy, '/');
                if (dir_slash) {
                    skill->name = str_dup(dir_slash + 1);
                }
            }
            spm_free(path_copy);
        }
    }

    if (!skill->name) {
        skill_free(skill);
        return NULL;
    }

    skill->skill_file = str_dup(skill_md_path);

    // Set path to the directory containing SKILL.md
    char *path_copy = str_dup(skill_md_path);
    char *last_slash = strrchr(path_copy, '/');
    if (last_slash) {
        *last_slash = '\0';
        skill->path = path_copy;
    } else {
        skill->path = str_dup(".");
        spm_free(path_copy);
    }

    return skill;
}

// Read entire file into a freshly-allocated, NUL-terminated buffer.
// Returns NULL on any error.
static char *read_file_to_string(const char *path) {
    FILE *fp = fopen(path, "rb");
    if (!fp) return NULL;

    if (fseek(fp, 0, SEEK_END) != 0) {
        fclose(fp);
        return NULL;
    }
    long len = ftell(fp);
    if (len < 0) {
        fclose(fp);
        return NULL;
    }
    rewind(fp);

    char *buf = spm_malloc((size_t)len + 1);
    size_t read = fread(buf, 1, (size_t)len, fp);
    fclose(fp);
    buf[read] = '\0';
    return buf;
}

char *skill_strip_yaml_frontmatter(const char *path) {
    char *contents = read_file_to_string(path);
    if (!contents) return NULL;

    // Frontmatter must start with "---" on the first line (allow leading
    // whitespace? The skill parser doesn't, so we don't either).
    if (strncmp(contents, "---", 3) != 0 ||
        (contents[3] != '\n' && contents[3] != '\r')) {
        return contents;
    }

    // Find the closing "---" on its own line.
    char *p = contents + 3;
    while (*p == '\r' || *p == '\n') p++;

    while (*p) {
        char *line_start = p;
        char *line_end = strchr(p, '\n');
        size_t line_len = line_end ? (size_t)(line_end - line_start) : strlen(line_start);

        // Trim trailing \r for CRLF files.
        size_t check_len = line_len;
        if (check_len > 0 && line_start[check_len - 1] == '\r') check_len--;

        if (check_len == 3 && strncmp(line_start, "---", 3) == 0) {
            // Skip past the closing delimiter and any trailing newlines.
            char *body = line_end ? line_end + 1 : line_start + line_len;
            char *body_dup = str_dup(body);
            spm_free(contents);
            return body_dup;
        }

        if (!line_end) break;
        p = line_end + 1;
    }

    // Unterminated frontmatter — fall back to returning the original contents.
    log_debug("Unterminated frontmatter in %s", path);
    return contents;
}

// Check if a directory contains SKILL.md
static Skill *check_skill_dir(const char *dir_path) {
    char *skill_file = path_join(dir_path, "SKILL.md");
    Skill *skill = NULL;

    if (file_exists(skill_file)) {
        skill = parse_skill_file(skill_file);
    }

    spm_free(skill_file);
    return skill;
}

// Recursively search for SKILL.md files
static void find_skills_recursive(const char *base_dir, SkillList *list, int depth) {
    if (depth > 5) return;  // Limit recursion depth

    DIR *dir = opendir(base_dir);
    if (!dir) return;

    struct dirent *entry;

    while ((entry = readdir(dir)) != NULL) {
        if (entry->d_name[0] == '.') continue;  // Skip hidden files

        char *full_path = path_join(base_dir, entry->d_name);
        struct stat st;

        if (stat(full_path, &st) == 0 && S_ISDIR(st.st_mode)) {
            // Check if this directory contains SKILL.md
            Skill *skill = check_skill_dir(full_path);
            if (skill) {
                skill_list_add(list, skill);
            } else {
                // Recurse into subdirectory
                find_skills_recursive(full_path, list, depth + 1);
            }
        }

        spm_free(full_path);
    }

    closedir(dir);
}

SkillList *discover_skills(const char *base_dir) {
    SkillList *list = spm_malloc(sizeof(SkillList));
    list->skills = NULL;
    list->count = 0;
    list->capacity = 0;

    // Check root level first
    Skill *root_skill = check_skill_dir(base_dir);
    if (root_skill) {
        skill_list_add(list, root_skill);
    }

    // Check known skill paths
    for (int i = 0; SKILL_SEARCH_PATHS[i] != NULL; i++) {
        char *search_path = path_join(base_dir, SKILL_SEARCH_PATHS[i]);

        if (dir_exists(search_path)) {
            log_debug("Searching for skills in: %s", search_path);
            find_skills_recursive(search_path, list, 0);
        }

        spm_free(search_path);
    }

    // If nothing found in known paths, search from root
    if (list->count == 0) {
        log_debug("No skills in known paths, searching recursively from root");
        find_skills_recursive(base_dir, list, 0);
    }

    return list;
}

void skill_print(const Skill *skill) {
    if (!skill) return;

    // Use color if outputting to a terminal
    int use_color = isatty(fileno(stdout));

    if (use_color) {
        printf("  \033[1;34m%s\033[0m", skill->name);  // Bold blue
    } else {
        printf("  %s", skill->name);
    }

    if (skill->description) {
        printf(" - %s", skill->description);
    }
    printf("\n");
}

void skill_list_print(const SkillList *list) {
    if (!list || list->count == 0) {
        printf("  (no skills found)\n");
        return;
    }

    for (int i = 0; i < list->count; i++) {
        skill_print(&list->skills[i]);
    }
}
