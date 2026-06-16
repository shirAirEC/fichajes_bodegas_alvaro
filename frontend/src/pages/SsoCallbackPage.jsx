import { useEffect, useState } from 'react';

export default function SsoCallbackPage() {
  const [error, setError] = useState('');

  useEffect(() => {
    try {
      const hash = window.location.hash.replace(/^#/, '');
      const params = new URLSearchParams(hash);
      const token = params.get('token');
      if (!token) {
        setError('Token SSO no recibido.');
        return;
      }
      localStorage.setItem('fichajes_token', token);
      window.history.replaceState(null, '', '/admin/sso-callback');
      window.location.replace('/admin');
    } catch {
      setError('No se pudo completar el inicio de sesion SSO.');
    }
  }, []);

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
