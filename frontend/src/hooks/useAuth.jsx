import { useState, useEffect, useCallback, createContext, useContext } from 'react';

const AuthContext = createContext(null);

const API_URL = import.meta.env.VITE_API_URL || '';

// App nativa Android (Capacitor)
function esAppNativa() {
  return typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() === true;
}

// PWA instalada en Windows/escritorio
function esPWA() {
  if (typeof window === 'undefined') return false;
  // Método 1: parámetro en la URL del manifest (más fiable en Chrome)
  const pwaParam = new URLSearchParams(window.location.search).get('pwa') === 'true';
  // Método 2: display-mode standalone (Edge, Safari, algunos Chrome)
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    window.navigator.standalone === true;
  return pwaParam || standalone;
}

// Los empleados solo pueden acceder desde la app Android o desde la PWA instalada
function verificarAccesoWeb(rol) {
  if (rol === 'empleado' && !esAppNativa() && !esPWA()) {
    throw new Error('SOLO_APP');
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('fichajes_token'));
  const [loading, setLoading] = useState(true);
  const [notificaciones, setNotificaciones] = useState([]);

  const logout = useCallback(() => {
    localStorage.removeItem('fichajes_token');
    setToken(null);
    setUser(null);
  }, []);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    fetch(`${API_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(res => {
        if (!res.ok) throw new Error('Token inválido');
        return res.json();
      })
      .then(data => {
        // Si es empleado accediendo por web, expulsar inmediatamente
        try { verificarAccesoWeb(data.rol); } catch { logout(); return; }
        setUser(data);
      })
      .catch(() => logout())
      .finally(() => setLoading(false));
  }, [token, logout]);

  const cargarNotificaciones = useCallback(async (tok) => {
    try {
      const res = await fetch(`${API_URL}/api/notificaciones`, {
        headers: { Authorization: `Bearer ${tok}` }
      });
      if (res.ok) setNotificaciones(await res.json());
    } catch {}
  }, []);

  const marcarNotificacionesLeidas = useCallback(async () => {
    if (!token) return;
    await fetch(`${API_URL}/api/notificaciones/marcar-leidas`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` }
    });
    setNotificaciones([]);
  }, [token]);

  const login = async (email, password) => {
    const res = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al iniciar sesión');

    // Bloquear acceso web a empleados
    verificarAccesoWeb(data.empleado.rol);

    localStorage.setItem('fichajes_token', data.token);
    setToken(data.token);
    setUser(data.empleado);
    await cargarNotificaciones(data.token);
    return data.empleado;
  };

  const authFetch = useCallback(async (url, options = {}) => {
    const res = await fetch(`${API_URL}${url}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
        Authorization: `Bearer ${token}`
      }
    });

    if (res.status === 401) {
      logout();
      throw new Error('Sesión expirada');
    }
    // 403 por restricción de red o permisos — NO desloguear, dejar que el componente lo gestione

    return res;
  }, [token, logout]);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, authFetch, notificaciones, marcarNotificacionesLeidas }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
