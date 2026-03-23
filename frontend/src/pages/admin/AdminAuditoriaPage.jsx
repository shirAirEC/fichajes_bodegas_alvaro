import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import styles from './AdminAuditoriaPage.module.css';

const ACCIONES_LABEL = {
  crear_fichaje:      { label: 'Fichaje creado',     cls: 'verde' },
  editar_fichaje:     { label: 'Fichaje editado',     cls: 'naranja' },
  eliminar_fichaje:   { label: 'Fichaje eliminado',   cls: 'rojo' },
  crear_empleado:     { label: 'Empleado creado',     cls: 'verde' },
  editar_empleado:    { label: 'Empleado editado',    cls: 'naranja' },
  desactivar_empleado:{ label: 'Empleado desactivado',cls: 'rojo' },
};

function fmtFechaHora(ts) {
  return new Date(ts).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

export default function AdminAuditoriaPage() {
  const { authFetch } = useAuth();
  const hoy = new Date().toISOString().split('T')[0];
  const haceTreintaDias = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];

  const [logs, setLogs] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [filtros, setFiltros] = useState({ desde: haceTreintaDias, hasta: hoy, accion: '' });

  const cargar = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams();
    if (filtros.desde) params.append('desde', filtros.desde);
    if (filtros.hasta) params.append('hasta', filtros.hasta);
    if (filtros.accion) params.append('accion', filtros.accion);
    params.append('limite', '300');
    const res = await authFetch(`/api/config/audit?${params}`);
    const data = await res.json();
    setLogs(Array.isArray(data) ? data : []);
    setCargando(false);
  }, [authFetch, filtros]);

  useEffect(() => { cargar(); }, [cargar]);

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <h1 className={styles.title}>Auditoría</h1>
        <span className={styles.subtitle}>Registro de todas las acciones administrativas sobre fichajes y empleados</span>
      </div>

      <div className={styles.filtros}>
        <input type="date" className={styles.filtroInput} value={filtros.desde}
          onChange={e => setFiltros(f => ({ ...f, desde: e.target.value }))} />
        <span className={styles.filtroSep}>→</span>
        <input type="date" className={styles.filtroInput} value={filtros.hasta}
          onChange={e => setFiltros(f => ({ ...f, hasta: e.target.value }))} />
        <select className={styles.filtroSelect} value={filtros.accion}
          onChange={e => setFiltros(f => ({ ...f, accion: e.target.value }))}>
          <option value="">Todas las acciones</option>
          {Object.entries(ACCIONES_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <button className={styles.btnBuscar} onClick={cargar}>Buscar</button>
      </div>

      {cargando ? (
        <div className={styles.loading}>Cargando...</div>
      ) : logs.length === 0 ? (
        <div className={styles.empty}>No hay registros en el período seleccionado.</div>
      ) : (
        <div className={styles.tablaWrap}>
          <p className={styles.count}>{logs.length} registros</p>
          <table className={styles.tabla}>
            <thead>
              <tr>
                <th>Fecha y hora</th>
                <th>Administrador</th>
                <th>Acción</th>
                <th>Detalle</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {logs.map(log => {
                const info = ACCIONES_LABEL[log.accion] ?? { label: log.accion, cls: 'gris' };
                return (
                  <tr key={log.id} className={styles.fila}>
                    <td className={styles.tdFecha}>{fmtFechaHora(log.created_at)}</td>
                    <td className={styles.tdUsuario}>{log.usuario_nombre}</td>
                    <td>
                      <span className={`${styles.badge} ${styles[info.cls]}`}>
                        {info.label}
                      </span>
                    </td>
                    <td className={styles.tdDetalle}>{log.detalle}</td>
                    <td className={styles.tdIp}>{log.ip || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
