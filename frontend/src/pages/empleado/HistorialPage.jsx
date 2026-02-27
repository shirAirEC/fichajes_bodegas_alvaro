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
  const sorted = [...fichajesDia].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  for (const f of sorted) {
    if (f.tipo === 'entrada') {
      entrada = new Date(f.timestamp);
    } else if (f.tipo === 'salida' && entrada) {
      min += (new Date(f.timestamp) - entrada) / 60000;
      entrada = null;
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
  const LIMITE = 50;

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const params = new URLSearchParams({ pagina, limite: LIMITE });
      if (filtros.desde) params.append('desde', filtros.desde);
      if (filtros.hasta) params.append('hasta', filtros.hasta);
      const res = await authFetch(`/api/fichajes/mis-fichajes?${params}`);
      const data = await res.json();
      setFichajes(data.fichajes);
      setTotal(data.total);
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

      <div className={styles.info}>
        <span>{total} fichajes encontrados</span>
      </div>

      {cargando ? (
        <div className={styles.loading}>Cargando historial...</div>
      ) : dias.length === 0 ? (
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
                    <div key={f.id} className={`${styles.fichaje} ${f.tipo === 'entrada' ? styles.fichajeEntrada : styles.fichajeSalida}`}>
                      <div className={`${styles.fichajeTipoBadge} ${f.tipo === 'entrada' ? styles.badgeEntrada : styles.badgeSalida}`}>
                        {f.tipo === 'entrada' ? '↓ Entrada' : '↑ Salida'}
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
          <button
            className={styles.btnPag}
            disabled={pagina === 1}
            onClick={() => setPagina(p => p - 1)}
          >← Anterior</button>
          <span className={styles.pagInfo}>{pagina} / {totalPaginas}</span>
          <button
            className={styles.btnPag}
            disabled={pagina === totalPaginas}
            onClick={() => setPagina(p => p + 1)}
          >Siguiente →</button>
        </div>
      )}
    </div>
  );
}
