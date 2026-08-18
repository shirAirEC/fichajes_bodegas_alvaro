/**
 * URL base del backend.
 *
 * Web (Vercel / Vite):
 *   '' → /api/* relativo al host actual.
 *   Vercel (vercel.json) reescribe a Railway prod o develop según hostname.
 *   Vite dev proxy reenvía a localhost:3001.
 *
 * Android nativo (APK empaquetada, sin server.url):
 *   El WebView sirve dist local con origin https://fichajes-bodegas-alvaro.vercel.app
 *   (capacitor hostname). Un fetch relativo /api NO llega a Vercel: Capacitor lo
 *   resuelve contra el servidor local → "Failed to fetch".
 *   Hay que usar la API de Railway en absoluto.
 *
 * `npm run build:android` fija VITE_CAPACITOR y VITE_API_URL de producción
 * (ganan a .env.local de Vercel CLI, que apunta al Railway de pruebas).
 */
const PRODUCTION_API = 'https://fichajesbodegasalvaro-production.up.railway.app';

function esHostLocal(url) {
  try {
    const { hostname } = new URL(url);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';
  } catch {
    return true;
  }
}

function esNativo() {
  if (import.meta.env.VITE_CAPACITOR === 'true') return true;
  return typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() === true;
}

export function getApiUrl() {
  if (!esNativo()) return '';

  const url = (import.meta.env.VITE_API_URL || PRODUCTION_API).replace(/\/$/, '');
  if (!url || esHostLocal(url)) return PRODUCTION_API;

  // Play / `vite build` (mode production): nunca el backend de pruebas.
  // `build:android:dev` usa --mode dev y sí puede apuntar a -developed.
  if (import.meta.env.MODE === 'production' && /developed/i.test(url)) {
    return PRODUCTION_API;
  }

  return url;
}
