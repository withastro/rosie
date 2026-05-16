---
title: references
navOrder: 4
---

<div class="prompt-line"><span class="prompt">$</span> <a href="/">cd ..</a></div>

<div class="section-rule" id="references">
  <span class="dashes">──</span>
  <a href="/docs/references/" class="label">references</a>
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
