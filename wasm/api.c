// JS API entry points for the WASM build.
//
// Each rosie_api_* function returns a malloc'd JSON string in the WASM heap:
//   {"ok": true, "data": <result>}        on success
//   {"ok": false, "error": "<message>"}   on failure
//
// JS calls these via Module.ccall, copies the string out, then frees the
// returned pointer with Module._free.

#include "../src/lockfile.h"
#include "../src/agent.h"
#include "../src/install.h"
#include "../src/util.h"
#include <emscripten.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// ---- Small JSON builder ----------------------------------------------------

typedef struct {
    char *buf;
    size_t len;
    size_t cap;
} JsonBuf;

static void json_init(JsonBuf *b) {
    b->buf = NULL;
    b->len = 0;
    b->cap = 0;
}

static void json_reserve(JsonBuf *b, size_t need) {
    if (b->len + need + 1 <= b->cap) return;
    size_t cap = b->cap == 0 ? 256 : b->cap * 2;
    while (b->len + need + 1 > cap) cap *= 2;
    b->buf = spm_realloc(b->buf, cap);
    b->cap = cap;
}

static void json_append(JsonBuf *b, const char *s) {
    size_t n = strlen(s);
    json_reserve(b, n);
    memcpy(b->buf + b->len, s, n);
    b->len += n;
    b->buf[b->len] = '\0';
}

static void json_append_char(JsonBuf *b, char c) {
    json_reserve(b, 1);
    b->buf[b->len++] = c;
    b->buf[b->len] = '\0';
}

static void json_append_string(JsonBuf *b, const char *s) {
    json_append_char(b, '"');
    if (s) {
        for (; *s; s++) {
            unsigned char c = (unsigned char)*s;
            switch (c) {
                case '"':  json_append(b, "\\\""); break;
                case '\\': json_append(b, "\\\\"); break;
                case '\n': json_append(b, "\\n"); break;
                case '\r': json_append(b, "\\r"); break;
                case '\t': json_append(b, "\\t"); break;
                default:
                    if (c < 0x20) {
                        char esc[8];
                        snprintf(esc, sizeof(esc), "\\u%04x", c);
                        json_append(b, esc);
                    } else {
                        json_append_char(b, (char)c);
                    }
            }
        }
    }
    json_append_char(b, '"');
}

static void json_append_bool(JsonBuf *b, bool v) {
    json_append(b, v ? "true" : "false");
}

static void json_append_null(JsonBuf *b) {
    json_append(b, "null");
}

// Either the source string or "null" if NULL / "-" (rosie's sentinel for
// "unknown" in the lockfile).
static void json_append_string_or_null(JsonBuf *b, const char *s) {
    if (!s || strcmp(s, "-") == 0) {
        json_append_null(b);
    } else {
        json_append_string(b, s);
    }
}

// Wrap whatever's in `data` with an envelope. `data` must be a fully-formed
// JSON value (object, array, etc.). Caller frees the returned buffer.
static char *envelope_ok(JsonBuf *data) {
    JsonBuf out;
    json_init(&out);
    json_append(&out, "{\"ok\":true,\"data\":");
    json_append(&out, data->buf ? data->buf : "null");
    json_append_char(&out, '}');
    spm_free(data->buf);
    return out.buf;
}

static char *envelope_err(const char *message) {
    JsonBuf out;
    json_init(&out);
    json_append(&out, "{\"ok\":false,\"error\":");
    json_append_string(&out, message ? message : "unknown error");
    json_append_char(&out, '}');
    return out.buf;
}

