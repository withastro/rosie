# Rust rewrite — discovery and mapping

Status: discovery only, no code written. This document captures what a Rust
rewrite of rosie would look like under the agreed constraints, and what each
existing C module maps to.

## Constraints (agreed)

1. **No API changes.** The TypeScript surface in `npm/rosie-skills/src/index.ts`
   is the public JS API and stays byte-identical. The CLI flags in `main.c`
   stay identical. The lockfile format (`.agents/rosie.lock`) stays identical.
2. **No platform changes.** Native: linux-x64, darwin-arm64, freebsd-x64,
   Windows-x64. WASM fallback for everything else, loaded by the npm
   `rosie-skills` package.
3. **No async Rust.** No `tokio`, no `async-std`, no `async fn` / `.await` in
   the Rust code. Blocking only.
4. **Plain Rust, not idiomatic-with-traits Rust.** Functions and structs, no
   premature abstractions. Read like the C does.
5. **Drop `libcurl` and `libarchive` as system dependencies** — replace with
   pure-Rust crates. Distro packaging updates accordingly.

## Layout

Single `cargo` crate at the repo root. No workspace, no sub-crates.

```
Cargo.toml
src/
  lib.rs          # re-exports the public functions used by both bin and wasm
  bin/rosie.rs    # CLI entry point (was main.c)
  agent.rs        # was agent.[ch]
  agentsmd.rs     # was agentsmd.[ch]
  archive.rs      # was archive.[ch] — now tar + flate2
  download.rs     # was download.[ch] + part of resolve.[ch]
  http.rs         # NEW — small trait-free split: native uses ureq, wasm uses extern fn
  install.rs      # was install.[ch] (the big one)
  link.rs         # was link.[ch]
  lockfile.rs     # was lockfile.[ch]
  npm.rs          # was npm.[ch]
  resolve.rs      # was resolve.[ch]
  skill.rs        # was skill.[ch]
  util.rs         # was util.[ch]
  log.rs          # extracted from util.[ch] — log_callback + last_error + g_verbose
wasm/
  src/lib.rs      # NEW — replaces wasm/api.c (cdylib, with #[no_mangle] exports)
  shim.js         # NEW — replaces wasm/http-lib.js
  build.sh        # cargo + wasm-opt --asyncify post-processing
```

Why split out `wasm/`: the WASM build is a separate `cargo` invocation against
the same `src/` with `--target wasm32-unknown-unknown` and a different crate
type (`cdylib`). The wasm-specific glue is small and lives next to its build
script, mirroring today's `wasm/` directory.

## Module-by-module mapping

### `src/util.c` → `src/util.rs` + `src/log.rs`

C public surface:

| C symbol | Rust equivalent |
|---|---|
| `path_join` | `path::PathBuf::join` (stdlib) |
| `get_home_dir` | `home` crate, or `std::env::var("HOME")` + `libc::getpwuid` fallback |
| `get_temp_dir` | `std::env::temp_dir()` |
| `dir_exists`, `file_exists` | `std::fs::metadata(p).map(|m| m.is_dir())` |
| `make_dirs` | `std::fs::create_dir_all` |
| `copy_file`, `copy_dir_recursive` | `std::fs::copy` + manual walk (no `walkdir` needed) |
| `str_dup`, `str_trim`, `str_starts_with`, `str_ends_with` | `String`, `str::trim`, `str::starts_with`, `str::ends_with` |
| `read_json_string_field` | reimplement scanner directly; no serde needed (used only for `package.json` `version`) |
| `spm_malloc` family | `Box::new` / `Vec` — Rust aborts on OOM by default |
| `log_info`, `log_error`, `log_debug`, `set_log_callback`, `last_error_message` | `log.rs` — `static LOG_CB: Mutex<Option<Box<dyn Fn(LogLevel, &str) + Send + Sync>>>` + `static LAST_ERROR: Mutex<Option<String>>`. WASM build uses `parking_lot::Mutex` to avoid pthread pulls; in practice `std::sync::Mutex` works for single-threaded wasm too |
| `g_verbose`, `g_host_is_windows` | `static G_VERBOSE: AtomicBool`; `g_host_is_windows` is gone — WASM build branches on a feature instead (see `link.rs`) |

