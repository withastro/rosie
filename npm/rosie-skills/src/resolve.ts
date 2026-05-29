// Git smart-HTTP info/refs resolver. Ported from src/resolve.rs.
//
// Queries `<base>/<owner>/<repo>/info/refs?service=git-upload-pack`, parses
// the pkt-line response, and exposes:
//   - resolveAuto(spec):          latest semver tag, else default branch
//   - resolveLatestTag(spec):     highest semver tag (skipping pre-releases)
//   - resolveRef(spec, refName):  SHA for a specific branch or tag name

import { PackageSpec } from "./download.js";
import * as http from "./http.js";
import * as log from "./log.js";

export interface ResolvedRef {
  ref: string;
  sha: string;
  isTag: boolean;
}

interface RawRef {
  sha: string; // 40-char hex
  name: string;
}

// ---- pkt-line parser ------------------------------------------------------

function hexValue(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  return -1;
}

function parsePktLen(body: Buffer, pos: number): number | null {
  if (pos + 4 > body.length) return null;
  let v = 0;
  for (let i = 0; i < 4; i++) {
    const h = hexValue(body[pos + i]);
    if (h < 0) return null;
    v = v * 16 + h;
  }
  return v;
}

function parseRefs(body: Buffer): RawRef[] | null {
  const out: RawRef[] = [];
  let pos = 0;
  while (pos + 4 <= body.length) {
    const len = parsePktLen(body, pos);
    if (len === null) {
      log.debug(`Malformed pkt-line at offset ${pos}`);
      return null;
    }
    if (len === 0) {
      pos += 4;
      continue;
    }
    if (len < 4 || pos + len > body.length) {
      log.debug(`Bad pkt length ${len} at offset ${pos}`);
      return null;
    }
    const start = pos + 4;
    let end = pos + len;
    pos = pos + len;

    // Strip trailing CR/LF.
    while (end > start) {
      const last = body[end - 1];
      if (last === 0x0a || last === 0x0d) end--;
      else break;
    }

    // Service header lines start with '#'.
    if (end > start && body[start] === 0x23) continue;

    // First ref line: "<sha> <name>\0<capabilities>" — truncate at NUL.
    let effEnd = end;
    for (let i = start; i < end; i++) {
      if (body[i] === 0) {
        effEnd = i;
        break;
      }
    }

    const dlen = effEnd - start;
    if (dlen < 42 || body[start + 40] !== 0x20) continue;
    let shaOk = true;
    for (let i = start; i < start + 40; i++) {
      if (hexValue(body[i]) < 0) {
        shaOk = false;
        break;
      }
    }
    if (!shaOk) continue;
    const sha = body.toString("utf8", start, start + 40);
    const name = body.toString("utf8", start + 41, effEnd);
    out.push({ sha, name });
  }
  return out;
}

// ---- semver --------------------------------------------------------------

interface SemVer {
  major: number;
  minor: number;
  patch: number;
  hasPrerelease: boolean;
}

// Accept "1.2.3", "v1.2.3", or 2-part "1.2"/"v1.2" (treated as "1.2.0"),
// optionally followed by "-..." (prerelease) or "+..." (build). Mirrors
// resolve.rs::parse_semver.
function parseSemver(s: string): SemVer | null {
  let i = 0;
  if (s.length > 0 && (s[0] === "v" || s[0] === "V")) i = 1;

  function takeNum(): number | null {
    const startIdx = i;
    while (i < s.length && s[i] >= "0" && s[i] <= "9") i++;
    if (i === startIdx) return null;
    return parseInt(s.slice(startIdx, i), 10);
  }

  const major = takeNum();
  if (major === null) return null;
  if (s[i] !== ".") return null;
  i++;
  const minor = takeNum();
  if (minor === null) return null;
  let patch = 0;
  if (s[i] === ".") {
    i++;
    const p = takeNum();
    if (p === null) return null;
    patch = p;
  }
  let hasPrerelease: boolean;
  const next = i < s.length ? s[i] : undefined;
  if (next === undefined) hasPrerelease = false;
  else if (next === "-") hasPrerelease = true;
  else if (next === "+") hasPrerelease = false;
  else return null;

  return { major, minor, patch, hasPrerelease };
}

function semverCmp(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  // Prereleases sort below their corresponding release (semver §11).
  return (b.hasPrerelease ? 1 : 0) - (a.hasPrerelease ? 1 : 0);
}

