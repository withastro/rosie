# rosie-skills

A fast, cross-platform package manager for AI agent skills.

## Install

```bash
npm install -g rosie-skills
```

Or use without installing:

```bash
npx rosie-skills install owner/repo
```

## Usage

```bash
rosie-skills install owner/repo
rosie-skills list
rosie-skills --help
```

See the full documentation at <https://github.com/matthewp/rosie>.

## Supported platforms

Prebuilt binaries are shipped for:

- `linux-x64`
- `darwin-arm64`
- `freebsd-x64`

For other platforms, install from source:

- Homebrew: `brew tap matthewp/rosie && brew install rosie`
- Arch Linux: `yay -S rosie`
- Debian/Ubuntu: see <https://github.com/matthewp/rosie>
- Source: clone the repo and run `make release`

## License

BSD-3-Clause
