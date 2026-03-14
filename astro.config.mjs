import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import vercel from '@astrojs/vercel/serverless';

// AION Growth Studio - Astro Configuration
export default defineConfig({
  integrations: [tailwind()],
  output: 'hybrid',
  adapter: vercel({
    maxDuration: 60,
  }),
});
