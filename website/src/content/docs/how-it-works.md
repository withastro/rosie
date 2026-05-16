---
title: how it works
---

<div class="prompt-line"><span class="prompt">$</span> <a href="/">cd ..</a></div>

<div class="section-rule" id="how-it-works">
  <span class="dashes">──</span>
  <a href="/docs/how-it-works/" class="label">how it works</a>
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
      <span class="val">inlined into the npm package · works on every platform node runs · powers the <a href="/docs/js-api/">js api</a></span>
    </li>
    <li>
      <span class="bullet">▸</span>
      <strong class="key">deps</strong>
      <span class="val">libcurl + libarchive (system on linux/freebsd · static on macos · emscripten ports + node fetch in wasm)</span>
    </li>
  </ul>
</section>
