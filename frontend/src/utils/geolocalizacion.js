/**
 * Utilidad de geolocalización que funciona tanto en navegador web
 * como en app nativa Android (Capacitor).
 *
 * En Capacitor se usa @capacitor/geolocation para acceso nativo GPS.
 * En web se usa la API estándar navigator.geolocation.
 */

let CapacitorGeo = null;

// Detectar si estamos en Capacitor (app nativa)
function esCapacitor() {
  return typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
}

async function cargarCapacitorGeo() {
  if (!CapacitorGeo && esCapacitor()) {
    try {
      const mod = await import('@capacitor/geolocation');
      CapacitorGeo = mod.Geolocation;
    } catch {
      CapacitorGeo = null;
    }
  }
  return CapacitorGeo;
}

/**
 * Obtiene la posición actual del dispositivo.
 * @returns {Promise<GeolocationPosition>} posición con coords.latitude, coords.longitude, coords.accuracy
 */
export async function obtenerPosicion() {
  const geo = await cargarCapacitorGeo();

  if (geo) {
    // Ruta Capacitor nativa
    const permisos = await geo.checkPermissions();
    if (permisos.location === 'denied') {
      throw new Error('Permisos de ubicación denegados. Ve a Configuración del dispositivo y activa la ubicación para esta app.');
    }
    if (permisos.location !== 'granted') {
      const solicitado = await geo.requestPermissions();
      if (solicitado.location !== 'granted') {
        throw new Error('Es necesario conceder permisos de ubicación para poder fichar.');
      }
    }
    const pos = await geo.getCurrentPosition({ enableHighAccuracy: true, timeout: 10000 });
    return pos;
  }

  // Ruta web (browser)
  if (!navigator.geolocation) {
    throw new Error('Tu dispositivo no soporta geolocalización.');
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      resolve,
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          reject(new Error('Permisos de ubicación denegados. Activa el GPS y los permisos del navegador.'));
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          reject(new Error('Ubicación no disponible. Asegúrate de tener GPS activado.'));
        } else if (err.code === err.TIMEOUT) {
          reject(new Error('Tiempo de espera agotado. Asegúrate de tener buena señal GPS.'));
        } else {
          reject(new Error('Error al obtener la ubicación.'));
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  });
}
