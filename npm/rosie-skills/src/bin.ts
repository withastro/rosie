#!/usr/bin/env node
// CLI launcher for rosie-skills. Pure JS: dispatches straight to the
// TypeScript implementation. Maps a negative return to exit code 255 (matching
// the Rust binary's u8 cast of a negative i32).

import { run } from "./cli.js";

run(process.argv.slice(1))
  .then((rc) => process.exit(rc < 0 ? 255 : rc))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
