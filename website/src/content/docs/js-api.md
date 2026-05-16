---
title: js api
---

<div class="prompt-line"><span class="prompt">$</span> <a href="/">cd ..</a></div>

<div class="section-rule" id="js-api">
  <span class="dashes">──</span>
  <a href="/docs/js-api/" class="label">js api</a>
  <span class="dashes-grow"></span>
</div>

<section class="js-api">
  <p class="lockfile-intro">rosie is also a typed JavaScript library. install <code>rosie-skills</code> from npm and call it from node directly — no spawning, no parsing stdout. backed by the same C internals as the CLI, compiled to wasm and inlined in the package.</p>

```bash
$ npm install rosie-skills
```

  <p class="lockfile-intro">the package is esm-only. use a namespace import:</p>

```js
// every function returns a Promise. failures throw Error with a descriptive message.
import * as rosie from 'rosie-skills';

await rosie.install('anthropics/skills');
const skills = await rosie.list();
const agents = await rosie.agents();
```

  <h3 class="sub-label">install</h3>
  <p class="lockfile-intro">every cli flag has a corresponding option. pass nothing extra and rosie does the right thing: install the whole repo, auto-detect agents, write to <code>.agents/skills/</code>.</p>

```js
// one skill, specific agents
await rosie.install('anthropics/skills', {
  skill: 'pdf',
  agent: ['claude', 'cursor'],
});

// install as a reference (.md doc indexed in AGENTS.md / CLAUDE.md / …)
await rosie.install('vercel/next.js', { ref: true });

// reference with a custom name
await rosie.install('anthropics/skills', {
  ref: true,
  skill: 'pdf',
  name: 'pdf-handling',
});

// from an npm package — symlinks .md files out of node_modules/
await rosie.install('react', {
  ref: true,
  npm: true,
  include: ['README.md'],
});

// global install (~/.agent/skills/ instead of ./.agents/skills/)
await rosie.install('anthropics/skills', { global: true });

// ad-hoc install, don't record in rosie.lock
await rosie.install('anthropics/skills', { lockfile: false });

// install into a different project directory
await rosie.install('anthropics/skills', { cwd: '/path/to/project' });

// reinstall everything in .agents/rosie.lock — no args needed
await rosie.installFromLockfile();
```

  <h3 class="sub-label">install result</h3>
  <p class="lockfile-intro"><code>install</code>, <code>installFromLockfile</code>, and <code>update</code> return an <code>InstallResult</code>. per-skill detail in <code>skills</code>, deduped unions in <code>installedAgents</code> / <code>failedAgents</code>, and <code>installedInstruction</code> names the agent-instructions file that was written (or <code>null</code> when none was touched).</p>

```ts
const result = await rosie.install('anthropics/skills');
// {
//   skills: [
//     { name: 'pdf', kind: 'skill',
//       installedAgents: ['claude', 'cursor'],
//       failedAgents: [] },
//     ...
//   ],
//   installedAgents: ['claude', 'cursor'],
//   failedAgents: [],
//   installedInstruction: null,
// }
```

  <p class="lockfile-intro"><code>failedAgents</code> is non-fatal — rosie tries every agent and reports the misses. Common cause: an existing non-symlink file at <code>~/.&lt;agent&gt;/skills/&lt;name&gt;</code> blocking the create, or restrictive permissions on the agent's <code>skills/</code> dir. The canonical copy under <code>.agents/skills/</code> still lands and the lockfile still records the entry; rerunning <code>rosie.install</code> after fixing permissions re-attempts the failed agents.</p>

```ts
const result = await rosie.install('anthropics/skills');
if (result.failedAgents.length > 0) {
  console.warn(`couldn't symlink into: ${result.failedAgents.join(', ')}`);
}
```

  <p class="lockfile-intro">reference installs land under <code>.agents/references/</code> instead of agent dirs, so <code>kind === 'reference'</code> and the agent arrays are empty. <code>installedInstruction</code> is the path of the markdown file (<code>AGENTS.md</code> / <code>CLAUDE.md</code> / <code>GEMINI.md</code> / <code>.github/copilot-instructions.md</code>) whose references block was rewritten.</p>

```ts
const result = await rosie.install('vercel/next.js', { ref: true });
// {
//   skills: [{ name: 'vercel-next.js', kind: 'reference',
//              installedAgents: [], failedAgents: [] }],
//   installedAgents: [],
//   failedAgents: [],
//   installedInstruction: 'AGENTS.md',
// }
```

  <h3 class="sub-label">references</h3>
  <p class="lockfile-intro">pass <code>ref: true</code> to install a markdown doc into <code>.agents/references/&lt;name&gt;/REFERENCE.md</code> and append it to the project's agent-instructions file (<code>AGENTS.md</code> · <code>CLAUDE.md</code> · <code>GEMINI.md</code> · <code>.github/copilot-instructions.md</code>, first one found — else <code>AGENTS.md</code> is created).</p>

```js
// the repo's README.md becomes the reference
await rosie.install('vercel/next.js', { ref: true });

