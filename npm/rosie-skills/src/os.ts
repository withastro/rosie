// OS-interaction layer. Ported from src/os/native.rs.
//
// In the Rust crate this module exists to hide the native/wasm split; here
// there is no wasm, so it is a thin, faithful wrapper over node:fs / node:os /
// node:process that keeps the rest of the port reading like the Rust. Paths
// are plain strings throughout (Node's fs convention).
//
// Functions that the Rust returns `Result` for throw on error here; callers
// that used `.ok()?` / `match` wrap them in try/catch. Predicate-style helpers
// (exists/isDir/isFile) never throw.

import * as fs from "node:fs";
import * as nodeOs from "node:os";
import * as path from "node:path";

export type FileKind = "file" | "dir" | "symlink" | "other";

export interface Meta {
  kind: FileKind;
  size: number;
  mode: number;
}

const isWindows = process.platform === "win32";

// ---- file ops --------------------------------------------------------------

export function write(p: string, bytes: Buffer | string): void {
  fs.writeFileSync(p, bytes);
}

export function read(p: string): Buffer {
  return fs.readFileSync(p);
}

export function readToString(p: string): string {
  return fs.readFileSync(p, "utf8");
}

export function copy(src: string, dst: string): void {
  fs.copyFileSync(src, dst);
}

export function rename(src: string, dst: string): void {
  fs.renameSync(src, dst);
}

export function removeFile(p: string): void {
  fs.rmSync(p, { force: false });
}

export function removeDirAll(p: string): void {
  fs.rmSync(p, { recursive: true, force: true });
}

export function createDirAll(p: string): void {
  fs.mkdirSync(p, { recursive: true });
}

/** Directory entry names only (mirrors read_dir returning Vec<String>). */
export function readDir(p: string): string[] {
  return fs.readdirSync(p);
}

// ---- metadata --------------------------------------------------------------

function metaFromStats(st: fs.Stats): Meta {
  let kind: FileKind;
  if (st.isSymbolicLink()) kind = "symlink";
  else if (st.isDirectory()) kind = "dir";
  else if (st.isFile()) kind = "file";
  else kind = "other";
  return { kind, size: st.size, mode: st.mode };
}

export function metadata(p: string): Meta {
  return metaFromStats(fs.statSync(p));
}

export function symlinkMetadata(p: string): Meta {
  return metaFromStats(fs.lstatSync(p));
}

export function exists(p: string): boolean {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

export function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function readLink(p: string): string {
  return fs.readlinkSync(p);
}

/** Resolve a path to its absolute, symlink-free canonical form. */
export function canonicalize(p: string): string {
  return fs.realpathSync(p);
}

// ---- link creation ---------------------------------------------------------

// Create a symlink from `linkPath` to `target`. On Windows, `isDir` selects
// between a junction (directory) and a hard-link / file copy. Mirrors
// os/native.rs::create_link.
export function createLink(target: string, linkPath: string, isDir: boolean): void {
  if (!isWindows) {
    fs.symlinkSync(target, linkPath);
    return;
  }
  if (isDir) {
    // Junctions require an absolute target.
    const absTarget = path.isAbsolute(target) ? target : path.resolve(path.dirname(linkPath), target);
    fs.symlinkSync(absTarget, linkPath, "junction");
  } else {
    try {
      fs.linkSync(target, linkPath);
    } catch {
      fs.copyFileSync(target, linkPath);
    }
  }
}

export function setMode(p: string, mode: number): void {
  if (isWindows) return;
  fs.chmodSync(p, mode);
}

// ---- env / time ------------------------------------------------------------

export function homeDir(): string | null {
  if (!isWindows) {
    const v = process.env.HOME;
    return v && v.length > 0 ? v : null;
  }
  const v = process.env.USERPROFILE;
  return v && v.length > 0 ? v : null;
}

export function tempDir(): string {
  return nodeOs.tmpdir();
}

export function getenv(name: string): string | undefined {
  return process.env[name];
}

// The list of env vars that signal an AI-agent context. Mirrors
// os/native.rs::AGENT_ENV_VARS (which mirrors @vercel/detect-agent). Order
// doesn't matter — any match is sufficient.
const AGENT_ENV_VARS: string[] = [
  // Universal — any agent can set this.
  "AI_AGENT",
  // Claude Code
  "CLAUDECODE",
  "CLAUDE_CODE",
  "CLAUDE_CODE_SSE_PORT",
  // Cursor + Cursor CLI
  "CURSOR_TRACE_ID",
  "CURSOR_AGENT",
  "CURSOR_EXTENSION_HOST_ROLE",
  // Gemini CLI
  "GEMINI_CLI",
  // Codex
  "CODEX_SANDBOX",
  "CODEX_CI",
  "CODEX_THREAD_ID",
  // OpenCode
  "OPENCODE_CLIENT",
  // Antigravity
  "ANTIGRAVITY_AGENT",
  // Augment CLI
  "AUGMENT_AGENT",
  // Replit
  "REPL_ID",
  // GitHub Copilot
  "COPILOT_MODEL",
  "COPILOT_ALLOW_ALL",
  "COPILOT_GITHUB_TOKEN",
];

function nonempty(name: string): boolean {
  const v = process.env[name];
  return v !== undefined && v.length > 0;
}

// Best-effort detection of whether rosie is running inside an AI-agent
// session. Escape hatches: ROSIE_AGENT_CONTEXT=1 forces on; =0/false forces
// off. Mirrors os/native.rs::is_agent_context.
export function isAgentContext(): boolean {
  const v = process.env.ROSIE_AGENT_CONTEXT;
  if (v !== undefined) {
    if (v === "0" || v.toLowerCase() === "false") return false;
    if (v.length > 0) return true;
  }
  return AGENT_ENV_VARS.some(nonempty);
}

export function nowUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function currentDir(): string {
  return process.cwd();
}

export function setCurrentDir(p: string): void {
  process.chdir(p);
}

// Recursively copy a directory tree. Preserves file-mode bits on regular
// files. Mirrors os/native.rs::copy_dir_recursive.
export function copyDirRecursive(src: string, dst: string): void {
  createDirAll(dst);
  for (const name of readDir(src)) {
    const srcPath = path.join(src, name);
    const dstPath = path.join(dst, name);
    const meta = symlinkMetadata(srcPath);
    switch (meta.kind) {
      case "dir":
        copyDirRecursive(srcPath, dstPath);
        break;
      case "file":
        fs.copyFileSync(srcPath, dstPath);
        if (!isWindows) {
          try {
            setMode(dstPath, meta.mode);
          } catch {
            /* best effort */
          }
        }
        break;
      case "symlink": {
        const target = fs.readlinkSync(srcPath);
        createLink(target, dstPath, true);
        break;
      }
      default:
        break;
    }
  }
}

// Create a uniquely-named temp directory under the system temp dir. Mirrors
// os/native.rs::create_temp_dir, but uses mkdtemp so the name is unpredictable
// and creation is atomic (fails rather than reusing an existing directory) —
// avoids a symlink/TOCTOU foothold in a shared temp dir.
export function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(nodeOs.tmpdir(), `${prefix}-`));
}
