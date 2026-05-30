// Minimal line-level unified-diff generator.
//
// Replaces the `diff` package's `createTwoFilesPatch` for the single use site
// in audit.ts (the unified diff stored in the audit record on updates). The
// diff is human/agent-facing review text, never machine-applied, so there is
// no byte-for-byte contract with any other implementation.
//
// Algorithm: trim the common leading/trailing lines, then run a
// longest-common-subsequence diff over just the region that actually changed.
// Trimming keeps the O(n*m) table small for the common case (a localized edit
// in a larger file); a size guard falls back to a wholesale region replacement
// for pathological large rewrites that skill/reference files never hit.
//
// Lines retain their trailing newline, so a line missing one (only ever the
// last line of a file) compares unequal to the same text with a newline and
// gets a `\ No newline at end of file` marker. Output is git-style
// (`--- a/x` / `+++ b/x` / `@@ -l,s +l,s @@`), which also matches the Rust
// side's `similar`-based output more closely than the old format did.

interface Op {
  type: "eq" | "del" | "ins";
  // Index into old lines for `eq`/`del` (-1 for `ins`).
  a: number;
  // Index into new lines for `eq`/`ins` (-1 for `del`).
  b: number;
}

// Cap on the LCS table size (cells) after prefix/suffix trimming. Beyond this
// the changed region is emitted as a wholesale delete+insert rather than
// allocating an enormous table. Real skills/references never approach this.
const MAX_CELLS = 4_000_000;

const NO_NEWLINE = "\\ No newline at end of file";

// Split into lines, each keeping its trailing "\n" except possibly the last.
// An empty string is zero lines.
function splitLines(s: string): string[] {
  if (s === "") return [];
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\n") {
      out.push(s.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (start < s.length) out.push(s.slice(start)); // last line, no newline
  return out;
}

// LCS edit script over a[aLo, aHi) vs b[bLo, bHi), appended to `ops`.
function lcsRegion(
  a: string[],
  b: string[],
  aLo: number,
  aHi: number,
  bLo: number,
  bHi: number,
  ops: Op[],
): void {
  const n = aHi - aLo;
  const m = bHi - bLo;
  // dp[i][j] = LCS length of a[aLo+i..aHi) and b[bLo+j..bHi).
  const dp: Int32Array[] = new Array(n + 1);
  for (let i = 0; i <= n; i++) dp[i] = new Int32Array(m + 1);
  for (let i = n - 1; i >= 0; i--) {
    const ai = a[aLo + i];
    const dpi = dp[i];
    const dpi1 = dp[i + 1];
    for (let j = m - 1; j >= 0; j--) {
      if (ai === b[bLo + j]) dpi[j] = dpi1[j + 1] + 1;
      else dpi[j] = dpi1[j] >= dpi[j + 1] ? dpi1[j] : dpi[j + 1];
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[aLo + i] === b[bLo + j]) {
      ops.push({ type: "eq", a: aLo + i, b: bLo + j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ type: "del", a: aLo + i, b: -1 });
      i++;
    } else {
      ops.push({ type: "ins", a: -1, b: bLo + j });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: "del", a: aLo + i, b: -1 });
    i++;
  }
  while (j < m) {
    ops.push({ type: "ins", a: -1, b: bLo + j });
    j++;
  }
}

