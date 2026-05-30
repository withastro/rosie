---
name: release
description: Cut a new rosie release. Use when asked to publish a release, bump the version, or ship X.Y.Z. Covers the version bump, the tag that triggers CI, and what gets published (GitHub release, npm, Homebrew, AUR, Debian, FreeBSD).
---

# Releasing rosie

Rosie ships two artifacts from one tag:

- the **standalone Rust `rosie` binary** (Homebrew, AUR, Debian/Ubuntu, FreeBSD), and
- the **`rosie-skills` npm package** (pure TypeScript).

Releases are **tag-driven**. Pushing a `v*` tag to `withastro/rosie` runs
`.github/workflows/release.yaml`, which builds and publishes everything. You do
not publish anything by hand.

## Versioning

Plain semver, tags look like `v0.8.0`. Minor bump for features, patch for fixes.

The **source of truth for the version is `Cargo.toml`** (mirrored in
`Cargo.lock`). The binary reads its version from there, and the Debian/FreeBSD
builds compile from the tagged commit, so `Cargo.toml` must already hold the new
version when the tag is created.

The npm package version is **derived from the tag** at publish time
(`npm version "$VERSION"` in the `npm-publish` job), so
`npm/rosie-skills/package.json` stays at `0.0.0` in the repo on purpose. Do not
bump it.

## Steps

For a release `X.Y.Z` (example: `0.8.0`):

1. Start from an up-to-date `main`:
   ```sh
   git checkout main && git pull
   ```

2. Bump the version in **two files** to `X.Y.Z`:
   - `Cargo.toml` -> `[package] version`
   - `Cargo.lock` -> the `name = "rosie"` package entry

3. Build and verify the binary reports the new version:
   ```sh
   cargo build --release
   ./target/release/rosie --version   # must print X.Y.Z
   ```
   The build also keeps `Cargo.lock` consistent (it should show only the one
   version-line change you made). See "Toolchain pin" below if `cargo` errors.

4. Commit to `main` and push (match the existing convention):
   ```sh
   git add Cargo.toml Cargo.lock
   git commit -m "Bump to X.Y.Z"
   git push origin main
   ```

5. Tag and push the tag. **This is the step that publishes the release:**
   ```sh
   git tag -a vX.Y.Z -m "Release vX.Y.Z"
   git push origin vX.Y.Z
   ```

## What the tag triggers

`release.yaml` runs these jobs off the tag:

- **create-release** - GitHub Release with generated notes; computes the source
  tarball SHA256 used by Homebrew/AUR.
- **npm-publish** - sets the version from the tag, builds `dist/` via `tsc`,
  runs `npm publish` for `rosie-skills` (npm OIDC, no token).
- **homebrew-and-aur** - updates the `withastro/homebrew-rosie` formula and the
  AUR `PKGBUILD`.
- **debian-build** + **debian-publish** - builds `.deb`s for jammy and noble,
  publishes the apt repo to `gh-pages`.
- **freebsd** - builds the `.pkg` in a FreeBSD VM and publishes to `gh-pages`.
  This is the slowest job (VM boot + build), usually finishes a few minutes
  after the others.

## Verify

```sh
# Release workflow + per-job status
gh run list --repo withastro/rosie --workflow release.yaml --limit 1
gh run view <run-id> --repo withastro/rosie

# npm published and tagged latest
npm view rosie-skills version dist-tags
npm view rosie-skills@X.Y.Z dependencies dist.unpackedSize
```

A healthy npm publish shows `latest` pointing at `X.Y.Z` with `diff` and
`modern-tar` as the only runtime dependencies and no platform-specific packages.

## Notes and gotchas

- **Toolchain pin.** `rust-toolchain.toml` pins the compiler (e.g. `1.96.0`) so
  CI does not silently jump stable releases. If a local `cargo` command fails
  with "Missing manifest in toolchain", the pinned toolchain is partially
  installed: `rustup toolchain install <channel> --force`, then rebuild.
- **Do not bump `package.json`.** Its `0.0.0` is intentional; the tag drives the
  npm version. Bumping it by hand causes a mismatch.
- **The tag is the point of no return.** npm publishes are effectively
  permanent. Make sure `main` is green and the version is right before pushing
  the tag.
- **FreeBSD lagging is normal.** If every job but `freebsd` is green shortly
  after tagging, that is expected; give it a few more minutes.
