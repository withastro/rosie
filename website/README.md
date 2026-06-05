# rosie.astro.build

The marketing site for [Rosie](https://github.com/withastro/rosie). Static assets served by a Cloudflare Worker.

## Layout

```
website/
├── wrangler.jsonc      # Worker config (assets-only, custom domain)
├── package.json        # esbuild + @matthewp/zebra
├── src/
│   └── script.js       # source — bundled to public/script.js
├── public/             # everything served from the root
│   ├── index.html
│   ├── styles.css
│   ├── script.js       # built — gitignored
│   ├── fonts/          # self-hosted JetBrains Mono (Google Fonts subsets out box-drawing chars)
│   ├── rosie.png       # mascot
│   ├── favicon.svg
│   └── demo.svg        # (optional) asciinema recording — section is hidden until this exists
└── README.md
```

The site uses [Zebra](https://www.npmjs.com/package/@matthewp/zebra) for the small bits of client-side reactivity (install tabs, copy buttons, demo reveal). esbuild bundles `src/script.js` into a single ESM file at `public/script.js`.

## Setup

```bash
cd website
npm install
```

## Develop

esbuild rebuilds the bundle on save; wrangler serves the static assets. Run them in two terminals:

```bash
npm run watch        # esbuild --watch
npx wrangler dev     # http://localhost:8787
```

## Deploy

Requires the [Cloudflare Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) and a Cloudflare account where `astro.build` is configured as a zone.

```bash
npx wrangler login   # one-time
npm run deploy       # builds, then runs wrangler deploy
```

The `routes` block in `wrangler.jsonc` binds the worker to `rosie.astro.build` as a custom domain. Cloudflare will provision the certificate automatically the first time.

## Recording the demo (`demo.svg`)

The "See it in action" section on the page stays hidden until `public/demo.svg` exists. Drop a file there and it appears.

The pipeline is **asciinema → agg → SVG**:

1. **Install tools.** On macOS:
   ```bash
   brew install asciinema agg
   ```
   On Arch:
   ```bash
   sudo pacman -S asciinema agg
   ```
   (`agg` is the asciinema GIF/SVG generator. The Rust-based one renders crisp SVGs.)

2. **Record.** From a clean shell:
   ```bash
   asciinema rec demo.cast --cols 90 --rows 22
   ```
   Suggested take — keep it under ~30 seconds:
   ```
   $ rosie agents
   $ rosie install anthropics/skills
   $ rosie list
   ```
   Press `Ctrl-D` (or type `exit`) to stop recording.

3. **Trim/clean** if needed. You can edit `demo.cast` by hand — it's a JSON-lines file. Or re-record if it didn't go cleanly.

4. **Render to SVG.**
   ```bash
   agg --theme monokai --font-size 16 demo.cast demo.svg
   ```
   Useful flags:
   - `--cols 90 --rows 22` — match what you recorded with
   - `--speed 1.3` — speed the playback up a touch
   - `--idle-time-limit 1.5` — clamp long pauses

5. **Drop it in.**
   ```bash
   mv demo.svg website/public/demo.svg
   ```

6. **Preview locally**, then deploy:
   ```bash
   cd website
   npx wrangler dev
   # confirms the demo section now renders
   npx wrangler deploy
   ```

### Tips for a good recording

- Use a clean prompt (`PS1='$ '`) so the SVG doesn't pick up your full shell theme.
- Resize the terminal to exactly 90×22 before recording so output doesn't wrap unexpectedly.
- Run `clear` right before `asciinema rec` so the cast starts on a fresh screen.
- If you want a simulated/scripted run instead of a live one, write the commands to a script and `cat` them with `sleep` between — it produces a more predictable cadence.
