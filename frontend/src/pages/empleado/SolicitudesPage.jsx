import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import styles from './SolicitudesPage.module.css';

const TIPOS = { correccion: 'Corregir fichaje', nuevo: 'Añadir fichaje', eliminar: 'Eliminar fichaje' };
const ESTADOS = { pendiente: '⏳ Pendiente', aprobada: '✅ Aprobada', rechazada: '❌ Rechazada' };

const FORM_VACIO = { tipo: 'nuevo', fecha_solicitada: '', hora_solicitada: '', tipo_fichaje: 'entrada', motivo: '', fichaje_id: '' };

export default function SolicitudesPage() {
  const { authFetch } = useAuth();
  const [solicitudes, setSolicitudes] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(FORM_VACIO);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [exito, setExito] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    const res = await authFetch('/api/solicitudes');
    setSolicitudes(await res.json());
    setCargando(false);
  }, [authFetch]);

  useEffect(() => { cargar(); }, [cargar]);

  const handleEnviar = async (e) => {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      const body = { ...form };
      if (!body.fichaje_id) delete body.fichaje_id;
      const res = await authFetch('/api/solicitudes', { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setModalOpen(false);
      setForm(FORM_VACIO);
      setExito(true);
      setTimeout(() => setExito(false), 5000);
      cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setEnviando(false);
    }
  };

  const pendientes = solicitudes.filter(s => s.estado === 'pendiente');
  const resueltas = solicitudes.filter(s => s.estado !== 'pendiente');

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <h1 className={styles.title}>Mis solicitudes de corrección</h1>
        <button className={styles.btnNueva} onClick={() => { setModalOpen(true); setForm(FORM_VACIO); setError(''); }}>
          + Nueva solicitud
        </button>
      </div>

      {exito && <div className={styles.successBox}>Solicitud enviada correctamente. El administrador la revisará pronto.</div>}

      {cargando ? <div className={styles.loading}>Cargando...</div> : (
        <>
          {solicitudes.length === 0 && (
            <div className={styles.vacio}>
              <p>No tienes solicitudes de corrección.</p>
              <p>Si cometiste un error al fichar, usa el botón "Nueva solicitud".</p>
            </div>
          )}

          {pendientes.length > 0 && (
            <>
              <h2 className={styles.seccion}>Pendientes de revisión</h2>
              {pendientes.map(s => <TarjetaSolicitud key={s.id} s={s} />)}
            </>
          )}

          {resueltas.length > 0 && (
            <>
              <h2 className={styles.seccion}>Historial</h2>
              {resueltas.map(s => <TarjetaSolicitud key={s.id} s={s} />)}
            </>
          )}
        </>
      )}

      {modalOpen && (
        <div className={styles.overlay} onClick={e => e.target === e.currentTarget && setModalOpen(false)}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>Nueva solicitud de corrección</h2>
              <button className={styles.modalClose} onClick={() => setModalOpen(false)}>×</button>
            </div>
            <form onSubmit={handleEnviar} className={styles.modalForm}>
              {error && <div className={styles.error}>{error}</div>}

              <div className={styles.field}>
                <label>Tipo de solicitud</label>
                <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
                  <option value="nuevo">Añadir un fichaje que no registré</option>
                  <option value="correccion">Corregir un fichaje incorrecto</option>
                  <option value="eliminar">Eliminar un fichaje duplicado o erróneo</option>
                </select>
              </div>

              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label>Fecha del fichaje *</label>
                  <input type="date" required value={form.fecha_solicitada}
                    onChange={e => setForm(f => ({ ...f, fecha_solicitada: e.target.value }))} />
                </div>
                <div className={styles.field}>
                  <label>Hora {form.tipo === 'eliminar' ? 'del fichaje a eliminar' : 'correcta'} *</label>
                  <input type="time" required value={form.hora_solicitada}
                    onChange={e => setForm(f => ({ ...f, hora_solicitada: e.target.value }))} />
                </div>
                <div className={styles.field}>
                  <label>Tipo de fichaje *</label>
                  <select value={form.tipo_fichaje} onChange={e => setForm(f => ({ ...f, tipo_fichaje: e.target.value }))}>
                    <option value="entrada">Entrada</option>
                    <option value="salida">Salida</option>
                  </select>
                </div>
              </div>

              <div className={styles.field}>
                <label>Motivo de la corrección *</label>
                <textarea required rows={3} value={form.motivo}
                  onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))}
                  placeholder="Explica brevemente qué ocurrió (ej: se me olvidó fichar la salida, fichaje duplicado...)" />
              </div>

              <div className={styles.modalFooter}>
                <button type="button" className={styles.btnCancelar} onClick={() => setModalOpen(false)}>Cancelar</button>
                <button type="submit" className={styles.btnEnviar} disabled={enviando}>
                  {enviando ? 'Enviando...' : 'Enviar solicitud'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function TarjetaSolicitud({ s }) {
  const fecha = new Date(s.created_at).toLocaleDateString('es-ES');
  return (
    <div className={`${styles.tarjeta} ${styles['estado_' + s.estado]}`}>
      <div className={styles.tarjetaTop}>
        <span className={styles.tarjetaTipo}>{TIPOS[s.tipo]}</span>
        <span className={styles.tarjetaEstado}>{ESTADOS[s.estado]}</span>
      </div>
      <div className={styles.tarjetaInfo}>
        <span>{s.fecha_solicitada?.toString().split('T')[0]} a las {s.hora_solicitada?.toString().slice(0,5)}</span>
        <span className={styles.sep}>·</span>
        <span>{s.tipo_fichaje === 'entrada' ? 'Entrada' : 'Salida'}</span>
        <span className={styles.sep}>·</span>
        <span>Enviada el {fecha}</span>
      </div>
      <p className={styles.tarjetaMotivo}>{s.motivo}</p>
      {s.admin_nota && (
        <p className={styles.tarjetaAdminNota}>
          <strong>Respuesta del administrador:</strong> {s.admin_nota}
        </p>
      )}
    </div>
  );
}
