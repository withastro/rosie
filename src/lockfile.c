#include "lockfile.h"
#include "util.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

#define LOCKFILE_NAME "rosie.lock"
#define LOCKFILE_LINE_MAX 2048
#define LOCKFILE_VERSION 1

static void lock_entry_free(LockEntry *e) {
    if (!e) return;
    spm_free(e->skill_name);
    spm_free(e->source);
    spm_free(e->ref);
    spm_free(e->sha);
    spm_free(e->installed_at);
    e->skill_name = NULL;
    e->source = NULL;
    e->ref = NULL;
    e->sha = NULL;
    e->installed_at = NULL;
}

void lockfile_free(Lockfile *lf) {
    if (!lf) return;
    for (int i = 0; i < lf->count; i++) {
        lock_entry_free(&lf->entries[i]);
    }
    spm_free(lf->entries);
    spm_free(lf->path);
    spm_free(lf);
}

static void lockfile_grow(Lockfile *lf) {
    if (lf->count < lf->capacity) return;
    int new_cap = lf->capacity == 0 ? 8 : lf->capacity * 2;
    lf->entries = spm_realloc(lf->entries, new_cap * sizeof(LockEntry));
    lf->capacity = new_cap;
}

Lockfile *lockfile_load(const char *dir) {
    Lockfile *lf = spm_malloc(sizeof(Lockfile));
    lf->entries = NULL;
    lf->count = 0;
    lf->capacity = 0;
    lf->path = path_join(dir, LOCKFILE_NAME);

    FILE *fp = fopen(lf->path, "r");
    if (!fp) {
        // Missing file is fine — return empty lockfile
        return lf;
    }

    char line[LOCKFILE_LINE_MAX];
    while (fgets(line, sizeof(line), fp)) {
        char *trimmed = str_trim(line);
        if (trimmed[0] == '\0' || trimmed[0] == '#') continue;

        char skill_name[256], source[1024], ref[256], sha[64], ts[64], pin[16], kind[16];
        pin[0] = '\0';
        kind[0] = '\0';
        int n = sscanf(trimmed, "%255s %1023s %255s %63s %63s %15s %15s",
                       skill_name, source, ref, sha, ts, pin, kind);
        if (n < 5) {
            log_debug("Skipping malformed lockfile line: %s", trimmed);
            continue;
        }

        lockfile_grow(lf);
        LockEntry *e = &lf->entries[lf->count++];
        e->skill_name = str_dup(skill_name);
        e->source = str_dup(source);
        e->ref = str_dup(ref);
        e->sha = str_dup(sha);
        e->installed_at = str_dup(ts);
        // Pinned flag is optional for backwards compat; default to false (auto).
        e->pinned = (n >= 6) && (strcmp(pin, "pin") == 0);
        // Kind is optional (legacy v0 lockfiles have no 7th field). Default to skill.
        e->kind = (n >= 7 && strcmp(kind, "ref") == 0) ? LOCK_REF : LOCK_SKILL;
    }

    fclose(fp);
    return lf;
}

static int lock_entry_cmp(const void *a, const void *b) {
    const LockEntry *ea = (const LockEntry *)a;
    const LockEntry *eb = (const LockEntry *)b;
    return strcmp(ea->skill_name, eb->skill_name);
}

int lockfile_save(const Lockfile *lf) {
    if (!lf || !lf->path) return -1;

    // Sort for stable diffs. The cast away from const is safe — we only reorder
    // entries, not their string contents, and the array is owned by lf.
    if (lf->count > 1) {
        qsort(lf->entries, lf->count, sizeof(LockEntry), lock_entry_cmp);
    }

    size_t tmp_len = strlen(lf->path) + 5;
    char *tmp_path = spm_malloc(tmp_len);
    snprintf(tmp_path, tmp_len, "%s.tmp", lf->path);

    FILE *fp = fopen(tmp_path, "w");
    if (!fp) {
        log_error("Cannot create lockfile: %s", tmp_path);
        spm_free(tmp_path);
        return -1;
    }

    fprintf(fp, "# rosie-lock v%d\n", LOCKFILE_VERSION);

    for (int i = 0; i < lf->count; i++) {
        const LockEntry *e = &lf->entries[i];
        fprintf(fp, "%s %s %s %s %s %s %s\n",
                e->skill_name, e->source, e->ref, e->sha, e->installed_at,
                e->pinned ? "pin" : "auto",
                e->kind == LOCK_REF ? "ref" : "skill");
    }

    if (fclose(fp) != 0) {
        log_error("Failed writing lockfile: %s", tmp_path);
        unlink(tmp_path);
        spm_free(tmp_path);
        return -1;
    }

    if (rename(tmp_path, lf->path) != 0) {
        log_error("Cannot finalize lockfile: %s", lf->path);
        unlink(tmp_path);
        spm_free(tmp_path);
        return -1;
    }

    spm_free(tmp_path);
    return 0;
}

LockEntry *lockfile_find(const Lockfile *lf, const char *skill_name) {
    if (!lf || !skill_name) return NULL;
    for (int i = 0; i < lf->count; i++) {
        if (strcmp(lf->entries[i].skill_name, skill_name) == 0) {
            return &lf->entries[i];
        }
    }
    return NULL;
}

void lockfile_upsert(Lockfile *lf, const char *skill_name, const char *source,
                     const char *ref, const char *sha, const char *installed_at,
                     bool pinned, LockKind kind) {
    if (!lf || !skill_name) return;

    LockEntry *e = lockfile_find(lf, skill_name);
    if (e) {
        spm_free(e->source);
        spm_free(e->ref);
        spm_free(e->sha);
        spm_free(e->installed_at);
        e->source = str_dup(source);
        e->ref = str_dup(ref);
        e->sha = str_dup(sha);
        e->installed_at = str_dup(installed_at);
        e->pinned = pinned;
        e->kind = kind;
        return;
    }

    lockfile_grow(lf);
    e = &lf->entries[lf->count++];
    e->skill_name = str_dup(skill_name);
    e->source = str_dup(source);
    e->ref = str_dup(ref);
    e->sha = str_dup(sha);
    e->installed_at = str_dup(installed_at);
    e->pinned = pinned;
    e->kind = kind;
}

int lockfile_remove_entry(Lockfile *lf, const char *skill_name) {
    if (!lf || !skill_name) return 0;
    for (int i = 0; i < lf->count; i++) {
        if (strcmp(lf->entries[i].skill_name, skill_name) == 0) {
            lock_entry_free(&lf->entries[i]);
            for (int j = i; j < lf->count - 1; j++) {
                lf->entries[j] = lf->entries[j + 1];
            }
            lf->count--;
            return 1;
        }
    }
    return 0;
}

char *lockfile_now_iso8601(void) {
    time_t now = time(NULL);
    struct tm tm_utc;
    gmtime_r(&now, &tm_utc);
    char *buf = spm_malloc(32);
    strftime(buf, 32, "%Y-%m-%dT%H:%M:%SZ", &tm_utc);
    return buf;
}
