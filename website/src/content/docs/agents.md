---
title: agents
---

<div class="prompt-line"><span class="prompt">$</span> <a href="/">cd ..</a></div>

<div class="section-rule" id="agents">
  <span class="dashes">──</span>
  <a href="/docs/agents/" class="label">agents</a>
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
