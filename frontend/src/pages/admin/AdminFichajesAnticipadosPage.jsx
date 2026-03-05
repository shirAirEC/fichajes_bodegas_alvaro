import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import styles from './AdminSolicitudesPage.module.css';

function formatFechaHora(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

export default function AdminFichajesAnticipadosPage() {
  const { authFetch } = useAuth();
  const [pendientes, setPendientes] = useState([]);
  const [historial, setHistorial] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [modal, setModal] = useState(null);
  const [adminNota, setAdminNota] = useState('');
  const [procesando, setProcesando] = useState(false);
  const [exito, setExito] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    const [r1, r2, r3] = await Promise.all([
      authFetch('/api/fichajes/anticipados?estado=pendiente'),
      authFetch('/api/fichajes/anticipados?estado=aprobado'),
      authFetch('/api/fichajes/anticipados?estado=rechazado'),
    ]);
    const [pend, aprob, rech] = await Promise.all([r1.json(), r2.json(), r3.json()]);
    setPendientes(Array.isArray(pend) ? pend : []);
    const hist = [...(Array.isArray(aprob) ? aprob : []), ...(Array.isArray(rech) ? rech : [])]
      .sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
    setHistorial(hist);
    setCargando(false);
  }, [authFetch]);

  useEffect(() => { cargar(); }, [cargar]);

  const handleResolver = async (accion) => {
    setProcesando(true);
    try {
      const res = await authFetch(`/api/fichajes/anticipados/${modal.id}/${accion}`, {
        method: 'POST',
        body: JSON.stringify({ admin_nota: adminNota })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setModal(null);
      setAdminNota('');
      setExito(accion === 'aprobar'
        ? 'Fichaje aprobado y registrado correctamente.'
        : 'Fichaje anticipado rechazado.'
      );
      setTimeout(() => setExito(''), 5000);
      cargar();
    } finally {
      setProcesando(false);
    }
  };

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Fichajes anticipados</h1>
      <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
        Empleados que han intentado fichar antes del inicio del margen de cortesía. Apruébalos o recházalos.
      </p>

      {exito && <div className={styles.successBox}>{exito}</div>}

      {cargando ? <div className={styles.loading}>Cargando...</div> : (
        <>
          <section>
            <h2 className={styles.seccion}>
              Pendientes de revisión
              {pendientes.length > 0 && <span className={styles.badge}>{pendientes.length}</span>}
            </h2>
            {pendientes.length === 0
              ? <div className={styles.vacio}>No hay fichajes anticipados pendientes.</div>
              : pendientes.map(a => (
                  <TarjetaAnticipado key={a.id} a={a} onRevisar={() => { setModal(a); setAdminNota(''); }} />
                ))
            }
          </section>

          {historial.length > 0 && (
            <section style={{ marginTop: '2rem' }}>
              <h2 className={styles.seccion}>Historial reciente</h2>
              {historial.slice(0, 20).map(a => <TarjetaAnticipado key={a.id} a={a} />)}
            </section>
          )}
        </>
      )}

      {modal && (
        <div className={styles.overlay} onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>Fichaje anticipado de {modal.nombre} {modal.apellidos}</h2>
              <button className={styles.modalClose} onClick={() => setModal(null)}>×</button>
            </div>
            <div className={styles.modalBody}>
              <div className={styles.resumen}>
                <div><span className={styles.lbl}>Empleado</span><strong>{modal.nombre} {modal.apellidos}</strong></div>
                <div><span className={styles.lbl}>Fecha</span><strong>{modal.fecha}</strong></div>
                <div><span className={styles.lbl}>Intento a las</span><strong>{formatFechaHora(modal.hora_intento)}</strong></div>
                <div><span className={styles.lbl}>Hora programada</span><strong>{modal.hora_entrada_programada?.slice(0, 5)}</strong></div>
              </div>
              <div className={styles.motivoBox}>
                <span className={styles.lbl}>Si apruebas:</span>
                <p>Se registrará una entrada con la hora del intento: <strong>{formatFechaHora(modal.hora_intento)}</strong></p>
              </div>
              <div className={styles.field}>
                <label className={styles.lbl}>Nota para el empleado (opcional)</label>
                <textarea
                  rows={2}
                  value={adminNota}
                  onChange={e => setAdminNota(e.target.value)}
                  placeholder="Mensaje para el empleado..."
                  className={styles.textarea}
                />
              </div>
              <div className={styles.modalFooter}>
                <button
                  className={styles.btnRechazar}
                  onClick={() => handleResolver('rechazar')}
                  disabled={procesando}
                >
                  Rechazar
                </button>
                <button
                  className={styles.btnAprobar}
                  onClick={() => handleResolver('aprobar')}
                  disabled={procesando}
                >
                  {procesando ? 'Procesando...' : 'Aprobar y registrar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TarjetaAnticipado({ a, onRevisar }) {
  const ESTADOS = {
    pendiente: { label: 'Pendiente', cls: 'pendiente' },
    aprobado:  { label: 'Aprobado',  cls: 'aprobada' },
    rechazado: { label: 'Rechazado', cls: 'rechazada' }
  };
  const st = ESTADOS[a.estado] || ESTADOS.pendiente;
  return (
    <div className={`${styles.tarjeta} ${styles['est_' + st.cls]}`}>
      <div className={styles.tarjetaLeft}>
        <span className={styles.empNombre}>{a.nombre} {a.apellidos}</span>
        <span className={styles.tarjetaInfo}>
          {a.departamento} · {a.fecha} · Intento: {formatFechaHora(a.hora_intento)} · Entrada programada: {a.hora_entrada_programada?.slice(0, 5)}
        </span>
        {a.admin_nota && (
          <span className={styles.tarjetaMotivo}>Nota admin: {a.admin_nota}</span>
        )}
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
