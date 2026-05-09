#include "agentsmd.h"
#include "util.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/stat.h>

#define LOCAL_REFERENCES_DIR ".agents/references"
#define BLOCK_START "<!-- rosie:references:start -->"
#define BLOCK_END   "<!-- rosie:references:end -->"

const char *agentsmd_target_path(void) {
    if (file_exists("AGENTS.md")) return "AGENTS.md";
    if (file_exists("CLAUDE.md")) return "CLAUDE.md";
    return "AGENTS.md";
}

// Read file into NUL-terminated buffer; returns NULL on any failure (including
// missing file, treated as empty by the caller).
static char *read_file(const char *path) {
    FILE *fp = fopen(path, "rb");
    if (!fp) return NULL;

    if (fseek(fp, 0, SEEK_END) != 0) { fclose(fp); return NULL; }
    long len = ftell(fp);
    if (len < 0) { fclose(fp); return NULL; }
    rewind(fp);

    char *buf = spm_malloc((size_t)len + 1);
    size_t got = fread(buf, 1, (size_t)len, fp);
    fclose(fp);
    buf[got] = '\0';
    return buf;
}

char *agentsmd_extract_first_h1(const char *markdown_path) {
    FILE *fp = fopen(markdown_path, "r");
    if (!fp) return NULL;

    char line[4096];
    bool in_frontmatter = false;
    bool seen_first = false;
    char *result = NULL;

    while (fgets(line, sizeof(line), fp)) {
        // Trim trailing newline / CR for delimiter and prefix checks.
        size_t len = strlen(line);
        while (len > 0 && (line[len-1] == '\n' || line[len-1] == '\r')) {
            line[--len] = '\0';
        }

        // YAML frontmatter delimiter handling — only treat the first "---" as
        // an opener if it sits on the very first line.
        if (strcmp(line, "---") == 0) {
            if (!seen_first) {
                in_frontmatter = true;
                seen_first = true;
                continue;
            }
            if (in_frontmatter) {
                in_frontmatter = false;
                continue;
            }
        }
        seen_first = true;
        if (in_frontmatter) continue;

        if (line[0] == '#' && line[1] == ' ') {
            char *title = line + 2;
            // Trim leading spaces in case of "#   Title".
            while (*title == ' ' || *title == '\t') title++;
            // Trim trailing whitespace.
            size_t tlen = strlen(title);
            while (tlen > 0 && (title[tlen-1] == ' ' || title[tlen-1] == '\t')) {
                title[--tlen] = '\0';
            }
            if (tlen > 0) {
                result = str_dup(title);
            }
            break;
        }
    }

    fclose(fp);
    return result;
}

static int sort_by_name(const void *a, const void *b) {
    const LockEntry *const *ea = a;
    const LockEntry *const *eb = b;
    return strcmp((*ea)->skill_name, (*eb)->skill_name);
}