// pick a specific SKILL.md (frontmatter stripped) — source is recorded
// as owner/repo#skill so rosie.update() round-trips correctly
await rosie.install('anthropics/skills', {
  ref: true,
  skill: 'pdf',
});

// override the default install name (default: owner-repo[-skill])
await rosie.install('anthropics/skills', {
  ref: true,
  skill: 'docx',
  name: 'word-docs',
});

// from an npm package — symlinks .md files out of node_modules/<pkg>/
// (implies ref: true; tracks the installed version)
await rosie.install('react', { ref: true, npm: true });

// scope the npm walk — replaces the default README+docs/**.md set
await rosie.install('zod', {
  ref: true,
  npm: true,
  include: ['README.md'],
});
```

  <p class="lockfile-intro">title in the index is re-extracted from each file's first H1 on every rebuild; falls back to the install name. references show up in <code>rosie.list()</code> with <code>isReference: true</code>:</p>

```js
const all = await rosie.list();
const refs = all.filter(s => s.isReference);
// [
//   { name: 'vercel-next.js', source: 'vercel/next.js',
//     ref: 'main', sha: '...', isReference: true },
//   ...
// ]
```

  <h3 class="sub-label">list, agents</h3>
  <p class="lockfile-intro">read-only commands; structured results, no parsing.</p>

```js
const skills = await rosie.list();
// [
//   { name: 'pdf', source: 'anthropics/skills', ref: 'main',
//     sha: 'f458cee31...', isReference: false },
//   ...
// ]

const agents = await rosie.agents();
// [
//   { name: 'claude', display: 'Claude Code',
//     detected: true, installPath: '/home/me/.claude/skills' },
//   { name: 'cursor', display: 'Cursor',
//     detected: false, installPath: null },
//   ...
// ]
```

  <h3 class="sub-label">remove, update</h3>

```js
// remove a skill from all agents (or pass agent: ['claude'] to scope)
await rosie.remove('pdf');

// update everything in rosie.lock
await rosie.update();

// update just one entry
await rosie.update('pdf');
```

  <h3 class="sub-label">logging</h3>
  <p class="lockfile-intro">silent by default. pass <code>onLog</code> to observe progress. failures still throw — <code>onLog</code> is purely for visibility.</p>

```js
await rosie.install('anthropics/skills', {
  onLog: ({ level, message }) => {
    if (level === 'error') console.error(message);
    else if (level === 'info') console.log(message);
    // 'warn' and 'debug' levels also available
  },
});
```

  <h3 class="sub-label">error handling</h3>

```js
try {
  await rosie.install('owner/nonexistent-repo');
} catch (err) {
  // err.message has the underlying log_error from the C side
  console.error('install failed:', err.message);
}
```

  <h3 class="sub-label">cwd and lockfile</h3>
  <p class="lockfile-intro">every command accepts a <code>cwd</code> option, equivalent to <code>cd</code>'ing into that directory before running. <code>process.cwd()</code> is restored on exit. mirrors the cli's <code>--cwd</code> flag.</p>

```js
await rosie.install('owner/repo', { cwd: '/path/to/project' });

// cli equivalent
// $ rosie --cwd /path/to/project install owner/repo
```

  <p class="lockfile-intro">pass <code>lockfile: false</code> on <code>install</code>, <code>remove</code>, or <code>update</code> to skip reads and writes to <code>.agents/rosie.lock</code>. files still land on disk; nothing is recorded. mirrors the cli's <code>--no-lockfile</code>.</p>

```js
await rosie.install('anthropics/skills', { lockfile: false });

// cli equivalent
// $ rosie install anthropics/skills --no-lockfile
```

  <h3 class="sub-label">how it runs</h3>
  <ul class="bullet-list">
    <li>
      <span class="bullet">▸</span>
      <strong class="key">in-process wasm</strong>
      <span class="val">the api always uses the wasm build · no subprocess spawning · synchronous from the c side via asyncify</span>
    </li>
    <li>
      <span class="bullet">▸</span>
      <strong class="key">node 18+</strong>
      <span class="val">uses built-in <code>fetch</code> for http · node <code>fs</code> for file i/o via NODERAWFS</span>
    </li>
    <li>
      <span class="bullet">▸</span>
      <strong class="key">esm-only</strong>
      <span class="val"><code>"type": "module"</code> · use <code>import</code> · no <code>require</code></span>
    </li>
    <li>
      <span class="bullet">▸</span>
      <strong class="key">typescript types</strong>
      <span class="val">ships <code>.d.ts</code> alongside <code>.js</code> · works in any editor that resolves npm types</span>
    </li>
    <li>
      <span class="bullet">▸</span>
      <strong class="key">cli still works the same</strong>
      <span class="val"><code>npx rosie-skills install …</code> uses the native binary when available, falls back to wasm otherwise</span>
    </li>
  </ul>
</section>
