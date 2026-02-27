import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import styles from './AdminFichajesPage.module.css';

const API_URL = import.meta.env.VITE_API_URL || '';

function fmtHora(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}
function fmtFecha(str) {
  return new Date(str + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtDuracion(minutos) {
  if (!minutos) return '0h 0m';
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
function fmtFechaHora(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

// ─── Fila expandible de jornada ───────────────────────────────────────────────
function FilaJornada({ jornada, onEliminarFichaje }) {
  const [expandida, setExpandida] = useState(false);

  return (
    <>
      <tr
        className={`${styles.fila} ${expandida ? styles.filaExpandida : ''}`}
        onClick={() => setExpandida(v => !v)}
        style={{ cursor: 'pointer' }}
      >
        <td>
          <div className={styles.empNombre}>{jornada.nombre} {jornada.apellidos}</div>
          <div className={styles.empDept}>{jornada.departamento || '—'}</div>
        </td>
        <td className={styles.tdFecha}>{fmtFecha(jornada.fecha)}</td>
        <td>
          <span className={styles.horasValor}>{fmtDuracion(jornada.minutosTrabajados)}</span>
          {jornada.enProgreso && <span className={styles.badgeVivo}>en curso</span>}
        </td>
        <td className={styles.tdHorario}>
          {jornada.primeraEntrada ? (
            <span>{fmtHora(jornada.primeraEntrada)} → {jornada.ultimaSalida ? fmtHora(jornada.ultimaSalida) : <em>activo</em>}</span>
          ) : '—'}
        </td>
        <td className={styles.tdFichajes}>
          {jornada.numEntradas}E / {jornada.numSalidas}S
        </td>
        <td className={styles.tdExpand}>
          <span className={expandida ? styles.chevronUp : styles.chevronDown}>▾</span>
        </td>
      </tr>

      {expandida && (
        <tr className={styles.filaDetalle}>
          <td colSpan={6}>
            <div className={styles.detalleContainer}>
              <div className={styles.detalleTimeline}>
                {jornada.fichajes.map((f, i) => (
                  <div key={f.id} className={`${styles.dtItem} ${f.tipo === 'entrada' ? styles.dtEntrada : styles.dtSalida}`}>
                    <div className={styles.dtDot} />
                    <div className={styles.dtInfo}>
                      <span className={styles.dtTipo}>{f.tipo === 'entrada' ? '▶ Entrada' : '■ Salida'}</span>
                      <span className={styles.dtHora}>{fmtFechaHora(f.timestamp)}</span>
                      {i > 0 && f.tipo === 'salida' && jornada.fichajes[i - 1]?.tipo === 'entrada' && (
                        <span className={styles.dtDuracion}>
                          {fmtDuracion(Math.round((new Date(f.timestamp) - new Date(jornada.fichajes[i - 1].timestamp)) / 60000))}
                        </span>
                      )}
                    </div>
                    <button
                      className={styles.btnBorrar}
                      onClick={e => { e.stopPropagation(); onEliminarFichaje(f.id); }}
                      title="Eliminar este fichaje"
                    >✕</button>
                  </div>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function AdminFichajesPage() {
  const { authFetch } = useAuth();
  const [vista, setVista] = useState('jornadas');
  const [jornadas, setJornadas] = useState([]);
  const [fichajes, setFichajes] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [cargando, setCargando] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const LIMITE = 50;

  const hoy = new Date().toISOString().split('T')[0];
  const hace30 = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const [filtros, setFiltros] = useState({ empleado_id: '', desde: hace30, hasta: hoy });

  useEffect(() => {
    authFetch('/api/empleados').then(r => r.json()).then(setEmpleados);
  }, [authFetch]);

  const cargarJornadas = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams();
    if (filtros.empleado_id) params.append('empleado_id', filtros.empleado_id);
    if (filtros.desde) params.append('desde', filtros.desde);
    if (filtros.hasta) params.append('hasta', filtros.hasta);
    const res = await authFetch(`/api/fichajes/admin/jornadas?${params}`);
    const data = await res.json();
    setJornadas(data.jornadas || []);
    setCargando(false);
  }, [authFetch, filtros]);

  const cargarDetalle = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams({ pagina, limite: LIMITE });
    if (filtros.empleado_id) params.append('empleado_id', filtros.empleado_id);
    if (filtros.desde) params.append('desde', filtros.desde);
    if (filtros.hasta) params.append('hasta', filtros.hasta);
    const res = await authFetch(`/api/fichajes/admin/todos?${params}`);
    const data = await res.json();
    setFichajes(data.fichajes || []);
    setTotal(data.total || 0);
    setCargando(false);
  }, [authFetch, pagina, filtros]);

  useEffect(() => {
    if (vista === 'jornadas') cargarJornadas();
    else cargarDetalle();
  }, [vista, cargarJornadas, cargarDetalle]);

  const handleEliminarFichaje = async (id) => {
    if (!window.confirm('¿Eliminar este fichaje?')) return;
    await authFetch(`/api/fichajes/admin/${id}`, { method: 'DELETE' });
    if (vista === 'jornadas') cargarJornadas();
    else cargarDetalle();
  };

  const handleExportar = () => {
    const params = new URLSearchParams();
    if (filtros.empleado_id) params.append('empleado_id', filtros.empleado_id);
    if (filtros.desde) params.append('desde', filtros.desde);
    if (filtros.hasta) params.append('hasta', filtros.hasta);
    const token = localStorage.getItem('fichajes_token');
    fetch(`${API_URL}/api/fichajes/admin/exportar?${params}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `fichajes_${filtros.desde}_${filtros.hasta}.csv`;
        a.click();
      });
  };

  const totalHorasJornadas = jornadas.reduce((s, j) => s + j.minutosTrabajados, 0);
  const totalPaginas = Math.ceil(total / LIMITE);

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <h1 className={styles.title}>Fichajes</h1>
        <button onClick={handleExportar} className={styles.btnExportar}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Exportar CSV
        </button>
      </div>

      {/* Filtros */}
      <div className={styles.filtros}>
        <select className={styles.filtroSelect} value={filtros.empleado_id}
          onChange={e => setFiltros(f => ({ ...f, empleado_id: e.target.value }))}>
          <option value="">Todos los empleados</option>
          {empleados.map(e => <option key={e.id} value={e.id}>{e.nombre} {e.apellidos}</option>)}
        </select>
        <input type="date" className={styles.filtroInput} value={filtros.desde}
          onChange={e => setFiltros(f => ({ ...f, desde: e.target.value }))} />
        <span className={styles.filtroSep}>→</span>
        <input type="date" className={styles.filtroInput} value={filtros.hasta}
          onChange={e => setFiltros(f => ({ ...f, hasta: e.target.value }))} />
        <button className={styles.btnFiltrar} onClick={() => { setPagina(1); vista === 'jornadas' ? cargarJornadas() : cargarDetalle(); }}>
          Buscar
        </button>
      </div>

      {/* Selector de vista */}
      <div className={styles.vistaTabs}>
        <button className={vista === 'jornadas' ? styles.vistaTabActive : styles.vistaTab} onClick={() => setVista('jornadas')}>
          Resumen por jornada
        </button>
        <button className={vista === 'detalle' ? styles.vistaTabActive : styles.vistaTab} onClick={() => setVista('detalle')}>
          Detalle de fichajes
        </button>
      </div>

      {cargando ? (
        <div className={styles.loading}>Cargando...</div>
      ) : vista === 'jornadas' ? (
        <>
          {jornadas.length > 0 && (
            <div className={styles.resumenBanner}>
              <span><strong>{jornadas.length}</strong> jornadas</span>
              <span>·</span>
              <span>Total: <strong>{fmtDuracion(totalHorasJornadas)}</strong></span>
              <span>·</span>
              <span>Media/jornada: <strong>{fmtDuracion(Math.round(totalHorasJornadas / jornadas.length))}</strong></span>
            </div>
          )}
          <div className={styles.tablaWrap}>
            <table className={styles.tabla}>
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Fecha</th>
                  <th>Tiempo trabajado</th>
                  <th>Horario</th>
                  <th>Registros</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {jornadas.length === 0 ? (
                  <tr><td colSpan={6} className={styles.empty}>No hay jornadas en el período seleccionado.</td></tr>
                ) : jornadas.map(j => (
                  <FilaJornada
                    key={`${j.empleado_id}_${j.fecha}`}
                    jornada={j}
                    onEliminarFichaje={handleEliminarFichaje}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <p className={styles.infoDetalle}>{total} fichajes · haz clic en ✕ para eliminar</p>
          <div className={styles.tablaWrap}>
            <table className={styles.tabla}>
              <thead>
                <tr><th>Empleado</th><th>Depto.</th><th>Tipo</th><th>Fecha y hora</th><th></th></tr>
              </thead>
              <tbody>
                {fichajes.length === 0 ? (
                  <tr><td colSpan={5} className={styles.empty}>No hay fichajes en el período seleccionado.</td></tr>
                ) : fichajes.map(f => (
                  <tr key={f.id} className={styles.fila}>
                    <td><div className={styles.empNombre}>{f.nombre} {f.apellidos}</div></td>
                    <td className={styles.tdDept}>{f.departamento || '—'}</td>
                    <td>
                      <span className={`${styles.badge} ${f.tipo === 'entrada' ? styles.badgeEntrada : styles.badgeSalida}`}>
                        {f.tipo}
                      </span>
                    </td>
                    <td>{new Date(f.timestamp).toLocaleString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })}</td>
                    <td>
                      <button className={styles.btnBorrar} onClick={() => setConfirmDelete(f.id)} title="Eliminar">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPaginas > 1 && (
            <div className={styles.paginacion}>
              <button disabled={pagina === 1} onClick={() => setPagina(p => p - 1)}>← Anterior</button>
              <span>{pagina} / {totalPaginas}</span>
              <button disabled={pagina === totalPaginas} onClick={() => setPagina(p => p + 1)}>Siguiente →</button>
            </div>
          )}
        </>
      )}

      {confirmDelete && (
        <div className={styles.confirmOverlay}>
          <div className={styles.confirmBox}>
            <p>¿Eliminar este fichaje? Esta acción no se puede deshacer.</p>
            <div className={styles.confirmBtns}>
              <button className={styles.btnEliminarConfirm} onClick={() => { handleEliminarFichaje(confirmDelete); setConfirmDelete(null); }}>Eliminar</button>
              <button className={styles.btnCancelar} onClick={() => setConfirmDelete(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
