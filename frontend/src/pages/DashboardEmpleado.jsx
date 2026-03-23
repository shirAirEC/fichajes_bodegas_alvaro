import { Routes, Route, Navigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import FicharPage from './empleado/FicharPage';
import HistorialPage from './empleado/HistorialPage';
import SaldosPage from './empleado/SaldosPage';
import HorasPage from './empleado/HorasPage';
import SolicitudesPage from './empleado/SolicitudesPage';
import PlanPage from './empleado/PlanPage';
import { useAuth } from '../hooks/useAuth';
import styles from './Dashboard.module.css';

export default function DashboardEmpleado() {
  const { user } = useAuth();
  const soloPlan = user?.solo_planificacion === 1;

  if (soloPlan) {
    return (
      <div className={styles.layout}>
        <Navbar isAdmin={false} soloPlanificacion />
        <main className={styles.main}>
          <Routes>
            <Route path="/plan" element={<PlanPage />} />
            <Route path="*" element={<Navigate to="/plan" replace />} />
          </Routes>
        </main>
      </div>
    );
  }

  return (
    <div className={styles.layout}>
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
