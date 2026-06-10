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
    <a class="btn btn-ghost" href="https://github.com/withastro/rosie">[ github → ]</a>
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
      <span class="val">claude, cursor, opencode, codex, and <a href="/docs/agents/">8 more</a> — auto-detected</span>
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
<pre class="term-block"><span class="prompt">$</span> brew tap withastro/rosie
<span class="prompt">$</span> brew install rosie<button class="copy-btn" data-copy>[ copy ]</button></pre>
  </div>

  <div class="tab-panel" data-panel="aur">
<pre class="term-block"><span class="prompt">$</span> yay -S rosie
<span class="comment"># or</span>
<span class="prompt">$</span> paru -S rosie<button class="copy-btn" data-copy>[ copy ]</button></pre>
  </div>

  <div class="tab-panel" data-panel="apt">
    <p class="panel-note"><span class="comment"># noble for ubuntu 24.04 / debian 13+, jammy for ubuntu 22.04</span></p>
<pre class="term-block"><span class="prompt">$</span> echo "deb [trusted=yes] https://pkg.rosie.astro.build/debian noble main" \
    | sudo tee /etc/apt/sources.list.d/rosie.list
<span class="prompt">$</span> sudo apt update
<span class="prompt">$</span> sudo apt install rosie<button class="copy-btn" data-copy>[ copy ]</button></pre>
  </div>

  <div class="tab-panel" data-panel="pkg">
    <p class="panel-note"><span class="comment"># add the rosie repo, then install</span></p>
<pre class="term-block"><span class="prompt">$</span> sudo mkdir -p /usr/local/etc/pkg/repos
<span class="prompt">$</span> cat &lt;&lt;'EOF' | sudo tee /usr/local/etc/pkg/repos/rosie.conf
rosie: {
  url: "https://pkg.rosie.astro.build/freebsd/",
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
<pre class="term-block"><span class="prompt">$</span> git clone https://github.com/withastro/rosie
<span class="prompt">$</span> cd rosie
<span class="prompt">$</span> make
<span class="prompt">$</span> sudo make install<button class="copy-btn" data-copy>[ copy ]</button></pre>
  </div>
</section>

