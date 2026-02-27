import { Routes, Route } from 'react-router-dom';
import Navbar from '../components/Navbar';
import FicharPage from './empleado/FicharPage';
import HistorialPage from './empleado/HistorialPage';
import SaldosPage from './empleado/SaldosPage';
import HorasPage from './empleado/HorasPage';
import styles from './Dashboard.module.css';

export default function DashboardEmpleado() {
  return (
    <div className={styles.layout}>
      <Navbar isAdmin={false} />
      <main className={styles.main}>
        <Routes>
          <Route path="/" element={<FicharPage />} />
          <Route path="/historial" element={<HistorialPage />} />
          <Route path="/saldos" element={<SaldosPage />} />
          <Route path="/horas" element={<HorasPage />} />
        </Routes>
      </main>
    </div>
  );
}
