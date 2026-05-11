// WASM HTTP implementations.
//
// Replaces the curl-using code that download.c and resolve.c #ifndef out for
// __EMSCRIPTEN__ builds. The actual transport lives in wasm/http-lib.js,
// linked via --js-library at build time. Asyncify lets the JS side await on
// fetch() while the C call looks synchronous from this side.
//
// Convention: wasm_fetch_* return the HTTP status code on transport success
// (which the C caller inspects to differentiate 200/404/etc.), or -1 on
// transport failure (network unreachable, bad URL, etc.).

#include "../src/download.h"
#include "../src/util.h"
#include <stddef.h>

// Implemented in wasm/http-lib.js.
extern int wasm_fetch_to_file(const char *url, const char *output_path);

int download_init(void) {
    return 0;
}

void download_cleanup(void) {
}

int download_file(const char *url, const char *output_path) {
    int status = wasm_fetch_to_file(url, output_path);
    if (status < 0) {
        log_error("Download failed");
        return -1;
    }
    if (status >= 400) {
        log_error("HTTP error: %d", status);
        return -1;
    }
    return 0;
}

int download_package_tarball(const PackageSpec *spec, const char *output_path) {
    if (!spec) return -1;

    char *url = build_tarball_url(spec, REF_KIND_BRANCH);
    int status = wasm_fetch_to_file(url, output_path);
    spm_free(url);

    if (status < 0) return -1;
    if (status < 400) return 0;
    if (status != 404) {
        log_error("HTTP error: %d", status);
        return -1;
    }

    log_debug("Ref '%s' not found as branch, trying as tag", spec->ref);
    url = build_tarball_url(spec, REF_KIND_TAG);
    status = wasm_fetch_to_file(url, output_path);
    spm_free(url);

    if (status < 0) return -1;
    if (status >= 400) {
        log_error("Ref '%s' not found as branch or tag (HTTP %d)", spec->ref, status);
        return -1;
    }
    return 0;
}
