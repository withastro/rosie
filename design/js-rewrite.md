# Pure-JS rewrite of `rosie-skills`

Status: plan only, no code written. Captures what it takes to replace the
WASM engine inside the `rosie-skills` npm package with a real, pure-TypeScript
implementation of rosie, validated against the existing test suites.

## Scope (agreed)

1. **`rosie-skills` becomes pure JS, period.** `npm/rosie-skills/` gets a
   full TypeScript implementation of the library and CLI. There is **no**
   native binary path and **no** WASM path in the package, at all. `bin.ts`
   calls the TS implementation directly.
2. **The `rosie-skills-{platform}-{arch}` packages are retired.** They exist
   only to feed a native binary to the npm package, which no longer wants
   one. Stop building and publishing them; remove the `optionalDependencies`
   block from `rosie-skills`.
3. **The native binary is a separate product.** The standalone `rosie`
   binary is distributed exclusively through OS package managers (Homebrew,
   AUR, Debian, FreeBSD) and GitHub releases, built from the Rust core. It
   has nothing to do with the npm package and is untouched by this work.
4. **The Rust core stays as-is.** `src/`, `Cargo.toml`, and the binary do not
   change. There will be two implementations of the same logic (Rust and TS).
   That duplication is accepted.
5. **WASM is deleted** from the npm package: the bundled `.wasm`, the shim,
   the asyncify pump, and the loader.
6. **Same tests.** The TS implementation must pass the existing regression
   suite (52 CLI cases) and the wasm-parity API suite, against the same mock
   server and fixtures.
7. **Minimal dependencies.** Runtime deps target zero; one small dependency
   (`diff`) is accepted for the audit-log unified diffs. TypeScript stays a
   build-time devDependency only.

## Why this is tractable

The hard constraint is "pass the same tests." The test harness makes that
easy, because it already treats rosie as a black box:

- `tests/regression/run.sh` runs `$ROSIE <argv>`, captures
  `stdout`/`stderr`/`exit_code`, tree-diffs the project against `expected/`,
  checks symlink targets, and normalizes the lockfile timestamp before
  diffing. It accepts `--binary <path>` and already has a `--mode wasm` path
  that runs `node bin.js` through `tests/regression/lib/rosie-wasm`.
- All network I/O is mocked. A Python file server serves
  `tests/regression/fixtures/repos/` and rosie is pointed at it via
  `ROSIE_GITHUB_BASE_URL`. The TS code reads the same env var, so it hits the
  same fixtures with no test changes.
- `tests/wasm-parity/run.mjs` imports the built `dist/index.js` and calls the
  API directly, asserting on `InstallResult` / `Audit` shapes. With WASM gone
  this is no longer a "parity" check against a second engine; it becomes the
  API test suite for the only implementation. It keeps working unchanged.

So the TS implementation has two acceptance gates, both already written:
the 52-case CLI suite and the API suite. Neither needs rewriting to pass.

## Dependency analysis

Target is zero runtime deps. Verdict per concern:

| Concern | Rust today | TS replacement | Dep |
|---|---|---|---|
| gzip decode | `flate2` | `node:zlib` `gunzipSync` | none |
| tar extract | `tar` | hand-rolled 512-byte block parser (files, dirs, symlinks, skip pax) | none |
| HTTP | `ureq` + rustls | `fetch` (Node 18+): custom UA, redirects, status, body-to-buffer | none |
| pkt-line + semver | hand-rolled `resolve.rs` | direct port | none |
| symlinks + junctions | `junction` crate | `fs.symlinkSync(target, path, 'junction')` | none |
| sanitize | hand-rolled `sanitize.rs` | direct port (pure text) | none |
| timestamps | `time` crate | `new Date(s*1000).toISOString()`, strip the `.000` | none |
| CLI parsing | `lexopt` | hand-roll; `cli.rs` match ports directly | none |
| unified diff | `similar` | `diff` package (`createPatch`) | **diff** |

Only `diff` is a runtime dependency. It is small and well-tested, and the
audit tests assert only on substring markers (`-beta`, `+gamma`, `a/file.md`,
`b/file.md`), so its output format is compatible.

Build-time only: `typescript` and `@types/node` (already present).

## Module-by-module port map

Each Rust module maps to a TS module. Keep names parallel for reviewability.
The OS-boundary split disappears: with no WASM there is no native/wasm
divergence, so `src/os/` collapses into direct `node:fs` / `node:os` /
`node:process` calls.

