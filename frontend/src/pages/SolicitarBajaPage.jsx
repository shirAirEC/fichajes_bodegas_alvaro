import { useState } from 'react';
import { getApiUrl } from '../lib/apiUrl';

const API_URL = getApiUrl();

export default function SolicitarBajaPage() {
  const [form, setForm] = useState({ nombre: '', apellidos: '', motivo: '' });
  const [estado, setEstado] = useState('idle'); // idle | enviando | ok | error

  const handleSubmit = async (e) => {
    e.preventDefault();
    setEstado('enviando');
    try {
      const res = await fetch(`${API_URL}/api/auth/solicitar-baja`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setEstado('ok');
      } else {
        setEstado('error');
      }
    } catch {
      setEstado('error');
    }
  };

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.logo}>
          <div style={s.logoIcon}>🍷</div>
          <div>
            <div style={s.logoTitle}>Bodegas Álvaro</div>
            <div style={s.logoSub}>Sistema de fichajes</div>
          </div>
        </div>

        <h1 style={s.title}>Solicitud de eliminación de cuenta</h1>
        <p style={s.desc}>
          Si deseas que tu cuenta y datos personales sean eliminados del sistema,
          rellena este formulario. El responsable recibirá tu solicitud y la
          gestionará en un plazo máximo de <strong>30 días</strong>.
        </p>

        {estado === 'ok' ? (
          <div style={s.success}>
            <div style={s.successIcon}>✓</div>
            <h2 style={s.successTitle}>Solicitud enviada</h2>
            <p style={s.successText}>
              Hemos recibido tu solicitud. El responsable del sistema la
              procesará y te confirmará la eliminación de tus datos en un
              plazo máximo de 30 días, conforme al RGPD.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} style={s.form}>
            <div style={s.field}>
              <label style={s.label}>Nombre *</label>
              <input
                style={s.input}
                required
                value={form.nombre}
                onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))}
                placeholder="Tu nombre"
              />
            </div>
            <div style={s.field}>
              <label style={s.label}>Apellidos *</label>
              <input
                style={s.input}
                required
                value={form.apellidos}
                onChange={e => setForm(f => ({ ...f, apellidos: e.target.value }))}
                placeholder="Tus apellidos"
              />
            </div>
            <div style={s.field}>
              <label style={s.label}>Motivo <span style={s.optional}>(opcional)</span></label>
              <textarea
                style={s.textarea}
                value={form.motivo}
                onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))}
                placeholder="Puedes indicar el motivo de la solicitud"
                rows={3}
              />
            </div>

            {estado === 'error' && (
              <p style={s.errorMsg}>
                No se pudo enviar la solicitud. Por favor, inténtalo de nuevo
                o contacta directamente con el administrador.
              </p>
            )}

            <button
              type="submit"
              style={s.btn}
              disabled={estado === 'enviando'}
            >
              {estado === 'enviando' ? 'Enviando...' : 'Enviar solicitud de baja'}
            </button>
          </form>
        )}

        <p style={s.footer}>
          Esta solicitud se tramita conforme al{' '}
          <strong>Reglamento General de Protección de Datos (RGPD)</strong>.
          Los datos del formulario se usarán únicamente para gestionar tu baja.
        </p>
      </div>
    </div>
  );
}

const s = {
  page: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #f5f0e8 0%, #ede5d0 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem 1rem',
    fontFamily: "'Segoe UI', system-ui, sans-serif",
  },
  card: {
    background: '#fff',
    borderRadius: '16px',
    padding: '2.5rem',
    maxWidth: '480px',
    width: '100%',
    boxShadow: '0 4px 32px rgba(0,0,0,0.10)',
  },
  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.875rem',
    marginBottom: '1.75rem',
  },
  logoIcon: { fontSize: '2rem' },
  logoTitle: { fontWeight: 700, fontSize: '1.1rem', color: '#8B2635' },
  logoSub: { fontSize: '0.8rem', color: '#888', marginTop: '1px' },
  title: {
    fontSize: '1.3rem',
    fontWeight: 700,
    color: '#1a1a1a',
    marginBottom: '0.75rem',
  },
  desc: {
    fontSize: '0.9rem',
    color: '#555',
    lineHeight: 1.6,
    marginBottom: '1.75rem',
  },
  form: { display: 'flex', flexDirection: 'column', gap: '1.1rem' },
  field: { display: 'flex', flexDirection: 'column', gap: '0.35rem' },
  label: { fontSize: '0.875rem', fontWeight: 600, color: '#333' },
  optional: { fontWeight: 400, color: '#999' },
  input: {
    padding: '0.65rem 0.875rem',
    border: '1.5px solid #ddd',
    borderRadius: '8px',
    fontSize: '0.95rem',
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  textarea: {
    padding: '0.65rem 0.875rem',
    border: '1.5px solid #ddd',
    borderRadius: '8px',
    fontSize: '0.95rem',
    outline: 'none',
    resize: 'vertical',
    fontFamily: 'inherit',
  },
  btn: {
    padding: '0.8rem',
    background: '#8B2635',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    fontSize: '0.95rem',
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: '0.5rem',
  },
  errorMsg: {
    color: '#c0392b',
    fontSize: '0.875rem',
    background: '#fdf0ef',
    padding: '0.75rem',
    borderRadius: '8px',
    margin: 0,
  },
  success: { textAlign: 'center', padding: '1rem 0' },
  successIcon: {
    fontSize: '3rem',
    color: '#27ae60',
    background: '#eafaf1',
    width: '72px',
    height: '72px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    margin: '0 auto 1rem',
  },
  successTitle: { fontSize: '1.2rem', color: '#1a1a1a', marginBottom: '0.75rem' },
  successText: { fontSize: '0.9rem', color: '#555', lineHeight: 1.6 },
  footer: {
    marginTop: '2rem',
    fontSize: '0.78rem',
    color: '#aaa',
    borderTop: '1px solid #f0f0f0',
    paddingTop: '1.25rem',
    lineHeight: 1.5,
  },
};
