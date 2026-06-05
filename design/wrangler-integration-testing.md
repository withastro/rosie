# Testing the wrangler integration after rosie got bundled

Status: implemented. Records why the wrangler integration test had to change
from "override an installed wrangler" to "build wrangler from source."

## The seam wrangler depends on

Wrangler (`cloudflare/workers-sdk`) installs Cloudflare skills on `wrangler
setup --install-skills`. The glue lives in
`packages/wrangler/src/agents-skills-install.ts` and calls the rosie-skills JS
API:

```ts
import { install as rosieInstall, agents as rosieAgents } from "rosie-skills";
const all = await rosieAgents();
const detected = all.filter(a => a.detected && a.installPath !== null) /* ...shape... */;
const { failedAgents } = await rosieInstall("cloudflare/skills",
  { global: true, agent: detected.map(a => a.rosie.id), lockfile: false });
```

`tests/wrangler-integration/` guards that exact seam against this repo's build.

## What changed, and why the old test broke

The old Level 2 e2e installed the real `wrangler` from npm into a scratch
project with `overrides: { "rosie-skills": "file:<our build>" }`, trusting that
wrangler imported rosie-skills from `node_modules` at runtime. It then asserted
the override took by reading the installed package's version sentinel.

That premise is dead. When rosie shipped as a pure-JS package, wrangler stopped
treating it as a runtime dependency:

- `rosie-skills` moved from `dependencies` to **`devDependencies`** in
  wrangler's `package.json`. A plain `npm install wrangler` no longer installs
  it at all, so the version-sentinel check fails first (`version=none`).
- wrangler **bundles** rosie into `wrangler-dist/cli.js` with esbuild at its own
  build time. All of rosie's `dist/*.js` modules become inputs to the bundle.
  A published wrangler therefore carries a *frozen snapshot* of whatever rosie
  it pinned, and nothing at the consumer's runtime resolves `rosie-skills` from
  `node_modules`.

The consequence is structural: the rosie -> wrangler integration is now a
**build-time** seam, not a runtime one. You cannot inject a different rosie into
an already-published wrangler binary, so "run published wrangler against my
local build" tests nothing about the local build.

## What we test now

Two levels, same as before in spirit:

- **Level 1 (contract)** is unchanged and is the load-bearing guard. It imports
  this branch's build by bare specifier and replays wrangler's glue verbatim
  (`agents()` shape, `install(..., { global, agent, lockfile: false })`,
  `failedAgents`). If rosie breaks the API/shape wrangler relies on, this fails.
  Hermetic and offline.

- **Level 2 (e2e)** reproduces wrangler's build so OUR rosie is the bundled one:
  1. Clone `workers-sdk` (blobless, shallow) at `--workers-sdk-ref` (default
     `main`).
  2. Add a pnpm override on the monorepo root:
     `pnpm.overrides["rosie-skills"] = "file:<repo>/npm/rosie-skills"`.
  3. `pnpm install --filter wrangler...` (browser downloads disabled).
  4. `turbo build --filter=wrangler` to build wrangler and its workspace deps.
  5. Confirm the override was bundled by grepping the esbuild metafile
     (`wrangler-dist/metafile-cjs.json`) for a `rosie-skills@file` input.
  6. Run `node wrangler-dist/cli.js setup --install-skills --dry-run --yes`
     against the regression suite's mock GitHub server and assert the
     `cloudflare-workers` / `cloudflare-pages` skills land on disk.

## Trade-offs and gotchas

- **It tracks `main` unpinned.** This catches wrangler-side glue changes early,
  at the cost of letting unrelated wrangler breakage fail rosie CI. Pin with
  `--workers-sdk-ref <tag|sha>` if that becomes noisy.
- **The build's DTS step can fail harmlessly.** wrangler's type-declaration emit
  trips on an undici `FormData` type mismatch in a freshly resolved tree. The
  CJS bundle still builds, so Level 2 tolerates the build exit code and asserts
  on `wrangler-dist/cli.js` plus the metafile rather than on a clean exit.
- **It is heavy.** A full monorepo `pnpm install` of wrangler's tree is ~1 GB
  and the `turbo build` compiles ~12 packages. `--no-e2e` keeps the fast,
  offline contract test as the default local signal.

## Options considered

- **Drop Level 2, keep contract only.** The contract test already covers the
  only thing a rosie release can break (the API surface). Simplest, but loses
  the "a real wrangler binary actually runs" signal.
- **Published-wrangler smoke.** Run published wrangler against the mock server.
  Works (the bundle still honors `ROSIE_GITHUB_BASE_URL`), but tests wrangler's
  *pinned* rosie, not this branch, so it can't gate a rosie change.
- **Build from source (chosen).** Heavier, but the only approach that exercises
  this branch's rosie inside a real wrangler binary now that the seam is
  build-time.