function peeledShaFor(refs: RawRef[], tagIdx: number): string {
  const peeled = `${refs[tagIdx].name}^{}`;
  for (const r of refs) {
    if (r.name === peeled) return r.sha;
  }
  return refs[tagIdx].sha;
}

// Walk refs and return the highest semver tag matching one of tagPrefixes.
// Pre-releases skipped. Returns [index, semver] or null.
function bestTag(refs: RawRef[], tagPrefixes: string[]): [number, SemVer] | null {
  let best: [number, SemVer] | null = null;
  for (let i = 0; i < refs.length; i++) {
    const name = refs[i].name;
    let rest: string | null = null;
    for (const p of tagPrefixes) {
      if (name.startsWith(p)) {
        rest = name.slice(p.length);
        break;
      }
    }
    if (rest === null) continue;
    if (rest.endsWith("^{}")) continue;
    const sv = parseSemver(rest);
    if (sv === null) continue;
    if (sv.hasPrerelease) continue;
    if (best === null || semverCmp(sv, best[1]) > 0) best = [i, sv];
  }
  return best;
}

function pickLatestTag(refs: RawRef[], repo: string): ResolvedRef | null {
  // Try name-prefixed monorepo conventions first, then bare-semver tags.
  const scoped = [`refs/tags/${repo}@`, `refs/tags/${repo}-v`];
  const bare = ["refs/tags/"];

  const best = bestTag(refs, scoped) ?? bestTag(refs, bare);
  if (best === null) return null;
  const idx = best[0];

  const name = refs[idx].name;
  const tag = name.startsWith("refs/tags/") ? name.slice("refs/tags/".length) : name;
  return { ref: tag, sha: peeledShaFor(refs, idx), isTag: true };
}

function pickBranch(refs: RawRef[], name: string): ResolvedRef | null {
  const refPath = `refs/heads/${name}`;
  const found = refs.find((r) => r.name === refPath);
  if (!found) return null;
  return { ref: name, sha: found.sha, isTag: false };
}

// ---- public API ----------------------------------------------------------

async function fetchRefs(owner: string, repo: string): Promise<Buffer | null> {
  const base = http.githubBaseUrl();
  const url = `${base}/${owner}/${repo}/info/refs?service=git-upload-pack`;
  const [status, body] = await http.fetchToBuffer(url, "application/x-git-upload-pack-advertisement");
  if (status < 0) {
    log.debug("info/refs fetch failed: transport error");
    return null;
  }
  if (status >= 400) {
    log.debug(`info/refs fetch failed: HTTP ${status}`);
    return null;
  }
  return body;
}

export async function resolveLatestTag(spec: PackageSpec): Promise<ResolvedRef | null> {
  if (spec.owner === null || spec.repo === null) return null;
  const body = await fetchRefs(spec.owner, spec.repo);
  if (body === null) return null;
  const refs = parseRefs(body);
  if (refs === null) return null;
  return pickLatestTag(refs, spec.repo);
}

// Auto-pin: prefer the highest semver tag, else fall back to the default
// branch ("main", then "master"). Mirrors resolve.rs::resolve_auto.
export async function resolveAuto(spec: PackageSpec): Promise<ResolvedRef | null> {
  if (spec.owner === null || spec.repo === null) return null;
  const body = await fetchRefs(spec.owner, spec.repo);
  if (body === null) return null;
  const refs = parseRefs(body);
  if (refs === null) return null;

  const tag = pickLatestTag(refs, spec.repo);
  if (tag !== null) return tag;
  return pickBranch(refs, "main") ?? pickBranch(refs, "master");
}

export async function resolveRef(spec: PackageSpec, refName: string): Promise<ResolvedRef | null> {
  if (spec.owner === null || spec.repo === null) return null;
  const body = await fetchRefs(spec.owner, spec.repo);
  if (body === null) return null;
  const refs = parseRefs(body);
  if (refs === null) return null;

  const branchPath = `refs/heads/${refName}`;
  const tagPath = `refs/tags/${refName}`;

  const branchIdx = refs.findIndex((r) => r.name === branchPath);
  if (branchIdx !== -1) {
    return { ref: refName, sha: refs[branchIdx].sha, isTag: false };
  }
  const tagIdx = refs.findIndex((r) => r.name === tagPath);
  if (tagIdx !== -1) {
    return { ref: refName, sha: peeledShaFor(refs, tagIdx), isTag: true };
  }
  return null;
}
