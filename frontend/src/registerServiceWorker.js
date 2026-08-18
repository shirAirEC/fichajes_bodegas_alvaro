import { Capacitor } from '@capacitor/core';

// Registro manual del service worker (ver injectRegister:false en vite.config.js).
//
// Motivo: el registro automático por defecto de vite-plugin-pwa solo hace
// `navigator.serviceWorker.register(...)`, sin comprobar actualizaciones ni
// recargar cuando hay una nueva versión. Esta app se queda abierta horas
// (pestaña de admin, PWA instalada, kiosko de fichaje) así que sin esto un
// deploy nuevo podía tardar mucho en llegar a los dispositivos que ya
// tenían la app abierta, mostrando pantallas desincronizadas del backend
// (p.ej. desplegables de planificación con datos/campos de una versión
// anterior).
//
// Estrategia: comprobar actualizaciones cada 10 min y, en cuanto el nuevo
// service worker toma el control (controllerchange), recargar la página
// una sola vez automáticamente.
//
// En Capacitor NO se registra: el SW intercepta /api contra el origin local
// (hostname Vercel) y sirve index.html → Unexpected token '<' en JSON.parse.
const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000;

function esNativo() {
  if (import.meta.env.VITE_CAPACITOR === 'true') return true;
  try {
    return Capacitor.isNativePlatform() === true;
  } catch {
    return false;
  }
}

export async function unregisterNativeServiceWorkers() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((r) => r.unregister()));
    if (typeof caches !== 'undefined' && caches.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* ignore */
  }
}

export function registerAutoUpdatingServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;
  if (esNativo()) {
    void unregisterNativeServiceWorkers();
    return;
  }

  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      const updateSW = registerSW({
        immediate: true,
        onRegisteredSW(_swUrl, registration) {
          if (!registration) return;
          setInterval(() => {
            registration.update().catch(() => {});
          }, UPDATE_CHECK_INTERVAL_MS);
        },
        onNeedRefresh() {
          // autoUpdate ya activa el nuevo SW solo; forzamos la recarga para
          // que la pestaña abierta cargue el JS/HTML nuevo.
          updateSW(true);
        },
      });
    })
    .catch(() => {
      // Fallback: registro clásico si el módulo virtual no está disponible
      // (p.ej. build sin PWA habilitada).
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    });

  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
}
