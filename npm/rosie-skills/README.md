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
- Source: clone the repo and run `make release`

## License

BSD-3-Clause
