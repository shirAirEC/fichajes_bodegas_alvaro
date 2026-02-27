import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { obtenerPosicion } from '../../utils/geolocalizacion';
import styles from './FicharPage.module.css';

function formatTime(date) {
  return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(date) {
  return date.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function formatDuration(minutos) {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${h}h ${m}m`;
}

function formatTimestamp(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

export default function FicharPage() {
  const { authFetch, user } = useAuth();
  const [ahora, setAhora] = useState(new Date());
  const [estado, setEstado] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [config, setConfig] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [fichando, setFichando] = useState(false);
  const [mensaje, setMensaje] = useState(null);
  const [geoError, setGeoError] = useState(null);

  // Reloj en tiempo real
  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const cargarEstado = useCallback(async () => {
    try {
      const [resEstado, resResumen, resConfig] = await Promise.all([
        authFetch('/api/fichajes/estado'),
        authFetch('/api/fichajes/resumen-hoy'),
        authFetch('/api/config')
      ]);
      setEstado(await resEstado.json());
      setResumen(await resResumen.json());
      setConfig(await resConfig.json());
    } catch (err) {
      console.error(err);
    } finally {
      setCargando(false);
    }
  }, [authFetch]);

  useEffect(() => { cargarEstado(); }, [cargarEstado]);

  const handleFichar = async () => {
    setFichando(true);
    setMensaje(null);
    setGeoError(null);

    let posicion = null;
    const geoActivo = config?.geo_activo === '1';

    if (geoActivo) {
      // Solo bloqueamos el fichaje por GPS si el admin lo ha activado
      try {
        posicion = await obtenerPosicion();
      } catch (err) {
        setGeoError(err.message);
        setFichando(false);
        return;
      }
    }
    // Si geo está desactivada, fichamos directamente sin intentar GPS

    try {
      const body = posicion ? {
        latitud: posicion.coords.latitude,
        longitud: posicion.coords.longitude,
        precision_metros: posicion.coords.accuracy,
        notas: ''
      } : {};

      const res = await authFetch('/api/fichajes/fichar', {
        method: 'POST',
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.requiereGeo) {
          setGeoError('Activa el GPS para poder fichar desde esta ubicación.');
        } else {
          throw new Error(data.error);
        }
        return;
      }

      const tipoLabel = data.tipo === 'entrada' ? 'Entrada registrada' : 'Salida registrada';
      setMensaje({ tipo: 'success', texto: `${tipoLabel} a las ${formatTimestamp(data.fichaje.timestamp)}` });
      await cargarEstado();
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message || 'Error al registrar fichaje' });
    } finally {
      setFichando(false);
      setTimeout(() => setMensaje(null), 6000);
    }
  };

  if (cargando) return <div className={styles.loading}>Cargando...</div>;

  const esDentro = estado?.dentro;
  const proximoTipo = estado?.proximoTipo;
  const geoActivada = config?.geo_activo === '1';

  return (
    <div className={styles.page}>
      <div className={styles.relojCard}>
        <div className={styles.fecha}>{formatDate(ahora)}</div>
        <div className={styles.hora}>{formatTime(ahora)}</div>

        <div className={`${styles.estadoBadge} ${esDentro ? styles.dentro : styles.fuera}`}>
          <span className={styles.estadoDot}></span>
          {esDentro ? 'En el trabajo' : 'Fuera del trabajo'}
        </div>

        {geoActivada && (
          <div className={styles.geoInfo}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            Fichaje con verificación de ubicación activa
          </div>
        )}

        {geoError && (
          <div className={styles.geoErrorBox}>
            <strong>Error de ubicación:</strong> {geoError}
            <br />
            <small>Asegúrate de tener el GPS activado y haber dado permisos de ubicación.</small>
          </div>
        )}

        {mensaje && (
          <div className={`${styles.mensaje} ${styles[mensaje.tipo]}`}>
            {mensaje.texto}
          </div>
        )}

        <button
          className={`${styles.btnFichar} ${proximoTipo === 'entrada' ? styles.btnEntrada : styles.btnSalida}`}
          onClick={handleFichar}
          disabled={fichando}
        >
          {fichando ? (
            <>
              <span className={styles.spinner}></span>
              {geoActivada ? 'Obteniendo ubicación...' : 'Registrando...'}
            </>
          ) : (
            <>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {proximoTipo === 'entrada'
                  ? <><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10,17 15,12 10,7"/><line x1="15" y1="12" x2="3" y2="12"/></>
                  : <><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/></>
                }
              </svg>
              Registrar {proximoTipo === 'entrada' ? 'Entrada' : 'Salida'}
            </>
          )}
        </button>

        {estado?.ultimoFichaje && (
          <p className={styles.ultimoFichaje}>
            Último fichaje: <strong>{estado.ultimoFichaje.tipo}</strong> a las{' '}
            <strong>{formatTimestamp(estado.ultimoFichaje.timestamp)}</strong>
          </p>
        )}
      </div>

      {resumen && (
        <div className={styles.resumenCard}>
          <h2 className={styles.resumenTitle}>Resumen de hoy</h2>

          <div className={styles.statsGrid}>
            <div className={styles.stat}>
              <span className={styles.statValue}>{formatDuration(resumen.minutosHoy)}</span>
              <span className={styles.statLabel}>Tiempo trabajado</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{resumen.fichajesHoy.length}</span>
              <span className={styles.statLabel}>Fichajes hoy</span>
            </div>
          </div>

          {resumen.fichajesHoy.length > 0 && (
            <div className={styles.timeline}>
              {resumen.fichajesHoy.map(f => (
                <div key={f.id} className={`${styles.timelineItem} ${f.tipo === 'entrada' ? styles.tiEntrada : styles.tiSalida}`}>
                  <div className={styles.tiDot}></div>
                  <div className={styles.tiContent}>
                    <span className={styles.tiTipo}>{f.tipo === 'entrada' ? 'Entrada' : 'Salida'}</span>
                    <div className={styles.tiRight}>
                      {f.latitud && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" title="Ubicación verificada" style={{ color: 'var(--color-success)' }}>
                          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>
                        </svg>
                      )}
                      <span className={styles.tiHora}>{formatTimestamp(f.timestamp)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
