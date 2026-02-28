import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import styles from './AdminSolicitudesPage.module.css';

const TIPOS = { correccion: 'Corrección', nuevo: 'Añadir fichaje', eliminar: 'Eliminar fichaje' };

export default function AdminSolicitudesPage() {
  const { authFetch } = useAuth();
  const [solicitudes, setSolicitudes] = useState([]);
  const [historial, setHistorial] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [modal, setModal] = useState(null);
  const [adminNota, setAdminNota] = useState('');
  const [procesando, setProcesando] = useState(false);
  const [exito, setExito] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    const [r1, r2] = await Promise.all([
      authFetch('/api/solicitudes/admin?estado=pendiente'),
      authFetch('/api/solicitudes/admin?estado=aprobada'),
    ]);
    const [pend, aprob] = await Promise.all([r1.json(), r2.json()]);
    const { data: rech } = await authFetch('/api/solicitudes/admin?estado=rechazada').then(r => r.json().then(d => ({ data: d })));
    setSolicitudes(pend);
    setHistorial([...aprob, ...rech].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at)));
    setCargando(false);
  }, [authFetch]);

  useEffect(() => { cargar(); }, [cargar]);

  const handleResolver = async (estado) => {
    setProcesando(true);
    try {
      const res = await authFetch(`/api/solicitudes/admin/${modal.id}`, {
        method: 'PUT',
        body: JSON.stringify({ estado, admin_nota: adminNota })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setModal(null);
      setAdminNota('');
      setExito(estado === 'aprobada' ? 'Solicitud aprobada y fichaje actualizado.' : 'Solicitud rechazada.');
      setTimeout(() => setExito(''), 5000);
      cargar();
    } finally {
      setProcesando(false);
    }
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Solicitudes de corrección</h1>

      {exito && <div className={styles.successBox}>{exito}</div>}

      {cargando ? <div className={styles.loading}>Cargando...</div> : (
        <>
          <section>
            <h2 className={styles.seccion}>
              Pendientes de revisión
              {solicitudes.length > 0 && <span className={styles.badge}>{solicitudes.length}</span>}
            </h2>
            {solicitudes.length === 0
              ? <div className={styles.vacio}>No hay solicitudes pendientes.</div>
              : solicitudes.map(s => (
                  <TarjetaSolicitud key={s.id} s={s} onRevisar={() => { setModal(s); setAdminNota(''); }} />
                ))
            }
          </section>

          {historial.length > 0 && (
            <section style={{ marginTop: '2rem' }}>
              <h2 className={styles.seccion}>Historial reciente</h2>
              {historial.slice(0, 20).map(s => <TarjetaSolicitud key={s.id} s={s} />)}
            </section>
          )}
        </>
      )}

      {modal && (
        <div className={styles.overlay} onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>Revisar solicitud de {modal.empleado_nombre}</h2>
              <button className={styles.modalClose} onClick={() => setModal(null)}>×</button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.resumen}>
                <div><span className={styles.lbl}>Tipo</span><strong>{TIPOS[modal.tipo]}</strong></div>
                <div><span className={styles.lbl}>Fecha</span><strong>{modal.fecha_solicitada?.toString().split('T')[0]}</strong></div>
                <div><span className={styles.lbl}>Hora</span><strong>{modal.hora_solicitada?.toString().slice(0,5)}</strong></div>
                <div><span className={styles.lbl}>Fichaje</span><strong>{modal.tipo_fichaje === 'entrada' ? 'Entrada' : 'Salida'}</strong></div>
              </div>
              <div className={styles.motivoBox}>
                <span className={styles.lbl}>Motivo del empleado:</span>
                <p>{modal.motivo}</p>
              </div>
              <div className={styles.field}>
                <label className={styles.lbl}>Nota de respuesta (opcional)</label>
                <textarea rows={2} value={adminNota} onChange={e => setAdminNota(e.target.value)}
                  placeholder="Mensaje para el empleado..." className={styles.textarea} />
              </div>
              <div className={styles.modalFooter}>
                <button className={styles.btnRechazar} onClick={() => handleResolver('rechazada')} disabled={procesando}>
                  Rechazar
                </button>
                <button className={styles.btnAprobar} onClick={() => handleResolver('aprobada')} disabled={procesando}>
                  {procesando ? 'Procesando...' : 'Aprobar y aplicar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TarjetaSolicitud({ s, onRevisar }) {
  const ESTADOS = { pendiente: { label: 'Pendiente', cls: 'pendiente' }, aprobada: { label: 'Aprobada', cls: 'aprobada' }, rechazada: { label: 'Rechazada', cls: 'rechazada' } };
  const st = ESTADOS[s.estado];
  return (
    <div className={`${styles.tarjeta} ${styles['est_' + st.cls]}`}>
      <div className={styles.tarjetaLeft}>
        <span className={styles.empNombre}>{s.empleado_nombre}</span>
        <span className={styles.tarjetaInfo}>
          {TIPOS[s.tipo]} · {s.fecha_solicitada?.toString().split('T')[0]} {s.hora_solicitada?.toString().slice(0,5)} · {s.tipo_fichaje}
        </span>
        <span className={styles.tarjetaMotivo}>{s.motivo}</span>
      </div>
      <div className={styles.tarjetaRight}>
        <span className={`${styles.estadoBadge} ${styles['badge_' + st.cls]}`}>{st.label}</span>
        {onRevisar && (
          <button className={styles.btnRevisar} onClick={onRevisar}>Revisar</button>
        )}
      </div>
    </div>
  );
}