Notes:
- `read_json_string_field` is hand-rolled in C to avoid pulling a JSON
  parser. Keep it hand-rolled in Rust too — it's ~50 lines and only used to
  extract `version` from `package.json`.
- The `last_error` static buffer is the contract the WASM API relies on:
  `log_error` writes there, then `envelope_err` reads it. Preserve that
  contract.

### `src/agent.c` → `src/agent.rs`

A trivial port. The `AGENT_DEFS` sentinel array becomes:

```rust
struct AgentDef { name: &'static str, display: &'static str, config_dir: &'static str, skills_dir: &'static str, binary: Option<&'static str> }
const AGENT_DEFS: &[AgentDef] = &[ ... ];
```

`AgentList` becomes `Vec<Agent>`. `detect_agents`, `agents_from_names`,
`find_agent_def`, `get_agent_install_path` map 1:1.

### `src/skill.c` → `src/skill.rs`

YAML frontmatter parser is hand-rolled (only `name:` and `description:`,
keep it that way). Functions:

- `parse_skill_file(path)` → `fn parse_skill_file(path: &Path) -> Option<Skill>`
- `skill_strip_yaml_frontmatter(path)` → `fn strip_yaml_frontmatter(path: &Path) -> Option<String>`
- `discover_skills(base_dir)` → `fn discover_skills(base: &Path) -> Vec<Skill>` with the same `SKILL_SEARCH_PATHS` list and depth-5 recursion limit

### `src/lockfile.c` → `src/lockfile.rs`

The lockfile format is whitespace-separated `name source ref sha installed_at pin kind`
with `# rosie-lock v1` header. Custom format, custom parser. Keep it custom.

Atomic save: write to `<path>.tmp` then `std::fs::rename`. Same as C.
`gmtime_r` + `strftime` for ISO 8601 → `chrono` crate, or `time` crate. I'd
take **`time`** — smaller dep, no async features to fight with.

`LockEntry` becomes a struct of `String` fields; `Lockfile` is `Vec<LockEntry> + path: PathBuf`.

### `src/npm.c` → `src/npm.rs`

Walks `node_modules/<pkg>/` for `*.md` files. Pure filesystem work, no async,
no deps beyond `std::fs`. Slug helpers (`npm_pkg_slug`, `npm_file_slug`,
`npm_ref_name`) are pure string functions.

### `src/agentsmd.c` → `src/agentsmd.rs`

Markdown-block-rewriter inside `AGENTS.md` / `CLAUDE.md` / `GEMINI.md` /
`.github/copilot-instructions.md`. Pure file I/O + string scanning. No deps.

### `src/archive.c` → `src/archive.rs` (**big simplification**)

C uses `libarchive` for tar.gz extraction. Rust replacement:

```toml
tar = "0.4"
flate2 = "1.0"
```

Both pure-Rust, no native deps, no async, work on WASM. This removes:
- `libarchive` system dep from PKGBUILD, debian/control, freebsd-pkg-manifest.ucl
- The libarchive cross-compile step in `wasm/build.sh` (~30 lines, fetches
  libarchive 3.7.7 source, runs emconfigure)
- The complex `npm-binary-darwin-arm64` job that statically links libarchive
  and its 6 transitive deps (`zstd`, `lz4`, `libb2`, `xz`, `expat`) — see
  `.github/workflows/release.yaml:247-289`. With pure-Rust extraction this
  whole song-and-dance disappears.

The C extract_tarball passes `ARCHIVE_EXTRACT_PERM | ACL | FFLAGS`. The `tar`
crate's default `Archive::unpack` preserves permissions; ACLs/FFLAGS are
ignored, which is fine — GitHub tarballs don't carry them.

`get_archive_root_dir` reads only the first entry. Trivial.

### `src/download.c` → `src/download.rs` + `src/http.rs`

`download.c` mixes two concerns:

1. **Package spec parsing** (`package_spec_parse`, `source_is_local`,
   `source_is_npm`, etc.) — pure string work, no I/O. Stays in `download.rs`.
2. **HTTP transport** (libcurl or wasm fetch) — moves to `http.rs`.

`http.rs` is the only place where native and WASM diverge. Trait-free:

