---
title: cli
navOrder: 1
---

<div class="prompt-line"><span class="prompt">$</span> <a href="/">cd ..</a></div>

<div class="section-rule" id="cli">
  <span class="dashes">──</span>
  <a href="/docs/cli/" class="label">cli</a>
  <span class="dashes-grow"></span>
</div>

<section class="cli">
  <p class="lockfile-intro">the basic verbs: <code>install</code>, <code>update</code>, <code>remove</code>, <code>list</code>, <code>agents</code>. flags map one-to-one with the <a href="/docs/js-api/">js api</a>.</p>

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
    <li><span class="bullet">▸</span><strong class="key">-g, --global</strong><span class="val">install globally to <code>~/.&lt;agent&gt;/skills/</code> · GitHub sources are copied · local paths are symlinked in place</span></li>
    <li><span class="bullet">▸</span><strong class="key">-l, --local</strong><span class="val">install locally with symlinks (default)</span></li>
    <li><span class="bullet">▸</span><strong class="key">-r, --ref</strong><span class="val">install as a reference (README, or a SKILL.md via <code>--skill</code>)</span></li>
    <li><span class="bullet">▸</span><strong class="key">-s, --skill &lt;name&gt;</strong><span class="val">with <code>--ref</code>: install a specific SKILL.md</span></li>
    <li><span class="bullet">▸</span><strong class="key">-n, --name &lt;name&gt;</strong><span class="val">with <code>--ref</code>: override the default install name</span></li>
    <li><span class="bullet">▸</span><strong class="key">-N, --npm</strong><span class="val">with <code>--ref</code>: source from <code>node_modules/&lt;pkg&gt;/</code></span></li>
    <li><span class="bullet">▸</span><strong class="key">-I, --include &lt;path&gt;</strong><span class="val">with <code>--npm</code>: file or directory to include (repeatable; replaces default scope)</span></li>
    <li><span class="bullet">▸</span><strong class="key">--cwd &lt;path&gt;</strong><span class="val">run as if started from <code>&lt;path&gt;</code> (mirrors <a href="/docs/js-api/">js api</a>'s <code>cwd</code> option)</span></li>
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
      <span class="val">installs into <code>~/.&lt;agent&gt;/skills/&lt;name&gt;/</code> for every detected agent. shared across projects. GitHub sources are copied (no lockfile). local paths (<code>rosie install ~/skills/my-skill -g</code>) are symlinked directly at the source and tracked in <code>~/.agents/rosie.lock</code> — re-run with no args to re-link after a machine wipe.</span>
    </li>
  </ul>
</section>
