// WASM parity test. Drives the rosie-skills TypeScript API end-to-end
// against the regression-suite mock server, mirroring a representative
// subset of the bash regression cases.
//
// Each scenario runs in a fresh tmpdir with HOME pointing at a controlled
// fake home (so agent detection is deterministic). The mock server lives
// in tests/regression/lib/mock_server.py and serves the same fixtures the
// native suite uses.
//
// Run via tests/wasm-parity/run.sh (which starts the mock server).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PORT = parseInt(process.env.PORT ?? '8765', 10);

// Bind to the JS API in the built dist/.
const apiPath = path.join(REPO_ROOT, 'npm', 'rosie-skills', 'dist', 'index.js');
const rosie = await import(apiPath);

let passed = 0;
let failed = 0;
const failures = [];

function makeTmp() {
    const t = fs.mkdtempSync(path.join(process.env.TMPDIR ?? '/tmp', 'rosie-wasm-'));
    fs.mkdirSync(path.join(t, 'home', '.claude'), { recursive: true });
    fs.mkdirSync(path.join(t, 'project'), { recursive: true });
    return t;
}

function assert(cond, msg) {
    if (!cond) throw new Error(`assertion failed: ${msg}`);
}

async function withTmp(name, fn) {
    const t = makeTmp();
    const origHome = process.env.HOME;
    process.env.HOME = path.join(t, 'home');
    process.env.ROSIE_GITHUB_BASE_URL = `http://127.0.0.1:${PORT}`;
    try {
        await fn(t);
        console.log(`  \x1b[32mPASS\x1b[0m  ${name}`);
        passed++;
    } catch (e) {
        console.log(`  \x1b[31mFAIL\x1b[0m  ${name}: ${e.message}`);
        failures.push(name);
        failed++;
    } finally {
        process.env.HOME = origHome;
        if (!process.env.KEEP_TMP) {
            fs.rmSync(t, { recursive: true, force: true });
        } else {
            console.log(`        tmpdir: ${t}`);
        }
    }
}

// ---- cases ----------------------------------------------------------------

await withTmp('agents', async () => {
    const agents = await rosie.agents();
    assert(agents.length === 12, `expected 12 agent defs, got ${agents.length}`);
    const claude = agents.find(a => a.name === 'claude');
    assert(claude !== undefined, 'claude entry missing');
    assert(claude.detected === true, 'claude should be detected');
});

await withTmp('install-basic', async (tmp) => {
    const project = path.join(tmp, 'project');
    await rosie.install('fake-org/skills', { cwd: project });
    const skills = await rosie.list({ cwd: project });
    assert(skills.length === 1, `expected 1 skill in lockfile, got ${skills.length}`);
    assert(skills[0].name === 'my-skill', `expected my-skill, got ${skills[0].name}`);
    assert(skills[0].ref === 'v1.0.0', `expected v1.0.0 ref, got ${skills[0].ref}`);
    assert(skills[0].isReference === false, 'should not be a reference');
    // Canonical dir created.
    assert(
        fs.existsSync(path.join(project, '.agents/skills/my-skill/SKILL.md')),
        'canonical SKILL.md missing'
    );
});

await withTmp('install-pinned-tag', async (tmp) => {
    const project = path.join(tmp, 'project');
    await rosie.install('fake-org/skills@v1.0.0', { cwd: project });
    const skills = await rosie.list({ cwd: project });
    assert(skills.length === 1, `expected 1 skill, got ${skills.length}`);
    assert(skills[0].ref === 'v1.0.0', `expected v1.0.0, got ${skills[0].ref}`);
});

await withTmp('install-from-lockfile', async (tmp) => {
    const project = path.join(tmp, 'project');
    fs.mkdirSync(path.join(project, '.agents'), { recursive: true });
    fs.writeFileSync(
        path.join(project, '.agents/rosie.lock'),
        '# rosie-lock v1\nmy-skill fake-org/skills main - 2025-01-01T00:00:00Z auto skill\n'
    );
    await rosie.installFromLockfile({ cwd: project });
    assert(
        fs.existsSync(path.join(project, '.agents/skills/my-skill/SKILL.md')),
        'reinstall did not place canonical'
    );
});

