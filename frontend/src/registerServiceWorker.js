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
const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000;

export function registerAutoUpdatingServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (import.meta.env.DEV) return;

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
