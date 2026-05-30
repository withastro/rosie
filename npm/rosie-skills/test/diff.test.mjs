// Tests for src/unified-diff.ts (compiled to dist/unified-diff.js).
//
// Run with `npm test` (builds first). Three layers of confidence:
//   1. Correctness: apply our diff back onto `old` and require it to
//      reconstruct `new` exactly, across thousands of fuzzed inputs.
//   2. Minimality: compare our edit distance (adds + deletes) against the
//      `diff` package's for the same inputs. Both are minimal, so the counts
//      must match. `diff` is a devDependency kept solely for this check.
//   3. Golden + edge cases: pin the exact output format and the boundaries
//      (empty files, single line, no trailing newline, newline-only change).

import { test } from "node:test";
import assert from "node:assert/strict";
import { createTwoFilesPatch } from "diff";

import { createUnifiedDiff } from "../dist/unified-diff.js";

// Apply a git-style unified diff produced by createUnifiedDiff back onto the
// original string. Independent of the generator's internals so it is a real
// cross-check, not a tautology.
function applyUnified(oldStr, patch) {
  if (patch === "") return oldStr;
  const orig =
    oldStr === "" ? [] : (oldStr.endsWith("\n") ? oldStr.slice(0, -1) : oldStr).split("\n");
  const plines = patch.endsWith("\n") ? patch.slice(0, -1).split("\n") : patch.split("\n");

  const out = [];
  let oldPos = 0; // 0-based index into orig
  let resultFinalNewline = true;

  let i = 0;
  while (i < plines.length && !plines[i].startsWith("@@")) i++; // skip ---/+++

  while (i < plines.length) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(plines[i]);
    assert.ok(header, `bad hunk header: ${plines[i]}`);
    const oldStart = parseInt(header[1], 10);
    const oldCount = header[2] === undefined ? 1 : parseInt(header[2], 10);
    const hunkOldStart = oldCount === 0 ? oldStart : oldStart - 1; // 0-based
    while (oldPos < hunkOldStart) out.push(orig[oldPos++]);
    i++;

    let prevTag = null;
    while (i < plines.length && !plines[i].startsWith("@@")) {
      const line = plines[i];
      if (line === "\\ No newline at end of file") {
        if (prevTag === "+" || prevTag === " ") resultFinalNewline = false;
        i++;
        continue;
      }
      const tag = line[0];
      const content = line.slice(1);
      if (tag === " ") {
        out.push(content);
        oldPos++;
      } else if (tag === "-") {
        oldPos++;
      } else if (tag === "+") {
        out.push(content);
      } else {
        assert.fail(`bad body line: ${line}`);
      }
      prevTag = tag;
      i++;
    }
  }
  while (oldPos < orig.length) out.push(orig[oldPos++]);

  let res = out.join("\n");
  if (out.length > 0 && resultFinalNewline) res += "\n";
  return res;
}

// Count +/- body lines, ignoring the ---/+++ headers. Works for both our
// output and `diff`'s.
function editCount(patch) {
  let adds = 0;
  let dels = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) adds++;
    else if (line.startsWith("-")) dels++;
  }
  return adds + dels;
}

// Deterministic PRNG (mulberry32) so failures reproduce.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomFile(rand) {
  const n = Math.floor(rand() * 12); // 0..11 lines
  const lines = [];
  for (let i = 0; i < n; i++) {
    // Small alphabet so common subsequences actually occur.
    lines.push("LMNOPQRST"[Math.floor(rand() * 9)]);
  }
  if (n === 0) return "";
  const joined = lines.join("\n");
  return rand() < 0.8 ? joined + "\n" : joined; // sometimes omit trailing newline
}

test("fuzz: applying our diff reconstructs new (correctness)", () => {
  const rand = rng(0x1234abcd);
  for (let iter = 0; iter < 5000; iter++) {
    const oldStr = randomFile(rand);
    const newStr = randomFile(rand);
    const patch = createUnifiedDiff("a/f", "b/f", oldStr, newStr, 3);
    const applied = applyUnified(oldStr, patch);
    assert.equal(
      applied,
      newStr,
      `iter ${iter}\n--old--\n${JSON.stringify(oldStr)}\n--new--\n${JSON.stringify(
        newStr,
      )}\n--patch--\n${patch}`,
    );
  }
});

test("fuzz: edit distance matches the diff package (minimality)", () => {
  const rand = rng(0x55aa33cc);
  for (let iter = 0; iter < 5000; iter++) {
    const oldStr = randomFile(rand);
    const newStr = randomFile(rand);
    if (oldStr === newStr) continue;
    const ours = createUnifiedDiff("a/f", "b/f", oldStr, newStr, 3);
    const theirs = createTwoFilesPatch("a/f", "b/f", oldStr, newStr, undefined, undefined, {
      context: 3,
    });
    assert.equal(
      editCount(ours),
      editCount(theirs),
      `iter ${iter}\n--old--\n${JSON.stringify(oldStr)}\n--new--\n${JSON.stringify(
        newStr,
      )}\n--ours--\n${ours}\n--theirs--\n${theirs}`,
    );
  }
});

test("identical input yields empty diff", () => {
  assert.equal(createUnifiedDiff("a/f", "b/f", "x\ny\n", "x\ny\n", 3), "");
  assert.equal(createUnifiedDiff("a/f", "b/f", "", "", 3), "");
});

test("golden: single line replacement", () => {
  const got = createUnifiedDiff("a/file.md", "b/file.md", "alpha\nbeta\n", "alpha\ngamma\n", 3);
  assert.equal(
    got,
    ["--- a/file.md", "+++ b/file.md", "@@ -1,2 +1,2 @@", " alpha", "-beta", "+gamma", ""].join(
      "\n",
    ),
  );
});

test("golden: pure insertion into empty file", () => {
  const got = createUnifiedDiff("a/f", "b/f", "", "one\ntwo\n", 3);
  assert.equal(got, ["--- a/f", "+++ b/f", "@@ -0,0 +1,2 @@", "+one", "+two", ""].join("\n"));
});

test("golden: pure deletion to empty file", () => {
  const got = createUnifiedDiff("a/f", "b/f", "one\ntwo\n", "", 3);
  assert.equal(got, ["--- a/f", "+++ b/f", "@@ -1,2 +0,0 @@", "-one", "-two", ""].join("\n"));
});

test("no trailing newline is marked", () => {
  const got = createUnifiedDiff("a/f", "b/f", "alpha\nbeta", "alpha\ngamma", 3);
  assert.ok(got.includes("-beta"));
  assert.ok(got.includes("+gamma"));
  assert.ok(got.includes("\\ No newline at end of file"));
  // Round-trips.
  assert.equal(applyUnified("alpha\nbeta", got), "alpha\ngamma");
});

test("trailing-newline-only change round-trips", () => {
  const a = "alpha\nbeta\n";
  const b = "alpha\nbeta";
  const got = createUnifiedDiff("a/f", "b/f", a, b, 3);
  assert.notEqual(got, "");
  assert.equal(applyUnified(a, got), b);
});

test("separated changes split into multiple hunks", () => {
  const oldStr = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n") + "\n";
  const lines = oldStr.slice(0, -1).split("\n");
  lines[0] = "CHANGED0";
  lines[19] = "CHANGED19";
  const newStr = lines.join("\n") + "\n";
  const got = createUnifiedDiff("a/f", "b/f", oldStr, newStr, 3);
  const hunks = got.split("\n").filter((l) => l.startsWith("@@")).length;
  assert.equal(hunks, 2, got);
  assert.equal(applyUnified(oldStr, got), newStr);
});
