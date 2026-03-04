import { useState, useEffect, useRef, useCallback, Fragment } from 'react';
import styles from './TVPage.module.css';
import { getApiUrl } from '../lib/apiUrl';

const API_URL = getApiUrl();

// Devuelve true si updated_at es de las últimas N horas
function editadoReciente(updated_at, horas = 8) {
  if (!updated_at) return false;
  return (Date.now() - new Date(updated_at).getTime()) < horas * 3600 * 1000;
}

const ESTADO_LABELS = {
  confirmado:    { label: 'Confirmado',    cls: 'confirmado' },
  pendiente:     { label: 'Pendiente',     cls: 'pendiente' },
  cancelado:     { label: 'Cancelado',     cls: 'cancelado' },
  sin_confirmar: { label: 'Sin confirmar', cls: 'sinConfirmar' },
};

function playDing() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [[880, 0], [1100, 0.22]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.35, ctx.currentTime + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.5);
      osc.start(ctx.currentTime + delay);
      osc.stop(ctx.currentTime + delay + 0.5);
    });
  } catch { /* sin soporte de audio */ }
}

function formatHora(hora) {
  if (!hora) return '—';
  return hora.slice(0, 5);
}

function formatFechaHeader(fechaStr) {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const fecha = new Date(y, m - 1, d);
  return fecha.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
}

function agruparPorFecha(reservas) {
  const mapa = {};
  for (const r of reservas) {
    if (!mapa[r.fecha]) mapa[r.fecha] = [];
    mapa[r.fecha].push(r);
  }
  return Object.entries(mapa).sort(([a], [b]) => a.localeCompare(b));
}

