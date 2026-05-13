---
title: rosie
---

<section class="hero">
  <div class="prompt-line"><span class="prompt">$</span> cat README</div>

  <h1 class="visually-hidden">Rosie — a robot helper for agent skills</h1>
  <div class="ascii-art" aria-hidden="true">
<pre class="art-robot"> ┏━━━━━━━┓
 ┃ <span class="eye">●</span>   <span class="eye">●</span> ┃
 ┃  ═══  ┃
 ┗━━━┳━━━┛
     ┃</pre>
<pre class="art-wordmark"> ____   ___  ____ ___ _____
|  _ \ / _ \/ ___|_ _| ____|
| |_) | | | \___ \| ||  _|
|  _ <| |_| |___) | || |___
|_| \_\___/|____/___|_____|</pre>
  </div>

  <p class="tagline">a robot helper for agent skills.</p>
  <p class="tagline">fast, cross-platform package manager — think npm, but for skills.</p>

<pre class="term-block"><span class="prompt">$</span> rosie install anthropics/skills
<span class="arrow">→</span> resolved main (a1b2c3d)
<span class="arrow">→</span> found 12 skills · detected: claude, cursor, opencode
<span class="check">✓</span> installed to .agents/skills/</pre>

  <div class="cta-row">
    <a class="btn btn-primary" href="#install">[ install rosie ]</a>
    <a class="btn btn-ghost" href="https://github.com/matthewp/rosie">[ github → ]</a>
  </div>
</section>

<div class="section-rule" id="features">
  <span class="dashes">──</span>
  <a href="#features" class="label">what rosie does</a>
  <span class="dashes-grow"></span>
</div>

<section class="features">
  <ul class="bullet-list">
    <li>
      <span class="bullet">▸</span>
      <strong class="key">discovers skills</strong>
      <span class="val">finds every SKILL.md in any GitHub repo</span>
    </li>
    <li>
      <span class="bullet">▸</span>
      <strong class="key">multi-agent install</strong>
      <span class="val">claude, cursor, opencode, codex, and <a href="#supported">8 more</a> — auto-detected</span>
    </li>
    <li>
      <span class="bullet">▸</span>
      <strong class="key">lockfile</strong>
      <span class="val">.agents/rosie.lock pins exact SHAs for reproducible installs</span>
    </li>
    <li>
      <span class="bullet">▸</span>
      <strong class="key">native c, no runtime</strong>
      <span class="val">single small binary. no node, no python, no jvm.</span>
    </li>
  </ul>
</section>

<section class="demo" data-demo hidden>
  <div class="section-rule" id="demo">
    <span class="dashes">──</span>
    <a href="#demo" class="label">demo</a>
    <span class="dashes-grow"></span>
  </div>
  <div class="demo-frame">
    <object data="/demo.svg" type="image/svg+xml" aria-label="rosie install demo">
      your browser does not support embedded svg
    </object>
  </div>
</section>

<div class="section-rule" id="install">
  <span class="dashes">──</span>
  <a href="#install" class="label">install</a>
  <span class="dashes-grow"></span>
</div>

<section class="install">
  <div class="tabs" role="tablist" aria-label="install method">
    <button class="tab" role="tab" data-tab="npm">[ npm ]</button>
    <button class="tab active" role="tab" data-tab="brew">[ macos ]</button>
    <button class="tab" role="tab" data-tab="aur">[ arch ]</button>
    <button class="tab" role="tab" data-tab="apt">[ debian ]</button>
    <button class="tab" role="tab" data-tab="pkg">[ freebsd ]</button>
    <button class="tab" role="tab" data-tab="src">[ source ]</button>
  </div>

  <div class="tab-panel" data-panel="npm">
<pre class="term-block"><span class="prompt">$</span> npx rosie-skills install owner/repo
<span class="comment"># or install globally</span>
<span class="prompt">$</span> npm install -g rosie-skills
<span class="prompt">$</span> rosie-skills install owner/repo<button class="copy-btn" data-copy>[ copy ]</button></pre>
  </div>

  <div class="tab-panel active" data-panel="brew">
