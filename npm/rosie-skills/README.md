# rosie-skills

A fast, cross-platform package manager for AI agent skills. Use as a CLI or as
a typed JS library — same binary either way, via a native build on supported
platforms or WebAssembly everywhere else.

## CLI

```bash
npm install -g rosie-skills
rosie-skills install anthropics/skills
```

Or one-shot via npx:

```bash
npx rosie-skills install anthropics/skills
```

## JavaScript API

The package is ESM-only. Use a namespace import:

```js
import * as rosie from 'rosie-skills';

await rosie.install('anthropics/skills');

const skills = await rosie.list();
//   [{ name: 'pdf', source: 'anthropics/skills', ref: 'main', sha: '...', isReference: false }, ...]

const agents = await rosie.agents();
//   [{ name: 'claude', display: 'Claude Code', detected: true, installPath: '/home/.../skills' }, ...]
```

All functions return Promises. Failures throw `Error` with a descriptive message.

### Install result

`install`, `installFromLockfile`, and `update` return an `InstallResult`:

```ts
interface InstallResult {
  skills: Array<{
    name: string;
    kind: "skill" | "reference";
    installedAgents: string[];     // e.g. ["claude", "cursor"]
    failedAgents: string[];        // agents the symlink couldn't reach
  }>;
  installedAgents: string[];       // deduped union across all skills
  failedAgents: string[];          // deduped union across all skills
  installedInstruction:            // file rosie wrote the references block to
    | "AGENTS.md"
    | "CLAUDE.md"
    | "GEMINI.md"
    | ".github/copilot-instructions.md"
    | null;                         // null for pure-skill installs
  audit: {                         // structured audit of every change + findings
    schemaVersion: 1;
    command: "install" | "update";
    findings: Array<{              // rosie's own warnings, e.g. tag_rewritten
      severity: "high";
      kind: "tag_rewritten" | string;
      skill: string;
      ref: string;
      oldSha: string;
      newSha: string;
    }>;
    changes: Array<{
      name: string;
      kind: "skill" | "reference";
      source: string;
      ref: string;
      sha: string;
      operation: "install" | "update";
      content: string | null;      // full sanitized body, first-install only
      diff: string | null;         // unified diff, updates only
    }>;
  };
}
```

```js
const result = await rosie.install('anthropics/skills');
if (result.failedAgents.length > 0) {
  console.warn(`couldn't symlink into: ${result.failedAgents.join(', ')}`);
}
```

`failedAgents` is non-fatal: rosie tries every detected agent and reports the
misses. The canonical install at `.agents/skills/<name>/` still lands and the
lockfile entry is still recorded, so a subsequent run after fixing
permissions will retry the failed agents.

`remove()` returns `void`.

### Targeted install

```js
await rosie.install('vercel-labs/agent-skills', {
  agent: ['claude', 'cursor'],
  ref: false,
});
```

### As a reference, not a skill

```js
await rosie.install('vercel/next.js', { ref: true });
```

### Observe progress

The library is silent by default. Pass `onLog` to receive log events:

```js
await rosie.install('anthropics/skills', {
  onLog: ({ level, message }) => {
    if (level === 'error') console.error(message);
    else if (level === 'info') console.log(message);
    // 'warn' and 'debug' levels also available
  },
});
```

### Remove / update

```js
await rosie.remove('pdf');
await rosie.update();           // update everything in rosie.lock
await rosie.update('pdf');      // update just one
```

### Security defenses

Every install applies content sanitization and structured auditing by
default; see [docs/security](https://rosie.astro.build/docs/security/) for the full
threat model. Each defense can be disabled per call via `InstallOptions`:

```js
await rosie.install('anthropics/skills', {
  stripComments: false,      // keep markdown comments in reference installs
  stripInvisible: false,     // keep zero-width / bidi / tag-block codepoints
  retagDetect: false,        // skip the tag-rewrite check on `rosie update`
  forceAudit: true,          // print audit on stdout regardless of context
  suppressAudit: true,       // never print audit on stdout (still in result)
});
```

`forceAudit` and `suppressAudit` are mutually exclusive; passing both throws.
The `audit` field on the result is always populated regardless of the
emission flags — those flags only control whether the wrapped text is
written to stdout by the CLI / bin.ts launcher.

### Working directory

Every function accepts a `cwd` option — equivalent to `cd`'ing into that
directory before running. `process.cwd()` is restored on exit:

```js
await rosie.install('owner/repo', { cwd: '/path/to/project' });
```

Mirrors the CLI's `--cwd` flag.

### Skip the lockfile

For ad-hoc installs that shouldn't be recorded in `.agents/rosie.lock`:

```js
await rosie.install('anthropics/skills', { lockfile: false });
```

Mirrors the CLI's `--no-lockfile` flag. Available on `install`, `remove`,
and `update`.

### Reinstall from lockfile

```js
await rosie.installFromLockfile();
```

## How it works

This package is pure JavaScript. The CLI and the JS API run the same
TypeScript implementation in-process — no native binary, no WebAssembly. It
works anywhere Node 18+ runs. The only runtime dependency is `modern-tar`
(tarball extraction).

## Standalone binary

A standalone, self-contained `rosie` binary (built from the Rust
implementation) is distributed separately through OS package managers, for
users who want the CLI without a Node runtime:

- Homebrew (macOS / Linux): `brew tap withastro/rosie && brew install rosie`
- Arch Linux: `yay -S rosie`
- Debian/Ubuntu: see <https://github.com/withastro/rosie>
- Source: clone the repo and run `cargo build --release`

## License

BSD-3-Clause
