import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import LoginPage from './pages/LoginPage';
import DashboardEmpleado from './pages/DashboardEmpleado';
import DashboardAdmin from './pages/DashboardAdmin';
import TVPage from './pages/TVPage';
import LoadingScreen from './components/LoadingScreen';
import SolicitarBajaPage from './pages/SolicitarBajaPage';
import SsoCallbackPage from './pages/SsoCallbackPage';
import OdooSsoRedirectPage from './pages/OdooSsoRedirectPage';
import { useAppUpdate } from './hooks/useAppUpdate';

function PantallaActualizacion({ versionMinima }) {
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'var(--color-light, #f5f1e8)', padding: '2rem',
    }}>
      <div style={{
        background: '#fff', borderRadius: '16px', padding: '2.5rem 2rem',
        boxShadow: '0 8px 32px rgba(0,0,0,0.12)', textAlign: 'center',
        maxWidth: '380px', width: '100%',
      }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔄</div>
        <h2 style={{
          color: '#8B2635', fontSize: '1.3rem', marginBottom: '0.75rem',
          fontFamily: 'var(--font-heading, Georgia, serif)',
        }}>
          Actualización requerida
        </h2>
        <p style={{
          color: '#555', fontSize: '0.95rem', lineHeight: '1.5', marginBottom: '1.5rem',
        }}>
          Hay una nueva versión disponible <strong>({versionMinima})</strong>.
          Actualiza la app para poder continuar.
        </p>
        <a
          href="https://play.google.com/store/apps/details?id=com.bodegasalvaro.fichajes"
          target="_blank" rel="noopener noreferrer"
          style={{
            display: 'inline-block', background: '#8B2635', color: '#fff',
            padding: '0.75rem 2rem', borderRadius: '8px', fontWeight: 700,
            textDecoration: 'none', fontSize: '1rem',
          }}
        >
          Actualizar ahora
        </a>
      </div>
    </div>
  );
}

function AppRoutes() {
  const { user, loading } = useAuth();
  const location = useLocation();
  const { necesitaActualizar, versionMinima } = useAppUpdate();

  if (necesitaActualizar) return <PantallaActualizacion versionMinima={versionMinima} />;

  // Páginas públicas sin autenticación
  if (location.pathname === '/tv') return <TVPage />;
  if (location.pathname === '/solicitar-baja') return <SolicitarBajaPage />;
  if (location.pathname === '/admin/sso-callback') return <SsoCallbackPage />;
  if (location.pathname === '/auth/odoo-sso') return <OdooSsoRedirectPage />;

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
