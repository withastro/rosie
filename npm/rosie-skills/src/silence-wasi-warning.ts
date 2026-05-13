// Suppress Node's ExperimentalWarning about `node:wasi` being unstable.
// The wasm fallback uses node:wasi via wasm/shim.js, and Node prints the
// warning to stderr the first time the module is imported. The warning is
// noise to a CLI/library user — they didn't choose WASI, we did — so we
// intercept it at the emitter.
//
// Patches process.emit('warning'); leaves every other warning untouched.
// Safe to call multiple times (the second patch wraps the first, which
// still defers to Node's original emit at the bottom of the chain).
export function silenceWasiExperimentalWarning(): void {
  const originalEmit = process.emit.bind(process);
  (process.emit as unknown) = function (
    name: string | symbol,
    ...args: unknown[]
  ): boolean {
    if (name === "warning") {
      const w = args[0] as { name?: string; message?: string } | undefined;
      if (
        w &&
        w.name === "ExperimentalWarning" &&
        (w.message ?? "").startsWith("WASI is an experimental feature")
      ) {
        return false;
      }
    }
    return (originalEmit as (n: string | symbol, ...a: unknown[]) => boolean)(name, ...args);
  };
}
