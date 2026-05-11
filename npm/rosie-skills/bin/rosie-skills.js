#!/usr/bin/env node
// Launcher for rosie-skills.
//
// Resolution order:
//   1. If ROSIE_FORCE_WASM=1, skip native entirely (for local WASM testing).
//   2. Try the matching platform package (e.g. rosie-skills-linux-x64) and
//      exec its native binary.
//   3. Fall back to the inlined WASM build (wasm/rosie.js) for any platform
//      we don't ship a native binary for.
//   4. If neither is available, error out with install instructions.
const path = require('node:path');

const forceWasm = process.env.ROSIE_FORCE_WASM === '1';
const args = process.argv.slice(2);

function tryNative() {
  const pkgName = `rosie-skills-${process.platform}-${process.arch}`;
  let binaryPath;
  try {
    const pkgJsonPath = require.resolve(`${pkgName}/package.json`);
    binaryPath = path.join(path.dirname(pkgJsonPath), 'bin', 'rosie');
  } catch {
    return null;
  }
  const { spawnSync } = require('node:child_process');
  const result = spawnSync(binaryPath, args, { stdio: 'inherit' });
  if (result.error) {
    console.error(`rosie-skills: failed to execute ${binaryPath}: ${result.error.message}`);
    process.exit(1);
  }
  process.exit(result.status ?? 1);
}

function runWasm() {
  let createRosie;
  try {
    createRosie = require(path.join(__dirname, '..', 'wasm', 'rosie.js'));
  } catch {
    console.error(`rosie-skills: no native binary for ${process.platform}-${process.arch} and the WASM fallback isn't bundled.`);
    console.error("This shouldn't happen for a normally-installed package; please file an issue at https://github.com/matthewp/rosie/issues.");
    process.exit(1);
  }
  // The factory's promise resolves on Module instantiation, NOT on main()
  // completion — so we attach only .catch() and let the event loop drain.
  // EXIT_RUNTIME=1 throws ExitStatus when C main returns; we surface that
  // status. Plain resolution (main returned without exiting) → exit 0.
  createRosie({ arguments: args }).catch(e => {
    if (e && e.name === 'ExitStatus') process.exit(e.status);
    console.error(e);
    process.exit(1);
  });
}

if (!forceWasm) {
  tryNative();  // exits on success; returns to fall through on no native
}
runWasm();
