// Tar.gz extraction via modern-tar. Ported from src/archive.rs.
//
// extractTarball extracts everything under destDir and returns the archive's
// root dir (GitHub's <repo>-<ref> wrapper). modern-tar handles gzip, PAX/GNU
// long names, symlinks, mode bits, and path-traversal protection, so this is
// thin wiring over it.

import * as fs from "node:fs";
import * as zlib from "node:zlib";
import { pipeline } from "node:stream/promises";
import { unpackTar } from "modern-tar/fs";
import * as os from "./os.js";
import * as log from "./log.js";

export interface ExtractResult {
  rc: number; // 0 on success, -1 on failure
  root: string | null; // <repo>-<ref> wrapper dir, or null if failed/empty
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Extract the tar.gz at archivePath into destDir, capturing the root dir in
// the same pass via modern-tar's `filter` (called for every entry in archive
// order). Mirrors archive.rs::extract_tarball + root_dir, but reads the
// archive once instead of decompressing again just to peek at the first entry.
export async function extractTarball(archivePath: string, destDir: string): Promise<ExtractResult> {
  try {
    os.createDirAll(destDir);
  } catch (e) {
    log.error(`Cannot create dest dir: ${errMsg(e)}`);
    return { rc: -1, root: null };
  }
  log.debug(`Extracting to: ${destDir}`);

  let root: string | null = null;
  try {
    // Gunzip before handing raw tar to unpackTar. No `strip` — the wrapper
    // dir is kept; `filter` records it.
    await pipeline(
      fs.createReadStream(archivePath),
      zlib.createGunzip(),
      unpackTar(destDir, {
        // Not filtering — observing. The decoder calls this once per entry in
        // archive order, so the first one is the <repo>-<ref> wrapper.
        filter: (header) => {
          if (root === null) {
            const first = header.name.split("/")[0];
            if (first && first.length > 0) root = first;
          }
          return true; // keep every entry
        },
      }),
    );
  } catch (e) {
    log.error(`Error reading archive: ${errMsg(e)}`);
    return { rc: -1, root: null };
  }
  return { rc: 0, root };
}
