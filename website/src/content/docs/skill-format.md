---
title: skill format
navOrder: 7
---

<div class="prompt-line"><span class="prompt">$</span> <a href="/">cd ..</a></div>

<div class="section-rule" id="skill-format">
  <span class="dashes">──</span>
  <a href="/docs/skill-format/" class="label">skill format</a>
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
      <span class="val">rosie walks the repo for <code>SKILL.md</code> files — see <a href="/docs/discovery/">discovery</a> for the exact algorithm</span>
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