function diffLines(a: string[], b: string[]): Op[] {
  const ops: Op[] = [];
  const n = a.length;
  const m = b.length;

  // Common prefix.
  let lo = 0;
  while (lo < n && lo < m && a[lo] === b[lo]) lo++;
  // Common suffix (not overlapping the prefix).
  let hiA = n;
  let hiB = m;
  while (hiA > lo && hiB > lo && a[hiA - 1] === b[hiB - 1]) {
    hiA--;
    hiB--;
  }

  for (let i = 0; i < lo; i++) ops.push({ type: "eq", a: i, b: i });

  const midA = hiA - lo;
  const midB = hiB - lo;
  if (midA > 0 && midB === 0) {
    for (let i = lo; i < hiA; i++) ops.push({ type: "del", a: i, b: -1 });
  } else if (midB > 0 && midA === 0) {
    for (let j = lo; j < hiB; j++) ops.push({ type: "ins", a: -1, b: j });
  } else if (midA > 0 && midB > 0) {
    if (midA * midB > MAX_CELLS) {
      for (let i = lo; i < hiA; i++) ops.push({ type: "del", a: i, b: -1 });
      for (let j = lo; j < hiB; j++) ops.push({ type: "ins", a: -1, b: j });
    } else {
      lcsRegion(a, b, lo, hiA, lo, hiB, ops);
    }
  }

  for (let i = hiA; i < n; i++) ops.push({ type: "eq", a: i, b: i - hiA + hiB });
  return ops;
}

function fmtRange(start: number, count: number): string {
  return count === 1 ? `${start}` : `${start},${count}`;
}

// Old/new lines consumed before op index `start` (the preceding line number,
// per GNU's convention for a zero-length range).
function linesBefore(ops: Op[], start: number, side: "a" | "b"): number {
  let c = 0;
  for (let i = 0; i < start; i++) if (ops[i][side] >= 0) c++;
  return c;
}

export function createUnifiedDiff(
  oldName: string,
  newName: string,
  oldStr: string,
  newStr: string,
  context = 3,
): string {
  if (oldStr === newStr) return "";

  const oldLines = splitLines(oldStr);
  const newLines = splitLines(newStr);
  const ops = diffLines(oldLines, newLines);

  const changeIdx: number[] = [];
  for (let i = 0; i < ops.length; i++) if (ops[i].type !== "eq") changeIdx.push(i);
  // Equal line arrays imply equal strings, already handled above.
  if (changeIdx.length === 0) return "";

  // Group changes into hunks; merge groups separated by <= 2*context eq lines.
  const groups: Array<[number, number]> = [];
  let g = 0;
  while (g < changeIdx.length) {
    let end = g;
    while (
      end + 1 < changeIdx.length &&
      changeIdx[end + 1] - changeIdx[end] - 1 <= 2 * context
    ) {
      end++;
    }
    const first = changeIdx[g];
    const last = changeIdx[end];
    groups.push([Math.max(0, first - context), Math.min(ops.length - 1, last + context)]);
    g = end + 1;
  }

  const out: string[] = [];
  out.push(`--- ${oldName}`);
  out.push(`+++ ${newName}`);

  const emit = (prefix: string, line: string): void => {
    if (line.endsWith("\n")) {
      out.push(prefix + line.slice(0, -1));
    } else {
      out.push(prefix + line);
      out.push(NO_NEWLINE);
    }
  };

  for (const [start, end] of groups) {
    let oldCount = 0;
    let newCount = 0;
    let oldFirst = -1;
    let newFirst = -1;
    for (let i = start; i <= end; i++) {
      const op = ops[i];
      if (op.a >= 0) {
        if (oldFirst < 0) oldFirst = op.a;
        oldCount++;
      }
      if (op.b >= 0) {
        if (newFirst < 0) newFirst = op.b;
        newCount++;
      }
    }
    const oldStart = oldCount === 0 ? linesBefore(ops, start, "a") : oldFirst + 1;
    const newStart = newCount === 0 ? linesBefore(ops, start, "b") : newFirst + 1;
    out.push(`@@ -${fmtRange(oldStart, oldCount)} +${fmtRange(newStart, newCount)} @@`);

    for (let i = start; i <= end; i++) {
      const op = ops[i];
      if (op.type === "eq") emit(" ", oldLines[op.a]);
      else if (op.type === "del") emit("-", oldLines[op.a]);
      else emit("+", newLines[op.b]);
    }
  }

  return out.join("\n") + "\n";
}
