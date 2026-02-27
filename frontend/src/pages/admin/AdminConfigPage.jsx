import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import styles from './AdminConfigPage.module.css';

export default function AdminConfigPage() {
  const { authFetch } = useAuth();
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [exito, setExito] = useState(false);
  const [error, setError] = useState('');
  const [probandoGeo, setProbandoGeo] = useState(false);
  const [geoResultado, setGeoResultado] = useState(null);

  useEffect(() => {
    authFetch('/api/config').then(r => r.json()).then(data => {
      setConfig(data);
      setForm(data);
    });
  }, [authFetch]);

  const handleGuardar = async (e) => {
    e.preventDefault();
    setGuardando(true);
    setError('');
    setExito(false);
    try {
      const res = await authFetch('/api/config', { method: 'PUT', body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setConfig(data);
      setForm(data);
      setExito(true);
      setTimeout(() => setExito(false), 4000);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  const probarGeolocalizacion = () => {
    setProbandoGeo(true);
    setGeoResultado(null);
    if (!navigator.geolocation) {
      setGeoResultado({ error: 'Tu navegador no soporta geolocalización.' });
      setProbandoGeo(false);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const precision = pos.coords.accuracy;

        // Calcular distancia a la bodega configurada
        const bLat = parseFloat(form.geo_lat || 0);
        const bLng = parseFloat(form.geo_lng || 0);
        const dist = calcularDistanciaMetros(lat, lng, bLat, bLng);

        setGeoResultado({ lat, lng, precision: Math.round(precision), distancia: Math.round(dist) });
        setProbandoGeo(false);
      },
      (err) => {
        setGeoResultado({ error: 'No se pudo obtener la ubicación: ' + err.message });
        setProbandoGeo(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const usarMiUbicacionComoBodega = () => {
    if (geoResultado && !geoResultado.error) {
      setForm(f => ({
        ...f,
        geo_lat: geoResultado.lat.toFixed(6),
        geo_lng: geoResultado.lng.toFixed(6)
      }));
    }
  };

  if (!config) return <div className={styles.loading}>Cargando configuración...</div>;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Configuración del sistema</h1>

      <form onSubmit={handleGuardar}>
        {error && <div className={styles.errorBox}>{error}</div>}
        {exito && <div className={styles.successBox}>Configuración guardada correctamente.</div>}

        {/* Sección empresa */}
        <div className={styles.seccion}>
          <div className={styles.seccionHeader}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/>
            </svg>
            <h2>Información de la empresa</h2>
          </div>
          <div className={styles.formGrid}>
            <div className={styles.field}>
              <label>Nombre de la empresa</label>
              <input
                value={form.empresa_nombre || ''}
                onChange={e => setForm(f => ({ ...f, empresa_nombre: e.target.value }))}
              />
            </div>
            <div className={styles.field}>
              <label>Dirección</label>
              <input
                value={form.empresa_direccion || ''}
                onChange={e => setForm(f => ({ ...f, empresa_direccion: e.target.value }))}
              />
            </div>
          </div>
        </div>

        {/* Sección geolocalización */}
        <div className={styles.seccion}>
          <div className={styles.seccionHeader}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            <h2>Control de geolocalización</h2>
          </div>

          <div className={styles.toggleRow}>
            <div>
              <span className={styles.toggleLabel}>Verificación de ubicación al fichar</span>
              <p className={styles.toggleDesc}>
                Si está activa, los empleados solo podrán fichar cuando estén físicamente dentro del radio definido.
              </p>
            </div>
            <label className={styles.switch}>
              <input
                type="checkbox"
                checked={form.geo_activo === '1'}
                onChange={e => setForm(f => ({ ...f, geo_activo: e.target.checked ? '1' : '0' }))}
              />
              <span className={styles.switchSlider}></span>
            </label>
          </div>

          <div className={styles.formGrid}>
            <div className={styles.field}>
              <label>Latitud de la bodega</label>
              <input
                type="number"
                step="0.000001"
                value={form.geo_lat || ''}
                onChange={e => setForm(f => ({ ...f, geo_lat: e.target.value }))}
                placeholder="Ej: 28.476200"
              />
            </div>
            <div className={styles.field}>
              <label>Longitud de la bodega</label>
              <input
                type="number"
                step="0.000001"
                value={form.geo_lng || ''}
                onChange={e => setForm(f => ({ ...f, geo_lng: e.target.value }))}
                placeholder="Ej: -16.325300"
              />
            </div>
            <div className={styles.field}>
              <label>Radio permitido (metros)</label>
              <input
                type="number"
                min="10"
                max="5000"
                value={form.geo_radio_metros || '150'}
                onChange={e => setForm(f => ({ ...f, geo_radio_metros: e.target.value }))}
              />
            </div>
          </div>

          {/* Herramienta para obtener coordenadas */}
          <div className={styles.geoTool}>
            <div className={styles.geoToolHeader}>
              <span>Herramienta: obtener coordenadas de tu ubicación actual</span>
              <button type="button" className={styles.btnProbar} onClick={probarGeolocalizacion} disabled={probandoGeo}>
                {probandoGeo ? 'Obteniendo...' : '📍 Usar mi ubicación actual'}
              </button>
            </div>

            {geoResultado && !geoResultado.error && (
              <div className={styles.geoResultado}>
                <div className={styles.geoResultadoGrid}>
                  <div>
                    <span className={styles.geoLbl}>Latitud</span>
                    <span className={styles.geoVal}>{geoResultado.lat.toFixed(6)}</span>
                  </div>
                  <div>
                    <span className={styles.geoLbl}>Longitud</span>
                    <span className={styles.geoVal}>{geoResultado.lng.toFixed(6)}</span>
                  </div>
                  <div>
                    <span className={styles.geoLbl}>Precisión</span>
                    <span className={styles.geoVal}>±{geoResultado.precision}m</span>
                  </div>
                  <div>
                    <span className={styles.geoLbl}>Distancia a bodega</span>
                    <span className={styles.geoVal}>{geoResultado.distancia}m</span>
                  </div>
                </div>
                <button type="button" className={styles.btnUsarCoords} onClick={usarMiUbicacionComoBodega}>
                  Establecer como ubicación de la bodega
                </button>
              </div>
            )}

            {geoResultado?.error && (
              <div className={styles.geoError}>{geoResultado.error}</div>
            )}
          </div>
        </div>

        <div className={styles.formActions}>
          <button type="submit" className={styles.btnGuardar} disabled={guardando}>
            {guardando ? 'Guardando...' : 'Guardar configuración'}
          </button>
        </div>
      </form>
    </div>
  );
}

function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon/2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