| Rust source | TS module | Notes |
|---|---|---|
| `src/os/native.rs`, `src/os/mod.rs` | (folded into callers) | Direct `node:fs`, `node:os`, `node:process`. `is_agent_context` becomes an env-var check. |
| `src/log.rs` | `log.ts` | Verbose flag + last-error + an `OnLog` callback. The API already exposes `onLog`. |
| `src/util.rs` | `util.ts` | path join (`node:path`), home/temp dir, fs helpers, the hand-rolled `package.json` version scanner. |
| `src/lockfile.rs` | `lockfile.ts` | Custom whitespace format, `# rosie-lock v1` header, atomic write (`.tmp` then rename). ISO-8601 via `Date`. |
| `src/skill.rs` | `skill.ts` | YAML frontmatter mini-parser (`name`, `description`), `discover_skills` with the same search paths + depth-5 limit. |
| `src/agent.rs` | `agent.ts` | Port `AGENT_DEFS` (58 entries) verbatim. `detect_agents`, install-path resolution. |
| `src/agentsmd.rs` | `agentsmd.ts` | The `<!-- rosie:references:start -->` block rewriter across AGENTS.md / CLAUDE.md / GEMINI.md / copilot-instructions. |
| `src/sanitize.rs` | `sanitize.ts` | Invisible-char stripping + markdown-comment stripping outside fences. Pure text, direct port. |
| `src/archive.rs` | `archive.ts` | `gunzipSync` + hand-rolled tar reader. `get_archive_root_dir` reads the first entry. |
| `src/http.rs` + spec parsing in `src/download.rs` | `http.ts` + `download.ts` | `fetch_to_file` / `fetch_to_buffer` over `fetch`; spec parsing (`source_is_local`, `source_is_npm`, splits) is pure string work. Respect `ROSIE_GITHUB_BASE_URL`. Keep both User-Agent strings (`rosie/1.0`, `git/rosie-1.0`). |
| `src/resolve.rs` | `resolve.ts` | pkt-line parser + semver + peeled-tag (`^{}`) handling. Subtle, port test cases mentally. |
| `src/link.rs` | `link.ts` | `fs.symlinkSync` (POSIX + Windows junction for dirs); `fs.linkSync` then `copyFileSync` fallback for files. |
| `src/npm.rs` | `npm.ts` | Walk `node_modules/<pkg>/` for `*.md`; slug helpers. |
| `src/audit.rs` | `audit.ts` | Accumulator, `tag_rewritten` finding, unified diff via `diff`, the stdout wrapper text, JSON shape. |
| `src/install.rs` (1,788 lines) | `install.ts` | The orchestrator. Port last. Keep it one file and sequential, like the Rust. |
| `src/cli.rs` | `cli.ts` | Arg parsing + dispatch + usage text (copy verbatim). Exit codes: 0 ok, 1 usage, 255 internal failure. |

### Behavior contracts that must match byte-for-byte

The regression suite diffs files and matches stdout substrings, so these are
not optional:

- **Lockfile lines**: `name source ref sha installed_at pin kind`, with the
  `# rosie-lock v1` header. Timestamp column is normalized by the harness, so
  only its presence/position matters, not the exact value.
- **Symlink targets**: relative, e.g. `../../.agents/skills/my-skill`.
- **Global installs** create real directories under `$HOME/.<agent>/skills/`,
  not symlinks (a case asserts this explicitly).
- **stdout phrasing**: e.g. `symlink -> 2 agent(s)`, `Detected agents:`,
  `Supported agents:`, the audit `=== rosie audit ===` / `=== end rosie
  audit ===` wrapper, and `"schemaVersion":1`, `"command":"install"`.
- **Exit codes**: 255 for download/resolve failures (the Rust path returns a
  negative i32 that the binary casts to u8; the CLI must produce 255).
- **Agent-context gating**: the audit block prints to stdout only when an
  agent-context env var is set (or `--audit`); the suite clears those vars and
  cases opt in with `ROSIE_AGENT_CONTEXT=1`.

### Public API contract (must stay identical)

`index.ts` keeps every export and signature. The six async functions
(`list`, `agents`, `install`, `installFromLockfile`, `remove`, `update`) and
all the interfaces (`Skill`, `Agent`, `SkillResult`, `InstallResult`,
`Audit`, `AuditFinding`, `AuditChange`, the option types, `OnLog`) stay
byte-identical. Only the bodies change: instead of `loadModule()` +
`callApi()` over the WASM JSON envelope, they call the TS implementation
directly and return the same object shapes. The `cwd` option maps to running
the operation with `process.chdir` semantics (or threading a base dir);
`onLog` wires into `log.ts`.

## Test integration

No changes to the regression cases, fixtures, mock server, `assert.sh`, or
`diff_tree.sh`. Two small harness additions:

1. **A JS launcher** replacing `tests/regression/lib/rosie-wasm`: a
   `#!/usr/bin/env node` shim (or a tiny bash wrapper) that execs
   `npm/rosie-skills/dist/bin.js`. There is no `ROSIE_FORCE_WASM` anymore, so
   the wrapper just runs the bin.
2. **A runner mode**: add `--mode js` to `tests/regression/run.sh` that points
   `ROSIE_BINARY` at that launcher, parallel to the existing `--mode wasm`
   block. The build hint for that mode becomes
   `cd npm/rosie-skills && npm install && npm run build` (no `wasm/build.sh`).

