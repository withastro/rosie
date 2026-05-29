// Symlink / junction creation. Ported from src/link.rs.
//
// The platform-specific logic lives in os.createLink. This is a thin wrapper
// that returns a number (0 ok, -1 fail) and emits a log.error on failure.

import * as os from "./os.js";
import * as log from "./log.js";

// Create a directory-or-file link from linkPath to target. Returns 0 on
// success, -1 on failure (with a log.error already emitted).
export function rosieCreateLink(target: string, linkPath: string, isDir: boolean): number {
  try {
    os.createLink(target, linkPath, isDir);
    return 0;
  } catch (e) {
    log.error(e instanceof Error ? e.message : String(e));
    return -1;
  }
}
