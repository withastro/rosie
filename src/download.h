#ifndef SPM_DOWNLOAD_H
#define SPM_DOWNLOAD_H

#include <stddef.h>
#include <stdbool.h>

typedef struct {
    char *owner;
    char *repo;
    char *ref;            // Branch or tag, defaults to "main" if not given
    bool ref_explicit;    // true if user passed @ref; false if defaulted
    // Optional skill name embedded in the spec via "owner/repo#skill". Used
    // by reference installs to round-trip through the lockfile source field.
    // NULL when no #skill suffix was present.
    char *skill_in_spec;
    // For hand-authored skills checked into the same repo. When true, owner/
    // repo/ref are unused and local_path holds a "./<rel>" path relative to
    // the repo root.
    bool is_local;
    char *local_path;
} PackageSpec;

// Parse "owner/repo[#skill][@ref]" or a local path (starting with ./, ../, /,
// ~/, or equal to "."), or a "file://<rel-path>" lockfile source, into a
// PackageSpec.
PackageSpec *package_spec_parse(const char *spec);
void package_spec_free(PackageSpec *spec);

// Source-field helpers (operate on the lockfile's `source` column).
// A "file://" prefix marks an entry as a local symlinked skill rather than
// an owner/repo download.
bool source_is_local(const char *source);
const char *source_local_path(const char *source);

// "npm:<pkg>#<rel-path>" marks a reference symlinked from the user's
// node_modules/<pkg>/<rel-path>. <pkg> may include a "@scope/" prefix.
bool source_is_npm(const char *source);
const char *source_npm_after_prefix(const char *source);
// Split "npm:<pkg>#<file>" into freshly allocated <pkg> and <file>. Either
// out-pointer may be NULL. *file_out is left NULL when the source has no '#'.
void source_npm_split(const char *source, char **pkg_out, char **file_out);

typedef enum {
    REF_KIND_BRANCH,   // archive/refs/heads/<ref>.tar.gz
    REF_KIND_TAG,      // archive/refs/tags/<ref>.tar.gz
} RefKind;

// Build GitHub tarball URL from package spec for a specific ref kind
char *build_tarball_url(const PackageSpec *spec, RefKind kind);

// Download URL to a file, returns 0 on success
int download_file(const char *url, const char *output_path);

// Download a package tarball, trying branch first and falling back to tag on 404.
// Used when we don't yet know whether the ref names a branch or a tag.
int download_package_tarball(const PackageSpec *spec, const char *output_path);

// Initialize/cleanup curl (call once at program start/end)
int download_init(void);
void download_cleanup(void);

#endif // SPM_DOWNLOAD_H
