import { useState, useEffect, useCallback, createContext, useContext } from 'react';
import { apiUrl, ensureJsonResponse, parseJsonResponse } from '../lib/apiUrl';

const AuthContext = createContext(null);

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

    let cancelled = false;
    setLoading(true);

    fetch(apiUrl('/api/auth/me'), {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(async res => {
        if (!res.ok) throw new Error('Token inválido');
        return parseJsonResponse(res);
      })
      .then(data => {
        if (cancelled) return;
        try { verificarAccesoWeb(data.rol); } catch { logout(); return; }
        setUser(data);
      })
      .catch(() => {
        // No borrar un token nuevo si este /me quedó obsoleto (p. ej. carrera SSO).
        if (!cancelled) logout();
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [token, logout]);

  const cargarNotificaciones = useCallback(async (tok) => {
    try {
      const res = await fetch(apiUrl('/api/notificaciones'), {
        headers: { Authorization: `Bearer ${tok}` }
      });
      if (res.ok) setNotificaciones(await parseJsonResponse(res));
    } catch {}
  }, []);

  const loginWithToken = useCallback(async (newToken) => {
    localStorage.setItem('fichajes_token', newToken);
    setToken(newToken);
    setLoading(true);
    const res = await fetch(apiUrl('/api/auth/me'), {
      headers: { Authorization: `Bearer ${newToken}` }
    });
    if (!res.ok) {
      logout();
      throw new Error('Token SSO inválido');
    }
    const data = await parseJsonResponse(res);
    verificarAccesoWeb(data.rol);
    setUser(data);
    setLoading(false);
    await cargarNotificaciones(newToken);
    return data;
  }, [logout, cargarNotificaciones]);

  const refrescarNotificaciones = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(apiUrl('/api/notificaciones'), {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) setNotificaciones(await parseJsonResponse(res));
    } catch {}
  }, [token]);

  const marcarNotificacionesLeidas = useCallback(async () => {
    if (!token) return;
    await fetch(apiUrl('/api/notificaciones/marcar-leidas'), {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}` }
    });
    setNotificaciones([]);
  }, [token]);

  const login = async (email, password) => {
    const res = await fetch(apiUrl('/api/auth/login'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await parseJsonResponse(res);
    if (!res.ok) throw new Error(data.error || 'Error al iniciar sesión');

    verificarAccesoWeb(data.empleado.rol);

    localStorage.setItem('fichajes_token', data.token);
    setToken(data.token);
    setUser(data.empleado);
    await cargarNotificaciones(data.token);
    return data.empleado;
  };

  const authFetch = useCallback(async (url, options = {}) => {
    const res = await fetch(apiUrl(url), {
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

    return ensureJsonResponse(res);
  }, [token, logout]);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, loginWithToken, logout, authFetch, notificaciones, marcarNotificacionesLeidas, refrescarNotificaciones }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
