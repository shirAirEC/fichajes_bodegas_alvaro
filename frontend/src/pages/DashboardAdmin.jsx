import { Routes, Route } from 'react-router-dom';
import Navbar from '../components/Navbar';
import AdminPanelPage from './admin/AdminPanelPage';
import AdminFichajesPage from './admin/AdminFichajesPage';
import AdminEmpleadosPage from './admin/AdminEmpleadosPage';
import AdminSaldosPage from './admin/AdminSaldosPage';
import AdminConfigPage from './admin/AdminConfigPage';
import AdminHorasPage from './admin/AdminHorasPage';
import AdminSolicitudesPage from './admin/AdminSolicitudesPage';
import styles from './Dashboard.module.css';

export default function DashboardAdmin() {
  return (
    <div className={styles.layout}>
      <Navbar isAdmin={true} />
      <main className={styles.main}>
        <Routes>
          <Route path="/" element={<AdminPanelPage />} />
          <Route path="/fichajes" element={<AdminFichajesPage />} />
          <Route path="/empleados" element={<AdminEmpleadosPage />} />
          <Route path="/saldos" element={<AdminSaldosPage />} />
          <Route path="/configuracion" element={<AdminConfigPage />} />
          <Route path="/horas" element={<AdminHorasPage />} />
          <Route path="/solicitudes" element={<AdminSolicitudesPage />} />
        </Routes>
      </main>
    </div>
  );
}