export default function TVPage() {
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [reservas, setReservas] = useState([]);
  const [filasCambiadas, setFilasCambiadas] = useState(new Set());
  const [ultimaActualizacion, setUltimaActualizacion] = useState(null);
  const [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const lastSeenRef = useRef({});
  const audioActivoRef = useRef(false);
  const audioDesbloqueadoRef = useRef(false);

  // Solo hoy
  const getDesdeHasta = () => {
    const ahora = new Date();
    const pad = n => String(n).padStart(2, '0');
    const hoy = `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}`;
    return { desde: hoy, hasta: hoy };
  };

  const cargar = useCallback(async (esPolling = false) => {
    if (!token) { setError('Falta el token de acceso en la URL.'); return; }
    try {
      const { desde, hasta } = getDesdeHasta();
      const url = `${API_URL}/api/reservas/tv?token=${token}&desde=${desde}&hasta=${hasta}`;
      const res = await fetch(url);
      if (!res.ok) { setError('Token inválido o error de conexión.'); return; }
      const data = await res.json();

      if (esPolling && Object.keys(lastSeenRef.current).length > 0) {
        const cambiadas = data.filter(r => {
          const prev = lastSeenRef.current[r.id];
          return prev !== undefined && prev !== r.updated_at;
        });
        const nuevas = data.filter(r => lastSeenRef.current[r.id] === undefined);
        const todas = [...cambiadas, ...nuevas];

        if (todas.length > 0) {
          if (audioActivoRef.current) playDing();
          setFilasCambiadas(new Set(todas.map(r => r.id)));
          setUltimaActualizacion(new Date());
          setTimeout(() => setFilasCambiadas(new Set()), 6000);
        }
      }

      lastSeenRef.current = Object.fromEntries(data.map(r => [r.id, r.updated_at]));
      setReservas(data);
      setError('');
    } catch {
      if (!esPolling) setError('No se pudo conectar con el servidor.');
    }
  }, [token]);

  useEffect(() => { cargar(false); }, [cargar]);

  useEffect(() => {
    const interval = setInterval(() => cargar(true), 15000);
    return () => clearInterval(interval);
  }, [cargar]);

  // El audio se desbloquea con el primer click en la página (requisito del navegador)
  const desbloquearAudio = () => {
    if (!audioDesbloqueadoRef.current) {
      audioDesbloqueadoRef.current = true;
      audioActivoRef.current = true;
      playDing();
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
      setFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setFullscreen(false);
    }
  };

  const grupos = agruparPorFecha(reservas);

  // El primer grupo es HOY, el resto (mañana) se muestra más pequeño
  return (
    <div className={styles.tv} onClick={desbloquearAudio}>
      {/* Cabecera */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <img src="/logo.svg" alt="Bodegas Álvaro" className={styles.logo} />
          <h1 className={styles.titulo}>Planificación</h1>
        </div>
        <div className={styles.headerRight}>
          {ultimaActualizacion && (
            <span className={styles.actualizado}>
              ↻ {ultimaActualizacion.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button className={styles.btnFullscreen} onClick={e => { e.stopPropagation(); toggleFullscreen(); }} title="Pantalla completa">
            {fullscreen ? '⊠' : '⛶'}
          </button>
        </div>
      </header>

      {error && <div className={styles.errorBanner}>{error}</div>}

      <div className={styles.contenido}>
        {grupos.length === 0 && !error && (
          <div className={styles.vacio}>No hay reservas programadas para hoy ni mañana.</div>
        )}

        {grupos.map(([fecha, filas]) => (
          <section key={fecha} className={styles.diaBloque}>
            <h2 className={styles.diaHeader}>
              <span className={styles.diaEtiqueta}>HOY</span>
              {formatFechaHeader(fecha)}
            </h2>
            <div className={styles.tablaWrapper}>
            <table className={styles.tabla}>
              <thead>
                <tr>
                  <th className={styles.thHora}>Hora</th>
                  <th className={styles.thNombre}>Nombre / Grupo</th>
                  <th className={styles.thGuia}>Guía</th>
                  <th className={styles.thPax}>Pax</th>
                  <th className={styles.thEstado}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {filas.map(r => {
                  const necesidades = Array.isArray(r.necesidades_especiales) ? r.necesidades_especiales : [];
                  const tieneMenu = Array.isArray(r.menu) && r.menu.length > 0;
                  const tieneNotas = r.notas && r.notas.trim();
                  const tieneExtras = r.tipo_servicio || tieneNotas;
                  const reciente = editadoReciente(r.updated_at, 8);
                  const clasesFila = [
                    styles.fila,
                    r.estado === 'cancelado' ? styles.filaCancelada : '',
                    filasCambiadas.has(r.id) ? styles.filaActualizada : '',
                    reciente ? styles.filaReciente : '',
                  ].join(' ');
                  return (
                    <Fragment key={r.id}>
                      <tr className={clasesFila}>
                        <td className={styles.tdHora}>{formatHora(r.hora)}</td>
                        <td className={styles.tdNombre}>
                          <span className={styles.nombreTexto}>
                            {r.nombre}
                            {reciente && (
                              <span className={styles.badgeReciente} title={`Actualizado: ${new Date(r.updated_at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`}>
                                ↻ actualizado
                              </span>
                            )}
                          </span>
                          {tieneExtras && (
                            <span className={styles.nombreSub}>
                              {r.tipo_servicio && <em className={styles.tipoServicio}>{r.tipo_servicio}</em>}
                              {r.tipo_servicio && tieneNotas && ' · '}
                              {tieneNotas && r.notas}
                            </span>
                          )}
                        </td>
                        <td className={styles.tdGuia}>{r.guia || '—'}</td>
                        <td className={styles.tdPax}>
                          <span className={styles.paxNum}>{r.pax ?? '—'}</span>
                          {necesidades.length > 0 && (
                            <div className={styles.necesidadesTv}>
                              {necesidades.map((n, i) => (
                                <span key={i} className={styles.necesidadTvPill}>
                                  {n.cantidad}× {n.tipo}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className={styles.tdEstado}>
                          <span className={`${styles.badge} ${styles[ESTADO_LABELS[r.estado]?.cls]}`}>
                            {ESTADO_LABELS[r.estado]?.label ?? r.estado}
                          </span>
                        </td>
                      </tr>
                      {tieneMenu && (
                        <tr className={`${styles.filaMenu} ${r.estado === 'cancelado' ? styles.filaCancelada : ''}`}>
                          <td className={styles.tdMenuIcono}>🍽</td>
                          <td colSpan={4} className={styles.tdMenuCompleto}>
                            {r.menu.map((cat, ci) => (
                              <span key={ci} className={styles.menuCatTv}>
                                <strong>{cat.categoria}:</strong>{' '}
                                {Array.isArray(cat.platos) ? cat.platos.join(' · ') : cat.platos}
                              </span>
                            ))}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            </div>
          </section>
        ))}
      </div>

      <footer className={styles.footer}>
        <RelojEnVivo />
      </footer>
    </div>
  );
}

function RelojEnVivo() {
  const [hora, setHora] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setHora(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span>
      {hora.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      {' · '}
      {hora.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
    </span>
  );
}