await withTmp('install-ref-readme', async (tmp) => {
    const project = path.join(tmp, 'project');
    await rosie.install('fake-org/skills', { cwd: project, ref: true });
    assert(
        fs.existsSync(path.join(project, '.agents/references/fake-org-skills/REFERENCE.md')),
        'REFERENCE.md missing'
    );
    assert(fs.existsSync(path.join(project, 'AGENTS.md')), 'AGENTS.md not created');
    const skills = await rosie.list({ cwd: project });
    assert(skills.length === 1, `expected 1 ref entry, got ${skills.length}`);
    assert(skills[0].isReference === true, 'should be marked as reference');
});

await withTmp('remove-basic', async (tmp) => {
    const project = path.join(tmp, 'project');
    await rosie.install('fake-org/skills', { cwd: project });
    await rosie.remove('my-skill', { cwd: project });
    const skills = await rosie.list({ cwd: project });
    assert(skills.length === 0, `expected lockfile empty, got ${skills.length} entries`);
});

await withTmp('update-noop', async (tmp) => {
    const project = path.join(tmp, 'project');
    fs.mkdirSync(path.join(project, '.agents/skills/my-skill'), { recursive: true });
    fs.writeFileSync(
        path.join(project, '.agents/skills/my-skill/SKILL.md'),
        '---\nname: my-skill\ndescription: x\n---\n'
    );
    fs.mkdirSync(path.join(project, '.claude/skills'), { recursive: true });
    fs.symlinkSync('../../.agents/skills/my-skill', path.join(project, '.claude/skills/my-skill'));
    fs.writeFileSync(
        path.join(project, '.agents/rosie.lock'),
        '# rosie-lock v1\nmy-skill fake-org/skills v1.0.0 bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb 2025-01-01T00:00:00Z pin skill\n'
    );
    await rosie.update(undefined, { cwd: project });
    const skills = await rosie.list({ cwd: project });
    assert(skills.length === 1, 'expected 1 skill');
    assert(skills[0].sha === 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', `SHA unchanged: ${skills[0].sha}`);
});

await withTmp('install-ref-npm', async (tmp) => {
    const project = path.join(tmp, 'project');
    fs.mkdirSync(path.join(project, 'node_modules/react'), { recursive: true });
    fs.writeFileSync(
        path.join(project, 'node_modules/react/package.json'),
        '{"name":"react","version":"18.0.0"}'
    );
    fs.writeFileSync(
        path.join(project, 'node_modules/react/README.md'),
        '# React\n\nlib.\n'
    );
    await rosie.install('react', { cwd: project, ref: true, npm: true });
    const skills = await rosie.list({ cwd: project });
    const readme = skills.find(s => s.name === 'react-readme');
    assert(readme !== undefined, 'react-readme entry missing');
    assert(readme.sha === '18.0.0', `expected version 18.0.0 in sha column, got ${readme.sha}`);
});

// Returns the InstallResult and surfaces installedAgents.
await withTmp('install-returns-installed-agents', async (tmp) => {
    const project = path.join(tmp, 'project');
    fs.mkdirSync(path.join(tmp, 'home', '.cursor'), { recursive: true });
    const result = await rosie.install('fake-org/skills', { cwd: project });
    assert(result.skills.length === 1, `expected 1 skill, got ${result.skills.length}`);
    const s = result.skills[0];
    assert(s.name === 'my-skill', `skill name: ${s.name}`);
    // claude + cursor are both planted in HOME; both should be detected and
    // succeed for this clean install.
    assert(s.installedAgents.includes('claude'), `claude missing: ${s.installedAgents}`);
    assert(s.installedAgents.includes('cursor'), `cursor missing: ${s.installedAgents}`);
    assert(s.failedAgents.length === 0, `expected no failures, got ${s.failedAgents}`);
    // Top-level union mirrors the per-skill record for a single-skill install.
    assert(result.installedAgents.includes('claude'), 'top-level installedAgents missing claude');
    assert(result.failedAgents.length === 0, 'top-level failedAgents should be empty');
});

// kind is "reference" for --ref installs and installedInstruction points
// at the file rosie wrote the references block into.
await withTmp('install-ref-returns-instruction-file', async (tmp) => {
    const project = path.join(tmp, 'project');
    const result = await rosie.install('fake-org/skills', { cwd: project, ref: true });
    assert(result.skills.length === 1, `expected 1 entry, got ${result.skills.length}`);
    assert(result.skills[0].kind === 'reference',
        `kind: expected "reference", got "${result.skills[0].kind}"`);
    assert(result.installedInstruction === 'AGENTS.md',
        `installedInstruction: expected "AGENTS.md", got ${JSON.stringify(result.installedInstruction)}`);
});

// Pre-staged CLAUDE.md → references go there instead of AGENTS.md.
await withTmp('install-ref-claude-target', async (tmp) => {
    const project = path.join(tmp, 'project');
    fs.writeFileSync(path.join(project, 'CLAUDE.md'), '# Project\n');
    const result = await rosie.install('fake-org/skills', { cwd: project, ref: true });
    assert(result.installedInstruction === 'CLAUDE.md',
        `installedInstruction: expected "CLAUDE.md", got ${JSON.stringify(result.installedInstruction)}`);
    assert(!fs.existsSync(path.join(project, 'AGENTS.md')),
        'AGENTS.md should not be created when CLAUDE.md is the target');
});

// Pre-create a regular file where rosie wants to put the symlink — the
// underlying symlink() call returns EEXIST, agent gets recorded as failed,
// the others succeed, and install exits cleanly.
await withTmp('install-partial-agent-failure', async (tmp) => {
    const project = path.join(tmp, 'project');
    fs.mkdirSync(path.join(tmp, 'home', '.cursor'), { recursive: true });
    // Block .claude's symlink slot with a regular file (rosie won't clobber
    // non-symlink files at link_path).
    fs.mkdirSync(path.join(project, '.claude/skills'), { recursive: true });
    fs.writeFileSync(path.join(project, '.claude/skills/my-skill'), 'blocker');

    const result = await rosie.install('fake-org/skills', { cwd: project });
    assert(result.skills.length === 1, `expected 1 skill, got ${result.skills.length}`);
    const s = result.skills[0];
    assert(s.failedAgents.includes('claude'),
        `expected claude in failedAgents, got ${JSON.stringify(s.failedAgents)}`);
    assert(s.installedAgents.includes('cursor'),
        `expected cursor in installedAgents, got ${JSON.stringify(s.installedAgents)}`);
    assert(!s.installedAgents.includes('claude'), 'claude should not be in installedAgents');
    // Top-level unions match the per-skill record.
    assert(result.failedAgents.includes('claude'), 'top-level failedAgents missing claude');
    assert(result.installedAgents.includes('cursor'), 'top-level installedAgents missing cursor');
    // The canonical install still lands; lockfile still has the entry.
    assert(
        fs.existsSync(path.join(project, '.agents/skills/my-skill/SKILL.md')),
        'canonical install missing — partial failure should not abort the whole install'
    );
    const skills = await rosie.list({ cwd: project });
    assert(skills.length === 1, 'lockfile should still record the skill');
});

await withTmp('install-audit-shape', async (tmp) => {
    const project = path.join(tmp, 'project');
    const result = await rosie.install('fake-org/skills', { cwd: project });
    assert(result.audit !== undefined, 'InstallResult.audit missing');
    assert(result.audit.schemaVersion === 1, 'schemaVersion must be 1');
    assert(result.audit.command === 'install', `expected command=install, got ${result.audit.command}`);
    assert(Array.isArray(result.audit.findings), 'findings must be an array');
    assert(Array.isArray(result.audit.changes), 'changes must be an array');
    assert(result.audit.changes.length === 1, `expected 1 change, got ${result.audit.changes.length}`);
    const change = result.audit.changes[0];
    assert(change.name === 'my-skill', 'change.name should be my-skill');
    assert(change.kind === 'skill', 'change.kind should be skill');
    assert(change.operation === 'install', 'change.operation should be install (first-time)');
    assert(typeof change.content === 'string' && change.content.length > 0, 'change.content should be populated for first install');
    assert(change.diff === null, 'change.diff should be null for first install');
});

await withTmp('retag-finding-shape', async (tmp) => {
    const project = path.join(tmp, 'project');
    // Stage a lockfile with a stale SHA for v1.0.0; mock server returns bbbb...
    fs.mkdirSync(path.join(project, '.agents/skills/my-skill'), { recursive: true });
    fs.writeFileSync(
        path.join(project, '.agents/skills/my-skill/SKILL.md'),
        '---\nname: my-skill\ndescription: stale\n---\n\n# my-skill\n\nstale\n',
    );
    fs.writeFileSync(
        path.join(project, '.agents/rosie.lock'),
        '# rosie-lock v1\nmy-skill fake-org/skills v1.0.0 ' +
            'dddddddddddddddddddddddddddddddddddddddd 2025-01-01T00:00:00Z pin skill\n',
    );
    const result = await rosie.update(undefined, { cwd: project });
    assert(result.audit !== undefined, 'audit missing');
    const finding = result.audit.findings.find(f => f.kind === 'tag_rewritten');
    assert(finding !== undefined, 'expected a tag_rewritten finding');
    assert(finding.severity === 'high', 'finding severity should be high');
    assert(finding.skill === 'my-skill', 'finding.skill should be my-skill');
    assert(finding.oldSha === 'd'.repeat(40), 'oldSha mismatch');
    assert(finding.newSha === 'b'.repeat(40), 'newSha mismatch');
});

await withTmp('sanitize-applied-via-wasm', async (tmp) => {
    const project = path.join(tmp, 'project');
    await rosie.install('fake-org/hostile', { cwd: project, ref: true });
    const ref = fs.readFileSync(path.join(project, '.agents/references/fake-org-hostile/REFERENCE.md'), 'utf8');
    assert(!ref.includes('ROSIE_TEST_HOSTILE_HTML_COMMENT'), 'html comment should be stripped');
    assert(!ref.includes('ROSIE_TEST_LINK_FORM_COMMENT'), 'link-form comment should be stripped');
    assert(ref.includes('ROSIE_TEST_FENCED_PRESERVED'), 'fenced comment should be preserved');
    assert(!ref.includes('​'), 'U+200B should be stripped');
});

await withTmp('js-opts-strip-disabled', async (tmp) => {
    const project = path.join(tmp, 'project');
    await rosie.install('fake-org/hostile', {
        cwd: project,
        ref: true,
        stripComments: false,
        stripInvisible: false,
    });
    const ref = fs.readFileSync(path.join(project, '.agents/references/fake-org-hostile/REFERENCE.md'), 'utf8');
    assert(ref.includes('ROSIE_TEST_HOSTILE_HTML_COMMENT'), 'comment should be preserved with stripComments:false');
    assert(ref.includes('​'), 'U+200B should be preserved with stripInvisible:false');
});

await withTmp('js-opts-mutex-rejection', async () => {
    let threw = false;
    try {
        await rosie.install('fake-org/skills', { forceAudit: true, suppressAudit: true });
    } catch (e) {
        threw = true;
        assert(/mutually exclusive/i.test(e.message), `expected mutex error, got: ${e.message}`);
    }
    assert(threw, 'expected install to throw on forceAudit + suppressAudit');
});

// ---- summary --------------------------------------------------------------

console.log();
if (failed === 0) {
    console.log(`\x1b[32mAll ${passed} case(s) passed.\x1b[0m`);
    process.exit(0);
} else {
    console.log(`\x1b[31m${failed} failure(s):\x1b[0m`);
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
}
