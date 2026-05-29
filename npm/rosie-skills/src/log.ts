// Logging contract. Ported from src/log.rs.
//
// Two consumers:
//   - CLI prints to stdout/stderr (the default sink).
//   - The library API installs a callback that bridges into the user's
//     `onLog`, and reads `lastError` to build the thrown Error.
//
// Invariants that must not break:
//   - error() always updates lastError (even when a callback is set).
//   - setCallback(null) restores default CLI behavior.
//   - Level integers match the Rust enum: Error=0, Warn=1, Info=2, Debug=3.

export enum Level {
  Error = 0,
  Warn = 1,
  Info = 2,
  Debug = 3,
}

export type Callback = (level: Level, message: string) => void;

let verboseFlag = false;
let callback: Callback | null = null;
let lastError: string | null = null;

export function setVerbose(v: boolean): void {
  verboseFlag = v;
}

export function verbose(): boolean {
  return verboseFlag;
}

export function setCallback(cb: Callback | null): void {
  callback = cb;
}

export function lastErrorMessage(): string | null {
  return lastError;
}

export function clearLastError(): void {
  lastError = null;
}

function dispatch(level: Level, message: string): void {
  if (callback) {
    callback(level, message);
    return;
  }
  switch (level) {
    case Level.Error:
      process.stderr.write(`rosie: error: ${message}\n`);
      break;
    case Level.Warn:
      process.stderr.write(`rosie: warning: ${message}\n`);
      break;
    case Level.Debug:
      if (verboseFlag) process.stdout.write(`[debug] ${message}\n`);
      break;
    default:
      process.stdout.write(`${message}\n`);
      break;
  }
}

// User-facing stdout output (mirrors Rust println! / log::info). In CLI mode
// this writes to stdout; in API mode it routes to the onLog callback.
export function info(message: string): void {
  dispatch(Level.Info, message);
}

export function warn(message: string): void {
  dispatch(Level.Warn, message);
}

export function error(message: string): void {
  lastError = message;
  dispatch(Level.Error, message);
}

export function debug(message: string): void {
  if (!verboseFlag && callback === null) return;
  dispatch(Level.Debug, message);
}
