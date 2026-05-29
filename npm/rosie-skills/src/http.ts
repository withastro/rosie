// HTTP client. Ported from src/http.rs (native path).
//
// Uses the global fetch (Node 18+). Two functions mirror the Rust surface:
//   - fetchToFile(url, outputPath) -> HTTP status; -1 on transport error
//   - fetchToBuffer(url, accept)   -> [status, Buffer]; -1 on transport error
//
// Status >= 400 is returned to the caller, not collapsed into an error — the
// install flow needs to distinguish 404 (try branch then tag) from a network
// failure.

import * as os from "./os.js";
import * as log from "./log.js";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Read ROSIE_GITHUB_BASE_URL or default to github.com, so tests can point us
// at a local mock server. Mirrors http.rs::github_base_url.
export function githubBaseUrl(): string {
  const v = os.getenv("ROSIE_GITHUB_BASE_URL");
  return v && v.length > 0 ? v : "https://github.com";
}

// Returns the HTTP status. On transport failure returns -1; on HTTP failure
// the partial file is removed (matches curl behavior in the C/Rust version).
export async function fetchToFile(url: string, outputPath: string): Promise<number> {
  log.debug(`Downloading: ${url}`);

  let resp: Response;
  try {
    resp = await fetch(url, { redirect: "follow", headers: { "User-Agent": "rosie/1.0" } });
  } catch (e) {
    log.error(`Download failed: ${errMsg(e)}`);
    return -1;
  }

  const status = resp.status;
  let body: Buffer;
  try {
    body = Buffer.from(await resp.arrayBuffer());
  } catch (e) {
    log.error(`Download failed: ${errMsg(e)}`);
    safeRemove(outputPath);
    return -1;
  }

  if (status >= 400) {
    safeRemove(outputPath);
    return status;
  }
  try {
    os.write(outputPath, body);
  } catch (e) {
    log.error(`Cannot create file: ${errMsg(e)}`);
    return -1;
  }
  log.debug(`Downloaded to: ${outputPath}`);
  return status;
}

// Buffered fetch — for the smart-HTTP info/refs response. `accept` is set as
// the Accept header when provided. Returns [status, body]. Mirrors
// http.rs::fetch_to_buffer (note the git-shaped User-Agent).
export async function fetchToBuffer(url: string, accept?: string): Promise<[number, Buffer]> {
  log.debug(`Fetching refs: ${url}`);
  const headers: Record<string, string> = { "User-Agent": "git/rosie-1.0" };
  if (accept) headers["Accept"] = accept;

  let resp: Response;
  try {
    resp = await fetch(url, { redirect: "follow", headers });
  } catch (e) {
    log.debug(`info/refs fetch failed: ${errMsg(e)}`);
    return [-1, Buffer.alloc(0)];
  }
  const status = resp.status;
  try {
    const body = Buffer.from(await resp.arrayBuffer());
    return [status, body];
  } catch (e) {
    log.debug(`info/refs read failed: ${errMsg(e)}`);
    return [-1, Buffer.alloc(0)];
  }
}

function safeRemove(p: string): void {
  try {
    os.removeFile(p);
  } catch {
    /* best effort */
  }
}
