import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_CAPACITOR=true → base './' para app Android (WebView usa rutas relativas)
// Por defecto → base '/' para web (Railway, nginx, etc.)
const isCapacitor = process.env.VITE_CAPACITOR === 'true';

export default defineConfig({
  plugins: [react()],
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
