// Package-spec parsing + tarball-URL construction + the branch-then-tag
// fallback download. Ported from src/download.rs.
//
// Supported spec forms:
//   owner/repo[@ref][#skill]           — remote, default ref "main"
//   ./<path>, /<abs>, ~/<rel>, .., .   — local symlinkable skill
//   file://<rel>                       — same, from a lockfile source
//   npm:<pkg>[#<rel-path>]             — npm-ref source (from lockfile)

import * as path from "node:path";
import * as os from "./os.js";
import * as log from "./log.js";
import * as http from "./http.js";
import * as util from "./util.js";

export const LOCAL_SOURCE_PREFIX = "file://";
export const NPM_SOURCE_PREFIX = "npm:";

export interface PackageSpec {
  owner: string | null;
  repo: string | null;
  ref: string | null; // defaulted to "main" for remote specs
  refExplicit: boolean;
  skillInSpec: string | null;
  isLocal: boolean;
  localPath: string | null;
}

export function specIsRemote(s: PackageSpec): boolean {
  return !s.isLocal;
}

export type RefKind = "branch" | "tag";

export function sourceIsLocal(source: string): boolean {
  return source.startsWith(LOCAL_SOURCE_PREFIX);
}

export function sourceLocalPath(source: string): string | null {
  return sourceIsLocal(source) ? source.slice(LOCAL_SOURCE_PREFIX.length) : null;
}

export function sourceIsNpm(source: string): boolean {
  return source.startsWith(NPM_SOURCE_PREFIX);
}

export function sourceNpmAfterPrefix(source: string): string | null {
  return sourceIsNpm(source) ? source.slice(NPM_SOURCE_PREFIX.length) : null;
}

// Split "npm:<pkg>#<file>" into [pkg, file]. file is null when no #.
export function sourceNpmSplit(source: string): [string, string | null] | null {
  const body = sourceNpmAfterPrefix(source);
  if (body === null) return null;
  const idx = body.lastIndexOf("#");
  if (idx !== -1) {
    const pkg = body.slice(0, idx);
    const file = idx + 1 < body.length ? body.slice(idx + 1) : null;
    return [pkg, file];
  }
  return [body, null];
}

// True if the user-supplied argument is a local path rather than owner/repo.
// Mirrors download.rs::looks_like_local_path.
function looksLikeLocalPath(spec: string): boolean {
  if (spec.length === 0) return false;
  if (spec === ".") return true;
  if (spec[0] === "/") return true;
  if (spec.length >= 2 && spec[0] === "~" && spec[1] === "/") return true;
  if (spec.length >= 2 && spec[0] === "." && spec[1] === "/") return true;
  if (spec.length >= 3 && spec[0] === "." && spec[1] === "." && spec[2] === "/") return true;
  return false;
}

// Resolve a user-supplied path. Expands a leading `~/` and canonicalizes. For
// project installs returns a `./<rel>` form rooted at cwd and rejects paths
// outside cwd. For global installs returns the absolute path as-is. Mirrors
// download.rs::canonicalize_local_path.
function canonicalizeLocalPath(userPath: string, global: boolean): string | null {
  if (userPath.length === 0) return null;

  let expanded: string;
  if (userPath.startsWith("~/")) {
    const home = os.homeDir();
    if (home === null) {
      log.error("Cannot expand ~ (HOME not set)");
      return null;
    }
    expanded = path.join(home, userPath.slice(2));
  } else {
    expanded = userPath;
  }

  let abs: string;
  try {
    abs = os.canonicalize(expanded);
  } catch {
    log.error(`Cannot resolve path: ${userPath}`);
    return null;
  }

  if (global) return abs;

  let cwd: string;
  try {
    cwd = os.currentDir();
  } catch {
    log.error("Cannot get current directory");
    return null;
  }

  const rel = path.relative(cwd, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    log.error(`Local skill path is outside the project: ${userPath}`);
    return null;
  }
  if (rel.length === 0) return ".";
  return `./${rel}`;
}

export function parse(spec: string, global: boolean): PackageSpec | null {
  // Local-path / file:// shortcut.
  let localInput: string | null = null;
  if (sourceIsLocal(spec)) localInput = sourceLocalPath(spec);
  else if (looksLikeLocalPath(spec)) localInput = spec;

  if (localInput !== null) {
    const canonical = canonicalizeLocalPath(localInput, global);
    if (canonical === null) return null;
    return {
      owner: null,
      repo: null,
      ref: null,
      refExplicit: false,
      skillInSpec: null,
      isLocal: true,
      localPath: canonical,
    };
  }

  let work = spec;

  // @ref suffix
  let ref = "main";
  let refExplicit = false;
  const atIdx = work.indexOf("@");
  if (atIdx !== -1) {
    ref = work.slice(atIdx + 1);
    work = work.slice(0, atIdx);
    refExplicit = true;
  }

  // #skill suffix (after stripping @ref)
  let skillInSpec: string | null = null;
  const hashIdx = work.indexOf("#");
  if (hashIdx !== -1) {
    const tail = work.slice(hashIdx + 1);
    skillInSpec = tail.length > 0 ? tail : null;
    work = work.slice(0, hashIdx);
  }

  // owner/repo
  const slashIdx = work.indexOf("/");
  if (slashIdx === -1) {
    log.error(`Invalid package spec: ${spec} (expected owner/repo)`);
    return null;
  }
  const owner = work.slice(0, slashIdx);
  const repo = work.slice(slashIdx + 1);
  if (owner.length === 0 || repo.length === 0) {
    log.error(`Invalid package spec: ${spec} (empty owner or repo)`);
    return null;
  }

  return {
    owner,
    repo,
    ref,
    refExplicit,
    skillInSpec,
    isLocal: false,
    localPath: null,
  };
}

// ---- URL building ----------------------------------------------------------

export function buildTarballUrl(spec: PackageSpec, kind: RefKind): string | null {
  if (spec.owner === null || spec.repo === null || spec.ref === null) return null;
  const kindSegment = kind === "tag" ? "tags" : "heads";
  const base = http.githubBaseUrl();
  return `${base}/${spec.owner}/${spec.repo}/archive/refs/${kindSegment}/${spec.ref}.tar.gz`;
}

// Download the package tarball. Tries refs/heads/<ref> first; on 404 falls
// back to refs/tags/<ref>. Returns 0 on success, -1 on failure. Mirrors
// download.rs::download_package_tarball.
export async function downloadPackageTarball(spec: PackageSpec, outputPath: string): Promise<number> {
  const branchUrl = buildTarballUrl(spec, "branch");
  if (branchUrl === null) return -1;
  let status = await http.fetchToFile(branchUrl, outputPath);

  if (status < 0) return -1;
  if (status < 400) return 0;
  if (status !== 404) {
    log.error(`HTTP error: ${status}`);
    return -1;
  }

  const refName = spec.ref ?? "";
  log.debug(`Ref '${refName}' not found as branch, trying as tag`);
  const tagUrl = buildTarballUrl(spec, "tag");
  if (tagUrl === null) return -1;
  status = await http.fetchToFile(tagUrl, outputPath);
  if (status < 0) return -1;
  if (status >= 400) {
    log.error(`Ref '${refName}' not found as branch or tag (HTTP ${status})`);
    return -1;
  }
  return 0;
}

// Build "<destDir>/<name>.tmp". Mirrors download.rs::tmp_archive_path.
export function tmpArchivePath(destDir: string, name: string): string {
  return util.tmpPathFor(path.join(destDir, name));
}
