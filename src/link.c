#include "link.h"
#include "util.h"

#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32

// ---------------------------------------------------------------------------
// Windows native: junctions for directories, hard-link-or-copy for files.
// ---------------------------------------------------------------------------

#include <windows.h>
#include <winioctl.h>
#include <wchar.h>

// The standard junction reparse-data layout. Mirrors REPARSE_DATA_BUFFER but
// declared locally so we don't depend on Ddk headers.
typedef struct {
    DWORD ReparseTag;
    WORD  ReparseDataLength;
    WORD  Reserved;
    WORD  SubstituteNameOffset;
    WORD  SubstituteNameLength;
    WORD  PrintNameOffset;
    WORD  PrintNameLength;
    WCHAR PathBuffer[1];
} RosieReparseMountpoint;

// Bytes of header before PathBuffer.
#define REPARSE_MOUNTPOINT_HEADER_SIZE \
    (offsetof(RosieReparseMountpoint, PathBuffer))

// UTF-8 -> wide. Caller frees with spm_free.
static wchar_t *utf8_to_wide(const char *s) {
    int n = MultiByteToWideChar(CP_UTF8, 0, s, -1, NULL, 0);
    if (n <= 0) return NULL;
    wchar_t *w = spm_malloc((size_t)n * sizeof(wchar_t));
    if (MultiByteToWideChar(CP_UTF8, 0, s, -1, w, n) <= 0) {
        spm_free(w);
        return NULL;
    }
    return w;
}

// Resolve target to an absolute path (junctions can't store relative targets).
// Returns a freshly-allocated wide string.
static wchar_t *absolutize(const wchar_t *target) {
    DWORD n = GetFullPathNameW(target, 0, NULL, NULL);
    if (n == 0) return NULL;
    wchar_t *abs = spm_malloc((size_t)n * sizeof(wchar_t));
    if (GetFullPathNameW(target, n, abs, NULL) == 0) {
        spm_free(abs);
        return NULL;
    }
    return abs;
}

static int create_junction(const char *target_utf8, const char *link_utf8) {
    wchar_t *target_w = utf8_to_wide(target_utf8);
    wchar_t *link_w = utf8_to_wide(link_utf8);
    if (!target_w || !link_w) {
        log_error("create_junction: failed to convert UTF-8 paths");
        spm_free(target_w); spm_free(link_w);
        return -1;
    }

    wchar_t *abs_target = absolutize(target_w);
    if (!abs_target) {
        log_error("create_junction: failed to resolve target: %s", target_utf8);
        spm_free(target_w); spm_free(link_w);
        return -1;
    }

    // Build the "\??\<absolute>" substitute path required by NT reparse data.
    size_t abs_len = wcslen(abs_target);
    size_t sub_chars = abs_len + 4;  // "\??\" prefix
    wchar_t *substitute = spm_malloc((sub_chars + 1) * sizeof(wchar_t));
    swprintf(substitute, sub_chars + 1, L"\\??\\%ls", abs_target);
    size_t sub_bytes = sub_chars * sizeof(wchar_t);
    size_t print_bytes = abs_len * sizeof(wchar_t);

    // Step 1: create the directory we'll convert into a reparse point.
    if (!CreateDirectoryW(link_w, NULL) && GetLastError() != ERROR_ALREADY_EXISTS) {
        log_error("create_junction: CreateDirectoryW failed for %s (err=%lu)",
                  link_utf8, GetLastError());
        spm_free(target_w); spm_free(link_w); spm_free(abs_target); spm_free(substitute);
        return -1;
    }

    // Step 2: open the directory with reparse-point flags so we can set the
    // reparse data on it.
    HANDLE h = CreateFileW(link_w, GENERIC_WRITE, 0, NULL, OPEN_EXISTING,
                           FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS, NULL);
    if (h == INVALID_HANDLE_VALUE) {
        log_error("create_junction: CreateFileW failed for %s (err=%lu)",
                  link_utf8, GetLastError());
        spm_free(target_w); spm_free(link_w); spm_free(abs_target); spm_free(substitute);
        return -1;
    }

    // Step 3: build the reparse buffer. Layout:
    //   [ substitute_name (sub_bytes) ][ NUL (2 bytes) ]
    //   [ print_name    (print_bytes) ][ NUL (2 bytes) ]
    size_t buf_size = REPARSE_MOUNTPOINT_HEADER_SIZE + sub_bytes + sizeof(wchar_t)
                                                    + print_bytes + sizeof(wchar_t);
    RosieReparseMountpoint *rb = spm_malloc(buf_size);
    memset(rb, 0, buf_size);
    rb->ReparseTag = IO_REPARSE_TAG_MOUNT_POINT;
    rb->SubstituteNameOffset = 0;
    rb->SubstituteNameLength = (WORD)sub_bytes;
    rb->PrintNameOffset = (WORD)(sub_bytes + sizeof(wchar_t));
    rb->PrintNameLength = (WORD)print_bytes;
    // ReparseDataLength counts from after Reserved through end of variable
    // section, i.e. the offset/length fields (8 bytes) plus the path data
    // plus the two NUL terminators.
    rb->ReparseDataLength = (WORD)(8 + sub_bytes + sizeof(wchar_t)
                                     + print_bytes + sizeof(wchar_t));
    memcpy((char *)rb->PathBuffer + rb->SubstituteNameOffset,
           substitute, sub_bytes);
    memcpy((char *)rb->PathBuffer + rb->PrintNameOffset,
           abs_target, print_bytes);

    DWORD returned = 0;
    BOOL ok = DeviceIoControl(h, FSCTL_SET_REPARSE_POINT, rb,
                              REPARSE_MOUNTPOINT_HEADER_SIZE + rb->ReparseDataLength,
                              NULL, 0, &returned, NULL);
    DWORD err = ok ? 0 : GetLastError();

    CloseHandle(h);
    spm_free(rb);
    spm_free(substitute);
    spm_free(abs_target);
    spm_free(link_w);
    spm_free(target_w);

    if (!ok) {
        // Roll back the empty directory so the caller can retry cleanly.
        RemoveDirectoryW(link_w);
        log_error("create_junction: FSCTL_SET_REPARSE_POINT failed for %s (err=%lu)",
                  link_utf8, err);
        return -1;
    }
    return 0;
}

