import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiUrl, parseJsonResponse } from '../lib/apiUrl';
import { safeInternalPath } from '../lib/safeInternalPath';

export default function OdooSsoRedirectPage() {
  const [searchParams] = useSearchParams();
  const [error, setError] = useState('');

  useEffect(() => {
    const token = searchParams.get('token');
    const next = safeInternalPath(searchParams.get('next'));
    if (!token) {
      setError('Token SSO no recibido.');
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        // Fetch JSON (no window.location a Railway): en la APK un 302 externo
        // abre Chrome en lugar de seguir dentro de Capacitor.
        const res = await fetch(
          apiUrl(`/api/auth/odoo-sso?token=${encodeURIComponent(token)}&format=json`),
          { headers: { Accept: 'application/json' } }
        );
        const data = await parseJsonResponse(res);
        if (!res.ok || !data.token) {
          throw new Error(data.error || 'SSO invalido o expirado');
        }
        if (cancelled) return;
        const nextQ = next ? `&next=${encodeURIComponent(next)}` : '';
        window.location.replace(
          `/admin/sso-callback?token=${encodeURIComponent(data.token)}${nextQ}`
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
