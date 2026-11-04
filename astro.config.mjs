import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';

const base = process.env.BASE_PATH || '/';
const site = process.env.SITE_URL || 'http://localhost:4321';

export default defineConfig({
  site,
  base,
  output: 'static',
  trailingSlash: 'ignore',
  build: {
    // 单页应用壳，产物全部落在 dist/
    assets: '_assets',
    inlineStylesheets: 'auto',
  },
  integrations: [svelte()],
  devToolbar: { enabled: false },
});