`tests/wasm-parity/run.sh` drops its `wasm/build.sh` step (lines 11-13) and
keeps the rest. Optionally rename the directory to `tests/api/` since it no
longer tests WASM parity, but that rename is cosmetic and can wait.

Acceptance: `run.sh --mode js` passes all 52 cases; `wasm-parity/run.sh`
passes. During the port, run both continuously; they are the regression net.

## Packaging and CI changes

Small, because the binary channels are untouched.

KEEP unchanged:
- The standalone-binary release pipeline (FreeBSD, Debian, Homebrew/AUR
  templating) and the Rust CI build/test of the native binary.
- `src/`, `Cargo.toml`, and the `wasm/` crate source can remain in-repo (the
  Rust core is unchanged); the npm package simply no longer consumes any of
  its output.

CHANGE in `npm/rosie-skills/`:
- `package.json`: drop `"wasm"` from `files`; delete the
  `optionalDependencies` block entirely. Add `"diff"` to dependencies and
  `@types/diff` to devDependencies. `bin` and `exports` stay.
- `bin.ts`: replace the whole native/wasm dispatch (`tryNative()` +
  `runWasm()`) with a direct call into the CLI (`cli.ts`).
- Delete `wasm-loader.ts`, `silence-wasi-warning.ts`, and the bundled
  `npm/rosie-skills/wasm/` directory.

DELETE the platform packages: `npm/rosie-skills-linux-x64/`,
`npm/rosie-skills-darwin-arm64/`, `npm/rosie-skills-freebsd-x64/`.

CI:
- `ci.yaml`: drop the `build-wasm` job; add (or repoint) a job that builds the
  TS package and runs `tests/regression/run.sh --mode js` plus
  `tests/wasm-parity/run.sh`.
- `release.yaml`: drop the `wasm-build` job and the `npm-binary-*` jobs that
  build the platform binaries. `npm-publish` publishes only the pure-JS
  `rosie-skills` package (no WASM artifact, no platform packages). The
  standalone-binary release jobs (FreeBSD, Debian, Homebrew/AUR templating)
  are a separate pipeline and remain untouched.

## Suggested implementation order

Leaf modules first (pure, unit-testable), orchestration last, with the two
suites as the gate throughout.

1. **Scaffold**: TS module layout, `log.ts`, `util.ts`, env/fs helpers.
2. **Pure data/string modules**: `lockfile.ts`, `skill.ts`, `agent.ts`,
   `agentsmd.ts`, `sanitize.ts`, `npm.ts`. Unit-test each against the
   behaviors the Rust code encodes.
3. **`archive.ts`**: `gunzipSync` + tar reader. Test against a fixture
   tarball.
4. **`http.ts` + `download.ts`**: `fetch` wrapper honoring
   `ROSIE_GITHUB_BASE_URL`, plus spec parsing.
5. **`resolve.ts`**: pkt-line + semver + peeled tags. Test against
   `fixtures/.../info/refs`.
6. **`audit.ts`**: accumulator, diff via `diff`, wrapper text, JSON shape.
7. **`link.ts`**: symlink/junction/file fallback.
8. **`install.ts`**: the orchestrator. Land subcommand paths one at a time,
   running matching regression cases as each lands.
9. **`cli.ts` + `bin.ts`**: arg parsing, dispatch, usage text.
10. **`index.ts`**: rewrite bodies to call the TS implementation; keep the
    exact export surface. Wire `onLog` and `cwd`.
11. **Harness**: add `--mode js`; run both suites green.
12. **Cleanup**: delete WASM files, update `package.json`, CI, README install
    notes.

`install.ts` is where risk concentrates (it carries the most stateful logic).
Everything before it exists to make it portable and testable in isolation.

## Risks

1. **`install.ts` fidelity.** 1,788 lines of sequential orchestration. The
   regression suite covers the paths, so port path-by-path and keep the suite
   green; do not refactor the shape.
2. **`cwd` semantics.** The Rust CLI uses a real `--cwd` chdir. The library
   `cwd` option must produce identical on-disk results. Decide between
   `process.chdir` (simple, but process-global and not reentrant-safe for
   concurrent library calls) versus threading a base dir through every path
   join. The CLI can use chdir; the library is safer threading a base dir.
   The wasm-parity suite calls the API with `{ cwd }`, so this must work.
3. **Tar edge cases.** GitHub tarballs are simple (PAX global header, regular
   files, the wrapper dir), but the hand-rolled reader must handle the PAX
   header skip and preserve mode bits. Validate against the generated
   fixtures, which use PAX format.
4. **Symlink-on-Windows.** `fs.symlinkSync(target, path, 'junction')` is the
   `junction`-crate analog, but junctions need absolute targets, whereas the
   POSIX path uses relative targets. Match the Rust per-platform behavior.
   Not exercised by the Linux CI suite, so test separately.
5. **Exit-code mapping.** Internal failures must surface as 255, matching the
   Rust binary's u8 cast of a negative i32. The CLI layer owns this mapping.
6. **Node version.** `fetch` requires Node >= 18, which the package already
   declares in `engines`.
