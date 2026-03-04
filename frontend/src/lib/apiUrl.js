/**
 * Devuelve la URL base del backend.
 *
 * Web (Vercel / local):
 *   Siempre devuelve '' → las llamadas a /api/* son relativas al dominio actual.
 *   - En Vercel, el vercel.json proxy reenvía /api/* al Railway correcto
 *     según el hostname (production o develop preview).
 *   - En local, el proxy de Vite (vite.config.js) reenvía /api/* a localhost:3001.
 *
 * Android nativo (APK):
 *   VITE_CAPACITOR=true en el .env de build → usa VITE_API_URL explícita.
 */
export function getApiUrl() {
  if (import.meta.env.VITE_CAPACITOR === 'true') {
    const url = import.meta.env.VITE_API_URL
      || 'https://fichajesbodegasalvaro-production.up.railway.app';
    return url.replace(/\/$/, '');
  }

  // Web: rutas relativas, el proxy (Vercel o Vite dev) se encarga
  return '';
}
