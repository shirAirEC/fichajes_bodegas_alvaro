/**
 * Devuelve la URL base del backend según el entorno donde se ejecuta la app.
 *
 * Lógica:
 *  - Android (Capacitor nativo): usa VITE_API_URL del .env de build
 *  - Web (Vercel / local): detección por hostname en runtime
 *      localhost / 192.168.x.x → '' (proxy Vite → localhost:3001)
 *      *git-develop* / *-develop-* en Vercel → backend de pruebas
 *      cualquier otro hostname → backend de producción
 *
 * IMPORTANTE: para web nunca se usa VITE_API_URL, así Vercel no
 * puede "contaminar" el entorno equivocado con una variable mal configurada.
 */
export function getApiUrl() {
  // ── Plataforma nativa Android ──────────────────────────────────────────────
  // VITE_CAPACITOR=true se fija solo al compilar el APK (build_dev_apk.ps1 o
  // el build de release). En ese contexto no hay window.location fiable.
  if (import.meta.env.VITE_CAPACITOR === 'true') {
    const url = import.meta.env.VITE_API_URL || 'https://fichajesbodegasalvaro-production.up.railway.app';
    // Eliminar barra final por si acaso
    return url.replace(/\/$/, '');
  }

  // ── Web (Vercel, navegador local) ──────────────────────────────────────────
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;

    // Desarrollo local → proxy Vite (vite.config.js → localhost:3001)
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host.startsWith('192.168.')
    ) {
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

  // Producción (cualquier otro hostname de Vercel)
  return 'https://fichajesbodegasalvaro-production.up.railway.app';
}
