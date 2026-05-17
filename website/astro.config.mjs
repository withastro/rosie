import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://rosie.libs.technology',
  integrations: [sitemap()],
  server: {
    // 2062 — the year The Jetsons is set in. rosie was Rosey in the show.
    port: 2062,
  },
  // Default static output; dist/ is what we publish via wrangler.
  markdown: {
    shikiConfig: {
      // Dark theme matching the page's monospace/terminal aesthetic.
      theme: 'github-dark-default',
    },
  },
});
