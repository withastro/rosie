#include "util.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdarg.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>
#include <dirent.h>
#include <errno.h>
#include <pwd.h>

bool g_verbose = false;
bool g_host_is_windows = false;

// Memory management
void *spm_malloc(size_t size) {
    void *ptr = malloc(size);
    if (!ptr && size > 0) {
        fprintf(stderr, "rosie: out of memory\n");
        exit(1);
    }
    return ptr;
}

void *spm_realloc(void *ptr, size_t size) {
    void *new_ptr = realloc(ptr, size);
    if (!new_ptr && size > 0) {
        fprintf(stderr, "rosie: out of memory\n");
        exit(1);
    }
    return new_ptr;
}

void spm_free(void *ptr) {
    free(ptr);
}

// String utilities
char *str_dup(const char *s) {
    if (!s) return NULL;
    size_t len = strlen(s);
    char *dup = spm_malloc(len + 1);
    memcpy(dup, s, len + 1);
    return dup;
}

char *str_trim(char *s) {
    if (!s) return NULL;

    // Trim leading whitespace
    while (*s == ' ' || *s == '\t' || *s == '\n' || *s == '\r') {
        s++;
    }

    if (*s == '\0') return s;

    // Trim trailing whitespace
    char *end = s + strlen(s) - 1;
    while (end > s && (*end == ' ' || *end == '\t' || *end == '\n' || *end == '\r')) {
        end--;
    }
    end[1] = '\0';

    return s;
}

bool str_starts_with(const char *s, const char *prefix) {
    if (!s || !prefix) return false;
    return strncmp(s, prefix, strlen(prefix)) == 0;
}

bool str_ends_with(const char *s, const char *suffix) {
    if (!s || !suffix) return false;
    size_t s_len = strlen(s);
    size_t suffix_len = strlen(suffix);
    if (suffix_len > s_len) return false;
    return strcmp(s + s_len - suffix_len, suffix) == 0;
}

// Path utilities
char *get_home_dir(void) {
    const char *home = getenv("HOME");
    if (home) return str_dup(home);

    struct passwd *pw = getpwuid(getuid());
    if (pw) return str_dup(pw->pw_dir);

    return NULL;
}

char *get_temp_dir(void) {
    const char *tmp = getenv("TMPDIR");
    if (tmp) return str_dup(tmp);

    tmp = getenv("TMP");
    if (tmp) return str_dup(tmp);

    tmp = getenv("TEMP");
    if (tmp) return str_dup(tmp);

    return str_dup("/tmp");
}

char *path_join(const char *base, const char *name) {
    if (!base || !name) return NULL;

    size_t base_len = strlen(base);
    size_t name_len = strlen(name);

    // Remove trailing slash from base
    while (base_len > 0 && base[base_len - 1] == '/') {
        base_len--;
    }

    // Remove leading slash from name
    while (*name == '/') {
        name++;
        name_len--;
    }

    char *result = spm_malloc(base_len + 1 + name_len + 1);
    memcpy(result, base, base_len);
    result[base_len] = '/';
    memcpy(result + base_len + 1, name, name_len);
    result[base_len + 1 + name_len] = '\0';

    return result;
}

bool dir_exists(const char *path) {
    if (!path) return false;
    struct stat st;
    return stat(path, &st) == 0 && S_ISDIR(st.st_mode);
}

bool file_exists(const char *path) {
    if (!path) return false;
    struct stat st;
    return stat(path, &st) == 0 && S_ISREG(st.st_mode);
}

int make_dirs(const char *path) {
    if (!path) return -1;
    if (dir_exists(path)) return 0;

    char *tmp = str_dup(path);
    char *p = tmp;

    // Skip leading slash
    if (*p == '/') p++;

    while (*p) {
        if (*p == '/') {
            *p = '\0';
            if (!dir_exists(tmp)) {
                if (mkdir(tmp, 0755) != 0 && errno != EEXIST) {
                    spm_free(tmp);
                    return -1;
                }
            }
            *p = '/';
        }
        p++;
    }

    // Create final directory
    if (!dir_exists(tmp)) {
        if (mkdir(tmp, 0755) != 0 && errno != EEXIST) {
            spm_free(tmp);
            return -1;
        }
    }

    spm_free(tmp);
    return 0;
}

int copy_file(const char *src, const char *dst) {
    FILE *in = fopen(src, "rb");
    if (!in) {
        log_error("Cannot open source file: %s", src);
        return -1;
    }

    FILE *out = fopen(dst, "wb");
    if (!out) {
        fclose(in);
        log_error("Cannot open destination file: %s", dst);
        return -1;
    }

    char buf[8192];
    size_t n;

    while ((n = fread(buf, 1, sizeof(buf), in)) > 0) {
        if (fwrite(buf, 1, n, out) != n) {
            fclose(in);
            fclose(out);
            log_error("Write error: %s", dst);
            return -1;
        }
    }

    fclose(in);
    fclose(out);

    // Preserve executable bit
    struct stat st;
    if (stat(src, &st) == 0) {
        chmod(dst, st.st_mode);
    }

    return 0;
}

