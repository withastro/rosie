// Walks node_modules/<pkg>/ for *.md files used as references, plus the slug
// helpers that turn package + file path into a stable install name. Ported
// from src/npm.rs.

import * as path from "node:path";
import * as os from "./os.js";
import * as log from "./log.js";

const MAX_WALK_DEPTH = 16;

// Walk the package root for *.md files.
//   - When includePaths is empty: default scope is README at root + docs/**.md.
//   - Otherwise each include is interpreted relative to pkgRoot. .md paths are
//     taken as exact files; anything else is a directory walked recursively.
// nested node_modules is always skipped. Results are deduplicated.
export function collectFiles(pkgRoot: string, includePaths: string[]): string[] {
  const out: string[] = [];

  if (includePaths.length > 0) {
    for (const inc of includePaths) {
      if (inc.length === 0) continue;
      const abs = path.join(pkgRoot, inc);
      let kind: os.FileKind;
      try {
        kind = os.symlinkMetadata(abs).kind;
      } catch {
        log.info(`warning: --include path not found in package: ${inc}`);
        continue;
      }
      if (kind === "file") {
        if (inc.endsWith(".md")) {
          pushUnique(out, inc);
        } else {
          log.info(`warning: --include file is not a .md file: ${inc}`);
        }
      } else if (kind === "dir") {
        walkForMd(pkgRoot, inc, out, 0);
      }
    }
    return out;
  }

  // Default scope: README + docs/**.md
  const readme = findReadme(pkgRoot);
  if (readme) pushUnique(out, readme);
  const docs = path.join(pkgRoot, "docs");
  if (os.isDir(docs)) {
    walkForMd(pkgRoot, "docs", out, 0);
  }
  return out;
}

// Case-insensitive lookup for README.md at the package root. Returns the
// actual filename or undefined.
function findReadme(pkgRoot: string): string | undefined {
  let entries: string[];
  try {
    entries = os.readDir(pkgRoot);
  } catch {
    return undefined;
  }
  for (const name of entries) {
    if (name.toLowerCase() !== "readme.md") continue;
    if (os.isFile(path.join(pkgRoot, name))) return name;
  }
  return undefined;
}

function pushUnique(out: string[], s: string): void {
  if (!out.includes(s)) out.push(s);
}

// Append every *.md under <pkgRoot>/<relPrefix> (excluding nested
// node_modules) to out, with the path stored relative to pkgRoot.
function walkForMd(pkgRoot: string, relPrefix: string, out: string[], depth: number): void {
  if (depth > MAX_WALK_DEPTH) return;
  const absDir = relPrefix.length === 0 ? pkgRoot : path.join(pkgRoot, relPrefix);
  let entries: string[];
  try {
    entries = os.readDir(absDir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === "node_modules") continue;
    // Forward slashes in lockfile / display paths.
    const childRel = relPrefix.length === 0 ? name : `${relPrefix}/${name}`;
    const childAbs = path.join(pkgRoot, childRel);
    let kind: os.FileKind;
    try {
      kind = os.symlinkMetadata(childAbs).kind;
    } catch {
      continue;
    }
    if (kind === "dir") {
      walkForMd(pkgRoot, childRel, out, depth + 1);
    } else if (kind === "file" && name.endsWith(".md")) {
      pushUnique(out, childRel);
    }
  }
}

// ---- slug helpers ----------------------------------------------------------

// "@tanstack/react-query" -> "tanstack-react-query"; "react" -> "react"
export function pkgSlug(pkg: string): string {
  const s = pkg.startsWith("@") ? pkg.slice(1) : pkg;
  return s.replace(/\//g, "-").toLowerCase();
}

// "docs/hooks.md" -> "docs-hooks"; "README.md" -> "readme"
export function fileSlug(relPath: string): string {
  const trimmed = relPath.endsWith(".md") ? relPath.slice(0, -3) : relPath;
  return trimmed.replace(/\//g, "-").toLowerCase();
}

// "<pkg-slug>-<file-slug>"
export function refName(pkg: string, relPath: string): string {
  return `${pkgSlug(pkg)}-${fileSlug(relPath)}`;
}
