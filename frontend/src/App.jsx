import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import LoginPage from './pages/LoginPage';
import DashboardEmpleado from './pages/DashboardEmpleado';
import DashboardAdmin from './pages/DashboardAdmin';
import TVPage from './pages/TVPage';
import LoadingScreen from './components/LoadingScreen';
import SolicitarBajaPage from './pages/SolicitarBajaPage';

function AppRoutes() {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Páginas públicas sin autenticación
  if (location.pathname === '/tv') return <TVPage />;
  if (location.pathname === '/solicitar-baja') return <SolicitarBajaPage />;

  if (loading) return <LoadingScreen />;
  if (!user) return <LoginPage />;
  if (user.rol === 'admin') return (
    <Routes>
      <Route path="/admin/*" element={<DashboardAdmin />} />
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  );

  return (
    <Routes>
      <Route path="/*" element={<DashboardEmpleado />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
