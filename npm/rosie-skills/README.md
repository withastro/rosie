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

Three platform binaries (`linux-x64`, `darwin-arm64`, `freebsd-x64`) ship as
optional dependencies. On those platforms the CLI execs the native binary
directly. On everything else (Windows, `linux-arm64`, `darwin-x64`, etc.) the
package falls back to an inlined WebAssembly build that does the same work
in-process. The JS API always uses the WASM build so you can call it
synchronously from Node code without spawning a subprocess.

## Supported platforms

| Platform        | CLI        | JS API |
|-----------------|------------|--------|
| linux-x64       | native     | WASM   |
| darwin-arm64    | native     | WASM   |
| freebsd-x64     | native     | WASM   |
| Everything else | WASM       | WASM   |

For native installs on platforms we don't ship a binary for:

- Homebrew (macOS / Linux): `brew tap matthewp/rosie && brew install rosie`
- Arch Linux: `yay -S rosie`
- Debian/Ubuntu: see <https://github.com/matthewp/rosie>
- Source: clone the repo and run `cargo build --release`

## License

BSD-3-Clause