static int copy_file_w(const wchar_t *src, const wchar_t *dst) {
    // CopyFileW with bFailIfExists=FALSE; matches our overwrite semantics.
    return CopyFileW(src, dst, FALSE) ? 0 : -1;
}

static int create_file_link(const char *target_utf8, const char *link_utf8) {
    wchar_t *target_w = utf8_to_wide(target_utf8);
    wchar_t *link_w = utf8_to_wide(link_utf8);
    if (!target_w || !link_w) {
        log_error("create_file_link: failed to convert UTF-8 paths");
        spm_free(target_w); spm_free(link_w);
        return -1;
    }

    int rc = 0;
    // Prefer hard links (no extra disk usage). Falls back to copy when the
    // target lives on a different volume or the filesystem doesn't support
    // hard links.
    if (!CreateHardLinkW(link_w, target_w, NULL)) {
        if (copy_file_w(target_w, link_w) != 0) {
            log_error("create_file_link: CreateHardLinkW + CopyFileW both failed "
                      "for %s -> %s (err=%lu)",
                      link_utf8, target_utf8, GetLastError());
            rc = -1;
        }
    }

    spm_free(target_w);
    spm_free(link_w);
    return rc;
}

int rosie_create_link(const char *target, const char *link_path, bool is_dir) {
    if (!target || !link_path) return -1;
    return is_dir ? create_junction(target, link_path)
                  : create_file_link(target, link_path);
}

#else // POSIX (Linux, macOS, FreeBSD, and the WASM/emcc build)

// ---------------------------------------------------------------------------
// POSIX: a single symlink() call covers both files and directories.
//
// WASM caveat: emcc never defines _WIN32, so this branch is the one taken
// regardless of which OS the resulting WASM file ultimately runs on. To
// support Windows hosts running our WASM, we check g_host_is_windows (set at
// init by the JS loader via rosie_api_set_host_platform) and route through
// JS-implemented externs that use junctions / hard links instead of symlinks.
// ---------------------------------------------------------------------------

#include <unistd.h>
#include <errno.h>

#ifdef __EMSCRIPTEN__
// Implemented in wasm/http-lib.js. Both return 0 on success, -1 on failure.
extern int wasm_create_junction(const char *target, const char *link_path);
extern int wasm_copy_or_link_file(const char *target, const char *link_path);
#endif

int rosie_create_link(const char *target, const char *link_path, bool is_dir) {
    if (!target || !link_path) return -1;

#ifdef __EMSCRIPTEN__
    if (g_host_is_windows) {
        int rc = is_dir
            ? wasm_create_junction(target, link_path)
            : wasm_copy_or_link_file(target, link_path);
        if (rc != 0) {
            log_error("link failed on Windows host: %s -> %s",
                      link_path, target);
        }
        return rc;
    }
#endif

    (void)is_dir;  // POSIX symlink doesn't care.
    if (symlink(target, link_path) != 0) {
        log_error("symlink failed: %s -> %s: %s",
                  link_path, target, strerror(errno));
        return -1;
    }
    return 0;
}

#endif
