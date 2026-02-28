import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import LoginPage from './pages/LoginPage';
import DashboardEmpleado from './pages/DashboardEmpleado';
import DashboardAdmin from './pages/DashboardAdmin';
import LoadingScreen from './components/LoadingScreen';

function AppRoutes() {
  const { user, loading } = useAuth();

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
