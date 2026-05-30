// Tar.gz extraction via modern-tar. Ported from src/archive.rs.
//
// Two entry points:
//   - extractTarball(archivePath, destDir): extract everything under destDir.
//   - rootDir(archivePath): the first path component of the first archive
//     entry, which is GitHub's <repo>-<ref> wrapper dir.
//
// modern-tar handles gzip (via the gunzip step below), PAX/GNU long names,
// symlinks, mode bits, and path-traversal protection (it rejects ".."
// components and validates symlink/hardlink targets stay inside destDir), so
// this is thin wiring over it. Both functions are async: modern-tar is
// stream-based and has no synchronous API.

import * as fs from "node:fs";
import * as zlib from "node:zlib";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { unpackTar } from "modern-tar/fs";
import { createTarDecoder } from "modern-tar";
import * as os from "./os.js";
import * as log from "./log.js";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Extract the tar.gz at archivePath into destDir. Returns 0 on success, -1 on
// failure. Mirrors archive.rs::extract_tarball.
export async function extractTarball(archivePath: string, destDir: string): Promise<number> {
  try {
    os.createDirAll(destDir);
  } catch (e) {
    log.error(`Cannot create dest dir: ${errMsg(e)}`);
    return -1;
  }
  log.debug(`Extracting to: ${destDir}`);
  try {
    // GitHub tarballs are gzipped; gunzip before handing raw tar to unpackTar.
    // No `strip` — the <repo>-<ref> wrapper dir is kept and found by rootDir.
    await pipeline(
      fs.createReadStream(archivePath),
      zlib.createGunzip(),
      unpackTar(destDir),
    );
  } catch (e) {
    log.error(`Error reading archive: ${errMsg(e)}`);
    return -1;
  }
  return 0;
}

// Find the first path component of the first real entry in the archive.
// GitHub tarballs wrap the repo in <repo>-<ref>/. modern-tar applies PAX
// extended headers internally rather than emitting pseudo-entries, so the
// first decoded entry is already a real one. Mirrors archive.rs::root_dir.
export async function rootDir(archivePath: string): Promise<string | null> {
  try {
    const bytes = Readable.toWeb(
      fs.createReadStream(archivePath).pipe(zlib.createGunzip()),
    );
    const entries = bytes.pipeThrough(createTarDecoder());
    for await (const entry of entries) {
      const first = entry.header.name.split("/")[0];
      // Drain the body before moving on / returning, or the stream stalls.
      await entry.body.cancel();
      if (first && first.length > 0) return first;
    }
  } catch {
    return null;
  }
  return null;
}
