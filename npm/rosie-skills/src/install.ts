// Install orchestration. Faithful port of src/install.rs.
//
// Public functions return a number (0 ok, negative on error) so the CLI's
// exit-code path stays identical. Functions that touch the network are async
// (fetch); the rest stay synchronous.

import * as fs from "node:fs";
import * as path from "node:path";

import * as agent from "./agent.js";
import { Agent } from "./agent.js";
import * as agentsmd from "./agentsmd.js";
import * as archive from "./archive.js";
import * as audit from "./audit.js";
import * as download from "./download.js";
import { PackageSpec } from "./download.js";
import { rosieCreateLink } from "./link.js";
import { Lockfile, LockEntry } from "./lockfile.js";
import * as lockfile from "./lockfile.js";
import * as log from "./log.js";
import * as npm from "./npm.js";
import * as os from "./os.js";
import * as report from "./report.js";
import * as resolve from "./resolve.js";
import { ResolvedRef } from "./resolve.js";
import * as sanitize from "./sanitize.js";
import * as skill from "./skill.js";
import { Skill } from "./skill.js";
import * as util from "./util.js";

// Local install storage directories.
export const LOCAL_AGENTS_DIR = ".agents";
export const LOCAL_SKILLS_DIR = ".agents/skills";
export const LOCAL_REFERENCES_DIR = ".agents/references";
export const GLOBAL_AGENTS_SUBDIR = ".agents";

// Directory that holds rosie.lock for the given scope. Returns null if $HOME
// is unset under global=true. Mirrors install.rs::lockfile_dir.
export function lockfileDir(global: boolean): string | null {
  if (global) {
    const home = os.homeDir();
    if (home === null) return null;
    return path.join(home, GLOBAL_AGENTS_SUBDIR);
  }
  return LOCAL_AGENTS_DIR;
}

// ---------------------------------------------------------------------------
// Options structs — mirror InstallOptions / RemoveOptions.
// ---------------------------------------------------------------------------

export interface InstallOptions {
  spec: string | null;
  skillName: string | null;
  agentNames: string[];
  global: boolean;
  yes: boolean;
  listOnly: boolean;
  overridePinned: boolean;
  pinned: boolean;
  isReference: boolean;
  nameOverride: string | null;
  isNpm: boolean;
  includePaths: string[];
  skipLockfile: boolean;
  stripComments: boolean;
  stripInvisible: boolean;
  retagDetect: boolean;
  forceAudit: boolean;
  suppressAudit: boolean;
}

export function defaultInstallOptions(): InstallOptions {
  return {
    spec: null,
    skillName: null,
    agentNames: [],
    global: false,
    yes: false,
    listOnly: false,
    overridePinned: false,
    pinned: false,
    isReference: false,
    nameOverride: null,
    isNpm: false,
    includePaths: [],
    skipLockfile: false,
    stripComments: true,
    stripInvisible: true,
    retagDetect: true,
    forceAudit: false,
    suppressAudit: false,
  };
}

export interface RemoveOptions {
  skillName: string;
  agentNames: string[];
  global: boolean;
  yes: boolean;
  skipLockfile: boolean;
}

export function defaultRemoveOptions(): RemoveOptions {
  return { skillName: "", agentNames: [], global: false, yes: false, skipLockfile: false };
}

function sanitizeOptsReference(opts: InstallOptions): sanitize.SanitizeOpts {
  return { stripComments: opts.stripComments, stripInvisible: opts.stripInvisible };
}

function sanitizeOptsSkill(opts: InstallOptions): sanitize.SanitizeOpts {
  return { stripComments: false, stripInvisible: opts.stripInvisible };
}

// ---------------------------------------------------------------------------
// Small i/o helpers
// ---------------------------------------------------------------------------

