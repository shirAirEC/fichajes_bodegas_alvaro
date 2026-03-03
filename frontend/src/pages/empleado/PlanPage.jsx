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

export default function PlanPage() {
  const { authFetch } = useAuth();
  const [reservas, setReservas] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [filasCambiadas, setFilasCambiadas] = useState(new Set());
  const [avisos, setAvisos] = useState([]);
  const [confirmando, setConfirmando] = useState(null);
  const lastSeenRef = useRef({});
  const wakeLockRef = useRef(null);

  // Registrar token FCM para push notifications
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

  // Wake Lock: evitar que la pantalla se apague mientras se ve la planificación
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
      <div className={styles.header}>
        <h1 className={styles.titulo}>Planificación</h1>
        <span className={styles.rango}>
          {new Date(hoy + 'T00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })}
          {' — '}
          {new Date(hasta + 'T00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}
        </span>
      </div>

      {/* Avisos del administrador */}
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
                {confirmando === aviso.id ? '...' : 'Visto ✓'}
              </button>
            </div>
          ))}
        </div>
      )}

      {cargando && <div className={styles.cargando}>Cargando...</div>}

      {!cargando && grupos.length === 0 && (
        <div className={styles.vacio}>No hay reservas programadas para los próximos días.</div>
      )}

      <div className={styles.grupos}>
        {grupos.map(([fecha, filas]) => (
          <section key={fecha} className={styles.diaBloque}>
            <h2 className={styles.diaHeader}>{formatFechaHeader(fecha)}</h2>
            <div className={styles.tabla}>
              <div className={styles.thead}>
                <span className={styles.thHora}>Hora</span>
                <span className={styles.thNombre}>Nombre / Grupo</span>
                <span className={styles.thPax}>Pax</span>
                <span className={styles.thEstado}>Estado</span>
                <span className={styles.thNotas}>Notas</span>
              </div>
              {filas.map(r => {
                const necesidades = Array.isArray(r.necesidades_especiales) ? r.necesidades_especiales : [];
                const tieneMenu = Array.isArray(r.menu) && r.menu.length > 0;
                return (
                <div
                  key={r.id}
                  className={[
                    styles.filaWrapper,
                    r.estado === 'cancelado' ? styles.filaCancelada : '',
                    filasCambiadas.has(r.id) ? styles.filaActualizada : '',
                  ].join(' ')}
                >
                  <div className={styles.fila}>
                    <span className={styles.tdHora}>{formatHora(r.hora) || '—'}</span>
                    <span className={styles.tdNombre}>
                      {r.nombre}
                      {r.tipo_servicio && <span className={styles.tipoServicio}>{r.tipo_servicio}</span>}
                    </span>
                    <span className={styles.tdPax}>
                      <span className={styles.paxNum}>{r.pax ?? '—'}</span>
                      {necesidades.length > 0 && (
                        <span className={styles.necesidadesPills}>
                          {necesidades.map((n, i) => (
                            <span key={i} className={styles.necesidadPill}>
                              {n.cantidad}× {n.tipo}
                            </span>
                          ))}
                        </span>
                      )}
                    </span>
                    <span className={styles.tdEstado}>
                      <span className={`${styles.badge} ${styles[ESTADO_INFO[r.estado]?.cls]}`}>
                        {ESTADO_INFO[r.estado]?.label ?? r.estado}
                      </span>
                    </span>
                    <span className={styles.tdNotas}>{r.notas || '—'}</span>
                  </div>
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
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