```rust
// http.rs — native (default features)
#[cfg(not(target_arch = "wasm32"))]
pub fn fetch_to_file(url: &str, output_path: &Path) -> Result<i32, ()> {
    // ureq blocking call; returns HTTP status or transport error
}
#[cfg(not(target_arch = "wasm32"))]
pub fn fetch_to_buffer(url: &str, accept: Option<&str>) -> Result<(i32, Vec<u8>), ()> { ... }

// http.rs — wasm
#[cfg(target_arch = "wasm32")]
extern "C" {
    fn rosie_fetch_to_file(url_ptr: *const u8, url_len: usize,
                           path_ptr: *const u8, path_len: usize) -> i32;
    fn rosie_fetch_to_buffer(url_ptr: *const u8, url_len: usize,
                             accept_ptr: *const u8, accept_len: usize,
                             out_buf_ptr: *mut *mut u8, out_len: *mut usize) -> i32;
}
#[cfg(target_arch = "wasm32")]
pub fn fetch_to_file(url: &str, output_path: &Path) -> Result<i32, ()> { ... }
```

Native uses `ureq` (pure Rust, blocking, no tokio). WASM uses `extern fn`
imports supplied by `wasm/shim.js`. The Rust code is sync top-to-bottom; the
asyncify post-pass at build time is what lets the JS side `await` the call.

`HTTP_USER_AGENT` constants: `"rosie/1.0"` for tarball, `"git/rosie-1.0"` for
the smart-HTTP refs fetch (some servers gate on a git-shaped UA). Preserve
both.

### `src/resolve.c` → `src/resolve.rs`

This is interesting: a hand-rolled **git smart-HTTP pkt-line parser** that
reads `https://github.com/<owner>/<repo>/info/refs?service=git-upload-pack`
and picks the highest semver tag. ~390 lines.

Direct port. No external git crate needed (and bringing one in would be a
giant dep). `parse_pkt_len`, `parse_refs`, `parse_semver`, `semver_cmp`,
`peeled_sha_for`, `resolve_latest_tag`, `resolve_ref` all map 1:1.

The peeled-tag handling (`^{}` suffix for annotated tags) is subtle — make
sure to port the test cases mentally.

### `src/link.c` → `src/link.rs`

| Platform | C strategy | Rust strategy |
|---|---|---|
| POSIX (linux, darwin, freebsd) | `symlink()` | `std::os::unix::fs::symlink` |
| Windows native (dirs) | `DeviceIoControl(FSCTL_SET_REPARSE_POINT)` — 150 lines | `junction` crate, OR keep the `DeviceIoControl` code via `windows` crate |
| Windows native (files) | `CreateHardLinkW` → `CopyFileW` fallback | `std::fs::hard_link` → `std::fs::copy` fallback |
| WASM, POSIX host | symlink via emscripten NODERAWFS | `extern fn` to JS `fs.symlinkSync` |
| WASM, Windows host | JS-side `fs.symlinkSync(target, link, 'junction')` | same — `extern fn` to JS junction creator |

For the Windows-native junction path, the **`junction`** crate (~200 lines of
unsafe `winapi` calls, well-tested) is the cleanest port. If we don't want
the dep, we can transliterate the C using the `windows` crate — but that's
the same amount of code, with no advantage.

The `g_host_is_windows` flag goes away. The WASM build always routes through
JS-supplied externs. The JS side (`wasm/shim.js`) decides at runtime whether
to use `fs.symlinkSync(target, link, 'junction')` (Windows host) or the
default symlink form (POSIX host).

### `src/install.c` → `src/install.rs` (the **big one**, 1,694 lines)

Public functions to preserve, signature-for-signature:

```rust
pub fn install_package(opts: &InstallOptions) -> i32;
pub fn install_skill_to_agent(skill: &Skill, agent: &Agent) -> i32;
pub fn remove_skill(opts: &RemoveOptions) -> i32;
pub fn install_from_lockfile(base_opts: &InstallOptions) -> i32;
pub fn update_skills(base_opts: &InstallOptions, only_skill: Option<&str>) -> i32;
pub fn list_installed_skills() -> i32;
```

Internal helpers (keep as private `fn`s in the same file, mirror C names):

```
install_local, remove_dir_recursive, write_string_to_file,
npm_install_one, install_npm_references, install_reference_from_extracted,
remove_reference, free_snapshots, update_npm_package, default_ref_name,
find_readme_in_tree, create_temp_dir, install_to_canonical, install_skill_local
```