function writeStringToFile(p: string, contents: string): number {
  const parent = path.dirname(p);
  if (parent.length > 0) {
    try {
      os.createDirAll(parent);
    } catch (e) {
      log.error(`Cannot create directory: ${errMsg(e)}`);
      return -1;
    }
  }
  try {
    os.write(p, contents);
  } catch (e) {
    log.error(`Cannot create ${p}: ${errMsg(e)}`);
    return -1;
  }
  return 0;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function readLineSync(): string {
  const buf = Buffer.alloc(1);
  let s = "";
  for (;;) {
    let n: number;
    try {
      n = fs.readSync(0, buf, 0, 1, null);
    } catch {
      break;
    }
    if (n === 0) break;
    const ch = buf.toString("utf8");
    if (ch === "\n") break;
    s += ch;
  }
  return s;
}

// Default-yes prompt: 'y'/'Y' or empty accepts.
function askYesNo(prompt: string): boolean {
  process.stdout.write(prompt);
  const trimmed = readLineSync().trim();
  const first = trimmed.charAt(0);
  return first === "y" || first === "Y" || trimmed.length === 0;
}

// Default-no prompt: only 'y'/'Y' accepts.
function askYesNoDefaultNo(prompt: string): boolean {
  process.stdout.write(prompt);
  const trimmed = readLineSync().trim();
  const first = trimmed.charAt(0);
  return first === "y" || first === "Y";
}

function selectAgents(agentNames: string[], global: boolean): Agent[] {
  if (agentNames.length > 0) return agent.agentsFromNames(agentNames, global);
  return agent.detectAgents(global);
}

// ---------------------------------------------------------------------------
// install_skill_to_agent — global install (copy to ~/.<agent>/skills)
// ---------------------------------------------------------------------------

export function installSkillToAgent(sk: Skill, ag: Agent, opts: InstallOptions): number {
  const targetDir = path.join(ag.installPath, sk.name);
  log.debug(`Installing ${sk.name} to ${targetDir}`);
  try {
    os.createDirAll(ag.installPath);
  } catch (e) {
    log.error(`Cannot create directory: ${errMsg(e)}`);
    return -1;
  }
  try {
    os.copyDirRecursive(sk.path, targetDir);
  } catch (e) {
    log.error(`Failed to copy skill: ${sk.name} (${errMsg(e)})`);
    return -1;
  }
  try {
    sanitize.sanitizeSkillDir(targetDir, sanitizeOptsSkill(opts));
  } catch (e) {
    log.error(`Failed to sanitize skill: ${sk.name} (${errMsg(e)})`);
    return -1;
  }
  return 0;
}

// Local install: symlink an agent's skills dir to the canonical path. Mirrors
// install.rs::install_skill_local.
function installSkillLocal(skillName: string, ag: Agent, canonicalPath: string): number {
  if (ag.installPath === LOCAL_SKILLS_DIR) {
    return 0;
  }
  try {
    os.createDirAll(ag.installPath);
  } catch (e) {
    log.error(`Cannot create directory: ${errMsg(e)}`);
    return -1;
  }
  const linkPath = path.join(ag.installPath, skillName);
  // Remove existing symlink or directory if present.
  try {
    const m = os.symlinkMetadata(linkPath);
    if (m.kind === "symlink") {
      try {
        os.removeFile(linkPath);
      } catch {
        /* ignore */
      }
    } else if (m.kind === "dir") {
      log.debug(`Skipping ${linkPath} (already exists as directory)`);
      return 0;
    }
  } catch {
    /* not present */
  }
  let target: string;
  if (path.isAbsolute(canonicalPath)) {
    target = canonicalPath;
  } else {
    const depth = ag.installPath
      .split("/")
      .filter((c) => c.length > 0 && c !== "." && c !== "..").length;
    let prefix = "";
    for (let i = 0; i < depth; i++) prefix += "../";
    target = `${prefix}${canonicalPath}`;
  }
  log.debug(`Symlink: ${linkPath} -> ${target}`);
  return rosieCreateLink(target, linkPath, true);
}

function installToCanonical(sk: Skill, opts: InstallOptions): string | null {
  const canonicalDir = path.join(LOCAL_SKILLS_DIR, sk.name);
  log.debug(`Installing to canonical path: ${canonicalDir}`);
  try {
    os.createDirAll(LOCAL_SKILLS_DIR);
  } catch (e) {
    log.error(`Cannot create directory: ${LOCAL_SKILLS_DIR}: ${errMsg(e)}`);
    return null;
  }
  try {
    os.copyDirRecursive(sk.path, canonicalDir);
  } catch (e) {
    log.error(`Failed to copy skill: ${sk.name} (${errMsg(e)})`);
    return null;
  }
  try {
    sanitize.sanitizeSkillDir(canonicalDir, sanitizeOptsSkill(opts));
  } catch (e) {
    log.error(`Failed to sanitize skill: ${sk.name} (${errMsg(e)})`);
    return null;
  }
  return canonicalDir;
}

// ---------------------------------------------------------------------------
// Local-path install (file://… or ./path)
// ---------------------------------------------------------------------------

function installLocal(canonicalRel: string, opts: InstallOptions): number {
  if (!os.isDir(canonicalRel)) {
    log.error(`Local skill directory not found: ${canonicalRel}`);
    return -1;
  }
  const skillMd = path.join(canonicalRel, "SKILL.md");
  const sk = skill.parseSkillFile(skillMd);
  if (sk === null) {
    log.error(`No valid SKILL.md in ${canonicalRel}`);
    return -1;
  }
  if (opts.skillName !== null && sk.name !== opts.skillName) {
    log.error(`Skill name mismatch: SKILL.md declares '${sk.name}', expected '${opts.skillName}'`);
    return -1;
  }

  log.info(`Linking local skill: ${sk.name} (${canonicalRel})`);

  const agents = selectAgents(opts.agentNames, opts.global);
  if (agents.length === 0) {
    log.error("No agents detected. Use --agent to specify target agent.");
    return -1;
  }

  if (opts.listOnly) {
    log.info("Found 1 skill:");
    skill.printSkill(sk);
    return 0;
  }

  const linkTarget = opts.global ? canonicalRel : path.join(LOCAL_SKILLS_DIR, sk.name);

  if (!opts.yes) {
    const prompt = opts.global
      ? `\nSymlink ${canonicalRel} into ${agents.length} agent(s)' global skills/ dir? [Y/n] `
      : `\nLink ${canonicalRel} -> ${LOCAL_SKILLS_DIR}/${sk.name} for ${agents.length} agent(s)? [Y/n] `;
    if (!askYesNo(prompt)) {
      log.info("Cancelled.");
      return 0;
    }
  }

  if (!opts.global) {
    try {
      os.createDirAll(LOCAL_SKILLS_DIR);
    } catch (e) {
      log.error(`Cannot create directory: ${LOCAL_SKILLS_DIR}: ${errMsg(e)}`);
      return -1;
    }

    const relForLink = canonicalRel.startsWith("./") ? canonicalRel.slice(2) : canonicalRel;
    const canonicalTarget = relForLink.length === 0 || relForLink === "." ? "../.." : `../../${relForLink}`;
    const canonicalLink = linkTarget;

    let handled = false;
    try {
      const m = os.symlinkMetadata(canonicalLink);
      handled = true;
      if (m.kind === "symlink") {
        let existing = "";
        try {
          existing = os.readLink(canonicalLink);
        } catch {
          existing = "";
        }
        if (existing === canonicalTarget) {
          log.debug(`Canonical symlink already correct: ${canonicalLink}`);
        } else {
          let removed = true;
          try {
            os.removeFile(canonicalLink);
          } catch {
            removed = false;
          }
          if (!removed || rosieCreateLink(canonicalTarget, canonicalLink, true) !== 0) {
            return -1;
          }
        }
      } else {
        log.error(`Refusing to overwrite existing non-symlink at ${canonicalLink}`);
        return -1;
      }
    } catch {
      // not present
    }
    if (!handled) {
      if (rosieCreateLink(canonicalTarget, canonicalLink, true) !== 0) {
        return -1;
      }
    }

    log.info(`  ${canonicalLink} -> ${canonicalTarget}`);
  }

  let linked = 0;
  const okAgents: string[] = [];
  const failAgents: string[] = [];
  for (const a of agents) {
    if (installSkillLocal(sk.name, a, linkTarget) === 0) {
      linked += 1;
      okAgents.push(a.def.name);
    } else {
      failAgents.push(a.def.name);
    }
  }
  log.info(`    symlink -> ${linked} agent(s)`);
  report.push({ kind: "skill", skillName: sk.name, installedAgents: okAgents, failedAgents: failAgents });

  if (!opts.skipLockfile) {
    const lfDir = lockfileDir(opts.global);
    if (lfDir === null) {
      log.error("Cannot determine home directory for global lockfile");
      return -1;
    }
    try {
      os.createDirAll(lfDir);
    } catch (e) {
      log.error(`Cannot create directory: ${lfDir} (${errMsg(e)})`);
      return -1;
    }
    const lf = Lockfile.load(lfDir);
    const now = lockfile.nowIso8601();
    const source = `file://${canonicalRel}`;
    lf.upsert(sk.name, source, "-", "-", now, true, "skill");
    try {
      lf.save();
    } catch (e) {
      log.error(`Warning: failed to write ${lf.path}: ${errMsg(e)}`);
    }
  }

  log.info(`Linked ${sk.name}.`);
  return 0;
}

// ---------------------------------------------------------------------------
// Reference helpers
// ---------------------------------------------------------------------------

function defaultRefName(spec: PackageSpec, skillName: string | null): string {
  const owner = spec.owner ?? "";
  const repo = spec.repo ?? "";
  if (skillName !== null && skillName.length > 0) return `${owner}-${repo}-${skillName}`;
  return `${owner}-${repo}`;
}

function findReadmeInTree(root: string): string | null {
  const exact = path.join(root, "README.md");
  if (os.isFile(exact)) return exact;
  let entries: string[];
  try {
    entries = os.readDir(root);
  } catch {
    return null;
  }
  for (const name of entries) {
    if (name.length < 6) continue;
    if (name.toLowerCase().startsWith("readme")) {
      const candidate = path.join(root, name);
      if (os.isFile(candidate)) return candidate;
    }
  }
  return null;
}

// Copy node_modules/<pkg>/<relPath> into .agents/references/<name>/REFERENCE.md.
// Mirrors install.rs::npm_install_one.
function npmInstallOne(name: string, pkg: string, relPath: string, opts: InstallOptions): number {
  const refDir = path.join(LOCAL_REFERENCES_DIR, name);
  try {
    os.createDirAll(refDir);
  } catch (e) {
    log.error(`Cannot create directory: ${refDir} (${errMsg(e)})`);
    return -1;
  }
  const refFile = path.join(refDir, "REFERENCE.md");
  const src = path.join("node_modules", pkg, relPath);

  // Read prior content (if any) before we overwrite.
  let prior: string | null = null;
  try {
    const m = os.symlinkMetadata(refFile);
    if (m.kind === "file") {
      try {
        prior = os.readToString(refFile);
      } catch {
        prior = null;
      }
    }
  } catch {
    prior = null;
  }

  // Remove any prior install (symlink from an older rosie or a stale copy).
  try {
    const m = os.symlinkMetadata(refFile);
    if (m.kind === "symlink" || m.kind === "file") {
      try {
        os.removeFile(refFile);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* not present */
  }

  let body: string;
  try {
    body = os.readToString(src);
  } catch (e) {
    log.error(`Cannot read ${src}: ${errMsg(e)}`);
    return -1;
  }
  body = sanitize.sanitizeReference(body, sanitizeOptsReference(opts));
  const rc = writeStringToFile(refFile, body);
  if (rc !== 0) return rc;

  const operation: audit.Operation = prior !== null ? "update" : "install";
  let contentField: string | null;
  let diffField: string | null;
  if (prior !== null && operation === "update") {
    contentField = null;
    diffField = audit.unifiedDiff(name, prior, body);
  } else {
    contentField = body;
    diffField = null;
  }
  audit.pushChange({
    name,
    kind: "reference",
    source: npmLockSource(pkg, relPath),
    ref: "",
    sha: "",
    operation,
    content: contentField,
    diff: diffField,
  });

  return 0;
}

function npmLockSource(pkg: string, relPath: string): string {
  return `npm:${pkg}#${relPath}`;
}

function installNpmReferences(opts: InstallOptions): number {
  const pkg = opts.spec;
  if (pkg === null || pkg.length === 0) {
    log.error("--npm requires a package name");
    return -1;
  }
  const pkgRoot = path.join("node_modules", pkg);
  if (!os.isDir(pkgRoot)) {
    log.error(`npm package not found: ${pkgRoot} (run \`npm install ${pkg}\` first)`);
    return -1;
  }
  const pjson = path.join(pkgRoot, "package.json");
  const version = util.readJsonStringField(pjson, "version");
  if (version === undefined) {
    log.error(`Cannot read version from ${pkgRoot}/package.json`);
    return -1;
  }
  log.info(`Installing npm references for ${pkg}@${version}...`);

  const files = npm.collectFiles(pkgRoot, opts.includePaths);
  if (files.length === 0) {
    log.error(`No matching .md files found in ${pkgRoot}`);
    return -1;
  }

  const lf = opts.skipLockfile ? null : Lockfile.load(LOCAL_AGENTS_DIR);
  const now = opts.skipLockfile ? "" : lockfile.nowIso8601();
  let installed = 0;

  for (const rel of files) {
    const name = npm.refName(pkg, rel);
    if (npmInstallOne(name, pkg, rel, opts) !== 0) continue;
    if (lf !== null) {
      const source = npmLockSource(pkg, rel);
      lf.upsert(name, source, "-", version, now, false, "ref");
    }
    log.info(`  ${name}`);
    report.push({ skillName: name, kind: "reference", installedAgents: [], failedAgents: [] });
    installed += 1;
  }

  if (lf !== null) {
    try {
      lf.save();
    } catch (e) {
      log.error(`Warning: failed to write ${lf.path}: ${errMsg(e)}`);
    }
    if (agentsmd.rebuildBlock(lf) !== 0) {
      log.error(`Warning: failed to update ${agentsmd.targetPath()}`);
    }
  }

  log.info(`Installed ${installed} npm reference(s).`);
  return installed > 0 ? 0 : -1;
}

// Install a reference (--ref) from an extracted source tree. Mirrors
// install.rs::install_reference_from_extracted.
function installReferenceFromExtracted(
  extracted: string,
  spec: PackageSpec,
  opts: InstallOptions,
  resolved: ResolvedRef | null
): number {
  const skillName = opts.skillName ?? spec.skillInSpec;

  const name = opts.nameOverride !== null && opts.nameOverride.length > 0 ? opts.nameOverride : defaultRefName(spec, skillName);

  let body: string | null;
  if (skillName !== null) {
    const skills = skill.discoverSkills(extracted);
    if (skills.length === 0) {
      log.error("No skills found in package");
      return -1;
    }
    const m = skills.find((sk) => sk.name === skillName);
    if (m) {
      body = skill.stripYamlFrontmatter(m.skillFile);
    } else {
      log.error(`Skill '${skillName}' not found in package`);
      log.info("Available skills:");
      skill.printList(skills);
      return -1;
    }
  } else {
    const r = findReadmeInTree(extracted);
    if (r !== null) {
      body = skill.stripYamlFrontmatter(r);
    } else {
      log.error("No README found in repository root");
      return -1;
    }
  }

  if (body === null) {
    log.error("Failed to read reference source");
    return -1;
  }

  body = sanitize.sanitizeReference(body, sanitizeOptsReference(opts));

  const refDir = path.join(LOCAL_REFERENCES_DIR, name);
  const refFile = path.join(refDir, "REFERENCE.md");

  let prior: string | null = null;
  try {
    prior = os.readToString(refFile);
  } catch {
    prior = null;
  }
  const operation: audit.Operation = prior !== null ? "update" : "install";

  if (writeStringToFile(refFile, body) !== 0) return -1;

  const ownerAudit = spec.owner ?? "";
  const repoAudit = spec.repo ?? "";
  const sourceAudit = skillName !== null ? `${ownerAudit}/${repoAudit}#${skillName}` : `${ownerAudit}/${repoAudit}`;
  let contentField: string | null;
  let diffField: string | null;
  if (prior !== null && operation === "update") {
    contentField = null;
    diffField = audit.unifiedDiff(name, prior, body);
  } else {
    contentField = body;
    diffField = null;
  }
  audit.pushChange({
    name,
    kind: "reference",
    source: sourceAudit,
    ref: spec.ref ?? "",
    sha: resolved?.sha ?? "",
    operation,
    content: contentField,
    diff: diffField,
  });
  log.info(`  ${refFile}`);
  report.push({ skillName: name, kind: "reference", installedAgents: [], failedAgents: [] });

  const owner = spec.owner ?? "";
  const repo = spec.repo ?? "";
  const source = skillName !== null ? `${owner}/${repo}#${skillName}` : `${owner}/${repo}`;

  if (!opts.skipLockfile) {
    const lf = Lockfile.load(LOCAL_AGENTS_DIR);
    const now = lockfile.nowIso8601();
    const effectivePinned = opts.overridePinned ? opts.pinned : spec.refExplicit;
    const sha = resolved?.sha ?? "-";
    const ref = spec.ref ?? "-";
    lf.upsert(name, source, ref, sha, now, effectivePinned, "ref");
    try {
      lf.save();
    } catch (e) {
      log.error(`Warning: failed to write ${lf.path}: ${errMsg(e)}`);
    }
    if (agentsmd.rebuildBlock(lf) !== 0) {
      log.error(`Warning: failed to update ${agentsmd.targetPath()}`);
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// install_package — the main install entry point
// ---------------------------------------------------------------------------

export async function installPackage(opts: InstallOptions): Promise<number> {
  const specStr = opts.spec;
  if (specStr === null || specStr.length === 0) {
    log.error("No package specified");
    return -1;
  }

  if (opts.isNpm) {
    return installNpmReferences(opts);
  }

  const spec = download.parse(specStr, opts.global);
  if (spec === null) return -1;

  if (spec.isLocal) {
    const canonical = spec.localPath ?? "";
    return installLocal(canonical, opts);
  }

  log.info(`Installing ${spec.owner ?? ""}/${spec.repo ?? ""}...`);

  // Resolve the ref before downloading.
  let resolved: ResolvedRef | null;
  if (!spec.refExplicit) {
    const r = await resolve.resolveAuto(spec);
    if (r !== null) {
      const kind = r.isTag ? "" : " (branch)";
      log.info(`Resolved ${spec.owner ?? ""}/${spec.repo ?? ""} -> ${r.ref}${kind}`);
      spec.ref = r.ref;
      resolved = r;
    } else {
      log.debug(`Could not resolve ${spec.owner ?? ""}/${spec.repo ?? ""}`);
      resolved = null;
    }
  } else {
    const cur = spec.ref ?? "";
    resolved = await resolve.resolveRef(spec, cur);
  }
  if (resolved === null) {
    log.debug(`Could not resolve SHA for ${spec.ref ?? ""}, lockfile entry will use stub`);
  }

  let tempDir: string;
  try {
    tempDir = os.createTempDir("rosie");
  } catch (e) {
    log.error(`Cannot create temp directory: ${errMsg(e)}`);
    return -1;
  }
  const tarballPath = path.join(tempDir, "package.tar.gz");
  log.info("Downloading...");
  if ((await download.downloadPackageTarball(spec, tarballPath)) !== 0) {
    log.error("Failed to download package");
    safeRemoveDir(tempDir);
    return -1;
  }

  log.info("Extracting...");
  if (archive.extractTarball(tarballPath, tempDir) !== 0) {
    log.error("Failed to extract package");
    safeRemoveDir(tempDir);
    return -1;
  }

  const root = archive.rootDir(tarballPath);
  const extractedPath = root !== null ? path.join(tempDir, root) : tempDir;

  if (opts.isReference) {
    const rc = installReferenceFromExtracted(extractedPath, spec, opts, resolved);
    safeRemoveDir(tempDir);
    return rc;
  }

  log.info("Discovering skills...");
  let skills = skill.discoverSkills(extractedPath);
  if (skills.length === 0) {
    log.error("No skills found in package");
    safeRemoveDir(tempDir);
    return -1;
  }

  if (opts.skillName !== null) {
    const want = opts.skillName;
    const found = skills.find((s) => s.name === want);
    if (!found) {
      log.error(`Skill '${want}' not found in package`);
      log.info("Available skills:");
      skill.printList(skills);
      safeRemoveDir(tempDir);
      return -1;
    }
    skills = [found];
  }

  log.info(`Found ${skills.length} skill(s):`);
  skill.printList(skills);

  if (opts.listOnly) {
    safeRemoveDir(tempDir);
    return 0;
  }

  const agents = selectAgents(opts.agentNames, opts.global);
  if (agents.length === 0) {
    log.error("No agents detected. Use --agent to specify target agent.");
    safeRemoveDir(tempDir);
    return -1;
  }

  log.info("Target agents:");
  for (const a of agents) {
    log.info(`  ${a.def.display} (${a.installPath})`);
  }

  if (!opts.yes) {
    if (!askYesNo("\nProceed with installation? [Y/n] ")) {
      log.info("Installation cancelled.");
      safeRemoveDir(tempDir);
      return 0;
    }
  }

  let installed = 0;
  const owner = spec.owner ?? "";
  const repo = spec.repo ?? "";
  const source = `${owner}/${repo}`;
  const refNameAudit = spec.ref ?? "";
  const shaAudit = resolved?.sha ?? "";

  if (opts.global) {
    for (const s of skills) {
      let newSkillMd = "";
      try {
        newSkillMd = os.readToString(s.skillFile);
      } catch {
        newSkillMd = "";
      }
      const okAgents: string[] = [];
      const failAgents: string[] = [];
      for (const a of agents) {
        if (installSkillToAgent(s, a, opts) === 0) {
          installed += 1;
          okAgents.push(a.def.name);
        } else {
          failAgents.push(a.def.name);
        }
      }
      report.push({ skillName: s.name, kind: "skill", installedAgents: okAgents, failedAgents: failAgents });
      audit.pushChange({
        name: s.name,
        kind: "skill",
        source,
        ref: refNameAudit,
        sha: shaAudit,
        operation: "install",
        content: sanitize.sanitizeSkill(newSkillMd, sanitizeOptsSkill(opts)),
        diff: null,
      });
    }
    log.info(`Installed ${installed} skill(s) to ${agents.length} agent(s).`);
  } else {
    const lf = opts.skipLockfile ? null : Lockfile.load(LOCAL_AGENTS_DIR);
    const now = opts.skipLockfile ? "" : lockfile.nowIso8601();
    const effectivePinned = opts.overridePinned ? opts.pinned : spec.refExplicit;

    for (const s of skills) {
      const canonicalSkillMd = path.join(LOCAL_SKILLS_DIR, s.name, "SKILL.md");
      let priorSkill: string | null = null;
      try {
        priorSkill = os.readToString(canonicalSkillMd);
      } catch {
        priorSkill = null;
      }

      const canonical = installToCanonical(s, opts);
      if (canonical === null) continue;
      log.info(`  ${canonical}`);
      log.info(`    symlink -> ${agents.length} agent(s)`);
      const okAgents: string[] = [];
      const failAgents: string[] = [];
      for (const a of agents) {
        if (installSkillLocal(s.name, a, canonical) === 0) {
          installed += 1;
          okAgents.push(a.def.name);
        } else {
          failAgents.push(a.def.name);
        }
      }
      report.push({ skillName: s.name, kind: "skill", installedAgents: okAgents, failedAgents: failAgents });

      let newSkillMd = "";
      try {
        newSkillMd = os.readToString(path.join(canonical, "SKILL.md"));
      } catch {
        newSkillMd = "";
      }
      const operation: audit.Operation = priorSkill !== null ? "update" : "install";
      let contentField: string | null;
      let diffField: string | null;
      if (priorSkill !== null && operation === "update") {
        contentField = null;
        diffField = audit.unifiedDiff(s.name, priorSkill, newSkillMd);
      } else {
        contentField = newSkillMd;
        diffField = null;
      }
      audit.pushChange({
        name: s.name,
        kind: "skill",
        source,
        ref: refNameAudit,
        sha: shaAudit,
        operation,
        content: contentField,
        diff: diffField,
      });

      if (lf !== null) {
        const sha = resolved?.sha ?? "-";
        lf.upsert(s.name, source, spec.ref ?? "-", sha, now, effectivePinned, "skill");
      }
    }
    if (lf !== null) {
      try {
        lf.save();
      } catch (e) {
        log.error(`Warning: failed to write ${lf.path}: ${errMsg(e)}`);
      }
    }
    log.info(`Installed ${installed} skill(s) via symlinks.`);
  }

  safeRemoveDir(tempDir);
  return 0;
}

function safeRemoveDir(p: string): void {
  try {
    os.removeDirAll(p);
  } catch {
    /* best effort */
  }
}

// ---------------------------------------------------------------------------
// remove_skill
// ---------------------------------------------------------------------------

function removeReference(opts: RemoveOptions): number {
  const refDir = path.join(LOCAL_REFERENCES_DIR, opts.skillName);
  const present = os.isDir(refDir);
  if (!present) {
    log.info(`Reference '${opts.skillName}' has no on-disk directory; cleaning lockfile entry`);
  }
  if (!opts.yes) {
    const prompt = `\nRemove reference '${opts.skillName}'? [y/N] `;
    if (!askYesNoDefaultNo(prompt)) {
      log.info("Removal cancelled.");
      return 0;
    }
  }
  if (present) {
    try {
      os.removeDirAll(refDir);
    } catch (e) {
      log.error(`Failed to remove ${refDir}: ${errMsg(e)}`);
    }
  }
  if (!opts.skipLockfile) {
    const lf = Lockfile.load(LOCAL_AGENTS_DIR);
    if (lf.remove(opts.skillName)) {
      try {
        lf.save();
      } catch (e) {
        log.error(`Warning: failed to update ${lf.path}: ${errMsg(e)}`);
      }
    }
    if (agentsmd.rebuildBlock(lf) !== 0) {
      log.error(`Warning: failed to update ${agentsmd.targetPath()}`);
    }
  }
  log.info(`Removed reference '${opts.skillName}'.`);
  return 0;
}

export function removeSkill(opts: RemoveOptions): number {
  if (opts.skillName.length === 0) {
    log.error("No skill specified");
    return -1;
  }
  // Branch on lockfile kind first: refs aren't symlinked into agents.
  if (!opts.global) {
    const lfPeek = Lockfile.load(LOCAL_AGENTS_DIR);
    const e = lfPeek.find(opts.skillName);
    if (e && e.kind === "ref") {
      return removeReference(opts);
    }
  }

  const agents = selectAgents(opts.agentNames, opts.global);
  if (agents.length === 0) {
    log.error("No agents detected. Use --agent to specify target agent.");
    return -1;
  }

  let foundCount = 0;
  for (const a of agents) {
    const skillPath = path.join(a.installPath, opts.skillName);
    try {
      os.symlinkMetadata(skillPath);
      foundCount += 1;
      log.info(`Found: ${opts.skillName} (${skillPath})`);
    } catch {
      /* not present */
    }
  }
  if (foundCount === 0) {
    log.error(`Skill '${opts.skillName}' not found in any agent`);
    return -1;
  }

  if (!opts.yes) {
    const prompt = `\nRemove '${opts.skillName}' from ${foundCount} agent(s)? [y/N] `;
    if (!askYesNoDefaultNo(prompt)) {
      log.info("Removal cancelled.");
      return 0;
    }
  }

  let removed = 0;
  for (const a of agents) {
    const skillPath = path.join(a.installPath, opts.skillName);
    let kind: os.FileKind;
    try {
      kind = os.symlinkMetadata(skillPath).kind;
    } catch {
      continue;
    }
    log.debug(`Removing: ${skillPath}`);
    let ok = true;
    try {
      if (kind === "dir") os.removeDirAll(skillPath);
      else os.removeFile(skillPath);
    } catch {
      ok = false;
    }
    if (ok) removed += 1;
    else log.error(`Failed to remove: ${skillPath}`);
  }
  log.info(`Removed '${opts.skillName}' from ${removed} agent(s).`);

  if (!opts.global && !opts.skipLockfile) {
    const lf = Lockfile.load(LOCAL_AGENTS_DIR);
    if (lf.remove(opts.skillName)) {
      try {
        lf.save();
      } catch (e) {
        log.error(`Warning: failed to update ${lf.path}: ${errMsg(e)}`);
      }
    }
  }
  return 0;
}

// ---------------------------------------------------------------------------
// install_from_lockfile / update_skills helpers
// ---------------------------------------------------------------------------

function buildSpecString(source: string, ref: string): string {
  return `${source}@${ref}`;
}

export async function installFromLockfile(baseOpts: InstallOptions): Promise<number> {
  const lfDir = lockfileDir(baseOpts.global);
  if (lfDir === null) {
    log.error("Cannot determine home directory for global lockfile");
    return 1;
  }
  const lf = Lockfile.load(lfDir);
  if (lf.entries.length === 0) {
    log.error(`No lockfile entries to install (${lf.path})`);
    log.info("Did you mean: rosie install <owner/repo>?");
    return 1;
  }

  const snap: LockEntry[] = lf.entries.map((e) => ({ ...e }));
  const count = snap.length;
  log.info(`Reinstalling ${count} skill(s) from lockfile...`);

  let ok = 0;
  let fail = 0;
  let fresh = 0;
  let present = 0;

  for (const e of snap) {
    if (baseOpts.global && !download.sourceIsLocal(e.source)) {
      log.info(`warning: ${e.skillName}: --global only supports local skill installs, skipping (${e.source})`);
      continue;
    }

    if (download.sourceIsNpm(e.source)) {
      const split = download.sourceNpmSplit(e.source);
      if (split === null || split[1] === null) {
        log.error(`malformed npm source: ${e.source}`);
        fail += 1;
        continue;
      }
      const [pkg, fileRel] = split as [string, string];
      const absFile = path.join("node_modules", pkg, fileRel);
      if (!os.isFile(absFile)) {
        log.info(`warning: ${e.skillName} npm package missing locally, skipping (${absFile})`);
        continue;
      }
      if (npmInstallOne(e.skillName, pkg, fileRel, baseOpts) === 0) {
        ok += 1;
        fresh += 1;
      } else {
        fail += 1;
      }
      continue;
    }

    if (download.sourceIsLocal(e.source)) {
      const canonicalRel = download.sourceLocalPath(e.source);
      if (canonicalRel === null) continue;
      if (!os.isDir(canonicalRel)) {
        log.info(`warning: ${e.skillName} source missing locally, skipping (${canonicalRel})`);
        continue;
      }
      const opts: InstallOptions = {
        ...baseOpts,
        spec: null,
        skillName: e.skillName,
        yes: true,
        listOnly: false,
        global: baseOpts.global,
        overridePinned: false,
        pinned: false,
      };
      if (installLocal(canonicalRel, opts) === 0) ok += 1;
      else fail += 1;
      continue;
    }

    if (e.kind === "ref") {
      const refMd = path.join(LOCAL_REFERENCES_DIR, e.skillName, "REFERENCE.md");
      if (os.isFile(refMd)) {
        log.info(`${e.skillName}: already at ${e.ref} (reference)`);
        present += 1;
        ok += 1;
        continue;
      }
      const specStr = buildSpecString(e.source, e.ref);
      const opts: InstallOptions = {
        ...baseOpts,
        spec: specStr,
        skillName: null,
        nameOverride: e.skillName,
        isReference: true,
        yes: true,
        listOnly: false,
        global: false,
        overridePinned: true,
        pinned: e.pinned,
      };
      if ((await installPackage(opts)) === 0) {
        ok += 1;
        fresh += 1;
      } else {
        fail += 1;
      }
      continue;
    }

    // Trust the lockfile: if .agents/skills/<name>/SKILL.md is there, relink.
    const canonical = path.join(LOCAL_SKILLS_DIR, e.skillName);
    const presentOnDisk = os.isFile(path.join(canonical, "SKILL.md"));
    if (presentOnDisk) {
      const agents = selectAgents(baseOpts.agentNames, false);
      let linked = 0;
      const okAgents: string[] = [];
      const failAgents: string[] = [];
      for (const a of agents) {
        if (installSkillLocal(e.skillName, a, canonical) === 0) {
          linked += 1;
          okAgents.push(a.def.name);
        } else {
          failAgents.push(a.def.name);
        }
      }
      log.info(`${e.skillName}: already at ${e.ref} (${linked} agent symlink(s))`);
      report.push({ skillName: e.skillName, kind: "skill", installedAgents: okAgents, failedAgents: failAgents });
      present += 1;
      ok += 1;
      continue;
    }

    const specStr = buildSpecString(e.source, e.ref);
    const opts: InstallOptions = {
      ...baseOpts,
      spec: specStr,
      skillName: e.skillName,
      yes: true,
      listOnly: false,
      global: false,
      overridePinned: true,
      pinned: e.pinned,
    };
    if ((await installPackage(opts)) === 0) {
      ok += 1;
      fresh += 1;
    } else {
      fail += 1;
    }
  }

  if (!baseOpts.global) {
    const lfFinal = Lockfile.load(LOCAL_AGENTS_DIR);
    agentsmd.rebuildBlock(lfFinal);
  }

  if (fail > 0) {
    log.error(`Reinstalled ${ok} (${present} already present, ${fresh} fresh), ${fail} failed`);
    return 1;
  }
  if (fresh === 0) {
    log.info(`All ${ok} skill(s) already installed.`);
  } else {
    log.info(`Reinstalled ${ok} skill(s) (${present} already present, ${fresh} freshly installed).`);
  }
  return 0;
}

// ---------------------------------------------------------------------------
// update_skills
// ---------------------------------------------------------------------------

interface Counters {
  advanced: number;
  unchanged: number;
  failed: number;
}

// Reconcile a single npm package. Mutates the in-memory lockfile and counters.
function updateNpmPackage(lf: Lockfile, pkg: string, prevFiles: string[], counters: Counters, opts: InstallOptions): void {
  const pkgRoot = path.join("node_modules", pkg);
  if (!os.isDir(pkgRoot)) {
    log.error(`update: npm package missing locally: ${pkgRoot}`);
    counters.failed += 1;
    return;
  }
  const pjson = path.join(pkgRoot, "package.json");
  const version = util.readJsonStringField(pjson, "version");
  if (version === undefined) {
    log.error(`update: cannot read version from ${pkgRoot}/package.json`);
    counters.failed += 1;
    return;
  }

  const current = npm.collectFiles(pkgRoot, []);
  for (const prev of prevFiles) {
    const abs = path.join(pkgRoot, prev);
    if (!os.isFile(abs)) continue;
    if (!current.includes(prev)) current.push(prev);
  }

  // Drop entries for this pkg whose file is no longer in the current set.
  let i = 0;
  while (i < lf.entries.length) {
    const e = lf.entries[i];
    if (e.kind !== "ref" || !download.sourceIsNpm(e.source)) {
      i += 1;
      continue;
    }
    const split = download.sourceNpmSplit(e.source);
    if (split === null) {
      i += 1;
      continue;
    }
    const [epkg, efile] = split;
    if (epkg !== pkg) {
      i += 1;
      continue;
    }
    const keep = efile !== null ? current.includes(efile) : true;
    if (keep) {
      i += 1;
      continue;
    }
    log.info(`${e.skillName}: removed (no longer in package)`);
    const dir = path.join(LOCAL_REFERENCES_DIR, e.skillName);
    safeRemoveDir(dir);
    lf.remove(e.skillName);
    // Don't advance i — array shifted.
  }

  const now = lockfile.nowIso8601();
  for (const rel of current) {
    const name = npm.refName(pkg, rel);
    const source = npmLockSource(pkg, rel);

    const prev = lf.find(name);
    const wasPresent = prev !== undefined;
    const versionChanged = prev !== undefined && prev.sha !== version;

    npmInstallOne(name, pkg, rel, opts);
    lf.upsert(name, source, "-", version, now, false, "ref");

    if (!wasPresent) {
      log.info(`${name}: added`);
      counters.advanced += 1;
    } else if (versionChanged) {
      counters.advanced += 1;
    } else {
      counters.unchanged += 1;
    }
  }
  log.info(`${pkg}: refreshed at ${version} (${current.length} file(s))`);
}

export async function updateSkills(baseOpts: InstallOptions, onlySkill: string | null): Promise<number> {
  const lf0 = Lockfile.load(LOCAL_AGENTS_DIR);
  if (lf0.entries.length === 0) {
    log.error(`No lockfile entries to update (${lf0.path})`);
    return 1;
  }
  const snap: LockEntry[] = lf0.entries.map((e) => ({ ...e }));

  let matched = 0;
  const counters: Counters = { advanced: 0, unchanged: 0, failed: 0 };

  // npm pre-pass: group entries by package, reconcile each package once.
  {
    const npmLf = Lockfile.load(LOCAL_AGENTS_DIR);
    const seen: string[] = [];

    for (const e of snap) {
      if (onlySkill !== null && e.skillName !== onlySkill) continue;
      if (!download.sourceIsNpm(e.source)) continue;
      const split = download.sourceNpmSplit(e.source);
      if (split === null) continue;
      const pkg = split[0];
      if (seen.includes(pkg)) {
        matched += 1;
        continue;
      }

      const prev: string[] = [];
      for (const k of snap) {
        if (!download.sourceIsNpm(k.source)) continue;
        const ks = download.sourceNpmSplit(k.source);
        if (ks !== null && ks[0] === pkg && ks[1] !== null) prev.push(ks[1]);
      }
      updateNpmPackage(npmLf, pkg, prev, counters, baseOpts);
      seen.push(pkg);
      matched += 1;
    }

    try {
      npmLf.save();
    } catch (e) {
      log.error(`Warning: failed to write ${npmLf.path}: ${errMsg(e)}`);
    }
  }

  for (const e of snap) {
    if (onlySkill !== null && e.skillName !== onlySkill) continue;
    if (download.sourceIsNpm(e.source)) continue;
    matched += 1;

    if (download.sourceIsLocal(e.source)) {
      log.info(`${e.skillName}: local link, no update needed`);
      counters.unchanged += 1;
      continue;
    }

    const ps = download.parse(e.source, false);
    if (ps === null) {
      log.error(`update: cannot parse source '${e.source}'`);
      counters.failed += 1;
      continue;
    }

    const r = e.pinned
      ? await resolve.resolveRef(ps, e.ref)
      : (await resolve.resolveAuto(ps)) ?? (await resolve.resolveRef(ps, e.ref));

    if (r === null) {
      log.error(`update: cannot resolve ${e.source} for skill '${e.skillName}'`);
      counters.failed += 1;
      continue;
    }

    const refChanged = r.ref !== e.ref;
    const shaChanged = r.sha !== e.sha;

    if (baseOpts.retagDetect && r.isTag && shaChanged && !refChanged && e.sha !== "-") {
      audit.pushFinding({
        severity: "high",
        kind: "tag_rewritten",
        skill: e.skillName,
        ref: e.ref,
        oldSha: e.sha,
        newSha: r.sha,
      });
    }

    if (!refChanged && !shaChanged) {
      log.info(`${e.skillName}: up to date (${e.ref})`);
      counters.unchanged += 1;
      continue;
    }

    if (refChanged) {
      log.info(`${e.skillName}: ${e.ref} -> ${r.ref}`);
    } else {
      log.info(`${e.skillName}: ${e.ref} SHA changed (${e.source} upstream re-tagged?)`);
    }

    const newSpec = buildSpecString(e.source, r.ref);
    const opts: InstallOptions = { ...baseOpts };
    opts.spec = newSpec;
    opts.yes = true;
    opts.listOnly = false;
    opts.global = false;
    opts.overridePinned = true;
    opts.pinned = e.pinned;
    if (e.kind === "ref") {
      opts.skillName = null;
      opts.nameOverride = e.skillName;
      opts.isReference = true;
    } else {
      opts.skillName = e.skillName;
    }

    const rc = await installPackage(opts);
    if (rc === 0) counters.advanced += 1;
    else counters.failed += 1;
  }

  const lfFinal = Lockfile.load(LOCAL_AGENTS_DIR);
  agentsmd.rebuildBlock(lfFinal);

  if (onlySkill !== null && matched === 0) {
    log.error(`Skill '${onlySkill}' not found in lockfile`);
    return 1;
  }
  log.info(`Update complete: ${counters.advanced} updated, ${counters.unchanged} unchanged, ${counters.failed} failed`);
  return counters.failed === 0 ? 0 : 1;
}

// ---------------------------------------------------------------------------
// list_installed_skills (CLI) + listInstalled (API)
// ---------------------------------------------------------------------------

export function listInstalledSkills(global: boolean): number {
  const lfDir = lockfileDir(global);
  if (lfDir === null) {
    log.error("Cannot determine home directory for global lockfile");
    return 1;
  }
  const lf = Lockfile.load(lfDir);
  if (lf.entries.length === 0) {
    const scope = global ? "globally" : "in this project";
    process.stdout.write(`No skills installed ${scope} (${lf.path} not found or empty)\n`);
    const installHint = global ? "Install with: rosie install <owner/repo> -g" : "Install with: rosie install <owner/repo>";
    process.stdout.write(`${installHint}\n`);
    return 0;
  }
  const useColor = isStdoutTty();
  const headerScope = global ? "global " : "";
  process.stdout.write(`Installed ${headerScope}skills (${lf.path}):\n`);
  for (const e of lf.entries) {
    const kindTag = e.kind === "ref" ? "[ref]  " : "[skill]";
    const [nameOpen, nameClose] = useColor ? ["\x1b[1;34m", "\x1b[0m"] : ["", ""];
    if (download.sourceIsLocal(e.source)) {
      process.stdout.write(`  ${kindTag}  ${nameOpen}${e.skillName}${nameClose}  ${download.sourceLocalPath(e.source) ?? ""}  (linked)\n`);
    } else {
      const pinTag = e.pinned ? "(pinned)" : "";
      process.stdout.write(`  ${kindTag}  ${nameOpen}${e.skillName}${nameClose}  ${e.source}@${e.ref}  ${pinTag}\n`);
    }
  }
  return 0;
}

// API helper: return installed skills as structured records (no printing).
// Mirrors the wasm rosie_api_list_installed serialization.
export interface SkillRecord {
  name: string;
  source: string;
  ref: string | null;
  sha: string | null;
  isReference: boolean;
}

export function listInstalled(global: boolean): SkillRecord[] {
  const lfDir = lockfileDir(global);
  if (lfDir === null) return [];
  const lf = Lockfile.load(lfDir);
  // Mirror the wasm push_string_or_null: null only for an empty string. The
  // lockfile stores "-" (not empty) when there is no ref/sha, so those pass
  // through as "-".
  return lf.entries.map((e) => ({
    name: e.skillName,
    source: e.source,
    ref: e.ref.length === 0 ? null : e.ref,
    sha: e.sha.length === 0 ? null : e.sha,
    isReference: e.kind === "ref",
  }));
}

function isStdoutTty(): boolean {
  return process.stdout.isTTY === true;
}