// ---- list_installed --------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
char *rosie_api_list_installed(void) {
    clear_last_error();
    Lockfile *lf = lockfile_load(".agents");
    if (!lf) {
        return envelope_err(last_error_message() ? last_error_message()
                                                 : "failed to load lockfile");
    }
    JsonBuf data;
    json_init(&data);
    json_append_char(&data, '[');
    for (int i = 0; i < lf->count; i++) {
        if (i > 0) json_append_char(&data, ',');
        LockEntry *e = &lf->entries[i];
        json_append(&data, "{\"name\":");
        json_append_string(&data, e->skill_name);
        json_append(&data, ",\"source\":");
        json_append_string(&data, e->source);
        json_append(&data, ",\"ref\":");
        json_append_string_or_null(&data, e->ref);
        json_append(&data, ",\"sha\":");
        json_append_string_or_null(&data, e->sha);
        json_append(&data, ",\"isReference\":");
        json_append_bool(&data, e->kind == LOCK_REF);
        json_append_char(&data, '}');
    }
    json_append_char(&data, ']');
    lockfile_free(lf);
    return envelope_ok(&data);
}

// ---- agents ----------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
char *rosie_api_agents(void) {
    clear_last_error();
    AgentList *detected = detect_agents(true);  // global install paths
    const AgentDef *defs = get_agent_definitions();
    int n_defs = get_agent_count();

    JsonBuf data;
    json_init(&data);
    json_append_char(&data, '[');
    for (int i = 0; i < n_defs; i++) {
        if (i > 0) json_append_char(&data, ',');
        const AgentDef *def = &defs[i];
        const char *install_path = NULL;
        bool is_detected = false;
        for (int j = 0; j < detected->count; j++) {
            if (detected->agents[j].def == def) {
                is_detected = detected->agents[j].detected;
                install_path = detected->agents[j].install_path;
                break;
            }
        }
        json_append(&data, "{\"name\":");
        json_append_string(&data, def->name);
        json_append(&data, ",\"display\":");
        json_append_string(&data, def->display);
        json_append(&data, ",\"detected\":");
        json_append_bool(&data, is_detected);
        json_append(&data, ",\"installPath\":");
        if (install_path) {
            json_append_string(&data, install_path);
        } else {
            json_append_null(&data);
        }
        json_append_char(&data, '}');
    }
    json_append_char(&data, ']');
    agent_list_free(detected);
    return envelope_ok(&data);
}

// ---- log callback bridge ---------------------------------------------------

// Bridge from C log_* to a JS function stashed on Module.__rosieLog__.
// Returning to JS via EM_JS is synchronous (no Asyncify yield) so this can
// be called from anywhere in C without performance impact.
EM_JS(void, dispatch_log_to_js, (int level, const char *msg), {
    if (Module["__rosieLog__"]) {
        Module["__rosieLog__"](level, UTF8ToString(msg));
    }
});

static void log_bridge(LogLevel level, const char *msg) {
    dispatch_log_to_js((int)level, msg);
}

// JS calls this once after Module instantiation. Installs the bridge so all
// subsequent C log_* output is routed through Module.__rosieLog__ instead of
// hitting fd 1 / fd 2 (which under NODERAWFS go straight to process.stdout
// and can't be intercepted via Module.print).
EMSCRIPTEN_KEEPALIVE
void rosie_api_install_log_bridge(void) {
    set_log_callback(log_bridge);
}

EMSCRIPTEN_KEEPALIVE
void rosie_api_set_verbose(int verbose) {
    g_verbose = verbose ? true : false;
}

// ---- string-list helpers (split CSV / newline-separated args) --------------

// Splits `s` on `sep` into a malloc'd array of malloc'd strings. Sets *out_n
// to the count. Returns NULL when `s` is NULL or empty.
static char **split_to_array(const char *s, char sep, int *out_n) {
    *out_n = 0;
    if (!s || !*s) return NULL;
    // Count separators to size the array.
    int n = 1;
    for (const char *p = s; *p; p++) if (*p == sep) n++;
    char **arr = spm_malloc(sizeof(char *) * n);
    int idx = 0;
    const char *start = s;
    for (const char *p = s; ; p++) {
        if (*p == sep || *p == '\0') {
            size_t len = (size_t)(p - start);
            char *piece = spm_malloc(len + 1);
            memcpy(piece, start, len);
            piece[len] = '\0';
            arr[idx++] = piece;
            if (*p == '\0') break;
            start = p + 1;
        }
    }
    *out_n = idx;
    return arr;
}