int copy_dir_recursive(const char *src, const char *dst) {
    if (make_dirs(dst) != 0) {
        return -1;
    }

    DIR *dir = opendir(src);
    if (!dir) {
        log_error("Cannot open directory: %s", src);
        return -1;
    }

    struct dirent *entry;
    int ret = 0;

    while ((entry = readdir(dir)) != NULL) {
        if (strcmp(entry->d_name, ".") == 0 || strcmp(entry->d_name, "..") == 0) {
            continue;
        }

        char *src_path = path_join(src, entry->d_name);
        char *dst_path = path_join(dst, entry->d_name);

        struct stat st;
        if (stat(src_path, &st) == 0) {
            if (S_ISDIR(st.st_mode)) {
                if (copy_dir_recursive(src_path, dst_path) != 0) {
                    ret = -1;
                }
            } else if (S_ISREG(st.st_mode)) {
                if (copy_file(src_path, dst_path) != 0) {
                    ret = -1;
                }
            }
        }

        spm_free(src_path);
        spm_free(dst_path);

        if (ret != 0) break;
    }

    closedir(dir);
    return ret;
}

// Logging
static log_callback_t g_log_callback = NULL;
static char g_last_error[1024] = {0};

void set_log_callback(log_callback_t cb) {
    g_log_callback = cb;
}

const char *last_error_message(void) {
    return g_last_error[0] ? g_last_error : NULL;
}

void clear_last_error(void) {
    g_last_error[0] = '\0';
}

// Format `fmt + args` into `buf` and either emit through the callback or
// fall back to the supplied default `fp` stream (matching pre-callback
// behavior). `prefix` is emitted before the message when going to a stream.
static void log_dispatch(LogLevel level, FILE *fp, const char *prefix,
                         const char *fmt, va_list args) {
    char buf[1024];
    int n = vsnprintf(buf, sizeof(buf), fmt, args);
    if (n < 0) return;
    if (g_log_callback) {
        g_log_callback(level, buf);
    } else if (fp) {
        if (prefix) fputs(prefix, fp);
        fputs(buf, fp);
        fputc('\n', fp);
    }
}

void log_info(const char *fmt, ...) {
    va_list args;
    va_start(args, fmt);
    log_dispatch(LOG_LEVEL_INFO, stdout, NULL, fmt, args);
    va_end(args);
}

void log_error(const char *fmt, ...) {
    va_list args;
    va_start(args, fmt);
    // Capture into the last-error buffer regardless of routing, so API
    // callers can surface it in the thrown JS Error.
    va_list args_copy;
    va_copy(args_copy, args);
    vsnprintf(g_last_error, sizeof(g_last_error), fmt, args_copy);
    va_end(args_copy);
    log_dispatch(LOG_LEVEL_ERROR, stderr, "rosie: error: ", fmt, args);
    va_end(args);
}

void log_debug(const char *fmt, ...) {
    if (!g_verbose && !g_log_callback) return;
    va_list args;
    va_start(args, fmt);
    log_dispatch(LOG_LEVEL_DEBUG, stdout, "[debug] ", fmt, args);
    va_end(args);
}

// Slurp a file into a malloc'd, NUL-terminated buffer. NULL on any error.
static char *slurp(const char *path) {
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

// Scan past whitespace.
static const char *skip_ws(const char *p) {
    while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r') p++;
    return p;
}

// Decode a JSON string starting at *p (which points just past the opening
// quote). Returns malloc'd string with escapes resolved (\n \t \r \" \\ \/),
// other escape sequences passed through verbatim. Advances *p past the
// closing quote. Returns NULL on unterminated string.
static char *parse_json_string(const char **p) {
    const char *s = *p;
    size_t cap = 32, len = 0;
    char *out = spm_malloc(cap);
    while (*s && *s != '"') {
        char c;
        if (*s == '\\' && s[1]) {
            switch (s[1]) {
                case '"':  c = '"';  break;
                case '\\': c = '\\'; break;
                case '/':  c = '/';  break;
                case 'n':  c = '\n'; break;
                case 't':  c = '\t'; break;
                case 'r':  c = '\r'; break;
                default:   c = s[1]; break;  // pass through
            }
            s += 2;
        } else {
            c = *s++;
        }
        if (len + 1 >= cap) {
            cap *= 2;
            out = spm_realloc(out, cap);
        }
        out[len++] = c;
    }
    if (*s != '"') {
        spm_free(out);
        return NULL;
    }
    out[len] = '\0';
    *p = s + 1;
    return out;
}

char *read_json_string_field(const char *path, const char *field) {
    if (!path || !field) return NULL;
    char *contents = slurp(path);
    if (!contents) return NULL;

    size_t field_len = strlen(field);
    const char *p = contents;
    char *result = NULL;

    // Find a token that looks like "field" : at top-level by scanning. We
    // tolerate nested objects/strings sloppily — scan over strings whole, and
    // return the first match outside any string. For package.json's
    // "version" field this is more than sufficient.
    while (*p) {
        if (*p == '"') {
            // Possible key; capture and check.
            const char *key_start = ++p;
            while (*p && *p != '"') {
                if (*p == '\\' && p[1]) p += 2;
                else p++;
            }
            if (*p != '"') break;  // unterminated
            size_t key_len = (size_t)(p - key_start);
            p++;  // past closing quote
            const char *after = skip_ws(p);
            if (*after == ':') {
                after = skip_ws(after + 1);
                if (key_len == field_len &&
                    strncmp(key_start, field, field_len) == 0) {
                    if (*after == '"') {
                        const char *value_start = after + 1;
                        result = parse_json_string(&value_start);
                        break;
                    }
                    // Field exists but value isn't a string — abort.
                    break;
                }
                // Skip the value: only handle string values precisely; for
                // numbers/objects/arrays just keep scanning forward (the next
                // top-level key match still works because we always re-enter
                // via the '"' branch).
                p = after;
            }
        } else {
            p++;
        }
    }

    spm_free(contents);
    return result;
}
