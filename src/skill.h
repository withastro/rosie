#ifndef SPM_SKILL_H
#define SPM_SKILL_H

#include <stdbool.h>

typedef struct {
    char *name;
    char *description;
    char *path;          // Full path to skill directory
    char *skill_file;    // Full path to SKILL.md
} Skill;

typedef struct {
    Skill *skills;
    int count;
    int capacity;
} SkillList;

// Find all skills in a directory (searches known paths)
SkillList *discover_skills(const char *base_dir);

// Parse SKILL.md frontmatter
Skill *parse_skill_file(const char *skill_md_path);

// Read a markdown file and return its body with the leading "---" YAML
// frontmatter block stripped (if any). Returns the full file contents when no
// frontmatter is present. NULL on read error. Caller frees.
char *skill_strip_yaml_frontmatter(const char *path);

// Free resources
void skill_free(Skill *skill);
void skill_list_free(SkillList *list);

// Print skill info
void skill_print(const Skill *skill);
void skill_list_print(const SkillList *list);

#endif // SPM_SKILL_H