This is the file that does most of the orchestration: parse spec, download
tarball, extract, walk skills, copy to canonical, symlink to agents, update
lockfile, rebuild AGENTS.md block. The shape stays the same; it just becomes
Rust functions returning `i32` (matching the C convention of `0 = ok`,
`!= 0 = err`) so the exit-code path stays identical.

Resist the temptation to refactor this into smaller files. The C version is
one big file because the logic is genuinely sequential and stateful. Match it.

Return-type choice: I'd keep `i32` return codes rather than `Result<(), Error>`
for the public functions. Two reasons: (1) it matches C exactly so the WASM
envelope code stays one-liner, (2) error info is already plumbed through
`log_error` / `last_error_message`, not via return values. A `Result` would
double-up the error path.

### `src/main.c` → `src/bin/rosie.rs`

CLI argument parsing. The C uses `getopt_long` with custom code (~360 lines).
Options:

- **Hand-roll the same arg parser in Rust** — ~150 lines, matches C exactly,
  no deps.
- **Use `lexopt`** — tiny dep (no proc macros, no derive), pull-style parsing
  that maps cleanly onto the `getopt_long` switch.
- **Use `clap`** — large dep with many features; would change help-text
  formatting unless we override every detail.

I'd take **`lexopt`** — closest fit to the C structure, no derive macros, no
async, ~3kLOC dep. The help text stays under our control (we print it
ourselves).

Subcommand dispatch (`install` / `update` / `remove` / `list` / `agents` /
`help`) is a `match` on `argv[1]`. The `--cwd` global flag pre-pass becomes
`std::env::set_current_dir(p)`.

## WASM build details

### Build pipeline

```bash
# wasm/build.sh
cargo build --release --target wasm32-unknown-unknown -p rosie-wasm
wasm-opt build/wasm/rosie.wasm \
    --asyncify \
    --pass-arg=asyncify-imports@env.rosie_fetch_to_file,env.rosie_fetch_to_buffer \
    -O2 \
    -o npm/rosie-skills/wasm/rosie.wasm
cp wasm/shim.js npm/rosie-skills/wasm/rosie.js
```

No emscripten. No docker container. No 100MB emsdk image. Just `cargo` and
`wasm-opt` (Binaryen, single binary).

CI change for `wasm-build` job in `release.yaml:291-309`:

```yaml
wasm-build:
  needs: create-release
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - uses: actions-rust-lang/setup-rust-toolchain@v1
      with:
        target: wasm32-unknown-unknown
    - name: Install Binaryen (wasm-opt)
      run: sudo apt-get install -y binaryen
    - name: Build rosie.wasm
      run: ./wasm/build.sh
    - uses: actions/upload-artifact@v4
      with: { name: rosie-wasm, path: npm/rosie-skills/wasm/ }
```

### WASM API (`wasm/src/lib.rs`)

Replaces `wasm/api.c`. Same 7 exports, same JSON envelope contract:

```rust
#[no_mangle]
pub extern "C" fn rosie_api_list_installed() -> *mut c_char { ... }
#[no_mangle]
pub extern "C" fn rosie_api_agents() -> *mut c_char { ... }
#[no_mangle]
pub extern "C" fn rosie_api_install(spec: *const c_char, ...) -> *mut c_char { ... }
#[no_mangle]
pub extern "C" fn rosie_api_remove(...) -> *mut c_char { ... }
#[no_mangle]
pub extern "C" fn rosie_api_update(...) -> *mut c_char { ... }
#[no_mangle]
pub extern "C" fn rosie_api_set_verbose(verbose: i32) { ... }
#[no_mangle]
pub extern "C" fn rosie_api_install_log_bridge() { ... }
```

Note: `rosie_api_set_host_platform` is **gone** — see the link.rs notes
above. The JS shim handles per-platform routing.

`malloc` / `free` exports: with `wasm32-unknown-unknown`, Rust's `dlmalloc`
isn't exposed by name. We add a tiny export pair:

```rust
#[no_mangle]
pub extern "C" fn rosie_malloc(size: usize) -> *mut u8 { ... }
#[no_mangle]
pub extern "C" fn rosie_free(ptr: *mut u8, size: usize) { ... }
```

JS shim calls `rosie_free` instead of `_free`. Tiny change in
`wasm-loader.ts`.