<pre class="term-block"><span class="prompt">$</span> brew tap matthewp/rosie
<span class="prompt">$</span> brew install rosie<button class="copy-btn" data-copy>[ copy ]</button></pre>
  </div>

  <div class="tab-panel" data-panel="aur">
<pre class="term-block"><span class="prompt">$</span> yay -S rosie
<span class="comment"># or</span>
<span class="prompt">$</span> paru -S rosie<button class="copy-btn" data-copy>[ copy ]</button></pre>
  </div>

  <div class="tab-panel" data-panel="apt">
    <p class="panel-note"><span class="comment"># noble for ubuntu 24.04 / debian 13+, jammy for ubuntu 22.04</span></p>
<pre class="term-block"><span class="prompt">$</span> echo "deb [trusted=yes] https://matthewp.github.io/rosie/debian noble main" \
    | sudo tee /etc/apt/sources.list.d/rosie.list
<span class="prompt">$</span> sudo apt update
<span class="prompt">$</span> sudo apt install rosie<button class="copy-btn" data-copy>[ copy ]</button></pre>
  </div>

  <div class="tab-panel" data-panel="pkg">
    <p class="panel-note"><span class="comment"># add the rosie repo, then install</span></p>
<pre class="term-block"><span class="prompt">$</span> sudo mkdir -p /usr/local/etc/pkg/repos
<span class="prompt">$</span> cat &lt;&lt;'EOF' | sudo tee /usr/local/etc/pkg/repos/rosie.conf
rosie: {
  url: "https://matthewp.github.io/rosie/freebsd/",
  enabled: yes,
  signature_type: "none"
}
EOF
<span class="prompt">$</span> sudo pkg update &amp;&amp; sudo pkg install rosie<button class="copy-btn" data-copy>[ copy ]</button></pre>
  </div>

  <div class="tab-panel" data-panel="src">
    <p class="panel-note"><span class="comment"># install deps for your platform first</span></p>
<pre class="term-block"><span class="comment"># debian / ubuntu</span>
<span class="prompt">$</span> sudo apt install libcurl4-openssl-dev libarchive-dev pkg-config

<span class="comment"># macos</span>
<span class="prompt">$</span> brew install curl libarchive pkg-config

<span class="comment"># arch</span>
<span class="prompt">$</span> sudo pacman -S curl libarchive pkgconf</pre>

    <p class="panel-note"><span class="comment"># then clone, build, install (defaults to /usr/local/bin)</span></p>
<pre class="term-block"><span class="prompt">$</span> git clone https://github.com/matthewp/rosie
<span class="prompt">$</span> cd rosie
<span class="prompt">$</span> make
<span class="prompt">$</span> sudo make install<button class="copy-btn" data-copy>[ copy ]</button></pre>
  </div>
</section>

<div class="section-rule" id="cli">
  <span class="dashes">──</span>
  <a href="#cli" class="label">cli</a>
  <span class="dashes-grow"></span>
</div>

<section class="cli">
  <p class="lockfile-intro">the basic verbs: <code>install</code>, <code>update</code>, <code>remove</code>, <code>list</code>, <code>agents</code>. flags map one-to-one with the <a href="#js-api">js api</a>.</p>

