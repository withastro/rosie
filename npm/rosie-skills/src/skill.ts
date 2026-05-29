// Skill discovery and SKILL.md frontmatter parsing. Ported from src/skill.rs.
//
// SKILL.md format:
//   ---
//   name: skill-name
//   description: Some description
//   ---
//   <body>
//
// Only `name` and `description` are parsed; everything else is ignored.

import * as path from "node:path";
import * as os from "./os.js";
import * as log from "./log.js";

export interface Skill {
  name: string;
  description: string | null;
  // Directory containing the SKILL.md.
  path: string;
  // Path to the SKILL.md file itself.
  skillFile: string;
}

// Search paths checked when looking inside a package for the skills it ships.
// Intentionally narrow; the recursive fallback catches off-convention layouts.
const SKILL_SEARCH_PATHS = ["skills"];

// Parse SKILL.md frontmatter. Returns null on read error or when no name can
// be derived from frontmatter or the parent directory name.
export function parseSkillFile(p: string): Skill | null {
  let contents: string;
  try {
    contents = os.readToString(p);
  } catch {
    log.debug(`Cannot open: ${p}`);
    return null;
  }

  let name: string | null = null;
  let description: string | null = null;
  let inFrontmatter = false;

  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "---") {
      if (!inFrontmatter) {
        inFrontmatter = true;
        continue;
      }
      break;
    }
    if (!inFrontmatter) continue;
    const idx = trimmed.indexOf(":");
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim();
      let value = trimmed.slice(idx + 1).trim();
      // Strip matching quotes.
      if (value.length >= 2) {
        const first = value[0];
        const last = value[value.length - 1];
        if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
          value = value.slice(1, value.length - 1);
        }
      }
      if (key === "name") name = value;
      else if (key === "description") description = value;
    }
  }

  // If no name from frontmatter, fall back to the parent directory name.
  if (name === null) {
    const parent = path.dirname(p);
    const dirName = path.basename(parent);
    if (dirName.length > 0) name = dirName;
  }

  if (name === null) return null;
  const dir = path.dirname(p);

  return { name, description, path: dir, skillFile: p };
}

// Return the body of a markdown file with leading YAML frontmatter stripped.
// Returns full contents when no frontmatter is present, or null on read error.
// Mirrors skill.rs::strip_yaml_frontmatter.
export function stripYamlFrontmatter(p: string): string | null {
  let contents: string;
  try {
    contents = os.readToString(p);
  } catch {
    return null;
  }
  // Must begin with "---" followed by \n or \r.
  if (
    contents.length < 4 ||
    contents.slice(0, 3) !== "---" ||
    (contents[3] !== "\n" && contents[3] !== "\r")
  ) {
    return contents;
  }
  const lines = contents.split("\n");
  // First line is "---" (possibly with trailing \r). Find the closing "---".
  let offset = lines[0].length + 1; // past the opening delimiter line + \n
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const checked = line.endsWith("\r") ? line.slice(0, -1) : line;
    if (checked === "---") {
      return contents.slice(offset + line.length + 1);
    }
    offset += line.length + 1;
  }
  log.debug(`Unterminated frontmatter in ${p}`);
  return contents;
}

// Walk a directory tree (max depth 5) for SKILL.md files and parse each.
function findSkillsRecursive(base: string, out: Skill[], depth: number): void {
  if (depth > 5) return;
  let entries: string[];
  try {
    entries = os.readDir(base);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    const child = path.join(base, name);
    let kind: os.FileKind;
    try {
      kind = os.metadata(child).kind;
    } catch {
      continue;
    }
    if (kind !== "dir") continue;
    const skillMd = path.join(child, "SKILL.md");
    if (os.isFile(skillMd)) {
      const skill = parseSkillFile(skillMd);
      if (skill) {
        out.push(skill);
        continue;
      }
    }
    findSkillsRecursive(child, out, depth + 1);
  }
}

// Find all skills in a directory tree. Checks the root SKILL.md first, then
// each SKILL_SEARCH_PATHS dir, then walks the whole tree if nothing was found.
export function discoverSkills(baseDir: string): Skill[] {
  const out: Skill[] = [];

  const rootMd = path.join(baseDir, "SKILL.md");
  if (os.isFile(rootMd)) {
    const s = parseSkillFile(rootMd);
    if (s) out.push(s);
  }

  for (const sub of SKILL_SEARCH_PATHS) {
    const search = path.join(baseDir, sub);
    if (os.isDir(search)) {
      log.debug(`Searching for skills in: ${search}`);
      findSkillsRecursive(search, out, 0);
    }
  }

  if (out.length === 0) {
    log.debug("No skills in known paths, searching recursively from root");
    findSkillsRecursive(baseDir, out, 0);
  }

  return out;
}

export function printSkill(skill: Skill): void {
  if (skill.description) log.info(`  ${skill.name} - ${skill.description}`);
  else log.info(`  ${skill.name}`);
}

export function printList(list: Skill[]): void {
  if (list.length === 0) {
    log.info("  (no skills found)");
    return;
  }
  for (const s of list) printSkill(s);
}
