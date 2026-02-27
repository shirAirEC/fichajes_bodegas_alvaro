import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import styles from './SaldosPage.module.css';

const TIPOS = {
  vacaciones: { label: 'Vacaciones', unidad: 'días', color: '#2980b9', icon: '🌴' },
  horas_extra: { label: 'Horas extra', unidad: 'horas', color: '#8B2635', icon: '⏱' },
  permiso_especial: { label: 'Permiso especial', unidad: 'días', color: '#8e44ad', icon: '📋' },
  baja_medica: { label: 'Baja médica', unidad: 'días', color: '#e67e22', icon: '🏥' }
};

function formatFecha(ts) {
  return new Date(ts).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function SaldosPage() {
  const { authFetch } = useAuth();
  const [data, setData] = useState(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    authFetch('/api/saldos/mio')
      .then(r => r.json())
      .then(setData)
      .finally(() => setCargando(false));
  }, [authFetch]);

  if (cargando) return <div className={styles.loading}>Cargando saldos...</div>;

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Mis saldos</h1>

      <div className={styles.resumenGrid}>
        {Object.entries(TIPOS).map(([tipo, info]) => (
          <div key={tipo} className={styles.saldoCard} style={{ borderTopColor: info.color }}>
            <div className={styles.saldoIcono}>{info.icon}</div>
            <div className={styles.saldoValor} style={{ color: (data?.resumen?.[tipo] ?? 0) < 0 ? '#c0392b' : info.color }}>
              {(data?.resumen?.[tipo] ?? 0).toFixed(1)}
            </div>
            <div className={styles.saldoUnidad}>{info.unidad} disponibles</div>
            <div className={styles.saldoLabel}>{info.label}</div>
          </div>
        ))}
      </div>

      <div className={styles.historialCard}>
        <h2 className={styles.subtitulo}>Historial de movimientos</h2>

        {!data?.movimientos?.length ? (
          <div className={styles.empty}>No hay movimientos registrados aún.</div>
        ) : (
          <div className={styles.lista}>
            {data.movimientos.map(m => {
              const info = TIPOS[m.tipo];
              const positivo = m.cantidad >= 0;
              return (
                <div key={m.id} className={styles.movimiento}>
                  <div className={styles.movIcon} style={{ background: info.color + '18', color: info.color }}>
                    {info.icon}
                  </div>
                  <div className={styles.movInfo}>
                    <span className={styles.movConcepto}>{m.concepto}</span>
                    <span className={styles.movMeta}>
                      {info.label} · Por {m.admin_nombre} {m.admin_apellidos} · {formatFecha(m.created_at)}
                    </span>
                  </div>
                  <div className={`${styles.movCantidad} ${positivo ? styles.positivo : styles.negativo}`}>
                    {positivo ? '+' : ''}{m.cantidad} {info.unidad}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
