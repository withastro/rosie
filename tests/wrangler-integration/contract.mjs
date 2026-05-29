// Level 1: contract smoke test.
//
// Exercises the exact rosie-skills surface wrangler depends on, without
// pulling wrangler itself. Faithfully replicates the glue in wrangler's
// packages/wrangler/src/agents-skills-install.ts:
//
//   const rosie = await import("rosie-skills");
//   const all = await rosie.agents();
//   const detected = all.filter(a => a.detected && a.installPath !== null)
//                       .map(a => ({ name: a.display, rosie: { id: a.name, globalPath: a.installPath }}));
//   const { failedAgents } = await rosie.install("cloudflare/skills",
//                              { global: true, agent: detected.map(a => a.rosie.id), lockfile: false });
//
// rosie-skills is imported by BARE SPECIFIER on purpose: wrangler keeps it as
// an external (unbundled) dependency and resolves it from node_modules at
// runtime, so this validates the package's `exports` map and ESM resolution,
// not just a deep path into dist/. run.sh wires node_modules/rosie-skills to
// the freshly built local package and runs this file from there.
//
// Env (set by run.sh): HOME (sandbox with a planted ~/.claude), PORT (mock
// GitHub server). Exits 0 on success, 1 on failure.

import * as fs from "node:fs";
import * as path from "node:path";

const PORT = parseInt(process.env.PORT ?? "8765", 10);
process.env.ROSIE_GITHUB_BASE_URL = `http://127.0.0.1:${PORT}`;

const HOME = process.env.HOME;
if (!HOME) {
  console.error("contract: HOME must be set by run.sh");
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// The repo wrangler installs skills from, and the skills our fixture ships.
const SKILLS_REPO = "cloudflare/skills";
const EXPECTED_SKILLS = ["cloudflare-workers", "cloudflare-pages"];

try {
  // 1. Bare-specifier dynamic import, exactly as wrangler does it.
  const rosie = await import("rosie-skills");
  assert(typeof rosie.agents === "function", "rosie.agents export missing");
  assert(typeof rosie.install === "function", "rosie.install export missing");

  // 2. rosie.agents() + wrangler's getDetectedAgents() filter/shape.
  const all = await rosie.agents();
  assert(Array.isArray(all) && all.length > 0, "rosie.agents() returned no agents");
  for (const a of all) {
    // Fields wrangler reads off each agent.
    assert(typeof a.name === "string", "agent.name should be a string");
    assert(typeof a.display === "string", "agent.display should be a string");
    assert(typeof a.detected === "boolean", "agent.detected should be a boolean");
    assert(
      a.installPath === null || typeof a.installPath === "string",
      "agent.installPath should be string | null"
    );
  }

  const detectedAgents = all
    .filter((a) => a.detected && a.installPath !== null)
    .map((a) => ({ name: a.display, rosie: { id: a.name, globalPath: a.installPath } }));

  assert(
    detectedAgents.length > 0,
    "no agents detected — run.sh should plant ~/.claude in the sandbox HOME"
  );
  const claude = detectedAgents.find((a) => a.rosie.id === "claude");
  assert(claude !== undefined, "claude should be among detected agents");
  assert(
    path.resolve(claude.rosie.globalPath) === path.resolve(HOME, ".claude/skills"),
    `claude globalPath: expected ${path.resolve(HOME, ".claude/skills")}, got ${path.resolve(claude.rosie.globalPath)}`
  );

  // 3. rosie.install() with wrangler's exact options; read failedAgents.
  const agentNames = detectedAgents.map((a) => a.rosie.id);
  const result = await rosie.install(SKILLS_REPO, {
    global: true,
    agent: agentNames,
    lockfile: false,
  });
  assert(result !== undefined && result !== null, "install returned nothing");
  assert(Array.isArray(result.failedAgents), "result.failedAgents should be an array");
  assert(
    result.failedAgents.length === 0,
    `expected no failed agents, got ${JSON.stringify(result.failedAgents)}`
  );

  // 4. The skills actually landed in the agent's global dir.
  for (const skill of EXPECTED_SKILLS) {
    const md = path.join(HOME, ".claude/skills", skill, "SKILL.md");
    assert(fs.existsSync(md), `expected installed skill at ${md}`);
  }

  // lockfile: false means no global lockfile was written.
  assert(
    !fs.existsSync(path.join(HOME, ".agents/rosie.lock")),
    "lockfile: false should not write a global rosie.lock"
  );

  console.log(`  \x1b[32mPASS\x1b[0m  contract: agents() + install(${SKILLS_REPO}) -> ${EXPECTED_SKILLS.length} skill(s)`);
  process.exit(0);
} catch (e) {
  console.log(`  \x1b[31mFAIL\x1b[0m  contract: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}
