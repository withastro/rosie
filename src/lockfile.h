#ifndef SPM_LOCKFILE_H
#define SPM_LOCKFILE_H

#include <stdbool.h>

typedef enum {
    LOCK_SKILL = 0,
    LOCK_REF = 1,
} LockKind;

typedef struct {
    char *skill_name;
    char *source;        // "owner/repo" or "owner/repo#skill" for ref-from-skill
    char *ref;           // tag, branch, or "-" for raw commit
    char *sha;           // 40 hex chars or "-" if unknown
    char *installed_at;  // ISO 8601 UTC, e.g. "2026-05-02T14:32:18Z"
    bool pinned;         // true if installed with explicit @ref; false if auto-resolved
    LockKind kind;       // LOCK_SKILL (default for legacy v0 entries) or LOCK_REF
} LockEntry;

typedef struct {
    LockEntry *entries;
    int count;
    int capacity;
    char *path;          // e.g. ".agents/rosie.lock"
} Lockfile;

// Load lockfile at <dir>/rosie.lock. Returns an empty lockfile if the file
// is missing. Caller must lockfile_free() the result.
Lockfile *lockfile_load(const char *dir);

// Save lockfile atomically (write to .tmp, then rename). Entries are emitted
// sorted by skill_name for stable diffs. Returns 0 on success.
int lockfile_save(const Lockfile *lf);

// Insert or replace entry for skill_name. All string args are duplicated.
void lockfile_upsert(Lockfile *lf, const char *skill_name, const char *source,
                     const char *ref, const char *sha, const char *installed_at,
                     bool pinned, LockKind kind);

// Remove entry by skill_name. Returns 1 if removed, 0 if not present.
int lockfile_remove_entry(Lockfile *lf, const char *skill_name);

// Find entry by skill_name. Returned pointer is owned by the lockfile.
LockEntry *lockfile_find(const Lockfile *lf, const char *skill_name);

void lockfile_free(Lockfile *lf);

// Current UTC time as ISO 8601 ("2026-05-02T14:32:18Z"). Caller frees.
char *lockfile_now_iso8601(void);

#endif // SPM_LOCKFILE_H
