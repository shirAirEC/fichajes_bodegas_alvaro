import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import styles from './HistorialPage.module.css';

function formatFecha(ts) {
  return new Date(ts).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function formatHora(ts) {
  return new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function agruparPorDia(fichajes) {
  const grupos = {};
  for (const f of fichajes) {
    const dia = f.timestamp.split('T')[0] || f.timestamp.split(' ')[0];
    if (!grupos[dia]) grupos[dia] = [];
    grupos[dia].push(f);
  }
  return grupos;
}

function calcularMinutos(fichajesDia) {
  let min = 0;
  let entrada = null;
  let breakStart = null;
  let breakAllowed = 30;
  const sorted = [...fichajesDia].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  for (const f of sorted) {
    if (f.tipo === 'entrada') {
      if (breakStart) {
        const breakReal = (new Date(f.timestamp) - breakStart) / 60000;
        min += Math.min(breakReal, breakAllowed);
        breakStart = null;
      }
      entrada = new Date(f.timestamp);
    } else if (f.tipo === 'salida' && entrada) {
      min += (new Date(f.timestamp) - entrada) / 60000;
      entrada = null;
      if (f.es_descanso) {
        breakStart = new Date(f.timestamp);
        const match = (f.notas || '').match(/(\d+)\s*min/);
        breakAllowed = match ? parseInt(match[1]) : 30;
      }
    }
  }
  return Math.round(min);
}

function formatDuracion(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}h ${m}m`;
}

export default function HistorialPage() {
  const { authFetch } = useAuth();
  const [fichajes, setFichajes] = useState([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [cargando, setCargando] = useState(true);
  const [filtros, setFiltros] = useState({ desde: '', hasta: '' });
  const [excesos, setExcesos] = useState([]);
  const [tabActiva, setTabActiva] = useState('fichajes');
  const LIMITE = 50;

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const params = new URLSearchParams({ pagina, limite: LIMITE });
      if (filtros.desde) params.append('desde', filtros.desde);
      if (filtros.hasta) params.append('hasta', filtros.hasta);
      const [resFichajes, resExcesos] = await Promise.all([
        authFetch(`/api/fichajes/mis-fichajes?${params}`),
        authFetch(`/api/fichajes/mis-excesos${filtros.desde || filtros.hasta ? `?${new URLSearchParams({ desde: filtros.desde || '', hasta: filtros.hasta || '' })}` : ''}`)
      ]);
      const dataFichajes = await resFichajes.json();
      const dataExcesos = await resExcesos.json();
      setFichajes(dataFichajes.fichajes);
      setTotal(dataFichajes.total);
      setExcesos(dataExcesos.excesos || []);
    } finally {
      setCargando(false);
    }
  }, [authFetch, pagina, filtros]);

  useEffect(() => { cargar(); }, [cargar]);

  const grupos = agruparPorDia(fichajes);
  const dias = Object.keys(grupos).sort((a, b) => b.localeCompare(a));
  const totalPaginas = Math.ceil(total / LIMITE);

  const handleFiltro = (e) => {
    e.preventDefault();
    setPagina(1);
    cargar();
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Mi historial de fichajes</h1>

        <form onSubmit={handleFiltro} className={styles.filtros}>
          <div className={styles.filtroGrupo}>
            <label className={styles.filtroLabel}>Desde</label>
            <input
              type="date"
              className={styles.filtroInput}
              value={filtros.desde}
              onChange={e => setFiltros(f => ({ ...f, desde: e.target.value }))}
            />
          </div>
          <div className={styles.filtroGrupo}>
            <label className={styles.filtroLabel}>Hasta</label>
            <input
              type="date"
              className={styles.filtroInput}
              value={filtros.hasta}
              onChange={e => setFiltros(f => ({ ...f, hasta: e.target.value }))}
            />
          </div>
          <button type="submit" className={styles.btnFiltrar}>Filtrar</button>
          <button type="button" className={styles.btnLimpiar} onClick={() => {
            setFiltros({ desde: '', hasta: '' });
            setPagina(1);
          }}>Limpiar</button>
        </form>
      </div>

      {/* Tabs */}
      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${tabActiva === 'fichajes' ? styles.tabActiva : ''}`}
          onClick={() => setTabActiva('fichajes')}
        >
          Fichajes
          <span className={styles.tabCount}>{total}</span>
        </button>
        <button
          className={`${styles.tab} ${tabActiva === 'excesos' ? styles.tabActiva : ''} ${excesos.length > 0 ? styles.tabAlert : ''}`}
          onClick={() => setTabActiva('excesos')}
        >
          Excesos de descanso
          {excesos.length > 0 && <span className={styles.tabBadge}>{excesos.length}</span>}
        </button>
      </div>

      {cargando ? (
        <div className={styles.loading}>Cargando historial...</div>
      ) : tabActiva === 'fichajes' ? (
        <>
          <div className={styles.info}>
            <span>{total} fichajes encontrados</span>
          </div>
          {dias.length === 0 ? (
            <div className={styles.empty}>No hay fichajes en el período seleccionado.</div>
          ) : (
            <div className={styles.grupos}>
              {dias.map(dia => {
                const fichajesDia = grupos[dia].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
                const minutos = calcularMinutos(fichajesDia);
                return (
                  <div key={dia} className={styles.grupo}>
                    <div className={styles.grupoHeader}>
                      <span className={styles.grupoDia}>
                        {new Date(dia + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
                      </span>
                      {minutos > 0 && (
                        <span className={styles.grupoDuracion}>{formatDuracion(minutos)}</span>
                      )}
                    </div>
                    <div className={styles.grupoFichajes}>
                      {fichajesDia.map(f => (
                        <div key={f.id} className={`${styles.fichaje} ${f.tipo === 'entrada' ? styles.fichajeEntrada : f.notas?.startsWith('Exceso descanso') ? styles.fichajeExceso : styles.fichajeSalida}`}>
                          <div className={`${styles.fichajeTipoBadge} ${f.tipo === 'entrada' ? styles.badgeEntrada : f.notas?.startsWith('Exceso descanso') ? styles.badgeExceso : styles.badgeSalida}`}>
                            {f.tipo === 'entrada' ? '↓ Entrada' : f.notas?.startsWith('Exceso descanso') ? '⚠️ Exceso descanso' : '↑ Salida'}
                          </div>
                          <div className={styles.fichajeHora}>{formatHora(f.timestamp)}</div>
                          {f.notas && <div className={styles.fichajeNotas}>{f.notas}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {totalPaginas > 1 && (
            <div className={styles.paginacion}>
              <button className={styles.btnPag} disabled={pagina === 1} onClick={() => setPagina(p => p - 1)}>← Anterior</button>
              <span className={styles.pagInfo}>{pagina} / {totalPaginas}</span>
              <button className={styles.btnPag} disabled={pagina === totalPaginas} onClick={() => setPagina(p => p + 1)}>Siguiente →</button>
            </div>
          )}
        </>
      ) : (
        /* Tab excesos */
        <div className={styles.excesosSection}>
          {excesos.length === 0 ? (
            <div className={styles.excesosEmpty}>
              <span className={styles.excesosEmptyIcon}>✅</span>
              <p>No tienes excesos de descanso registrados en el período seleccionado.</p>
            </div>
          ) : (
            <>
              <p className={styles.excesosInfo}>
                El tiempo de descanso que supere el límite establecido no se contabiliza como jornada laboral.
              </p>
              <div className={styles.excesosLista}>
                {excesos.map(e => (
                  <div key={e.id} className={styles.excesoItem}>
                    <div className={styles.excesoFecha}>
                      {new Date(e.fecha + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                    </div>
                    <div className={styles.excesoDetalle}>
                      <span className={styles.excesoHoras}>
                        {formatHora(e.hora_inicio_descanso)} → {formatHora(e.hora_fin_descanso)}
                      </span>
                      <span className={styles.excesoDuracion}>
                        <span className={styles.excesoReal}>{e.minutos_real} min reales</span>
                        <span className={styles.excesoPermitido}>/ {e.minutos_permitido} min permitidos</span>
                      </span>
                    </div>
                    <div className={styles.excesoTag}>
                      +{e.minutos_exceso} min no contabilizados
                    </div>
                  </div>
                ))}
              </div>
              <div className={styles.excesosTotales}>
                Total excedido: <strong>{excesos.reduce((s, e) => s + e.minutos_exceso, 0)} min</strong>
                {' · '}
                Promedio por ocasión: <strong>{Math.round(excesos.reduce((s, e) => s + e.minutos_exceso, 0) / excesos.length)} min</strong>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
