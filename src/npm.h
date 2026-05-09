#ifndef SPM_NPM_H
#define SPM_NPM_H

typedef struct {
    char *rel_path;  // relative to the package root, e.g. "README.md" or "docs/hooks.md"
} NpmFile;

typedef struct {
    NpmFile *files;
    int count;
    int capacity;
} NpmFileList;

void npm_file_list_free(NpmFileList *list);

// Walk pkg_root for .md files. When include_count == 0, applies the default
// scope: README.md (case-insensitive) at the package root, plus a recursive
// scan of docs/ for any *.md files. When include_count > 0, each include
// path is interpreted relative to pkg_root: paths ending in ".md" are exact
// file matches, anything else is treated as a directory and walked
// recursively for *.md. Recursive walks always exclude nested node_modules
// directories. Results are deduplicated by relative path.
//
// Returns an empty (but non-NULL) list when nothing matches. Caller frees.
NpmFileList *npm_collect_files(const char *pkg_root,
                               const char **include_paths,
                               int include_count);

// Slug helpers. All return malloc'd strings.
char *npm_pkg_slug(const char *pkg);                                 // "@tanstack/react-query" -> "tanstack-react-query"
char *npm_file_slug(const char *rel_path);                           // "docs/hooks.md" -> "docs-hooks", "README.md" -> "readme"
char *npm_ref_name(const char *pkg, const char *rel_path);           // "<pkg-slug>-<file-slug>"

#endif // SPM_NPM_H
