#ifndef SPM_UTIL_H
#define SPM_UTIL_H

#include <stddef.h>
#include <stdbool.h>

// Path manipulation
char *path_join(const char *base, const char *name);
char *get_home_dir(void);
char *get_temp_dir(void);
bool dir_exists(const char *path);
bool file_exists(const char *path);
int make_dirs(const char *path);
int copy_file(const char *src, const char *dst);
int copy_dir_recursive(const char *src, const char *dst);

// String utilities
char *str_dup(const char *s);
char *str_trim(char *s);
bool str_starts_with(const char *s, const char *prefix);
bool str_ends_with(const char *s, const char *suffix);

// JSON: read a top-level string field from a JSON file. Hand-rolled scanner;
// handles common backslash escapes (no Unicode escape decoding). Returns
// malloc'd value or NULL on any error (file missing, field absent, value
// isn't a string).
char *read_json_string_field(const char *path, const char *field);

// Memory management
void *spm_malloc(size_t size);
void *spm_realloc(void *ptr, size_t size);
void spm_free(void *ptr);

// Logging
typedef enum {
    LOG_LEVEL_ERROR = 0,
    LOG_LEVEL_WARN  = 1,
    LOG_LEVEL_INFO  = 2,
    LOG_LEVEL_DEBUG = 3,
} LogLevel;

void log_info(const char *fmt, ...);
void log_error(const char *fmt, ...);
void log_debug(const char *fmt, ...);

// When set, log_* functions route messages through this callback instead of
// writing to stdout/stderr. Pass NULL to restore default CLI behavior. Used
// by the API entry points to surface log events to JS.
typedef void (*log_callback_t)(LogLevel level, const char *message);
void set_log_callback(log_callback_t cb);

// log_error also stashes its last formatted message in a static buffer so API
// entry points can construct an error envelope from it. Cleared per-call.
const char *last_error_message(void);
void clear_last_error(void);

extern bool g_verbose;

// True when running under WASM on a Windows host. Native builds never set
// this — they use the appropriate #ifdef _WIN32 branch instead. Set by the
// JS loader via rosie_api_set_host_platform("win32") at module init.
extern bool g_host_is_windows;

#endif // SPM_UTIL_H
