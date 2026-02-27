import { useState, useEffect, useCallback, createContext, useContext } from 'react';

const AuthContext = createContext(null);

const API_URL = import.meta.env.VITE_API_URL || '';

// Detecta si se ejecuta dentro de la app nativa de Capacitor (Android)
function esAppNativa() {
  return typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() === true;
}

// Los empleados SOLO pueden acceder desde la app nativa, nunca desde el navegador web
function verificarAccesoWeb(rol) {
  if (rol === 'empleado' && !esAppNativa()) {
    throw new Error('SOLO_APP');
  }
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('fichajes_token'));
  const [loading, setLoading] = useState(true);

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

    if (res.status === 403 || res.status === 401) {
      logout();
      throw new Error('Sesión expirada');
    }

    return res;
  }, [token, logout]);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, authFetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
