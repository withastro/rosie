// Tar.gz extraction via node-tar. Ported from src/archive.rs.
//
// Two entry points:
//   - extractTarball(archivePath, destDir): extract everything under destDir.
//   - rootDir(archivePath): the first path component of the first archive
//     entry, which is GitHub's <repo>-<ref> wrapper dir.
//
// node-tar handles gzip, PAX/GNU long names, symlinks, mode bits, and
// path-traversal protection, so this is thin wiring over it.

import * as tar from "tar";
import * as os from "./os.js";
import * as log from "./log.js";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Extract the tar.gz at archivePath into destDir. Returns 0 on success, -1 on
// failure. Mirrors archive.rs::extract_tarball.
export function extractTarball(archivePath: string, destDir: string): number {
  try {
    os.createDirAll(destDir);
  } catch (e) {
    log.error(`Cannot create dest dir: ${errMsg(e)}`);
    return -1;
  }
  log.debug(`Extracting to: ${destDir}`);
  try {
    tar.extract({ file: archivePath, cwd: destDir, sync: true });
  } catch (e) {
    log.error(`Error reading archive: ${errMsg(e)}`);
    return -1;
  }
  return 0;
}

// Find the first path component of the first real entry in the archive.
// GitHub tarballs wrap the repo in <repo>-<ref>/. Skips PAX extended/global
// header pseudo-entries. Mirrors archive.rs::root_dir.
export function rootDir(archivePath: string): string | null {
  let root: string | null = null;
  try {
    tar.list({
      file: archivePath,
      sync: true,
      onReadEntry: (entry) => {
        if (root !== null) return;
        const type = String(entry.type);
        if (type === "GlobalExtendedHeader" || type === "ExtendedHeader" || type === "PaxHeader") {
          return;
        }
        const first = entry.path.split("/")[0];
        if (first && first.length > 0) root = first;
      },
    });
  } catch {
    return null;
  }
  return root;
}
