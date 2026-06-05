# rosie

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
format, supported agents, and more: **<https://rosie.astro.build/>**.

A quick jump table:

- **[install](https://rosie.astro.build/#install)** — all install methods
- **[cli](https://rosie.astro.build/docs/cli/)** — commands and flags
- **[lockfile](https://rosie.astro.build/docs/lockfile/)** — `.agents/rosie.lock` format
- **[references](https://rosie.astro.build/docs/references/)** — markdown docs as agent context
- **[js api](https://rosie.astro.build/docs/js-api/)** — `import * as rosie from 'rosie-skills'`
- **[supported](https://rosie.astro.build/docs/agents/)** — detected agents
- **[skill format](https://rosie.astro.build/docs/skill-format/)** — anatomy of a skill
- **[how it works](https://rosie.astro.build/docs/how-it-works/)** — what happens on install

## License

BSD 3-Clause
