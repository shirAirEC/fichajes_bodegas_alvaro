import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import styles from './AdminPanelPage.module.css';

function formatHora(ts) {
  if (!ts) return '--';
  return new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function formatDuracion(minutos) {
  if (!minutos) return '0h 0m';
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${h}h ${m}m`;
}

export default function AdminPanelPage() {
  const { authFetch } = useAuth();
  const [resumen, setResumen] = useState(null);
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0]);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    setCargando(true);
    authFetch(`/api/fichajes/admin/resumen?fecha=${fecha}`)
      .then(r => r.json())
      .then(data => setResumen(data))
      .finally(() => setCargando(false));
  }, [authFetch, fecha]);

  const dentro = resumen?.resumen?.filter(e => e.dentro) || [];
  const fuera = resumen?.resumen?.filter(e => !e.dentro) || [];

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <h1 className={styles.title}>Panel de Administración</h1>
        <div className={styles.fechaSelector}>
          <label className={styles.fechaLabel}>Fecha:</label>
          <input
            type="date"
            value={fecha}
            onChange={e => setFecha(e.target.value)}
            className={styles.fechaInput}
          />
        </div>
      </div>

      {cargando ? (
        <div className={styles.loading}>Cargando...</div>
      ) : (
        <>
          <div className={styles.statsRow}>
            <div className={`${styles.statCard} ${styles.statTotal}`}>
              <span className={styles.statNum}>{resumen?.resumen?.length || 0}</span>
              <span className={styles.statLbl}>Total empleados</span>
            </div>
            <div className={`${styles.statCard} ${styles.statDentro}`}>
              <span className={styles.statNum}>{dentro.length}</span>
              <span className={styles.statLbl}>En el trabajo ahora</span>
            </div>
            <div className={`${styles.statCard} ${styles.statFuera}`}>
              <span className={styles.statNum}>{fuera.length}</span>
              <span className={styles.statLbl}>Fuera del trabajo</span>
            </div>
            <div className={`${styles.statCard} ${styles.statSinFichar}`}>
              <span className={styles.statNum}>{resumen?.resumen?.filter(e => e.fichajesToday === 0).length || 0}</span>
              <span className={styles.statLbl}>Sin fichar hoy</span>
            </div>
          </div>

          <div className={styles.tabla}>
            <div className={styles.tablaHeader}>
              <span>Empleado</span>
              <span>Departamento</span>
              <span>Estado</span>
              <span>Último fichaje</span>
              <span>Horas hoy</span>
              <span>Fichajes</span>
            </div>
            {resumen?.resumen?.length === 0 && (
              <div className={styles.empty}>No hay empleados activos.</div>
            )}
            {resumen?.resumen?.map(emp => (
              <div key={emp.id} className={styles.tablaRow}>
                <span className={styles.empNombre}>
                  <span className={styles.empAvatar}>
                    {emp.nombre[0]}{emp.apellidos[0]}
                  </span>
                  {emp.nombre} {emp.apellidos}
                </span>
                <span className={styles.empDept}>{emp.departamento || '—'}</span>
                <span>
                  <span className={`${styles.badge} ${emp.dentro ? styles.badgeDentro : styles.badgeFuera}`}>
                    {emp.dentro ? 'Dentro' : 'Fuera'}
                  </span>
                </span>
                <span className={styles.empHora}>
                  {emp.ultimoFichaje
                    ? `${emp.ultimoFichaje.tipo} ${formatHora(emp.ultimoFichaje.timestamp)}`
                    : '—'
                  }
                </span>
                <span className={styles.empHoras}>{formatDuracion(emp.minutosTrabajados)}</span>
                <span className={styles.empFichajes}>{emp.fichajesToday}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