JSON building: small hand-rolled `JsonBuf` equivalent, ~80 lines of Rust.
No `serde_json` — keeps the wasm binary small (serde_json adds ~80KB).

### `wasm/shim.js`

Replaces `wasm/http-lib.js` + the loader half of `wasm-loader.ts`. Roughly:

```js
// Instantiates rosie.wasm with imports for rosie_fetch_to_file,
// rosie_fetch_to_buffer, rosie_create_link. Wraps exports so that the
// asyncify-instrumented ones return Promises to TS.
```

Asyncify produces a wasm module where designated imports can suspend the
stack. Without emscripten's runtime, we supply that runtime ourselves —
it's ~50 lines of JS that allocates a small "asyncify data" buffer and
manages the start/stop calls. The Binaryen docs cover the protocol.
[Reference: github.com/WebAssembly/binaryen/blob/main/src/passes/Asyncify.cpp]

### `wasm-loader.ts` changes

Today's `wasm-loader.ts` imports the emcc-generated factory. It becomes
slightly thinner: just instantiate `rosie.wasm` via the new `shim.js`'s
exported `createRosie` function, then call exports via the wrapper. The
TypeScript types and `loadModule` / `callApi` signatures stay identical, so
`index.ts` doesn't change at all.

## Cargo dependencies (final list)

```toml
[package]
name = "rosie"
version = "0.5.6"
edition = "2021"
license = "BSD-3-Clause"

[dependencies]
tar    = "0.4"     # tar.gz extraction (replaces libarchive)
flate2 = "1.0"     # gzip decode (default rust_backend, no native deps)
time   = "0.3"     # ISO 8601 timestamps for lockfile
lexopt = "0.3"     # CLI arg parsing

[target.'cfg(not(target_arch = "wasm32"))'.dependencies]
ureq = { version = "2", default-features = false, features = ["tls"] }
# ureq's "tls" feature uses rustls — no openssl system dep

[target.'cfg(windows)'.dependencies]
junction = "1"     # Windows directory junctions (replaces our DeviceIoControl code)

[lib]
name = "rosie"
path = "src/lib.rs"

[[bin]]
name = "rosie"
path = "src/bin/rosie.rs"
```

The wasm crate is a separate `cargo` invocation:

```toml
# wasm/Cargo.toml
[package]
name = "rosie-wasm"
edition = "2021"

[lib]
crate-type = ["cdylib"]
path = "src/lib.rs"

[dependencies]
rosie = { path = ".." }   # re-uses everything in the main crate
```

Total deps: 4 in the main crate (`tar`, `flate2`, `time`, `lexopt`),
plus `ureq` for native, plus `junction` for Windows. Compare to today's
zero Rust deps but native `libcurl` + `libarchive` system deps. Net win on
the distribution side: no system C library version compatibility headaches.

## Packaging changes required

### Distro packages

| File | Change |
|---|---|
| `aur/PKGBUILD` | Replace `depends=('curl' 'libarchive')` with `makedepends=('rust' 'cargo')`. Build with `cargo build --release` instead of `make release`. `makedepends` because the runtime binary is self-contained — no `depends` line at all (rustls statically linked) |
| `debian/control` | Drop `Depends: libcurl4, libarchive13`. Build-Depends adds `cargo` (or use a Rust toolchain action in CI and skip system cargo). The published `.deb` ships a static binary with no runtime deps |
| `debian/build-package.sh` | Update CFLAGS handling — gone. Cargo handles it |
| `freebsd-package/pkg-manifest.ucl` | Drop `deps: { curl, libarchive }`. Add `rust` as build-only dep (or build cross from CI) |
| `freebsd-package/build-package.sh` | Update build commands |
| `Makefile` | Either delete it or make it a `cargo` wrapper. AUR/debian/freebsd scripts call `make release` — they'd switch to `cargo build --release` |

### Homebrew tap

`Formula/rosie.rb` (in `matthewp/homebrew-rosie`): change `depends_on` lines.
Rust formula instead of curl/libarchive. The build block changes from
`make release` to `cargo build --release`.

### CI (`.github/workflows/`)

