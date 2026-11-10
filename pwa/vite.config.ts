import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };

// App web (PWA) para celular/tablet: transcreve pelo microfone e traduz.
// Publicado em GitHub Pages em /video-translate/.
export default defineConfig({
  base: process.env.PWA_BASE ?? '/video-translate/',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'onnx/*'],
      manifest: {
        name: 'Video Translate',
        short_name: 'VideoTranslate',
        description: 'Ouve o inglês pelo microfone, transcreve no próprio aparelho e mostra a tradução em português.',
        lang: 'pt-BR',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#15171b',
        theme_color: '#0a7c6a',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // O runtime ONNX (27 MB) e os modelos ficam em cache para funcionar offline.
        maximumFileSizeToCacheInBytes: 40 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,png,wasm,mjs}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.hostname === 'huggingface.co' || url.hostname.endsWith('.hf.co') || url.hostname.endsWith('huggingface.co'),
            handler: 'CacheFirst',
            options: { cacheName: 'hf-models', expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 365 }, cacheableResponse: { statuses: [0, 200] } },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) },
    conditions: ['onnxruntime-web-use-extern-wasm', 'module', 'browser', 'development|production'],
  },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  build: { target: 'es2022' },
});
