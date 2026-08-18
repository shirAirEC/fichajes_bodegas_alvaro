import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// VITE_CAPACITOR=true → base './' para app Android (WebView usa rutas relativas)
// Por defecto → base '/' para web (Railway, nginx, etc.)
const isCapacitor = process.env.VITE_CAPACITOR === 'true';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registro manual (ver src/main.jsx): comprueba actualizaciones
      // periódicamente y recarga sola cuando hay una nueva versión, para
      // que una pestaña/PWA abierta todo el día no se quede con JS viejo
      // (p.ej. tipos de servicio o campos de un deploy anterior).
      injectRegister: false,
      includeAssets: ['logo.svg'],
      manifest: {
        name: 'Fichajes Bodegas Álvaro',
        short_name: 'Fichajes',
        description: 'Sistema de fichajes para Bodegas Álvaro',
        theme_color: '#8B2635',
        background_color: '#1a1a2e',
        display: 'standalone',
        start_url: '/?pwa=true',
        icons: [
          { src: '/logo.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      },
      workbox: {
        navigateFallbackDenylist: [/^\/api\//, /^\/\.well-known\//],
        // Solo cachear assets estáticos, no las llamadas a la API
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: { cacheName: 'google-fonts-cache' }
          }
        ]
      }
    })
  ],
  base: isCapacitor ? './' : '/',
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: false
  }
});
