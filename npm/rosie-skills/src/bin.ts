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
import { silenceWasiExperimentalWarning } from "./silence-wasi-warning.js";

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

interface WasmModule {
  ccall: (
    name: string,
    returnType: "number" | "string" | null,
    argTypes: Array<"string" | "number">,
    args: Array<string | number | null>,
    opts?: { async?: boolean }
  ) => unknown;
}

async function runWasm(): Promise<void> {
  silenceWasiExperimentalWarning();
  const wasmEntry = path.join(__dirname, "..", "wasm", "rosie.js");
  let createRosie: () => Promise<WasmModule>;
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
  const m = await createRosie();
  // The wasm module is a reactor (no main()); rosie_api_main takes a
  // \x1f-separated argv string (unit separator — non-NUL so ccall's
  // CStr-style marshalling doesn't truncate) and runs the CLI dispatch.
  // Returns the same integer exit code the native binary would; we map
  // Rust negative-i32 errors to 255 to match the native binary's u8
  // exit-code cast.
  const argv = args.join("\x1f");
  // async: true routes through the asyncify pump — install/update can do
  // multiple fetch round-trips and we need the wasm to suspend/resume on
  // each one.
  const rc = (await m.ccall(
    "rosie_api_main",
    "number",
    ["string"],
    [argv],
    { async: true }
  )) as number;
  process.exit(rc < 0 ? 255 : rc);
}

if (!forceWasm) {
  tryNative(); // exits on success; returns to fall through on no native
}
runWasm().catch((e) => {
  console.error(e);
  process.exit(1);
});
