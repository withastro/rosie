// Block-rewriter inside the project's agent-instructions file
// (AGENTS.md / CLAUDE.md / GEMINI.md / .github/copilot-instructions.md).
// Ported from src/agentsmd.rs.
//
// The block markers are HTML comments:
//   <!-- rosie:references:start -->
//   ...
//   <!-- rosie:references:end -->

import { Lockfile, LockEntry } from "./lockfile.js";
import * as os from "./os.js";
import * as log from "./log.js";
import * as util from "./util.js";
import * as report from "./report.js";

const BLOCK_START = "<!-- rosie:references:start -->";
const BLOCK_END = "<!-- rosie:references:end -->";
const LOCAL_REFERENCES_DIR = ".agents/references";

// Detection order: AGENTS.md -> CLAUDE.md -> GEMINI.md ->
// .github/copilot-instructions.md. Falls back to AGENTS.md.
export function targetPath(): string {
  const candidates = ["AGENTS.md", "CLAUDE.md", "GEMINI.md", ".github/copilot-instructions.md"];
  for (const c of candidates) {
    if (os.isFile(c)) return c;
  }
  return "AGENTS.md";
}

// Extract the first H1 ("# "), skipping leading YAML frontmatter. Returns null
// on read error or when no H1 is found.
export function extractFirstH1(p: string): string | null {
  let contents: string;
  try {
    contents = os.readToString(p);
  } catch {
    return null;
  }
  let inFrontmatter = false;
  let seenFirst = false;
  for (let raw of contents.split("\n")) {
    const line = raw.replace(/\r+$/, "");
    if (line === "---") {
      if (!seenFirst) {
        inFrontmatter = true;
        seenFirst = true;
        continue;
      }
      if (inFrontmatter) {
        inFrontmatter = false;
        continue;
      }
    }
    seenFirst = true;
    if (inFrontmatter) continue;
    if (line.startsWith("# ")) {
      const title = line.slice(2).trim();
      if (title.length > 0) return title;
    }
  }
  return null;
}

function buildBlockBody(lf: Lockfile): string | null {
  const refs: LockEntry[] = lf.entries.filter((e) => e.kind === "ref");
  if (refs.length === 0) return null;
  refs.sort((a, b) => (a.skillName < b.skillName ? -1 : a.skillName > b.skillName ? 1 : 0));

  let out = "<references>\n";
  for (const e of refs) {
    const refDir = util.pathJoin(LOCAL_REFERENCES_DIR, e.skillName);
    const refFile = util.pathJoin(refDir, "REFERENCE.md");
    const h1 = extractFirstH1(refFile);
    const title = h1 && h1.length > 0 ? h1 : e.skillName;
    out += `- [${title}](./${refFile})\n`;
  }
  out += "</references>";
  return out;
}

function atomicWrite(target: string, contents: string): void {
  const tmp = util.tmpPathFor(target);
  os.write(tmp, contents);
  os.rename(tmp, target);
}

// Rebuild the rosie-managed <references> block. Returns 0 on success
// (including the no-op case), non-zero on error.
export function rebuildBlock(lf: Lockfile): number {
  const target = targetPath();
  let existing: string | null;
  try {
    existing = os.readToString(target);
  } catch {
    existing = null;
  }
  const created = existing === null;
  const existingStr = existing ?? "";

  const body = buildBlockBody(lf);
  const wantBlock = body !== null;

  const startIdx = existingStr.indexOf(BLOCK_START);
  const endIdx = existingStr.indexOf(BLOCK_END);

  if (startIdx !== -1 && endIdx === -1) {
    log.error(`Found ${BLOCK_START} without matching ${BLOCK_END} in ${target}; skipping rebuild`);
    return -1;
  }

  let newContents: string;
  if (startIdx !== -1 && endIdx !== -1) {
    let prefix = existingStr.slice(0, startIdx);
    const suffixStart = endIdx + BLOCK_END.length;
    const suffix = existingStr.slice(suffixStart);
    if (body !== null) {
      prefix += `${BLOCK_START}\n${body}\n${BLOCK_END}`;
    } else if (prefix.endsWith("\n\n")) {
      prefix = prefix.slice(0, -1);
    }
    prefix += suffix;
    newContents = prefix;
  } else if (wantBlock) {
    let out = existingStr;
    if (out.length > 0 && !out.endsWith("\n")) out += "\n";
    if (out.length > 0) out += "\n";
    out += `${BLOCK_START}\n${body as string}\n${BLOCK_END}\n`;
    newContents = out;
  } else {
    // No block to write and none exists. Leave the file alone.
    return 0;
  }

  try {
    atomicWrite(target, newContents);
  } catch (e) {
    log.error(`Failed to write ${target}: ${(e as Error).message ?? String(e)}`);
    return -1;
  }
  // Record which file we touched so the API can surface it as
  // InstallResult.installedInstruction.
  report.setInstructionFile(target);
  if (created) log.info(`Created ${target} with references block`);
  return 0;
}
