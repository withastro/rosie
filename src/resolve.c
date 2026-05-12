#include "resolve.h"
#include "util.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifndef __EMSCRIPTEN__
#include <curl/curl.h>
#endif

// Returns the GitHub base URL (no trailing slash). Defaults to
// "https://github.com" but can be overridden via the ROSIE_GITHUB_BASE_URL
// env var. Used by the regression test suite to point rosie at a local
// mock server.
static const char *github_base_url(void) {
    const char *env = getenv("ROSIE_GITHUB_BASE_URL");
    return (env && *env) ? env : "https://github.com";
}

// --- in-memory fetch target ---

typedef struct {
    char *data;
    size_t size;
    size_t capacity;
} MemBuf;

#ifndef __EMSCRIPTEN__
static size_t mem_write_cb(void *contents, size_t size, size_t nmemb, void *userp) {
    MemBuf *buf = (MemBuf *)userp;
    size_t chunk = size * nmemb;
    if (buf->size + chunk + 1 > buf->capacity) {
        size_t new_cap = buf->capacity == 0 ? 8192 : buf->capacity * 2;
        while (new_cap < buf->size + chunk + 1) new_cap *= 2;
        buf->data = spm_realloc(buf->data, new_cap);
        buf->capacity = new_cap;
    }
    memcpy(buf->data + buf->size, contents, chunk);
    buf->size += chunk;
    buf->data[buf->size] = '\0';
    return chunk;
}

// Fetch the smart-HTTP refs advertisement. Returns 0 on success.
// On success, *out is filled and the caller frees out->data.
static int fetch_refs(const char *owner, const char *repo, MemBuf *out) {
    char url[1024];
    snprintf(url, sizeof(url),
             "%s/%s/%s/info/refs?service=git-upload-pack",
             github_base_url(), owner, repo);

    CURL *curl = curl_easy_init();
    if (!curl) return -1;

    struct curl_slist *headers = NULL;
    headers = curl_slist_append(headers,
        "Accept: application/x-git-upload-pack-advertisement");

    out->data = NULL;
    out->size = 0;
    out->capacity = 0;

    log_debug("Fetching refs: %s", url);
    curl_easy_setopt(curl, CURLOPT_URL, url);
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, mem_write_cb);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, out);
    curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);
    // Some servers gate smart-HTTP on a git-shaped User-Agent.
    curl_easy_setopt(curl, CURLOPT_USERAGENT, "git/rosie-1.0");
    curl_easy_setopt(curl, CURLOPT_FAILONERROR, 1L);

    if (g_verbose) {
        curl_easy_setopt(curl, CURLOPT_VERBOSE, 1L);
    }

    CURLcode res = curl_easy_perform(curl);
    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    if (res != CURLE_OK) {
        log_debug("info/refs fetch failed: %s", curl_easy_strerror(res));
        spm_free(out->data);
        out->data = NULL;
        return -1;
    }
    return 0;
}
#else
// WASM: dispatches through wasm_fetch_to_buffer (implemented in wasm/http-lib.js).
extern int wasm_fetch_to_buffer(const char *url, const char *accept_header,
                                char **out_buf, size_t *out_len);

static int fetch_refs(const char *owner, const char *repo, MemBuf *out) {
    char url[1024];
    snprintf(url, sizeof(url),
             "%s/%s/%s/info/refs?service=git-upload-pack",
             github_base_url(), owner, repo);

    out->data = NULL;
    out->size = 0;
    out->capacity = 0;

    log_debug("Fetching refs: %s", url);
    int status = wasm_fetch_to_buffer(url,
        "application/x-git-upload-pack-advertisement",
        &out->data, &out->size);
    if (status < 0) {
        log_debug("info/refs fetch failed: transport error");
        return -1;
    }
    if (status >= 400) {
        log_debug("info/refs fetch failed: HTTP %d", status);
        return -1;
    }
    out->capacity = out->size;
    return 0;
}
#endif // __EMSCRIPTEN__

// --- pkt-line parsing ---

typedef struct {
    char sha[41];   // null-terminated 40-char hex
    char *name;     // refs/heads/foo, refs/tags/v1.0.0, refs/tags/v1.0.0^{}
} RawRef;

