#include "npm.h"
#include "util.h"
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <dirent.h>
#include <sys/stat.h>

#define MAX_WALK_DEPTH 16

void npm_file_list_free(NpmFileList *list) {
    if (!list) return;
    for (int i = 0; i < list->count; i++) {
        spm_free(list->files[i].rel_path);
    }
    spm_free(list->files);
    spm_free(list);
}

static NpmFileList *npm_file_list_new(void) {
    NpmFileList *l = spm_malloc(sizeof(NpmFileList));
    l->files = NULL;
    l->count = 0;
    l->capacity = 0;
    return l;
}

// True if rel_path is already in list.
static bool list_contains(const NpmFileList *l, const char *rel_path) {
    for (int i = 0; i < l->count; i++) {
        if (strcmp(l->files[i].rel_path, rel_path) == 0) return true;
    }
    return false;
}

static void list_add(NpmFileList *l, const char *rel_path) {
    if (list_contains(l, rel_path)) return;
    if (l->count >= l->capacity) {
        l->capacity = l->capacity == 0 ? 8 : l->capacity * 2;
        l->files = spm_realloc(l->files, (size_t)l->capacity * sizeof(NpmFile));
    }
    l->files[l->count].rel_path = str_dup(rel_path);
    l->count++;
}

// Recursive walker: append every *.md under <pkg_root>/<rel_prefix> (excluding
// nested node_modules) to out, with the path stored relative to pkg_root.
static void walk_for_md(const char *pkg_root, const char *rel_prefix,
                        NpmFileList *out, int depth) {
    if (depth > MAX_WALK_DEPTH) return;

    char *abs_dir = rel_prefix[0] ? path_join(pkg_root, rel_prefix)
                                  : str_dup(pkg_root);
    DIR *dir = opendir(abs_dir);
    if (!dir) {
        spm_free(abs_dir);
        return;
    }

    struct dirent *entry;
    while ((entry = readdir(dir)) != NULL) {
        const char *name = entry->d_name;
        if (strcmp(name, ".") == 0 || strcmp(name, "..") == 0) continue;
        // Always skip nested node_modules.
        if (strcmp(name, "node_modules") == 0) continue;

        char *child_abs = path_join(abs_dir, name);
        char *child_rel = rel_prefix[0] ? path_join(rel_prefix, name)
                                        : str_dup(name);

        struct stat st;
        if (lstat(child_abs, &st) == 0) {
            if (S_ISDIR(st.st_mode)) {
                walk_for_md(pkg_root, child_rel, out, depth + 1);
            } else if (S_ISREG(st.st_mode) && str_ends_with(name, ".md")) {
                list_add(out, child_rel);
            }
        }

        spm_free(child_abs);
        spm_free(child_rel);
    }

    closedir(dir);
    spm_free(abs_dir);
}

// Case-insensitive lookup for README.md (or readme.md, Readme.md, etc.) at
// the package root. Returns the actual filename as malloc'd string, or NULL.
static char *find_readme(const char *pkg_root) {
    DIR *dir = opendir(pkg_root);
    if (!dir) return NULL;

    char *match = NULL;
    struct dirent *entry;
    while ((entry = readdir(dir)) != NULL) {
        const char *n = entry->d_name;
        // Lowercase comparison against "readme.md".
        size_t len = strlen(n);
        if (len != 9) continue;
        char buf[10];
        for (size_t i = 0; i < len; i++) buf[i] = (char)tolower((unsigned char)n[i]);
        buf[len] = '\0';
        if (strcmp(buf, "readme.md") != 0) continue;

        char *full = path_join(pkg_root, n);
        struct stat st;
        if (stat(full, &st) == 0 && S_ISREG(st.st_mode)) {
            match = str_dup(n);
            spm_free(full);
            break;
        }
        spm_free(full);
    }
    closedir(dir);
    return match;
}

NpmFileList *npm_collect_files(const char *pkg_root,
                               const char **include_paths,
                               int include_count) {
    NpmFileList *out = npm_file_list_new();
    if (!pkg_root) return out;

    if (include_count > 0) {
        for (int i = 0; i < include_count; i++) {
            const char *inc = include_paths[i];
            if (!inc || !inc[0]) continue;

            char *abs = path_join(pkg_root, inc);
            struct stat st;
            if (lstat(abs, &st) != 0) {
                log_info("warning: --include path not found in package: %s", inc);
                spm_free(abs);
                continue;
            }
            if (S_ISREG(st.st_mode)) {
                if (str_ends_with(inc, ".md")) {
                    list_add(out, inc);
                } else {
                    log_info("warning: --include file is not a .md file: %s", inc);
                }
            } else if (S_ISDIR(st.st_mode)) {
                walk_for_md(pkg_root, inc, out, 0);
            }
            spm_free(abs);
        }
        return out;
    }

    // Default scope: README + docs/**.md
    char *readme = find_readme(pkg_root);
    if (readme) {
        list_add(out, readme);
        spm_free(readme);
    }

    char *docs_abs = path_join(pkg_root, "docs");
    if (dir_exists(docs_abs)) {
        walk_for_md(pkg_root, "docs", out, 0);
    }
    spm_free(docs_abs);

    return out;
}

char *npm_pkg_slug(const char *pkg) {
    if (!pkg) return NULL;
    const char *p = pkg;
    if (*p == '@') p++;  // drop leading @ for scoped packages
    size_t len = strlen(p);
    char *out = spm_malloc(len + 1);
    for (size_t i = 0; i < len; i++) {
        char c = p[i];
        out[i] = (c == '/') ? '-' : (char)tolower((unsigned char)c);
    }
    out[len] = '\0';
    return out;
}

char *npm_file_slug(const char *rel_path) {
    if (!rel_path) return NULL;
    size_t len = strlen(rel_path);
    // Strip ".md" if present.
    if (len > 3 && strcmp(rel_path + len - 3, ".md") == 0) len -= 3;
    char *out = spm_malloc(len + 1);
    for (size_t i = 0; i < len; i++) {
        char c = rel_path[i];
        out[i] = (c == '/') ? '-' : (char)tolower((unsigned char)c);
    }
    out[len] = '\0';
    return out;
}

char *npm_ref_name(const char *pkg, const char *rel_path) {
    char *p = npm_pkg_slug(pkg);
    char *f = npm_file_slug(rel_path);
    size_t len = strlen(p) + 1 + strlen(f) + 1;
    char *out = spm_malloc(len);
    snprintf(out, len, "%s-%s", p, f);
    spm_free(p);
    spm_free(f);
    return out;
}
