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
import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { silenceWasiExperimentalWarning } from "./silence-wasi-warning.js";

const require = createRequire(import.meta.url);
// File URL for the WASM shim. URLs (not filesystem paths) keep dynamic
// import() portable — on Windows, import() of an absolute path fails with
// ERR_UNSUPPORTED_ESM_URL_SCHEME.
const WASM_ENTRY_URL = new URL("../wasm/rosie.js", import.meta.url);

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
  // Pre-check existence so a genuinely missing bundle produces a helpful
  // "not bundled" message rather than a confusing module-resolution error.
  if (!fs.existsSync(WASM_ENTRY_URL)) {
    console.error(
      `rosie-skills: no native binary for ${process.platform}-${process.arch} and the WASM fallback isn't bundled.`
    );
    console.error(
      "This shouldn't happen for a normally-installed package; please file an issue at https://github.com/matthewp/rosie/issues."
    );
    process.exit(1);
  }
  let createRosie: () => Promise<WasmModule>;
  try {
    const mod = (await import(WASM_ENTRY_URL.href)) as { default: typeof createRosie };
    createRosie = mod.default;
  } catch (e) {
    console.error(`rosie-skills: failed to load WASM fallback at ${WASM_ENTRY_URL.href}: ${(e as Error).message}`);
    console.error("Please file an issue at https://github.com/matthewp/rosie/issues.");
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
