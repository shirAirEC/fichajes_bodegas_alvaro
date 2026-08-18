import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { getApiUrl } from '../lib/apiUrl';

export default function OdooSsoRedirectPage() {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    if (!token) {
      setError('Token SSO no recibido.');
      return;
    }

    const api = getApiUrl();
    let cancelled = false;

    (async () => {
      try {
        // Fetch JSON (no window.location a Railway): en la APK un 302 externo
        // abre Chrome en lugar de seguir dentro de Capacitor.
        const res = await fetch(
          `${api}/api/auth/odoo-sso?token=${encodeURIComponent(token)}&format=json`,
          { headers: { Accept: 'application/json' } }
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.token) {
          throw new Error(data.error || 'SSO invalido o expirado');
        }
        if (cancelled) return;
        window.location.replace(
          `/admin/sso-callback?token=${encodeURIComponent(data.token)}`
        );
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'SSO invalido o expirado');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [searchParams]);

  if (error) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <p>{error}</p>
        <a href="/">Volver al login</a>
      </div>
    );
  }

  return <div style={{ padding: '2rem', textAlign: 'center' }}>Conectando con Odoo...</div>;
}
