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
    window.location.replace(
      `${api}/api/auth/odoo-sso?token=${encodeURIComponent(token)}`
    );
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
