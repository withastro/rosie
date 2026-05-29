// In-flight install/update reports. Ported from src/report.rs.
//
// install functions append a record per skill as they run; the API layer
// (index.ts) drains and assembles the InstallResult at the end of each call.
// The CLI flow just lets it accumulate and discards. Module-level singletons
// mirror the Rust statics; this matches the single-call-per-process model.

export type ReportKind = "skill" | "reference";

export interface InstallReport {
  skillName: string;
  kind: ReportKind;
  // Agent `name` values (e.g. "claude") that received a working copy of the
  // skill. Always empty for references.
  installedAgents: string[];
  // Agent `name` values where install failed. Always empty for references.
  failedAgents: string[];
}

let reports: InstallReport[] = [];
let instructionFile: string | null = null;

export function push(report: InstallReport): void {
  reports.push(report);
}

export function drain(): InstallReport[] {
  const out = reports;
  reports = [];
  return out;
}

// Record that agentsmd.rebuildBlock actually wrote (created or modified) the
// project's agent-instructions file. `null` means none was touched.
export function setInstructionFile(p: string | null): void {
  instructionFile = p;
}

export function takeInstructionFile(): string | null {
  const out = instructionFile;
  instructionFile = null;
  return out;
}

export function clear(): void {
  reports = [];
  instructionFile = null;
}
