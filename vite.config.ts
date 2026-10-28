import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    // App instalable que abre sin internet: el service worker guarda la
    // "cáscara" (HTML, JS, CSS, fuentes, íconos) y se actualiza solo cuando
    // hay una versión nueva publicada. Los datos viven en IndexedDB, no acá.
    VitePWA({
      // La versión nueva se instala sola (skipWaiting); src/main.tsx la busca cada
      // media hora y recarga cuando nadie está usando la caja (no en medio de un cobro).
      registerType: 'autoUpdate',
      injectRegister: false,
      includeAssets: ['icono.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Milenio Market',
        short_name: 'Milenio',
        description: 'Caja del kiosco Milenio Market. Funciona sin internet.',
        lang: 'es-AR',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        theme_color: '#E30613',
        background_color: '#ffffff',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'pwa-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2,webmanifest}'],
        navigateFallback: 'index.html',
        // La nube nunca sale de la caché: siempre va al servidor (o falla).
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
        skipWaiting: true,
        clientsClaim: true,
      },
    }),
  ],
  build: { assetsInlineLimit: 100_000 },
  test: {
    environment: 'node',
    // Las pruebas de la nube arrancan un Postgres (PGlite) la primera vez: tarda unos segundos.
    testTimeout: 20_000,
    exclude: ['**/node_modules/**', '.claude/**', 'dist/**'],
  },
});