typedef struct {
    RawRef *refs;
    int count;
    int capacity;
} RawRefList;

static void raw_ref_list_free(RawRefList *list) {
    if (!list) return;
    for (int i = 0; i < list->count; i++) {
        spm_free(list->refs[i].name);
    }
    spm_free(list->refs);
    spm_free(list);
}

static int hex_value(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

static int parse_pkt_len(const char *p) {
    int v = 0;
    for (int i = 0; i < 4; i++) {
        int h = hex_value(p[i]);
        if (h < 0) return -1;
        v = v * 16 + h;
    }
    return v;
}

static RawRefList *parse_refs(const char *body, size_t body_len) {
    RawRefList *list = spm_malloc(sizeof(RawRefList));
    list->refs = NULL;
    list->count = 0;
    list->capacity = 0;

    size_t pos = 0;
    while (pos + 4 <= body_len) {
        int len = parse_pkt_len(body + pos);
        if (len < 0) {
            log_debug("Malformed pkt-line at offset %zu", pos);
            raw_ref_list_free(list);
            return NULL;
        }
        if (len == 0) {
            // Flush packet
            pos += 4;
            continue;
        }
        if (len < 4 || pos + (size_t)len > body_len) {
            log_debug("Bad pkt length %d at offset %zu", len, pos);
            raw_ref_list_free(list);
            return NULL;
        }

        const char *data = body + pos + 4;
        size_t data_len = (size_t)len - 4;
        pos += (size_t)len;

        // Strip trailing newline.
        while (data_len > 0 && (data[data_len - 1] == '\n' || data[data_len - 1] == '\r')) {
            data_len--;
        }

        // Skip the service header line.
        if (data_len > 0 && data[0] == '#') continue;

        // Capabilities follow a NUL byte on the first ref line.
        size_t effective = data_len;
        for (size_t i = 0; i < data_len; i++) {
            if (data[i] == '\0') {
                effective = i;
                break;
            }
        }

        // Format: "<40-hex-sha> <ref-name>"
        if (effective < 42) continue;
        if (data[40] != ' ') continue;
        bool sha_ok = true;
        for (int i = 0; i < 40; i++) {
            if (hex_value(data[i]) < 0) { sha_ok = false; break; }
        }
        if (!sha_ok) continue;

        if (list->count >= list->capacity) {
            int new_cap = list->capacity == 0 ? 32 : list->capacity * 2;
            list->refs = spm_realloc(list->refs, (size_t)new_cap * sizeof(RawRef));
            list->capacity = new_cap;
        }
        RawRef *r = &list->refs[list->count++];
        memcpy(r->sha, data, 40);
        r->sha[40] = '\0';
        size_t name_len = effective - 41;
        r->name = spm_malloc(name_len + 1);
        memcpy(r->name, data + 41, name_len);
        r->name[name_len] = '\0';
    }

    return list;
}

// --- semver parsing ---

typedef struct {
    int major, minor, patch;
    bool has_prerelease;
} SemVer;

// Accept "1.2.3", "v1.2.3", optionally followed by "-..." (prerelease) or "+..." (build).
// Reject anything else (e.g. "1.2", "v1", "release-2026").
static int parse_semver(const char *s, SemVer *out) {
    if (!s || !out) return -1;
    if (s[0] == 'v' || s[0] == 'V') s++;

    out->major = out->minor = out->patch = 0;
    out->has_prerelease = false;

    char *end;
    long n;

    n = strtol(s, &end, 10);
    if (end == s || *end != '.') return -1;
    out->major = (int)n;
    s = end + 1;

    n = strtol(s, &end, 10);
    if (end == s || *end != '.') return -1;
    out->minor = (int)n;
    s = end + 1;

    n = strtol(s, &end, 10);
    if (end == s) return -1;
    out->patch = (int)n;

    if (*end == '\0') return 0;
    if (*end == '-') { out->has_prerelease = true; return 0; }
    if (*end == '+') return 0;
    return -1;
}

static int semver_cmp(const SemVer *a, const SemVer *b) {
    if (a->major != b->major) return a->major - b->major;
    if (a->minor != b->minor) return a->minor - b->minor;
    if (a->patch != b->patch) return a->patch - b->patch;
    // Prereleases sort below their corresponding release (semver §11).
    if (a->has_prerelease != b->has_prerelease) return a->has_prerelease ? -1 : 1;
    return 0;
}

// --- helpers ---

// For an annotated tag, the peeled commit SHA is exposed as "<ref>^{}".
// Return the peeled SHA if present, else the tag's own SHA.
static const char *peeled_sha_for(const RawRefList *refs, int tag_idx) {
    char peeled[512];
    snprintf(peeled, sizeof(peeled), "%s^{}", refs->refs[tag_idx].name);
    for (int i = 0; i < refs->count; i++) {
        if (strcmp(refs->refs[i].name, peeled) == 0) {
            return refs->refs[i].sha;
        }
    }
    return refs->refs[tag_idx].sha;
}

// --- public API ---

ResolvedRef *resolve_latest_tag(const PackageSpec *spec) {
    if (!spec) return NULL;

    MemBuf body;
    if (fetch_refs(spec->owner, spec->repo, &body) != 0) {
        return NULL;
    }
    RawRefList *refs = parse_refs(body.data, body.size);
    spm_free(body.data);
    if (!refs) return NULL;

    int best = -1;
    SemVer best_sv = {0};
    const char *prefix = "refs/tags/";
    size_t prefix_len = strlen(prefix);

    for (int i = 0; i < refs->count; i++) {
        const char *name = refs->refs[i].name;
        if (strncmp(name, prefix, prefix_len) != 0) continue;
        const char *tag = name + prefix_len;
        // Skip peeled refs ("^{}"); we'll look those up explicitly.
        size_t tag_len = strlen(tag);
        if (tag_len >= 3 && strcmp(tag + tag_len - 3, "^{}") == 0) continue;

        SemVer sv;
        if (parse_semver(tag, &sv) != 0) continue;
        if (sv.has_prerelease) continue;

        if (best < 0 || semver_cmp(&sv, &best_sv) > 0) {
            best = i;
            best_sv = sv;
        }
    }

    if (best < 0) {
        raw_ref_list_free(refs);
        return NULL;
    }

    ResolvedRef *result = spm_malloc(sizeof(ResolvedRef));
    result->ref = str_dup(refs->refs[best].name + prefix_len);
    result->sha = str_dup(peeled_sha_for(refs, best));
    result->is_tag = true;

    raw_ref_list_free(refs);
    return result;
}

ResolvedRef *resolve_ref(const PackageSpec *spec, const char *ref_name) {
    if (!spec || !ref_name) return NULL;

    MemBuf body;
    if (fetch_refs(spec->owner, spec->repo, &body) != 0) {
        return NULL;
    }
    RawRefList *refs = parse_refs(body.data, body.size);
    spm_free(body.data);
    if (!refs) return NULL;

    char branch_path[512], tag_path[512];
    snprintf(branch_path, sizeof(branch_path), "refs/heads/%s", ref_name);
    snprintf(tag_path, sizeof(tag_path), "refs/tags/%s", ref_name);

    int found = -1;
    bool is_tag = false;
    for (int i = 0; i < refs->count; i++) {
        if (strcmp(refs->refs[i].name, branch_path) == 0) {
            found = i;
            is_tag = false;
            break;
        }
    }
    if (found < 0) {
        for (int i = 0; i < refs->count; i++) {
            if (strcmp(refs->refs[i].name, tag_path) == 0) {
                found = i;
                is_tag = true;
                break;
            }
        }
    }

    if (found < 0) {
        raw_ref_list_free(refs);
        return NULL;
    }

    ResolvedRef *result = spm_malloc(sizeof(ResolvedRef));
    result->ref = str_dup(ref_name);
    result->sha = str_dup(is_tag ? peeled_sha_for(refs, found) : refs->refs[found].sha);
    result->is_tag = is_tag;

    raw_ref_list_free(refs);
    return result;
}

void resolved_ref_free(ResolvedRef *r) {
    if (!r) return;
    spm_free(r->ref);
    spm_free(r->sha);
    spm_free(r);
}
