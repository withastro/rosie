// Content sanitization for rosie installs. Ported from src/sanitize.rs.
//
//   - stripInvisible: remove zero-width, Unicode Tag block, and bidi-override
//     codepoints the LLM reads but a human reviewer can't see.
//   - stripComments: remove markdown comments outside fenced code blocks.
//     HTML form (<!-- ... -->, possibly multi-line) and link form
//     ([//]: # "..." / [//]: # (...)).

import * as path from "node:path";
import * as os from "./os.js";

export interface SanitizeOpts {
  stripComments: boolean;
  stripInvisible: boolean;
}

export const SANITIZE_ALL: SanitizeOpts = { stripComments: true, stripInvisible: true };
export const SANITIZE_INVISIBLE_ONLY: SanitizeOpts = { stripComments: false, stripInvisible: true };
export const SANITIZE_NONE: SanitizeOpts = { stripComments: false, stripInvisible: false };

export function sanitizeAny(opts: SanitizeOpts): boolean {
  return opts.stripComments || opts.stripInvisible;
}

// Sanitize reference content: strip comments and invisible chars per opts.
export function sanitizeReference(input: string, opts: SanitizeOpts): string {
  let out = input;
  if (opts.stripComments) out = stripComments(out);
  if (opts.stripInvisible) out = stripInvisible(out);
  return out;
}

// Sanitize skill content: strip invisible chars only (comments preserved).
export function sanitizeSkill(input: string, opts: SanitizeOpts): string {
  return opts.stripInvisible ? stripInvisible(input) : input;
}

// Walk `dir` recursively and rewrite every .md file with sanitizeSkill.
export function sanitizeSkillDir(dir: string, opts: SanitizeOpts): void {
  if (!opts.stripInvisible) return;
  sanitizeSkillDirInner(dir, opts);
}

function sanitizeSkillDirInner(dir: string, opts: SanitizeOpts): void {
  let entries: string[];
  try {
    entries = os.readDir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    const p = path.join(dir, name);
    if (os.isDir(p)) {
      sanitizeSkillDirInner(p, opts);
      continue;
    }
    if (!isMarkdownFile(name)) continue;
    let content: string;
    try {
      content = os.readToString(p);
    } catch {
      continue;
    }
    const cleaned = sanitizeSkill(content, opts);
    if (cleaned !== content) os.write(p, cleaned);
  }
}

function isMarkdownFile(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith(".md") || lower.endsWith(".markdown");
}

// ---- invisible-char stripping ----------------------------------------------

function stripInvisible(s: string): string {
  let out = "";
  let first = true;
  for (const c of s) {
    const cp = c.codePointAt(0) as number;
    if (!isInvisible(cp, first)) out += c;
    first = false;
  }
  return out;
}

function isInvisible(cp: number, isLeading: boolean): boolean {
  // Zero-width
  if (cp === 0x200b || cp === 0x200c || cp === 0x200d) return true;
  // BOM is fine at the very start of the doc, hostile anywhere else
  if (cp === 0xfeff && !isLeading) return true;
  // Bidi overrides + isolates (Trojan Source class)
  if ((cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069)) return true;
  // Unicode Tag block
  if (cp >= 0xe0000 && cp <= 0xe007f) return true;
  return false;
}

// ---- markdown-comment stripping (outside fenced code blocks) ----------------

// split a string into lines, each retaining its trailing '\n' (mirrors Rust
// split_inclusive('\n')).
function splitInclusive(s: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\n") {
      lines.push(s.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < s.length) lines.push(s.slice(start));
  return lines;
}

function stripComments(s: string): string {
  let out = "";
  let inFence = false;
  const state = { inHtmlComment: false };

  for (const line of splitInclusive(s)) {
    const trimmed = line.replace(/^\s+/, "");
    // Fence toggle has priority.
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      inFence = !inFence;
      state.inHtmlComment = false;
      out += line;
      continue;
    }
    if (inFence) {
      out += line;
      continue;
    }
    out += processLine(line, state);
  }
  return out;
}

function processLine(line: string, state: { inHtmlComment: boolean }): string {
  const strippedHtml = stripHtmlCommentsOnLine(line, state);
  if (isLinkFormCommentLine(strippedHtml)) return "";
  return strippedHtml;
}

function stripHtmlCommentsOnLine(line: string, state: { inHtmlComment: boolean }): string {
  const chars = Array.from(line);
  const n = chars.length;
  let out = "";
  let i = 0;

  while (i < n) {
    if (state.inHtmlComment) {
      if (i + 2 < n && chars[i] === "-" && chars[i + 1] === "-" && chars[i + 2] === ">") {
        state.inHtmlComment = false;
        i += 3;
        continue;
      }
      i += 1;
      continue;
    }

    if (i + 3 < n && chars[i] === "<" && chars[i + 1] === "!" && chars[i + 2] === "-" && chars[i + 3] === "-") {
      // Search for closing --> on or after this position.
      let j = i + 4;
      let closedAt = -1;
      while (j + 2 < n) {
        if (chars[j] === "-" && chars[j + 1] === "-" && chars[j + 2] === ">") {
          closedAt = j;
          break;
        }
        j += 1;
      }
      // Also check the last 3 chars (loop above stops before n-2).
      if (closedAt === -1 && n >= 3 && i + 4 <= n - 3) {
        const last = n - 3;
        if (last >= i + 4 && chars[last] === "-" && chars[last + 1] === "-" && chars[last + 2] === ">") {
          closedAt = last;
        }
      }
      if (closedAt !== -1) {
        i = closedAt + 3;
        continue;
      }
      // Unterminated: rest of line is inside the comment, continue next line.
      state.inHtmlComment = true;
      if (line.endsWith("\n")) out += "\n";
      return out;
    }

    out += chars[i];
    i += 1;
  }

  return out;
}

function isLinkFormCommentLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.startsWith("[//]:")) return false;
  let rest = trimmed.slice(5).replace(/^\s+/, "");
  if (!rest.startsWith("#")) return false;
  rest = rest.slice(1).replace(/^\s+/, "");
  if (rest.length === 0) return true;
  const first = rest[0];
  return first === '"' || first === "'" || first === "(";
}
