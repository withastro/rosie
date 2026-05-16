---
title: lockfile
navOrder: 2
---

<div class="prompt-line"><span class="prompt">$</span> <a href="/">cd ..</a></div>

<div class="section-rule" id="lockfile">
  <span class="dashes">──</span>
  <a href="/docs/lockfile/" class="label">lockfile</a>
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
