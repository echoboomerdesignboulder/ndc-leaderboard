import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Webflow Cloud sets COSMIC_MOUNT_PATH to the environment's mount path (expected: /api).
export default defineConfig({
  site: 'https://www.echoboomerdesign.com',
  base: process.env.COSMIC_MOUNT_PATH || process.env.PUBLIC_BASE_PATH || '',
  output: 'server',
  adapter: cloudflare({ platformProxy: { enabled: true } }),
});
