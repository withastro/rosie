// Tests for src/archive.ts (compiled to dist/archive.js). Fixtures are real
// .tar.gz bytes built with modern-tar's packTar + gzip, so this runs against
// the actual extractor, not a mock.

import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { packTar } from "modern-tar/fs";

import { extractTarball } from "../dist/archive.js";

// Build a gzipped tar from [{target, content}] entries (order preserved, so
// entries[0] determines the root) and write it to a temp file.
async function writeTarGz(entries) {
  const sources = entries.map((e) => ({
    type: "content",
    content: e.content,
    target: e.target,
  }));
  const chunks = [];
  for await (const chunk of packTar(sources)) chunks.push(chunk);
  const gz = zlib.gzipSync(Buffer.concat(chunks));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rosie-arc-src-"));
  const tarPath = path.join(dir, "package.tar.gz");
  fs.writeFileSync(tarPath, gz);
  return tarPath;
}

function freshDest() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rosie-arc-dest-"));
}

test("extracts files and reports the root wrapper dir", async () => {
  const tar = await writeTarGz([
    { target: "myrepo-main/SKILL.md", content: "# hello\n" },
    { target: "myrepo-main/scripts/run.sh", content: "echo hi\n" },
  ]);
  const dest = freshDest();

  const result = await extractTarball(tar, dest);

  assert.equal(result.rc, 0);
  assert.equal(result.root, "myrepo-main");
  assert.equal(fs.readFileSync(path.join(dest, "myrepo-main/SKILL.md"), "utf8"), "# hello\n");
  assert.equal(
    fs.readFileSync(path.join(dest, "myrepo-main/scripts/run.sh"), "utf8"),
    "echo hi\n",
  );
});

test("root is the first component of the first entry", async () => {
  const tar = await writeTarGz([
    { target: "repo-v1.2.3/README.md", content: "x\n" },
    { target: "repo-v1.2.3/a/b/c.txt", content: "y\n" },
  ]);
  const dest = freshDest();

  const result = await extractTarball(tar, dest);

  assert.equal(result.rc, 0);
  assert.equal(result.root, "repo-v1.2.3");
  assert.equal(fs.readFileSync(path.join(dest, "repo-v1.2.3/a/b/c.txt"), "utf8"), "y\n");
});

test("missing archive fails cleanly (rc -1, no root)", async () => {
  const dest = freshDest();
  const result = await extractTarball(path.join(dest, "does-not-exist.tar.gz"), dest);
  assert.equal(result.rc, -1);
  assert.equal(result.root, null);
});

test("non-gzip garbage fails cleanly (rc -1, no root)", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rosie-arc-bad-"));
  const tarPath = path.join(dir, "package.tar.gz");
  fs.writeFileSync(tarPath, Buffer.from("this is not a gzip stream"));
  const dest = freshDest();

  const result = await extractTarball(tarPath, dest);

  assert.equal(result.rc, -1);
  assert.equal(result.root, null);
});
