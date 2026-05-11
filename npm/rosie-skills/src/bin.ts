#!/usr/bin/env node
// CLI launcher for rosie-skills.
//
// Resolution order:
//   1. ROSIE_FORCE_WASM=1 -> skip native, use WASM.
//   2. Try the matching platform package (e.g. rosie-skills-linux-x64) and
//      exec its native binary.
//   3. Fall back to the inlined WASM build (wasm/rosie.js) for any platform
//      we don't ship a native binary for.

import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const forceWasm = process.env.ROSIE_FORCE_WASM === "1";
const args = process.argv.slice(2);

function tryNative(): void {
  const pkgName = `rosie-skills-${process.platform}-${process.arch}`;
  let binaryPath: string;
  try {
    const pkgJsonPath = require.resolve(`${pkgName}/package.json`);
    binaryPath = path.join(path.dirname(pkgJsonPath), "bin", "rosie");
  } catch {
    return;
  }
  const result = spawnSync(binaryPath, args, { stdio: "inherit" });
  if (result.error) {
    console.error(`rosie-skills: failed to execute ${binaryPath}: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

interface ExitStatus extends Error {
  name: "ExitStatus";
  status: number;
}

function isExitStatus(e: unknown): e is ExitStatus {
  return typeof e === "object" && e !== null && (e as { name?: string }).name === "ExitStatus";
}

async function runWasm(): Promise<void> {
  const wasmEntry = path.join(__dirname, "..", "wasm", "rosie.js");
  let createRosie: (opts: { arguments: string[] }) => Promise<unknown>;
  try {
    const mod = (await import(wasmEntry)) as { default: typeof createRosie };
    createRosie = mod.default;
  } catch {
    console.error(
      `rosie-skills: no native binary for ${process.platform}-${process.arch} and the WASM fallback isn't bundled.`
    );
    console.error(
      "This shouldn't happen for a normally-installed package; please file an issue at https://github.com/matthewp/rosie/issues."
    );
    process.exit(1);
  }
  // The factory's promise resolves on Module instantiation, NOT on main()
  // completion. Attach only .catch() and let the event loop drain.
  // EXIT_RUNTIME=1 throws ExitStatus when C main returns.
  createRosie({ arguments: args }).catch((e: unknown) => {
    if (isExitStatus(e)) process.exit(e.status);
    console.error(e);
    process.exit(1);
  });
}

if (!forceWasm) {
  tryNative(); // exits on success; returns to fall through on no native
}
runWasm().catch((e) => {
  console.error(e);
  process.exit(1);
});