static void free_string_array(char **arr, int n) {
    if (!arr) return;
    for (int i = 0; i < n; i++) spm_free(arr[i]);
    spm_free(arr);
}

// ---- install ---------------------------------------------------------------

// Args mirror CLI flags. Pass NULL/empty strings to omit. is_reference/is_npm/
// global/skip_lockfile are 0/1 ints. install_package always runs with yes=1
// from the API (no interactive prompts).
EMSCRIPTEN_KEEPALIVE
char *rosie_api_install(const char *spec,
                        const char *skill_name,
                        const char *agent_names_csv,
                        const char *name_override,
                        const char *include_paths_nl,
                        int is_reference,
                        int is_npm,
                        int global,
                        int skip_lockfile) {
    clear_last_error();

    int agent_count = 0;
    char **agent_names = split_to_array(agent_names_csv, ',', &agent_count);
    int include_count = 0;
    char **include_paths = split_to_array(include_paths_nl, '\n', &include_count);

    InstallOptions opts = {0};
    opts.spec = (spec && *spec) ? spec : NULL;
    opts.skill_name = (skill_name && *skill_name) ? skill_name : NULL;
    opts.agent_names = (const char **)agent_names;
    opts.agent_count = agent_count;
    opts.global = global ? true : false;
    opts.yes = true;
    opts.list_only = false;
    opts.is_reference = is_reference ? true : false;
    opts.name_override = (name_override && *name_override) ? name_override : NULL;
    opts.is_npm = is_npm ? true : false;
    opts.include_paths = (const char **)include_paths;
    opts.include_count = include_count;
    opts.skip_lockfile = skip_lockfile ? true : false;

    int rc;
    if (!opts.spec) {
        // No spec → reinstall from lockfile (matches `rosie install` with no args).
        rc = install_from_lockfile(&opts);
    } else {
        rc = install_package(&opts);
    }

    free_string_array(agent_names, agent_count);
    free_string_array(include_paths, include_count);

    if (rc != 0) {
        const char *err = last_error_message();
        return envelope_err(err ? err : "install failed");
    }
    JsonBuf data;
    json_init(&data);
    json_append(&data, "null");
    return envelope_ok(&data);
}

// ---- remove ----------------------------------------------------------------

EMSCRIPTEN_KEEPALIVE
char *rosie_api_remove(const char *skill_name,
                       const char *agent_names_csv,
                       int global,
                       int skip_lockfile) {
    clear_last_error();
    if (!skill_name || !*skill_name) {
        return envelope_err("skill name is required");
    }
    int agent_count = 0;
    char **agent_names = split_to_array(agent_names_csv, ',', &agent_count);

    RemoveOptions opts = {0};
    opts.skill_name = skill_name;
    opts.agent_names = (const char **)agent_names;
    opts.agent_count = agent_count;
    opts.global = global ? true : false;
    opts.yes = true;
    opts.skip_lockfile = skip_lockfile ? true : false;

    int rc = remove_skill(&opts);
    free_string_array(agent_names, agent_count);

    if (rc != 0) {
        const char *err = last_error_message();
        return envelope_err(err ? err : "remove failed");
    }
    JsonBuf data;
    json_init(&data);
    json_append(&data, "null");
    return envelope_ok(&data);
}

// ---- update ----------------------------------------------------------------

// only_skill = NULL or "" → update all entries. Otherwise updates just that one.
EMSCRIPTEN_KEEPALIVE
char *rosie_api_update(const char *only_skill, int skip_lockfile) {
    clear_last_error();
    InstallOptions base = {0};
    base.yes = true;
    base.global = false;
    base.skip_lockfile = skip_lockfile ? true : false;

    const char *target = (only_skill && *only_skill) ? only_skill : NULL;
    int rc = update_skills(&base, target);

    if (rc != 0) {
        const char *err = last_error_message();
        return envelope_err(err ? err : "update failed");
    }
    JsonBuf data;
    json_init(&data);
    json_append(&data, "null");
    return envelope_ok(&data);
}