// Build the block contents (everything between markers, exclusive) for the
// current set of ref entries. Returns malloc'd string, or NULL when there are
// no refs (signals "remove the block entirely").
static char *build_block_body(const Lockfile *lf) {
    int ref_count = 0;
    for (int i = 0; i < lf->count; i++) {
        if (lf->entries[i].kind == LOCK_REF) ref_count++;
    }
    if (ref_count == 0) return NULL;

    const LockEntry **refs = spm_malloc((size_t)ref_count * sizeof(LockEntry *));
    int idx = 0;
    for (int i = 0; i < lf->count; i++) {
        if (lf->entries[i].kind == LOCK_REF) refs[idx++] = &lf->entries[i];
    }
    qsort(refs, ref_count, sizeof(LockEntry *), sort_by_name);

    // Capacity grows as we append; start with a sensible initial size.
    size_t cap = 256;
    size_t pos = 0;
    char *out = spm_malloc(cap);
    out[0] = '\0';

    #define APPEND(fmt, ...) do { \
        int needed = snprintf(NULL, 0, fmt, ##__VA_ARGS__); \
        if (needed < 0) break; \
        if (pos + (size_t)needed + 1 > cap) { \
            while (pos + (size_t)needed + 1 > cap) cap *= 2; \
            out = spm_realloc(out, cap); \
        } \
        snprintf(out + pos, cap - pos, fmt, ##__VA_ARGS__); \
        pos += (size_t)needed; \
    } while (0)

    APPEND("%s", "<references>\n");
    for (int i = 0; i < ref_count; i++) {
        const LockEntry *e = refs[i];
        char *ref_md = path_join(LOCAL_REFERENCES_DIR, e->skill_name);
        char *ref_file = path_join(ref_md, "REFERENCE.md");
        char *title = agentsmd_extract_first_h1(ref_file);
        const char *display_title = (title && title[0]) ? title : e->skill_name;
        APPEND("- [%s](./%s)\n", display_title, ref_file);
        spm_free(title);
        spm_free(ref_md);
        spm_free(ref_file);
    }
    APPEND("%s", "</references>");

    #undef APPEND

    spm_free(refs);
    return out;
}

// Atomic write: target.tmp -> rename to target.
static int atomic_write(const char *target, const char *contents, size_t len) {
    size_t tmp_len = strlen(target) + 5;
    char *tmp_path = spm_malloc(tmp_len);
    snprintf(tmp_path, tmp_len, "%s.tmp", target);

    FILE *fp = fopen(tmp_path, "wb");
    if (!fp) {
        log_error("Cannot create %s", tmp_path);
        spm_free(tmp_path);
        return -1;
    }
    if (fwrite(contents, 1, len, fp) != len) {
        log_error("Failed writing %s", tmp_path);
        fclose(fp);
        unlink(tmp_path);
        spm_free(tmp_path);
        return -1;
    }
    if (fclose(fp) != 0) {
        unlink(tmp_path);
        spm_free(tmp_path);
        return -1;
    }
    if (rename(tmp_path, target) != 0) {
        log_error("Cannot finalize %s", target);
        unlink(tmp_path);
        spm_free(tmp_path);
        return -1;
    }
    spm_free(tmp_path);
    return 0;
}

int agentsmd_rebuild_block(const Lockfile *lf) {
    if (!lf) return -1;

    const char *target = agentsmd_target_path();
    char *existing = read_file(target);
    bool created = (existing == NULL);
    if (!existing) existing = str_dup("");

    char *body = build_block_body(lf);  // NULL when ref_count == 0
    bool want_block = (body != NULL);

    char *start_marker = strstr(existing, BLOCK_START);
    char *end_marker = strstr(existing, BLOCK_END);

    // Defensive: lone start without a matching end means a hand-edit broke the
    // block. Refuse to rewrite rather than nuke the rest of the file.
    if (start_marker && !end_marker) {
        log_error("Found %s without matching %s in %s; skipping rebuild",
                  BLOCK_START, BLOCK_END, target);
        spm_free(existing);
        spm_free(body);
        return -1;
    }

    // Compose the replacement / new contents.
    size_t new_cap = strlen(existing) + (body ? strlen(body) : 0) + 256;
    char *out = spm_malloc(new_cap);
    size_t out_len = 0;

    if (start_marker && end_marker) {
        // Replace the existing block (between markers, inclusive).
        size_t prefix_len = (size_t)(start_marker - existing);
        memcpy(out, existing, prefix_len);
        out_len = prefix_len;

        if (want_block) {
            int n = snprintf(out + out_len, new_cap - out_len,
                             "%s\n%s\n%s",
                             BLOCK_START, body, BLOCK_END);
            out_len += (size_t)n;
        } else {
            // No refs left: remove the block. Trim any single preceding blank
            // line we inserted on first write so we don't leave a trail of
            // empty lines on repeated install/remove cycles.
            if (out_len >= 2 && out[out_len-1] == '\n' && out[out_len-2] == '\n') {
                out_len--;
            }
        }

        const char *suffix = end_marker + strlen(BLOCK_END);
        size_t suffix_len = strlen(suffix);
        if (out_len + suffix_len + 1 > new_cap) {
            new_cap = out_len + suffix_len + 1;
            out = spm_realloc(out, new_cap);
        }
        memcpy(out + out_len, suffix, suffix_len);
        out_len += suffix_len;
    } else if (want_block) {
        // Append a fresh block. Ensure separation from existing content.
        size_t existing_len = strlen(existing);
        memcpy(out, existing, existing_len);
        out_len = existing_len;

        if (existing_len > 0 && out[out_len-1] != '\n') {
            out[out_len++] = '\n';
        }
        if (existing_len > 0) {
            out[out_len++] = '\n';
        }
        int n = snprintf(out + out_len, new_cap - out_len,
                         "%s\n%s\n%s\n",
                         BLOCK_START, body, BLOCK_END);
        out_len += (size_t)n;
    } else {
        // No block to write and none exists. Don't touch the file (or in the
        // created==true case, don't create an empty file).
        spm_free(out);
        spm_free(existing);
        spm_free(body);
        return 0;
    }

    int rc = atomic_write(target, out, out_len);
    if (rc == 0 && created) {
        log_info("Created %s with references block", target);
    }

    spm_free(out);
    spm_free(existing);
    spm_free(body);
    return rc;
}