| Job | Change |
|---|---|
| `ci.yaml:build-linux` | Drop apt-get of libcurl/libarchive. Add `actions-rust-lang/setup-rust-toolchain@v1`. Build with `cargo build` |
| `ci.yaml:build-macos` | Drop brew of curl/libarchive. Add Rust toolchain. Build with `cargo build` |
| `release.yaml:freebsd` | Inside the FreeBSD VM, install `rust` instead of `pkgconf curl libarchive`. Build with `cargo build --release` |
| `release.yaml:debian-build` | Drop apt deps. Add Rust toolchain. Build with `cargo build --release` |
| `release.yaml:npm-binary-linux-x64` | Same — drop apt deps, add Rust toolchain |
| `release.yaml:npm-binary-darwin-arm64` | **Huge simplification.** Today this job has 40 lines of brew installation, static linking gymnastics, and `otool -L` verification because of libarchive's transitive deps. With pure-Rust extraction: install Rust, `cargo build --release`, upload. ~5 lines |
| `release.yaml:wasm-build` | Replace emscripten docker invocation with Rust + wasm-opt (see above) |
| `release.yaml:npm-publish` | No change to this job — it just downloads artifacts and runs `npm publish` |

### What stays the same

- `rosie` CLI flags, output format, exit codes
- `.agents/rosie.lock` format
- `.agents/skills/`, `.agents/references/` directory layout
- `AGENTS.md` `<!-- rosie:references:start -->` block format
- TypeScript API in `npm/rosie-skills/src/index.ts`
- The 7 WASM exports (function names, return type = pointer to JSON string)
- The JSON envelope `{ok: true, data} / {ok: false, error}`
- `Module.__rosieLog__` callback contract
- The platform-specific npm packages (`rosie-skills-linux-x64`, etc.) — same
  shape, just shipping a Rust-built binary inside

## Open risks I'd flag

1. **Asyncify + cargo-built wasm.** This is the only part that isn't a
   well-worn path. Emscripten does asyncify routinely; Rust-built wasm +
   `wasm-opt --asyncify` is rarer. There's
   [example projects](https://github.com/WebAssembly/binaryen/wiki/Asyncify-for-Rust)
   but it's not as smooth as in C. We should prove this works with a 50-line
   spike before committing to the rewrite. The spike: a Rust function that
   calls an imported JS fetch, post-processed with wasm-opt, called from
   Node — works end to end.

2. **TLS in `ureq`.** Default `ureq` with `rustls` should work on all four
   native targets, including statically linked. Verify on macOS arm64 in
   particular (we want a single self-contained binary with no
   `/opt/homebrew` references — see today's `otool -L` check in
   `release.yaml:276-283`).

3. **`junction` crate on Windows.** Look at the actual crate code and decide
   whether to depend on it or transliterate today's C into safe Rust using
   the `windows` crate. The latter is ~150 lines and avoids the dep.

4. **No formal test suite.** Existing testing is manual / smoke. Before
   cutting over, I'd want at least:
   - A handful of integration tests against fixture repos (could use git's
     test fixtures or just a local skills repo)
   - A regression test comparing C-rosie and Rust-rosie output for the same
     installs on the same fixtures, byte-for-byte where feasible
   This is the only place where I'd expand scope vs the C version.

## Suggested implementation order

If we proceed, the order that minimizes risk:

1. **Asyncify spike** — prove the WASM toolchain works end-to-end before
   anything else. (1 day)
2. **Port `util.rs`, `log.rs`, `lockfile.rs`, `skill.rs`, `agent.rs`,
   `agentsmd.rs`, `npm.rs`** — pure data and string functions, no I/O
   beyond `std::fs`. (2-3 days)
3. **Port `archive.rs`** + native http via `ureq` + `download.rs` parsing.
   (1 day)
4. **Port `resolve.rs`** — pkt-line + semver. (1 day)
5. **Port `link.rs`** — POSIX first, then Windows. (1 day)
6. **Port `install.rs`** — the big one. Test each subcommand path as it
   lands. (3-4 days)
7. **Port `bin/rosie.rs`** — CLI parsing. (0.5 day)
8. **Build the WASM crate + shim.js + update wasm-loader.ts.** (2 days)
9. **Update CI workflows, distro packaging files.** (1 day)
10. **End-to-end smoke + comparison testing on all four platforms.**

Rough total: 12-15 person-days. The risk concentrates in steps 1, 6, and 8.
