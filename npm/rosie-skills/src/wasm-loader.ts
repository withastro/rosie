// Loads the inlined WASM build and exposes a typed `RosieModule` interface.
// All API entry points come from wasm/rosie.js (an ESM module emitted by
// emcc with EXPORT_ES6=1); this module instantiates that and wires up
// the log-callback bridge.
//
// Logging: rosie's C log_* functions route through a registered callback;
// when API mode is active that callback bridges into JS via a Module slot
// (`__rosieLog__`). We can't use Module.print here because NODERAWFS routes
// printf to host fd 1/2 directly, bypassing the Module hook.

import { silenceWasiExperimentalWarning } from "./silence-wasi-warning.js";

// File URL for the WASM shim. Using a URL (not a filesystem path) keeps
// dynamic import() portable — on Windows, import() of an absolute path
// fails with ERR_UNSUPPORTED_ESM_URL_SCHEME.
const WASM_ENTRY_URL = new URL("../wasm/rosie.js", import.meta.url);

export type LogLevel = "error" | "warn" | "info" | "debug";

export interface LogEvent {
  level: LogLevel;
  message: string;
}

export type OnLog = (event: LogEvent) => void;

// Internal: integer levels match the C-side LogLevel enum.
const LEVEL_NAMES: LogLevel[] = ["error", "warn", "info", "debug"];

// Shape of the createRosie factory's resolved Module.
export interface RosieModule {
  ccall: (
    name: string,
    returnType: "string" | "number" | null,
    argTypes: Array<"string" | "number">,
    args: Array<string | number | null>,
    opts?: { async?: boolean }
  ) => unknown;
  cwrap: (
    name: string,
    returnType: "string" | "number" | null,
    argTypes: Array<"string" | "number">,
    opts?: { async?: boolean }
  ) => (...args: Array<string | number | null>) => unknown;
  _free: (ptr: number) => void;
  UTF8ToString: (ptr: number) => string;
  HEAPU8?: Uint8Array;
  /** Slot the C log bridge calls into; set per-API-call. */
  __rosieLog__?: ((level: number, message: string) => void) | null;
}

interface RosieFactoryOptions {
  arguments?: string[];
  print?: (s: string) => void;
  printErr?: (s: string) => void;
  noInitialRun?: boolean;
  onAbort?: (reason: unknown) => void;
}

type RosieFactory = (opts?: RosieFactoryOptions) => Promise<RosieModule>;

let modulePromise: Promise<RosieModule> | null = null;

// Load the module once per process and install the log bridge.
async function getOrLoadModule(): Promise<RosieModule> {
  if (modulePromise) return modulePromise;

  silenceWasiExperimentalWarning();
  const mod = (await import(WASM_ENTRY_URL.href)) as { default: RosieFactory };
  const createRosie = mod.default;

  modulePromise = (async () => {
    const m = await createRosie({
      // Skip main(); API entry points are called via ccall.
      noInitialRun: true,
      // Module.print won't catch printf under NODERAWFS, so leave these as
      // defaults (they print to console.log/console.error). All rosie output
      // goes through log_* which we re-route via the bridge.
    });
    // Install the C-side log bridge so log_* messages reach __rosieLog__.
    m.ccall("rosie_api_install_log_bridge", null, [], []);
    // Tell C what host platform we're on so link.c can route symlink calls
    // through wasm_create_junction / wasm_copy_or_link_file on Windows.
    m.ccall("rosie_api_set_host_platform", null, ["string"], [process.platform]);
    return m;
  })();
  return modulePromise;
}

// Public: load the module and stash the per-call onLog handler on it before
// the C code runs. Returns the module so the caller can ccall API entries.
export async function loadModule(onLog?: OnLog): Promise<RosieModule> {
  const m = await getOrLoadModule();
  m.__rosieLog__ = onLog
    ? (level: number, message: string) => {
        const lvl = LEVEL_NAMES[level] ?? "info";
        onLog({ level: lvl, message });
      }
    : null;
  return m;
}

// Calls a C API function that returns a malloc'd char* JSON string. Copies
// the string out and frees the WASM-side buffer. Returns the parsed JSON.
//
// Always uses `async: true` so Asyncify-yielding ops (install, update — which
// call into JS fetch) work transparently. For non-yielding ops (list, agents,
// remove) the returned Promise just resolves on the same microtask.
export async function callApi<T>(mod: RosieModule, fn: string, args: Array<string | number> = []): Promise<T> {
  const argTypes = args.map((a) => (typeof a === "number" ? "number" : "string")) as Array<"string" | "number">;
  const ptr = (await mod.ccall(fn, "number", argTypes, args, { async: true })) as number;
  if (!ptr) throw new Error(`rosie-skills: ${fn} returned null`);
  try {
    const json = mod.UTF8ToString(ptr);
    return parseEnvelope<T>(json);
  } finally {
    mod._free(ptr);
  }
}

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: string;
}

function parseEnvelope<T>(json: string): T {
  let parsed: ApiEnvelope<T>;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(`rosie-skills: failed to parse WASM response: ${(e as Error).message}`);
  }
  if (!parsed.ok) {
    throw new Error(parsed.error || "rosie-skills: unknown error");
  }
  return parsed.data as T;
}
