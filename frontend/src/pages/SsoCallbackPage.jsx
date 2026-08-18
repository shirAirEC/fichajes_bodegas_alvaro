import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { safeInternalPath } from '../lib/safeInternalPath';

function readSsoToken() {
  const fromQuery = new URLSearchParams(window.location.search).get('token');
  if (fromQuery) return fromQuery;
  const hash = window.location.hash.replace(/^#/, '');
  return new URLSearchParams(hash).get('token');
}

export default function SsoCallbackPage() {
  const [error, setError] = useState('');
  const { loginWithToken } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const token = readSsoToken();
        if (!token) {
          setError('Token SSO no recibido.');
          return;
        }
        await loginWithToken(token);
        if (cancelled) return;
        const next = safeInternalPath(
          new URLSearchParams(window.location.search).get('next')
        ) || '/admin';
        window.history.replaceState(null, '', next);
        navigate(next, { replace: true });
      } catch {
        if (!cancelled) setError('No se pudo completar el inicio de sesion SSO.');
      }
    })();

    return () => { cancelled = true; };
  }, [loginWithToken, navigate]);

  if (error) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>{error}</p>
        <a href="/">Volver al login</a>
      </div>
    );
  }

  return <div style={{ padding: '2rem', textAlign: 'center' }}>Iniciando sesion...</div>;
}
