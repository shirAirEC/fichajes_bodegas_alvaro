import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import styles from './PlanPage.module.css';

const ESTADO_INFO = {
  confirmado:    { label: 'Confirmado',    cls: 'confirmado' },
  pendiente:     { label: 'Pendiente',     cls: 'pendiente' },
  cancelado:     { label: 'Cancelado',     cls: 'cancelado' },
  sin_confirmar: { label: 'Sin confirmar', cls: 'sinConfirmar' },
};

function formatHora(hora) {
  if (!hora) return '';
  return hora.slice(0, 5);
}

function formatFechaHeader(fechaStr) {
  const [y, m, d] = fechaStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function agruparPorFecha(reservas) {
  const mapa = {};
  for (const r of reservas) {
    if (!mapa[r.fecha]) mapa[r.fecha] = [];
    mapa[r.fecha].push(r);
  }
  return Object.entries(mapa).sort(([a], [b]) => a.localeCompare(b));
}

function useReloj() {
  const [hora, setHora] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setHora(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  return hora;
}

export default function PlanPage() {
  const { authFetch } = useAuth();
  const [reservas, setReservas] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [filasCambiadas, setFilasCambiadas] = useState(new Set());
  const [avisos, setAvisos] = useState([]);
  const [confirmando, setConfirmando] = useState(null);
  const lastSeenRef = useRef({});
  const wakeLockRef = useRef(null);
  const horaActual = useReloj();

  usePushNotifications(authFetch);

  const ahora = new Date();
  const pad = n => String(n).padStart(2, '0');
  const hoy = `${ahora.getFullYear()}-${pad(ahora.getMonth() + 1)}-${pad(ahora.getDate())}`;
  const hasta = addDays(hoy, 6);

  const cargar = useCallback(async (esPolling = false) => {
    try {
      if (!esPolling) setCargando(true);
      const res = await authFetch(`/api/reservas?desde=${hoy}&hasta=${hasta}`);
      const data = await res.json();
      const lista = Array.isArray(data) ? data : [];

      if (esPolling && Object.keys(lastSeenRef.current).length > 0) {
        const cambiadas = lista.filter(r => {
          const prev = lastSeenRef.current[r.id];
          return prev !== undefined && prev !== r.updated_at;
        });
        const nuevas = lista.filter(r => lastSeenRef.current[r.id] === undefined);
        const todas = [...cambiadas, ...nuevas];
        if (todas.length > 0) {
          setFilasCambiadas(new Set(todas.map(r => r.id)));
          setTimeout(() => setFilasCambiadas(new Set()), 5000);
        }
      }

      lastSeenRef.current = Object.fromEntries(lista.map(r => [r.id, r.updated_at]));
      setReservas(lista);
    } finally {
      setCargando(false);
    }
  }, [authFetch, hoy, hasta]);

  const cargarAvisos = useCallback(async () => {
    try {
      const res = await authFetch('/api/avisos');
      const data = await res.json();
      setAvisos(Array.isArray(data) ? data.filter(a => !a.visto) : []);
    } catch {}
  }, [authFetch]);

  const confirmarAviso = async (id) => {
    setConfirmando(id);
    try {
      await authFetch(`/api/avisos/${id}/visto`, { method: 'POST' });
      setAvisos(prev => prev.filter(a => a.id !== id));
    } finally {
      setConfirmando(null);
    }
  };

  useEffect(() => { cargar(false); cargarAvisos(); }, [cargar, cargarAvisos]);

  useEffect(() => {
    const interval = setInterval(() => { cargar(true); cargarAvisos(); }, 20000);
    return () => clearInterval(interval);
  }, [cargar, cargarAvisos]);

  useEffect(() => {
    async function activarWakeLock() {
      if (!('wakeLock' in navigator)) return;
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
      } catch {}
    }
    activarWakeLock();
    const reactivar = () => { if (document.visibilityState === 'visible') activarWakeLock(); };
    document.addEventListener('visibilitychange', reactivar);
    return () => {
      document.removeEventListener('visibilitychange', reactivar);
      if (wakeLockRef.current) wakeLockRef.current.release().catch(() => {});
    };
  }, []);

  const grupos = agruparPorFecha(reservas);

  return (
    <div className={styles.page}>

      {/* Cabecera */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.titulo}>Planificación</h1>
          <span className={styles.rango}>
            {new Date(hoy + 'T00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}
            {' — '}
            {new Date(hasta + 'T00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
        </div>
        <div className={styles.reloj}>
          {horaActual.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
        </div>
      </div>

      {/* Avisos pendientes de confirmar */}
      {avisos.length > 0 && (
        <div className={styles.avisosContainer}>
          {avisos.map(aviso => (
            <div key={aviso.id} className={styles.avisoCard}>
              <div className={styles.avisoIcono}>📢</div>
              <div className={styles.avisoContenido}>
                <div className={styles.avisoTitulo}>{aviso.titulo}</div>
                <div className={styles.avisoMensaje}>{aviso.mensaje}</div>
              </div>
              <button
                className={styles.btnConfirmar}
                onClick={() => confirmarAviso(aviso.id)}
                disabled={confirmando === aviso.id}
              >
                {confirmando === aviso.id ? '...' : '✓ He visto el cambio'}
              </button>
            </div>
          ))}
        </div>
      )}

      {cargando && <div className={styles.cargando}>Cargando...</div>}

      {!cargando && grupos.length === 0 && (
        <div className={styles.vacio}>No hay reservas programadas para los próximos días.</div>
      )}

      {/* Grupos por día */}
      <div className={styles.grupos}>
        {grupos.map(([fecha, filas]) => (
          <section key={fecha} className={styles.diaBloque}>
            <h2 className={styles.diaHeader}>{formatFechaHeader(fecha)}</h2>
            <div className={styles.cards}>
              {filas.map(r => {
                const necesidades = Array.isArray(r.necesidades_especiales) ? r.necesidades_especiales : [];
                const tieneMenu = Array.isArray(r.menu) && r.menu.length > 0;
                const estadoInfo = ESTADO_INFO[r.estado] ?? { label: r.estado, cls: 'sinConfirmar' };
                return (
                  <div
                    key={r.id}
                    className={[
                      styles.card,
                      r.estado === 'cancelado' ? styles.cardCancelada : '',
                      filasCambiadas.has(r.id) ? styles.cardActualizada : '',
                    ].join(' ')}
                  >
                    {/* Banda de hora */}
                    <div className={styles.cardHora}>
                      {formatHora(r.hora) || '—'}
                    </div>

                    {/* Cuerpo principal */}
                    <div className={styles.cardCuerpo}>
                      <div className={styles.cardTop}>
                        <div className={styles.cardIdentidad}>
                          <span className={styles.cardNombre}>{r.nombre}</span>
                          {r.tipo_servicio && (
                            <span className={styles.tipoServicio}>{r.tipo_servicio}</span>
                          )}
                        </div>
                        <div className={styles.cardMeta}>
                          {r.pax && (
                            <span className={styles.paxBadge}>
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                              </svg>
                              {r.pax} pax
                            </span>
                          )}
                          <span className={`${styles.badge} ${styles[estadoInfo.cls]}`}>
                            {estadoInfo.label}
                          </span>
                        </div>
                      </div>

                      {/* Guía — sección destacada */}
                      {r.guia && (
                        <div className={styles.guiaBloque}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                            <circle cx="12" cy="7" r="4"/>
                          </svg>
                          <span className={styles.guiaLabel}>Guía:</span>
                          <span className={styles.guiaNombre}>{r.guia}</span>
                        </div>
                      )}

                      {/* Necesidades especiales */}
                      {necesidades.length > 0 && (
                        <div className={styles.necesidades}>
                          {necesidades.map((n, i) => (
                            <span key={i} className={styles.necesidadPill}>
                              {n.cantidad}× {n.tipo}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Notas */}
                      {r.notas && (
                        <div className={styles.notas}>{r.notas}</div>
                      )}

                      {/* Menú */}
                      {tieneMenu && (
                        <div className={styles.menuBloque}>
                          <span className={styles.menuBloqueIcon}>🍽</span>
                          <div className={styles.menuCategorias}>
                            {r.menu.map((cat, ci) => (
                              <div key={ci} className={styles.menuCat}>
                                <strong>{cat.categoria}:</strong>{' '}
                                <span>{cat.platos.join(' · ')}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
