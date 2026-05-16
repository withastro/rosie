---
title: discovery
---

<div class="prompt-line"><span class="prompt">$</span> <a href="/">cd ..</a></div>

<div class="section-rule" id="discovery">
  <span class="dashes">──</span>
  <a href="/docs/discovery/" class="label">discovery</a>
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
