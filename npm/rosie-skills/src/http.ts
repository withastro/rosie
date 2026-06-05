// HTTP client. Ported from src/http.rs (native path).
//
// Uses the global fetch (Node 18+). Two functions mirror the Rust surface:
//   - fetchToFile(url, outputPath) -> HTTP status; -1 on transport error
//   - fetchToBuffer(url, accept)   -> [status, Buffer]; -1 on transport error
//
// Status >= 400 is returned to the caller, not collapsed into an error — the
// install flow needs to distinguish 404 (try branch then tag) from a network
// failure.

import { execFileSync } from "node:child_process";

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

// Resolve a GitHub token for authenticating private-repo downloads.
//
// Order of precedence (mirrors http.rs::github_token):
//   1. GH_TOKEN — what the gh CLI itself checks first
//   2. GITHUB_TOKEN — the conventional Actions / CI variable
//   3. `gh auth token` — falls back to whatever the locally installed gh CLI
//      is logged into (covers macOS keychain storage etc.)
//
// Cached for the process lifetime so we don't fork `gh` on every request.
// `null` means "we looked and nothing was available"; `undefined` means "not
// yet looked up".
let cachedToken: string | null | undefined;
export function githubToken(): string | null {
  if (cachedToken !== undefined) return cachedToken;
  for (const name of ["GH_TOKEN", "GITHUB_TOKEN"]) {
    const v = os.getenv(name);
    if (v && v.length > 0) {
      log.debug(`Using GitHub token from $${name}`);
      cachedToken = v;
      return cachedToken;
    }
  }
  try {
    const out = execFileSync("gh", ["auth", "token"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    if (out.length > 0) {
      log.debug("Using GitHub token from `gh auth token`");
      cachedToken = out;
      return cachedToken;
    }
  } catch {
    /* gh not installed, not logged in, or non-zero exit — fall through */
  }
  cachedToken = null;
  return cachedToken;
}

// Authority component of a URL, lowercased and without port. Returns null
// for non-absolute / unparseable input. Mirrors http.rs::host_of.
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

// Whether it's safe to attach an `Authorization` header for `url`. We only
// do so on the github.com control plane — codeload redirects arrive
// pre-signed via a `?token=` query param and don't need (and shouldn't
// receive) the user's token. Mirrors http.rs::should_send_token.
function shouldSendToken(url: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (host === "github.com" || host === "api.github.com") return true;
  const baseHost = hostOf(githubBaseUrl());
  return baseHost !== null && baseHost !== "github.com" && host === baseHost;
}

// Build the `Authorization` header for github.com. HTTP Basic with the
// `x-access-token` user works for both api.github.com / archive endpoints
// AND the git smart-HTTP info/refs endpoint, whereas `Bearer …` is rejected
// by the latter with "invalid credentials". Mirrors http.rs::with_github_auth.
function applyGithubAuth(url: string, headers: Record<string, string>): void {
  if (!shouldSendToken(url)) return;
  const token = githubToken();
  if (!token) return;
  const encoded = Buffer.from(`x-access-token:${token}`, "utf8").toString("base64");
  headers["Authorization"] = `Basic ${encoded}`;
}

// Returns the HTTP status. On transport failure returns -1; on HTTP failure
// the partial file is removed (matches curl behavior in the C/Rust version).
export async function fetchToFile(url: string, outputPath: string): Promise<number> {
  log.debug(`Downloading: ${url}`);

  let resp: Response;
  try {
    const headers: Record<string, string> = { "User-Agent": "rosie/1.0" };
    applyGithubAuth(url, headers);
    resp = await fetch(url, { redirect: "follow", headers });
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
  applyGithubAuth(url, headers);

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
