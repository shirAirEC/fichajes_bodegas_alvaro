import { Routes, Route, Navigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import FicharPage from './empleado/FicharPage';
import HistorialPage from './empleado/HistorialPage';
import SaldosPage from './empleado/SaldosPage';
import HorasPage from './empleado/HorasPage';
import SolicitudesPage from './empleado/SolicitudesPage';
import PlanPage from './empleado/PlanPage';
import styles from './Dashboard.module.css';
import { useAppUpdate } from '../hooks/useAppUpdate';

function BannerActualizacion({ versionMinima }) {
  return (
    <div style={{
      background: '#8B2635', color: '#fff', padding: '0.75rem 1.25rem',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: '1rem', flexWrap: 'wrap', fontSize: '0.9rem',
    }}>
      <span>
        <strong>Nueva versión disponible ({versionMinima})</strong>
        {' '}— Actualiza la app para disfrutar de las últimas mejoras.
      </span>
      <a
        href="https://play.google.com/store/apps/details?id=com.bodegasalvaro.fichajes"
        target="_blank" rel="noopener noreferrer"
        style={{
          background: '#fff', color: '#8B2635', padding: '0.4rem 1rem',
          borderRadius: '6px', fontWeight: 700, textDecoration: 'none',
          whiteSpace: 'nowrap', fontSize: '0.85rem',
        }}
      >
        Actualizar ahora
      </a>
    </div>
  );
}

export default function DashboardEmpleado() {
  const { necesitaActualizar, versionMinima } = useAppUpdate();
  return (
    <div className={styles.layout}>
      {necesitaActualizar && <BannerActualizacion versionMinima={versionMinima} />}
      <Navbar isAdmin={false} />
      <main className={styles.main}>
        <Routes>
          <Route path="/" element={<FicharPage />} />
          <Route path="/historial" element={<HistorialPage />} />
          <Route path="/saldos" element={<SaldosPage />} />
          <Route path="/horas" element={<HorasPage />} />
          <Route path="/solicitudes" element={<SolicitudesPage />} />
          <Route path="/plan" element={<PlanPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
