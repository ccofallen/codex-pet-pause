import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

function normalizeBasePath(value: string | undefined): string {
  const segment = value?.trim().replace(/^\/+|\/+$/g, '') ?? '';
  return segment === '' ? '/' : `/${segment}/`;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const base = mode === 'desktop' ? './' : normalizeBasePath(env.VITE_BASE_PATH);
  return {
    base,
    plugins: [
      react(),
      VitePWA({
        registerType: 'prompt',
        includeAssets: [
          'favicon.svg',
          'icons/*.png',
          'assets/cat/neko-pause-cat.webp',
          'assets/cat/neko-pause-cat-fallback.png',
          'assets/cat/meow.wav',
        ],
        manifest: {
          name: 'Codex Pet Pause',
          short_name: 'Pet Pause',
          start_url: base,
          scope: base,
          display: 'standalone',
          theme_color: '#f5f4ef',
          background_color: '#f5f4ef',
          icons: [
            { src: `${base}icons/pwa-192x192.png`, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
            { src: `${base}icons/pwa-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,svg,png,webp,wav,woff2}'],
          globIgnores: [
            'favicon.svg',
            'icons/*.png',
            'assets/cat/neko-pause-cat.webp',
            'assets/cat/neko-pause-cat-fallback.png',
            'assets/cat/meow.wav',
          ],
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          navigateFallback: `${base}index.html`,
        },
      }),
    ],
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});
