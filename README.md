# rosie

<p align="center">
  <img src="rosie.png" alt="Rosie the Robot">
</p>

A fast, cross-platform package manager for AI agent skills. Think npm, but for skills.

```bash
rosie install anthropics/skills
```

## Install

Via npm — works on every platform Node runs on:

```bash
npx rosie-skills install owner/repo
```

Via Homebrew:

```bash
brew tap withastro/rosie
brew install rosie
```

Other package managers (apt, AUR, FreeBSD pkg) + a build-from-source path are
on the docs site.

## Documentation

Full docs, including the CLI reference, the typed JavaScript API, lockfile
format, supported agents, and more: **<https://rosie.libs.technology/>**.

A quick jump table:

- **[install](https://rosie.libs.technology/#install)** — all install methods
- **[cli](https://rosie.libs.technology/#cli)** — commands and flags
- **[lockfile](https://rosie.libs.technology/#lockfile)** — `.agents/rosie.lock` format
- **[references](https://rosie.libs.technology/#references)** — markdown docs as agent context
- **[js api](https://rosie.libs.technology/#js-api)** — `import * as rosie from 'rosie-skills'`
- **[supported](https://rosie.libs.technology/#supported)** — detected agents
- **[skill format](https://rosie.libs.technology/#skill-format)** — anatomy of a skill
- **[how it works](https://rosie.libs.technology/#how-it-works)** — what happens on install

## License

BSD 3-Clause
