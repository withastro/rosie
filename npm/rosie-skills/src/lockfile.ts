// .agents/rosie.lock — whitespace-separated entries with a v1 header.
// Ported from src/lockfile.rs.
//
//   # rosie-lock v1
//   <name> <source> <ref> <sha> <iso8601_ts> <pin|auto> <skill|ref>
//
// Entries are sorted by name on save for stable diffs. The format is locked
// down by the regression suite; even whitespace changes break tests.

import * as path from "node:path";
import * as os from "./os.js";
import * as log from "./log.js";
import * as util from "./util.js";

export const LOCKFILE_NAME = "rosie.lock";
export const LOCKFILE_VERSION = 1;

export type LockKind = "skill" | "ref";

export interface LockEntry {
  skillName: string;
  source: string;
  ref: string;
  sha: string;
  installedAt: string;
  pinned: boolean;
  kind: LockKind;
}

export class Lockfile {
  entries: LockEntry[];
  path: string;

  private constructor(entries: LockEntry[], p: string) {
    this.entries = entries;
    this.path = p;
  }

  // Load `<dir>/rosie.lock`. Returns an empty lockfile if the file is missing.
  static load(dir: string): Lockfile {
    const p = path.join(dir, LOCKFILE_NAME);
    const entries: LockEntry[] = [];
    let contents: string | null = null;
    try {
      contents = os.readToString(p);
    } catch {
      contents = null;
    }
    if (contents !== null) {
      for (const line of contents.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.length === 0 || trimmed.startsWith("#")) continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length < 5) {
          log.debug(`skipping malformed lockfile line: ${trimmed}`);
          continue;
        }
        const pinned = parts[5] === "pin";
        const kind: LockKind = parts[6] === "ref" ? "ref" : "skill";
        entries.push({
          skillName: parts[0],
          source: parts[1],
          ref: parts[2],
          sha: parts[3],
          installedAt: parts[4],
          pinned,
          kind,
        });
      }
    }
    return new Lockfile(entries, p);
  }

  find(skillName: string): LockEntry | undefined {
    return this.entries.find((e) => e.skillName === skillName);
  }

  // Insert or replace by skill name.
  upsert(
    skillName: string,
    source: string,
    ref: string,
    sha: string,
    installedAt: string,
    pinned: boolean,
    kind: LockKind
  ): void {
    const existing = this.find(skillName);
    if (existing) {
      existing.source = source;
      existing.ref = ref;
      existing.sha = sha;
      existing.installedAt = installedAt;
      existing.pinned = pinned;
      existing.kind = kind;
      return;
    }
    this.entries.push({ skillName, source, ref, sha, installedAt, pinned, kind });
  }

  // Remove an entry by name. Returns true if present.
  remove(skillName: string): boolean {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.skillName !== skillName);
    return this.entries.length !== before;
  }

  // Atomic save: write to .tmp then rename. Entries sorted by name first.
  save(): void {
    this.entries.sort((a, b) => (a.skillName < b.skillName ? -1 : a.skillName > b.skillName ? 1 : 0));
    let out = `# rosie-lock v${LOCKFILE_VERSION}\n`;
    for (const e of this.entries) {
      out += `${e.skillName} ${e.source} ${e.ref} ${e.sha} ${e.installedAt} ${
        e.pinned ? "pin" : "auto"
      } ${e.kind}\n`;
    }
    const tmp = util.tmpPathFor(this.path);
    os.write(tmp, out);
    os.rename(tmp, this.path);
  }
}

// Current UTC time as ISO 8601 ("2026-05-02T14:32:18Z").
export function nowIso8601(): string {
  return iso8601FromUnix(os.nowUnixSeconds());
}

// Pure-function ISO 8601 formatter. Strips the milliseconds that
// Date.toISOString() adds, to match the Rust `time` crate output.
export function iso8601FromUnix(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}