```bash
# install latest semver tag from a repo (or default branch if no tags)
$ rosie install vercel-labs/agent-skills

# specific skill from a repo
$ rosie install anthropics/skills pdf

# pin to a branch or tag — recorded as `pin` in the lockfile
$ rosie install owner/repo@v1.0.0
$ rosie install owner/repo@develop

# scope to specific agents (repeatable)
$ rosie install owner/repo -a claude -a cursor

# install a local directory as a skill (symlinked, travels with your repo)
$ rosie install ./my-custom-skill

# reinstall everything in .agents/rosie.lock — useful on a fresh clone
$ rosie install

# update lockfile entries
$ rosie update                      # all entries
$ rosie update slack-gif-creator    # one entry

# list installed skills/refs in this project
$ rosie list

# list what's available in a remote repo (without installing)
$ rosie list owner/repo

# remove an installed skill or reference
$ rosie remove skill-name
$ rosie remove skill-name -a claude   # from a specific agent

# show detected + supported agents
$ rosie agents

# skip the confirmation prompt
$ rosie install owner/repo -y
```

  <h3 class="sub-label">flags</h3>
  <ul class="bullet-list">
    <li><span class="bullet">▸</span><strong class="key">-a, --agent &lt;name&gt;</strong><span class="val">install to a specific agent (repeatable)</span></li>
    <li><span class="bullet">▸</span><strong class="key">-g, --global</strong><span class="val">install globally to <code>~/.&lt;agent&gt;/skills/</code> (copies files)</span></li>
    <li><span class="bullet">▸</span><strong class="key">-l, --local</strong><span class="val">install locally with symlinks (default)</span></li>
    <li><span class="bullet">▸</span><strong class="key">-r, --ref</strong><span class="val">install as a reference (README, or a SKILL.md via <code>--skill</code>)</span></li>
    <li><span class="bullet">▸</span><strong class="key">-s, --skill &lt;name&gt;</strong><span class="val">with <code>--ref</code>: install a specific SKILL.md</span></li>
    <li><span class="bullet">▸</span><strong class="key">-n, --name &lt;name&gt;</strong><span class="val">with <code>--ref</code>: override the default install name</span></li>
    <li><span class="bullet">▸</span><strong class="key">-N, --npm</strong><span class="val">with <code>--ref</code>: source from <code>node_modules/&lt;pkg&gt;/</code></span></li>
    <li><span class="bullet">▸</span><strong class="key">-I, --include &lt;path&gt;</strong><span class="val">with <code>--npm</code>: file or directory to include (repeatable; replaces default scope)</span></li>
    <li><span class="bullet">▸</span><strong class="key">--cwd &lt;path&gt;</strong><span class="val">run as if started from <code>&lt;path&gt;</code> (mirrors <a href="#js-api">js api</a>'s <code>cwd</code> option)</span></li>
    <li><span class="bullet">▸</span><strong class="key">--no-lockfile</strong><span class="val">don't read or write <code>.agents/rosie.lock</code></span></li>
    <li><span class="bullet">▸</span><strong class="key">-y, --yes</strong><span class="val">skip the confirmation prompt</span></li>
    <li><span class="bullet">▸</span><strong class="key">-v, --verbose</strong><span class="val">verbose output</span></li>
  </ul>

  <h3 class="sub-label">local vs global</h3>
  <p class="lockfile-intro">two install modes; default is local. global is opt-in via <code>--global</code>.</p>

  <ul class="bullet-list">
    <li>
      <span class="bullet">▸</span>
      <strong class="key">local (default)</strong>
      <span class="val">canonical copy at <code>.agents/skills/&lt;name&gt;/</code>; symlinks from each agent's local dir (<code>.claude/skills/</code>, <code>.cursor/skills/</code>, …) into it. project-scoped. check the lockfile into git for reproducible installs.</span>
    </li>
    <li>
      <span class="bullet">▸</span>
      <strong class="key">global (<code>--global</code>)</strong>
      <span class="val">files copied directly into <code>~/.&lt;agent&gt;/skills/&lt;name&gt;/</code> for every detected agent. shared across projects, no lockfile, no symlinks.</span>
    </li>
  </ul>
</section>

<div class="section-rule" id="lockfile">
  <span class="dashes">──</span>
  <a href="#lockfile" class="label">lockfile</a>
  <span class="dashes-grow"></span>
</div>

<section class="lockfile">
  <p class="lockfile-intro">every install is recorded in <code>.agents/rosie.lock</code> — small, line-oriented, diffs cleanly. check it into git.</p>

<pre class="term-block"><span class="prompt">$</span> cat .agents/rosie.lock
<span class="comment"># rosie-lock v1</span>
<span class="lock-name">slack-gif-creator</span> anthropics/skills    main   <span class="lock-sha">5128e186…</span> <span class="comment">2026-05-02T14:32:18Z</span> <span class="lock-auto">auto</span> skill
<span class="lock-name">theme-factory</span>     anthropics/skills    v1.0.0 <span class="lock-sha">a1b2c3d4…</span> <span class="comment">2026-05-02T14:35:01Z</span> <span class="lock-pin">pin</span>  skill
<span class="lock-name">vite</span>              antfu/skills         main   <span class="lock-sha">f4d2e9c1…</span> <span class="comment">2026-05-02T14:38:44Z</span> <span class="lock-auto">auto</span> skill
<span class="lock-name">house-style</span>       file://./house-style -      -         <span class="comment">2026-05-02T14:41:09Z</span> <span class="lock-pin">pin</span>  skill
<span class="lock-name">vercel-next.js</span>    vercel/next.js       v15.1.0 <span class="lock-sha">9f8e7d6c…</span> <span class="comment">2026-05-09T10:00:00Z</span> <span class="lock-auto">auto</span> ref</pre>

  <p class="lockfile-intro">one line per entry, space-separated: <code>&lt;name&gt; &lt;source&gt; &lt;ref&gt; &lt;sha&gt; &lt;installed-at&gt; &lt;pin|auto&gt; &lt;skill|ref&gt;</code>. <code>rosie-lock v1</code> is the header marker; legacy v0 files (no header, skill-only) are read transparently and rewritten on the next mutating command.</p>

  <ul class="bullet-list">
    <li>
      <span class="bullet">▸</span>
      <strong class="key lock-auto">auto</strong>
      <span class="val">installed without a ref · <code>rosie update</code> advances to the latest semver tag</span>
    </li>
    <li>
      <span class="bullet">▸</span>
      <strong class="key lock-pin">pin</strong>
      <span class="val">installed with <code>@ref</code> · ref stays put, only the SHA refreshes</span>
    </li>
    <li>
      <span class="bullet">▸</span>
      <strong class="key">skill</strong>
      <span class="val">directory installed into <code>.agents/skills/</code> with per-agent symlinks</span>
    </li>
    <li>
      <span class="bullet">▸</span>
      <strong class="key">ref</strong>
      <span class="val">single markdown doc indexed in the project's <code>AGENTS.md</code> / <code>CLAUDE.md</code> / etc.</span>
    </li>
    <li>
      <span class="bullet">▸</span>
      <strong class="key">file://</strong>
      <span class="val"><code>rosie install ./my-skill</code> writes a <code>file://</code> source · hand-authored skills in your repo travel with it</span>
    </li>
    <li>
      <span class="bullet">▸</span>
      <strong class="key">npm:</strong>
      <span class="val"><code>--npm</code> refs use <code>npm:&lt;pkg&gt;#&lt;file&gt;</code> as the source · sha column holds the installed npm version</span>
    </li>
  </ul>
</section>

<div class="section-rule" id="references">
  <span class="dashes">──</span>
  <a href="#references" class="label">references</a>
  <span class="dashes-grow"></span>
</div>

<section class="references">
  <p class="lockfile-intro">references are an alternative to skills — markdown docs the agent loads on demand. inspired by <a href="https://vercel.com/blog/agents-md-outperforms-skills-in-our-agent-evals">vercel's finding</a> that an always-loaded <code>AGENTS.md</code> index outperformed <code>SKILL.md</code>-style discovery on their evals.</p>

```bash
$ rosie install vercel/next.js --ref
# installs the repo's README.md as a reference

$ rosie install anthropics/skills --ref --skill pdf
# installs a specific SKILL.md (frontmatter stripped)

$ rosie install owner/repo --ref --name custom-name
# override the default install name
```

  <p class="lockfile-intro">the doc lands at <code>.agents/references/&lt;name&gt;/REFERENCE.md</code>, and an entry is appended to a rosie-managed block in the project's agent-instructions file:</p>

```md
<!-- AGENTS.md (or CLAUDE.md, whichever the project already uses) -->

<!-- rosie:references:start -->
<references>
- [Next.js — The React Framework](./.agents/references/vercel-next.js/REFERENCE.md)
- [PDF Processing Guide](./.agents/references/anthropics-skills-pdf/REFERENCE.md)
</references>
<!-- rosie:references:end -->
```

  <ul class="bullet-list">
    <li>
      <span class="bullet">▸</span>
      <strong class="key">target file</strong>
      <span class="val"><code>AGENTS.md</code> · else <code>CLAUDE.md</code> · else <code>GEMINI.md</code> · else <code>.github/copilot-instructions.md</code> · else creates <code>AGENTS.md</code></span>
    </li>
    <li>
      <span class="bullet">▸</span>
      <strong class="key">title</strong>
      <span class="val">re-extracted from the first H1 of each REFERENCE.md on every rebuild · falls back to install name</span>
    </li>
    <li>
      <span class="bullet">▸</span>
      <strong class="key">default name</strong>
      <span class="val"><code>owner-repo</code> · or <code>owner-repo-skill</code> with <code>--skill</code> · override with <code>--name</code></span>
    </li>
    <li>
      <span class="bullet">▸</span>
      <strong class="key">same lockfile</strong>
      <span class="val">recorded with kind <code>ref</code> · same <code>pin</code>/<code>auto</code> semantics as skills · same <code>rosie update</code></span>
    </li>
    <li>
      <span class="bullet">▸</span>
      <strong class="key">project-scoped</strong>
      <span class="val">no symlinks into agent dirs · <code>--global</code> is rejected (the index file is per-project)</span>
    </li>
  </ul>

  <p class="lockfile-intro" style="margin-top:1.25rem;">npm packages with <code>--npm</code> — symlink <code>.md</code> files straight from <code>node_modules/&lt;pkg&gt;/</code>. tracks the installed version (read from <code>package.json</code>); <code>rosie update</code> re-walks and reconciles after <code>npm update</code>.</p>

```bash
$ rosie install react --ref --npm
# symlinks README.md + docs/**/*.md → .agents/references/react-*

$ rosie install @tanstack/react-query --ref --npm

$ rosie install zod --ref --npm --include README.md
# --include replaces the default scope (repeatable)
```
</section>

<div class="section-rule" id="supported">
  <span class="dashes">──</span>
  <a href="#supported" class="label">supported</a>
  <span class="dashes-grow"></span>
</div>

<section class="supported">
  <p class="lockfile-intro">agents are auto-detected by the presence of their config directory in <code>$HOME</code>. target them explicitly with <code>--agent &lt;name&gt;</code>.</p>

  <h3 class="sub-label">skills</h3>
  <ul class="bullet-list">
    <li><span class="bullet">▸</span><strong class="key">claude</strong><span class="val">Claude Code · <code>~/.claude/skills/</code></span></li>
    <li><span class="bullet">▸</span><strong class="key">cursor</strong><span class="val">Cursor · <code>~/.cursor/skills/</code></span></li>
    <li><span class="bullet">▸</span><strong class="key">opencode</strong><span class="val">OpenCode · <code>~/.opencode/skills/</code></span></li>
    <li><span class="bullet">▸</span><strong class="key">codex</strong><span class="val">Codex · <code>~/.codex/skills/</code></span></li>
    <li><span class="bullet">▸</span><strong class="key">cline</strong><span class="val">Cline · <code>~/.cline/skills/</code></span></li>
    <li><span class="bullet">▸</span><strong class="key">windsurf</strong><span class="val">Windsurf · <code>~/.windsurf/skills/</code></span></li>
    <li><span class="bullet">▸</span><strong class="key">continue</strong><span class="val">Continue · <code>~/.continue/skills/</code></span></li>
    <li><span class="bullet">▸</span><strong class="key">copilot</strong><span class="val">GitHub Copilot · <code>~/.github/skills/</code></span></li>
    <li><span class="bullet">▸</span><strong class="key">aider</strong><span class="val">Aider · <code>~/.aider/skills/</code></span></li>
    <li><span class="bullet">▸</span><strong class="key">roo</strong><span class="val">Roo · <code>~/.roo/skills/</code></span></li>
    <li><span class="bullet">▸</span><strong class="key">amplify</strong><span class="val">Amplify · <code>~/.amplify/skills/</code></span></li>
    <li><span class="bullet">▸</span><strong class="key">zed</strong><span class="val">Zed · <code>~/.zed/skills/</code></span></li>
  </ul>

  <h3 class="sub-label">references</h3>
  <p class="lockfile-intro"><code>rosie install --ref</code> appends into the project's agent-instructions file. detection order, first match wins:</p>
  <ul class="bullet-list">
    <li><span class="bullet">▸</span><strong class="key">AGENTS.md</strong><span class="val">preferred · the cross-tool standard</span></li>
    <li><span class="bullet">▸</span><strong class="key">CLAUDE.md</strong><span class="val">Claude Code</span></li>
    <li><span class="bullet">▸</span><strong class="key">GEMINI.md</strong><span class="val">Gemini CLI</span></li>
    <li><span class="bullet">▸</span><strong class="key">.github/copilot-instructions.md</strong><span class="val">GitHub Copilot</span></li>
  </ul>
  <p class="lockfile-intro" style="margin-top:.75rem;">if none exist, rosie creates <code>AGENTS.md</code>.</p>
</section>

<div class="section-rule" id="js-api">
  <span class="dashes">──</span>
  <a href="#js-api" class="label">js api</a>
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

<div class="section-rule" id="skill-format">
  <span class="dashes">──</span>
  <a href="#skill-format" class="label">skill format</a>
  <span class="dashes-grow"></span>
</div>

<section class="skill-format">
  <p class="lockfile-intro">a skill is a directory with a <code>SKILL.md</code> at its root. yaml frontmatter declares the name and description; everything else is free-form.</p>

```
my-skill/
├── SKILL.md          # required — agent instructions
├── scripts/          # optional — automation helpers
└── references/       # optional — supporting docs
```

```md
---
name: my-skill
description: A brief description of what this skill does
---

# My Skill

Instructions for the AI agent go here…
```

  <ul class="bullet-list">
    <li>
      <span class="bullet">▸</span>
      <strong class="key">discovery</strong>
      <span class="val">rosie walks the repo for <code>SKILL.md</code> files — see <a href="#discovery">discovery</a> for the exact algorithm</span>
    </li>
    <li>
      <span class="bullet">▸</span>
      <strong class="key">name + description</strong>
      <span class="val">read from frontmatter · used as the install name and shown in <code>rosie list</code></span>
    </li>
    <li>
      <span class="bullet">▸</span>
      <strong class="key">extra files</strong>
      <span class="val"><code>scripts/</code>, <code>references/</code>, anything else in the directory travels with the skill — the agent can use them</span>
    </li>
  </ul>
</section>

<div class="section-rule" id="discovery">
  <span class="dashes">──</span>
  <a href="#discovery" class="label">discovery</a>
  <span class="dashes-grow"></span>
</div>

<section class="discovery">
  <p class="lockfile-intro">when rosie installs a repo, it walks the extracted tree looking for <code>SKILL.md</code> files. three layers, checked in order:</p>

  <ul class="bullet-list">
    <li>
      <span class="bullet">1</span>
      <strong class="key">root <code>SKILL.md</code></strong>
      <span class="val">single-skill repos where the repo root <em>is</em> the skill</span>
    </li>
    <li>
      <span class="bullet">2</span>
      <strong class="key"><code>skills/</code> subdir</strong>
      <span class="val">conventional layout: <code>skills/&lt;name&gt;/SKILL.md</code></span>
    </li>
    <li>
      <span class="bullet">3</span>
      <strong class="key">recursive walk (fallback)</strong>
      <span class="val">only runs when layers 1 and 2 found nothing · descends into any non-hidden subdirectory · stops at the first <code>SKILL.md</code> on each branch · max depth 5</span>
    </li>
  </ul>

  <p class="lockfile-intro">dot-directories are intentionally skipped — that includes consumer-side install destinations like <code>.agents/skills/</code>, <code>.claude/skills/</code>, <code>.cursor/skills/</code>, etc. Those are where rosie installs <em>into</em>, not where a package authors its own skills. A project that commits its installed third-party skills will not have them re-published when its own repo is installed as a package.</p>
</section>

<div class="section-rule" id="how-it-works">
  <span class="dashes">──</span>
  <a href="#how-it-works" class="label">how it works</a>
  <span class="dashes-grow"></span>
</div>

<section class="how-it-works">
  <p class="lockfile-intro">a single C program (also compiled to wasm for the npm package). what happens when you run <code>rosie install owner/repo</code>:</p>

<pre class="term-block">rosie install owner/repo
   │
   ├─▶ parse package spec  (owner/repo[@ref][#skill])
   │
   ├─▶ resolve ref         (latest semver tag · branch · pinned ref)
   │
   ├─▶ download tarball    (libcurl native · fetch in wasm)
   │   https://github.com/owner/repo/archive/refs/heads/main.tar.gz
   │
   ├─▶ extract             (libarchive)
   │
   ├─▶ discover skills     (walk for SKILL.md, parse YAML frontmatter)
   │
   ├─▶ detect agents       (check ~/.claude, ~/.cursor, …)
   │
   └─▶ install
       local:  copy to .agents/skills/, symlink to each agent
       global: copy directly to each ~/.&lt;agent&gt;/skills/</pre>

  <ul class="bullet-list">
    <li>
      <span class="bullet">▸</span>
      <strong class="key">native binary</strong>
      <span class="val">single small executable · no node, no python, no jvm runtime · ships for linux-x64, darwin-arm64, freebsd-x64</span>
    </li>
    <li>
      <span class="bullet">▸</span>
      <strong class="key">wasm fallback</strong>
      <span class="val">inlined into the npm package · works on every platform node runs · powers the <a href="#js-api">js api</a></span>
    </li>
    <li>
      <span class="bullet">▸</span>
      <strong class="key">deps</strong>
      <span class="val">libcurl + libarchive (system on linux/freebsd · static on macos · emscripten ports + node fetch in wasm)</span>
    </li>
  </ul>
</section>

<div class="section-rule" id="alternatives">
  <span class="dashes">──</span>
  <a href="#alternatives" class="label">alternatives</a>
  <span class="dashes-grow"></span>
</div>

<section class="alternatives">
  <p class="lockfile-intro">other tools in the agent-skills ecosystem worth a look:</p>

  <ul class="bullet-list">
    <li><span class="bullet">▸</span><strong class="key"><a href="https://skills.sh">skills</a></strong><span class="val">vercel's official skills cli · <code>npx skills</code> · node</span></li>
    <li><span class="bullet">▸</span><strong class="key"><a href="https://github.com/vercel-labs/add-skill">add-skill</a></strong><span class="val">vercel labs skill installer · node</span></li>
    <li><span class="bullet">▸</span><strong class="key"><a href="https://paks.stakpak.dev/">paks</a></strong><span class="val">stakpak's agent skills manager</span></li>
    <li><span class="bullet">▸</span><strong class="key"><a href="https://github.com/kasperjunge/agent-resources">agr</a></strong><span class="val">agent resources manager · python</span></li>
    <li><span class="bullet">▸</span><strong class="key"><a href="https://github.com/danielmeppiel/apm">apm</a></strong><span class="val">agent package manager</span></li>
    <li><span class="bullet">▸</span><strong class="key"><a href="https://lib.rs/crates/skill-manager">skill-manager</a></strong><span class="val">cli for managing ai assistant skills · rust</span></li>
    <li><span class="bullet">▸</span><strong class="key"><a href="https://pypi.org/project/agent-skills-cli/">agent-skills-cli</a></strong><span class="val">agent skills cli · python</span></li>
  </ul>
</section>

<div class="section-rule">
  <span class="dashes-grow"></span>
</div>

<footer class="page-footer">
  <p>rosie · BSD-3 · <a href="https://github.com/matthewp/rosie">github.com/matthewp/rosie</a></p>
  <p class="cursor"><span class="prompt">$</span><span class="blink"></span></p>
</footer>
