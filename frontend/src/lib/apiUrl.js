/**
 * Devuelve la URL base del backend según el entorno donde se ejecuta la app.
 *
 * Prioridad:
 *  1. Variable VITE_API_URL explícita (Android / builds manuales)
 *  2. Detección por hostname:
 *     - localhost / 127.0.0.1  → '' (proxy Vite en local)
 *     - URL de Vercel preview "develop" → backend de pruebas
 *     - Cualquier otra URL de Vercel → backend de producción
 */
export function getApiUrl() {
  // 1. Variable de entorno explícita (Android usa esto)
  const envUrl = import.meta.env.VITE_API_URL;
  if (envUrl) return envUrl;

  // 2. Detección por hostname en tiempo de ejecución
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;

    // Local → proxy de Vite (vite.config.js apunta a localhost:3001)
    if (host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.')) {
      return '';
    }

    // Preview de Vercel para la rama develop
    if (
      host.includes('git-develop') ||
      host.includes('-develop-') ||
      host.includes('.develop.')
    ) {
      return 'https://fichajesbodegasalvaro-developed.up.railway.app';
    }
  }

  // 3. Por defecto → producción
  return 'https://fichajesbodegasalvaro-production.up.railway.app';
}
