import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import styles from './AdminConfigPage.module.css';

export default function AdminConfigPage() {
  const { authFetch } = useAuth();
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({});
  const [guardando, setGuardando] = useState(false);
  const [exito, setExito] = useState(false);
  const [error, setError] = useState('');
  const [miIp, setMiIp] = useState(null);
  const [cargandoIp, setCargandoIp] = useState(false);

  useEffect(() => {
    authFetch('/api/config').then(r => r.json()).then(data => {
      setConfig(data);
      setForm(data);
    });
  }, [authFetch]);

  const handleGuardar = async (e) => {
    e.preventDefault();
    setGuardando(true);
    setError('');
    setExito(false);
    try {
      const res = await authFetch('/api/config', { method: 'PUT', body: JSON.stringify(form) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setConfig(data);
      setForm(data);
      setExito(true);
      setTimeout(() => setExito(false), 4000);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  const detectarMiIp = async () => {
    setCargandoIp(true);
    try {
      const res = await authFetch('/api/config/mi-ip');
      const data = await res.json();
      setMiIp(data.ip);
    } finally {
      setCargandoIp(false);
    }
  };

  const añadirIpActual = () => {
    if (!miIp) return;
    const ipsActuales = (form.ip_permitidas || '').split(',').map(ip => ip.trim()).filter(Boolean);
    if (!ipsActuales.includes(miIp)) {
      setForm(f => ({ ...f, ip_permitidas: [...ipsActuales, miIp].join(',') }));
    }
  };

  const eliminarIp = (ipAEliminar) => {
    const nuevas = (form.ip_permitidas || '').split(',').map(ip => ip.trim()).filter(ip => ip && ip !== ipAEliminar);
    setForm(f => ({ ...f, ip_permitidas: nuevas.join(',') }));
  };

  if (!config) return <div className={styles.loading}>Cargando configuración...</div>;

  const ipsActuales = (form.ip_permitidas || '').split(',').map(ip => ip.trim()).filter(Boolean);

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Configuración del sistema</h1>

      <form onSubmit={handleGuardar}>
        {error && <div className={styles.errorBox}>{error}</div>}
        {exito && <div className={styles.successBox}>Configuración guardada correctamente.</div>}

        {/* Empresa */}
        <div className={styles.seccion}>
          <div className={styles.seccionHeader}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9,22 9,12 15,12 15,22"/>
            </svg>
            <h2>Información de la empresa</h2>
          </div>
          <div className={styles.formGrid}>
            <div className={styles.field}>
              <label>Nombre de la empresa</label>
              <input value={form.empresa_nombre || ''} onChange={e => setForm(f => ({ ...f, empresa_nombre: e.target.value }))} />
            </div>
            <div className={styles.field}>
              <label>Dirección</label>
              <input value={form.empresa_direccion || ''} onChange={e => setForm(f => ({ ...f, empresa_direccion: e.target.value }))} />
            </div>
          </div>
        </div>

        {/* Tiempo de gracia */}
        <div className={styles.seccion}>
          <div className={styles.seccionHeader}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/>
            </svg>
            <h2>Tiempo de gracia al fichar</h2>
          </div>
          <div className={styles.toggleRow}>
            <div>
              <span className={styles.toggleLabel}>Redondear a la hora exacta</span>
              <p className={styles.toggleDesc}>
                Si un empleado ficha dentro del margen de minutos configurado al inicio o al final de una hora,
                se registrará la hora exacta (ej: 08:03 → 08:00). Ponlo en 0 para desactivarlo.
              </p>
            </div>
          </div>
          <div className={styles.formGrid}>
            <div className={styles.field}>
              <label>Minutos de gracia (0 = desactivado)</label>
              <input
                type="number" min="0" max="30"
                value={form.gracia_minutos ?? '5'}
                onChange={e => setForm(f => ({ ...f, gracia_minutos: e.target.value }))}
              />
            </div>
          </div>
        </div>

        {/* Restricción por red WiFi */}
        <div className={styles.seccion}>
          <div className={styles.seccionHeader}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1.42 9a16 16 0 0121.16 0"/><path d="M5 12.55a11 11 0 0114.08 0"/><path d="M10.54 16.1a6 6 0 012.92 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>
            </svg>
            <h2>Restricción por red WiFi</h2>
          </div>

          <div className={styles.toggleRow}>
            <div>
              <span className={styles.toggleLabel}>Solo permitir fichaje desde la red de la bodega</span>
              <p className={styles.toggleDesc}>
                Si está activo, los empleados solo podrán fichar cuando estén conectados al WiFi de la bodega. Más seguro y fiable que la geolocalización.
              </p>
            </div>
            <label className={styles.switch}>
              <input
                type="checkbox"
                checked={form.ip_activo === '1'}
                onChange={e => setForm(f => ({ ...f, ip_activo: e.target.checked ? '1' : '0' }))}
              />
              <span className={styles.switchSlider}></span>
            </label>
          </div>

          {/* IPs configuradas */}
          <div className={styles.ipSection}>
            <div className={styles.ipLabel}>IPs públicas permitidas</div>

            {ipsActuales.length > 0 ? (
              <div className={styles.ipLista}>
                {ipsActuales.map(ip => (
                  <div key={ip} className={styles.ipTag}>
                    <span className={styles.ipDot} />
                    <span className={styles.ipValor}>{ip}</span>
                    <button type="button" className={styles.ipBorrar} onClick={() => eliminarIp(ip)} title="Eliminar esta IP">✕</button>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.ipVacia}>No hay IPs configuradas. Detecta tu IP actual desde la bodega para añadirla.</p>
            )}

            {/* Herramienta para detectar IP */}
            <div className={styles.ipTool}>
              <button type="button" className={styles.btnDetectarIp} onClick={detectarMiIp} disabled={cargandoIp}>
                {cargandoIp ? 'Detectando...' : '🔍 Detectar mi IP actual'}
              </button>

              {miIp && (
                <div className={styles.ipDetectada}>
                  <span>Tu IP actual: <strong>{miIp}</strong></span>
                  <button
                    type="button"
                    className={styles.btnAñadirIp}
                    onClick={añadirIpActual}
                    disabled={ipsActuales.includes(miIp)}
                  >
                    {ipsActuales.includes(miIp) ? '✓ Ya añadida' : '+ Añadir a la lista'}
                  </button>
                </div>
              )}
              <p className={styles.ipHelp}>
                Conéctate al WiFi de la bodega y pulsa "Detectar mi IP actual" para añadir la IP de esa red.
                Si la IP cambia (IPs dinámicas), repite este proceso.
              </p>
            </div>
          </div>
        </div>

        <div className={styles.formActions}>
          <button type="submit" className={styles.btnGuardar} disabled={guardando}>
            {guardando ? 'Guardando...' : 'Guardar configuración'}
          </button>
        </div>
      </form>
    </div>
  );
}
