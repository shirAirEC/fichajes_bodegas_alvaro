import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import styles from './AdminFichajesPage.module.css';

function formatFechaHora(ts) {
  const d = new Date(ts);
  return `${d.toLocaleDateString('es-ES')} ${d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`;
}

export default function AdminFichajesPage() {
  const { authFetch } = useAuth();
  const [fichajes, setFichajes] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [cargando, setCargando] = useState(true);
  const [filtros, setFiltros] = useState({ empleado_id: '', desde: '', hasta: '' });
  const [confirmDelete, setConfirmDelete] = useState(null);
  const LIMITE = 50;

  useEffect(() => {
    authFetch('/api/empleados').then(r => r.json()).then(setEmpleados);
  }, [authFetch]);

  const cargar = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams({ pagina, limite: LIMITE });
    if (filtros.empleado_id) params.append('empleado_id', filtros.empleado_id);
    if (filtros.desde) params.append('desde', filtros.desde);
    if (filtros.hasta) params.append('hasta', filtros.hasta);
    const res = await authFetch(`/api/fichajes/admin/todos?${params}`);
    const data = await res.json();
    setFichajes(data.fichajes);
    setTotal(data.total);
    setCargando(false);
  }, [authFetch, pagina, filtros]);

  useEffect(() => { cargar(); }, [cargar]);

  const handleExportar = () => {
    const params = new URLSearchParams();
    if (filtros.empleado_id) params.append('empleado_id', filtros.empleado_id);
    if (filtros.desde) params.append('desde', filtros.desde);
    if (filtros.hasta) params.append('hasta', filtros.hasta);
    // Crear enlace de descarga con token
    const token = localStorage.getItem('fichajes_token');
    const url = `/api/fichajes/admin/exportar?${params}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `fichajes_${filtros.desde || 'todo'}_${filtros.hasta || 'todo'}.csv`;
        a.click();
      });
  };

  const handleEliminar = async (id) => {
    await authFetch(`/api/fichajes/admin/${id}`, { method: 'DELETE' });
    setConfirmDelete(null);
    cargar();
  };

  const totalPaginas = Math.ceil(total / LIMITE);

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <h1 className={styles.title}>Gestión de Fichajes</h1>
        <button onClick={handleExportar} className={styles.btnExportar}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Exportar CSV
        </button>
      </div>

      <div className={styles.filtros}>
        <select
          className={styles.filtroSelect}
          value={filtros.empleado_id}
          onChange={e => setFiltros(f => ({ ...f, empleado_id: e.target.value }))}
        >
          <option value="">Todos los empleados</option>
          {empleados.map(e => (
            <option key={e.id} value={e.id}>{e.nombre} {e.apellidos}</option>
          ))}
        </select>
        <input type="date" className={styles.filtroInput} value={filtros.desde}
          onChange={e => setFiltros(f => ({ ...f, desde: e.target.value }))} placeholder="Desde" />
        <input type="date" className={styles.filtroInput} value={filtros.hasta}
          onChange={e => setFiltros(f => ({ ...f, hasta: e.target.value }))} placeholder="Hasta" />
        <button className={styles.btnFiltrar} onClick={() => { setPagina(1); cargar(); }}>Buscar</button>
        <button className={styles.btnLimpiar} onClick={() => {
          setFiltros({ empleado_id: '', desde: '', hasta: '' });
          setPagina(1);
        }}>Limpiar</button>
      </div>

      <p className={styles.info}>{total} fichajes encontrados</p>

      {confirmDelete && (
        <div className={styles.confirmOverlay}>
          <div className={styles.confirmBox}>
            <p>¿Eliminar este fichaje? Esta acción no se puede deshacer.</p>
            <div className={styles.confirmBtns}>
              <button className={styles.btnEliminarConfirm} onClick={() => handleEliminar(confirmDelete)}>Eliminar</button>
              <button className={styles.btnCancelar} onClick={() => setConfirmDelete(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {cargando ? (
        <div className={styles.loading}>Cargando...</div>
      ) : (
        <div className={styles.tabla}>
          <div className={styles.tablaHeader}>
            <span>Empleado</span>
            <span>Departamento</span>
            <span>Tipo</span>
            <span>Fecha y hora</span>
            <span></span>
          </div>
          {fichajes.length === 0 ? (
            <div className={styles.empty}>No hay fichajes en el período seleccionado.</div>
          ) : fichajes.map(f => (
            <div key={f.id} className={styles.tablaRow}>
              <span className={styles.empNombre}>
                <span className={styles.empAvatar}>{f.nombre[0]}{f.apellidos[0]}</span>
                {f.nombre} {f.apellidos}
              </span>
              <span className={styles.dept}>{f.departamento || '—'}</span>
              <span>
                <span className={`${styles.badge} ${f.tipo === 'entrada' ? styles.badgeEntrada : styles.badgeSalida}`}>
                  {f.tipo}
                </span>
              </span>
              <span className={styles.fechaHora}>{formatFechaHora(f.timestamp)}</span>
              <span>
                <button
                  className={styles.btnEliminar}
                  onClick={() => setConfirmDelete(f.id)}
                  title="Eliminar fichaje"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14a2,2,0,0,1-2,2H8a2,2,0,0,1-2-2L5,6"/><path d="M10,11v6M14,11v6"/><path d="M9,6V4a1,1,0,0,1,1-1h4a1,1,0,0,1,1,1V6"/>
                  </svg>
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      {totalPaginas > 1 && (
        <div className={styles.paginacion}>
          <button className={styles.btnPag} disabled={pagina === 1} onClick={() => setPagina(p => p - 1)}>← Anterior</button>
          <span>{pagina} / {totalPaginas}</span>
          <button className={styles.btnPag} disabled={pagina === totalPaginas} onClick={() => setPagina(p => p + 1)}>Siguiente →</button>
        </div>
      )}
    </div>
  );
}
