import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import styles from './LoginPage.module.css';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setCargando(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.bgDecor} aria-hidden="true">
        <div className={styles.bgCircle1}></div>
        <div className={styles.bgCircle2}></div>
      </div>

      <div className={styles.card}>
        <div className={styles.header}>
          <img src="/logo.svg" alt="Bodegas Álvaro" className={styles.logo} />
          <div className={styles.divider}></div>
          <h1 className={styles.title}>Sistema de Fichajes</h1>
          <p className={styles.subtitle}>80 años de tradición en Tacoronte</p>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          {error && (
            <div className={styles.error} role="alert">
              <span className={styles.errorIcon}>!</span>
              {error}
            </div>
          )}

          <div className={styles.field}>
            <label htmlFor="email" className={styles.label}>Correo electrónico</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="tu@bodegas-alvaro.com"
              className={styles.input}
              required
              autoFocus
              autoComplete="email"
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="password" className={styles.label}>Contraseña</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              className={styles.input}
              required
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            className={styles.btn}
            disabled={cargando}
          >
            {cargando ? (
              <span className={styles.btnSpinner}></span>
            ) : (
              'Iniciar sesión'
            )}
          </button>
        </form>

        <footer className={styles.footer}>
          <p>¿Problemas para acceder? Contacta con administración.</p>
        </footer>
      </div>
    </div>
  );
}
