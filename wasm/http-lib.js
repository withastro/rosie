// JS-side HTTP implementations the WASM build calls into.
//
// emcc bakes these into the generated rosie.js via --js-library. Each
// `<name>__async: true` declaration tells emcc the function awaits a promise;
// Asyncify pauses the WASM stack, lets the promise resolve, then resumes.
//
// Return convention: HTTP status code on transport success, -1 on transport
// error (DNS, network, etc.). 404 / 5xx etc. are returned as-is so callers
// can distinguish "not found, try as tag" from "the network is down."

addToLibrary({
  // int wasm_fetch_to_file(const char *url, const char *output_path)
  // Streams the response body straight to output_path (no buffering of the
  // full tarball in WASM memory). Used for tarball downloads.
  wasm_fetch_to_file__async: true,
  wasm_fetch_to_file: function(url_ptr, output_path_ptr) {
    const url = UTF8ToString(url_ptr);
    const output_path = UTF8ToString(output_path_ptr);
    return Asyncify.handleAsync(async () => {
      try {
        const res = await fetch(url, {
          headers: { 'User-Agent': 'rosie/1.0' },
          redirect: 'follow',
        });
        const buf = Buffer.from(await res.arrayBuffer());
        // Only write the file on 2xx — matches curl's behavior of removing a
        // partial file on HTTP error so the caller doesn't see a junk file.
        if (res.ok) {
          require('fs').writeFileSync(output_path, buf);
        }
        return res.status;
      } catch (e) {
        if (typeof console !== 'undefined') console.error('fetch error:', e.message);
        return -1;
      }
    });
  },

  // int wasm_fetch_to_buffer(const char *url, const char *accept_header,
  //                         char **out_buf, size_t *out_len)
  // Buffers the body in WASM-allocated memory; writes the pointer + length
  // through the out parameters so the C caller can spm_free() it. Used for
  // the GitHub info/refs response (small).
  wasm_fetch_to_buffer__async: true,
  wasm_fetch_to_buffer__deps: ['malloc'],
  wasm_fetch_to_buffer: function(url_ptr, accept_ptr, out_buf_pp, out_len_p) {
    const url = UTF8ToString(url_ptr);
    const accept = accept_ptr ? UTF8ToString(accept_ptr) : null;
    return Asyncify.handleAsync(async () => {
      try {
        const headers = { 'User-Agent': 'git/rosie-1.0' };
        if (accept) headers['Accept'] = accept;
        const res = await fetch(url, { headers, redirect: 'follow' });
        if (!res.ok) return res.status;
        const bytes = new Uint8Array(await res.arrayBuffer());
        const buf_ptr = _malloc(bytes.length + 1);
        HEAPU8.set(bytes, buf_ptr);
        HEAPU8[buf_ptr + bytes.length] = 0;  // null-terminate for safety
        // wasm32: pointers + size_t are 32-bit, so HEAPU32 is correct.
        HEAPU32[out_buf_pp >> 2] = buf_ptr;
        HEAPU32[out_len_p >> 2] = bytes.length;
        return res.status;
      } catch (e) {
        if (typeof console !== 'undefined') console.error('fetch error:', e.message);
        return -1;
      }
    });
  },
});
