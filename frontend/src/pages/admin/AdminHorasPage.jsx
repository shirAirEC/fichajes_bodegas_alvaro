import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import styles from './AdminHorasPage.module.css';

const MESES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

function fmtH(h) {
  const abs = Math.abs(h);
  const hh = Math.floor(abs);
  const mm = Math.round((abs - hh) * 60);
  const signo = h < 0 ? '-' : '';
  return mm > 0 ? `${signo}${hh}h ${mm}m` : `${signo}${hh}h`;
}

// ─── Modal ajuste/objetivo ────────────────────────────────────────────────────
function Modal({ empleado, onClose, onSave, authFetch }) {
  const [tab, setTab] = useState('ajuste');
  const [ajuste, setAjuste] = useState({ cantidad_horas: '', concepto: '', fecha: new Date().toISOString().split('T')[0] });
  const [objetivo, setObjetivo] = useState({ horas_semana: '', horas_mes: '' });
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');

  const handleAjuste = async e => {
    e.preventDefault();
    if (!ajuste.concepto.trim() || !ajuste.cantidad_horas) return setError('Rellena todos los campos');
    setCargando(true); setError('');
    try {
      const res = await authFetch('/api/horas/admin/ajuste', {
        method: 'POST',
        body: JSON.stringify({ empleado_id: empleado.id, cantidad_horas: parseFloat(ajuste.cantidad_horas), concepto: ajuste.concepto, fecha: ajuste.fecha })
      });
      const data = await res.json();
      if (!res.ok) return setError(data.error);
      onSave();
    } finally { setCargando(false); }
  };

  const handleObjetivo = async e => {
    e.preventDefault();
    setCargando(true); setError('');
    try {
      const body = {};
      if (objetivo.horas_semana !== '') body.horas_semana = parseFloat(objetivo.horas_semana);
      if (objetivo.horas_mes !== '')    body.horas_mes = parseFloat(objetivo.horas_mes);
      const res = await authFetch(`/api/horas/admin/objetivo/${empleado.id}`, { method: 'PUT', body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) return setError(data.error);
      onSave();
    } finally { setCargando(false); }
  };

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={styles.modal}>
        <div className={styles.modalHeader}>
          <h3>{empleado.nombre} {empleado.apellidos}</h3>
          <button className={styles.btnCerrar} onClick={onClose}>✕</button>
        </div>
        <div className={styles.tabs}>
          <button className={tab === 'ajuste' ? styles.tabActive : styles.tab} onClick={() => setTab('ajuste')}>Ajuste manual</button>
          <button className={tab === 'objetivo' ? styles.tabActive : styles.tab} onClick={() => setTab('objetivo')}>Objetivo personalizado</button>
        </div>

        {tab === 'ajuste' && (
          <form onSubmit={handleAjuste} className={styles.form}>
            <p className={styles.formHelp}>Añade o resta horas al balance del empleado para un período concreto.</p>
            <label>Horas (positivo = añadir, negativo = restar)
              <input type="number" step="0.5" value={ajuste.cantidad_horas}
                onChange={e => setAjuste(p => ({...p, cantidad_horas: e.target.value}))}
                placeholder="Ej: 8 o -4" required />
            </label>
            <label>Concepto
              <input type="text" value={ajuste.concepto}
                onChange={e => setAjuste(p => ({...p, concepto: e.target.value}))}
                placeholder="Ej: Formación, Corrección nómina..." required />
            </label>
            <label>Fecha de referencia
              <input type="date" value={ajuste.fecha}
                onChange={e => setAjuste(p => ({...p, fecha: e.target.value}))} />
            </label>
            {error && <div className={styles.error}>{error}</div>}
            <button type="submit" className={styles.btnPrimary} disabled={cargando}>
              {cargando ? 'Guardando...' : 'Guardar ajuste'}
            </button>
          </form>
        )}

        {tab === 'objetivo' && (
          <form onSubmit={handleObjetivo} className={styles.form}>
            <p className={styles.formHelp}>Establece un objetivo personalizado para este empleado. Deja en blanco para usar el valor global.</p>
            <label>Horas por semana
              <input type="number" step="0.5" min="0" value={objetivo.horas_semana}
                onChange={e => setObjetivo(p => ({...p, horas_semana: e.target.value}))}
                placeholder={`Global: ${empleado.objetivo?.horas_semana ?? '—'}`} />
            </label>
            <label>Horas por mes
              <input type="number" step="0.5" min="0" value={objetivo.horas_mes}
                onChange={e => setObjetivo(p => ({...p, horas_mes: e.target.value}))}
                placeholder={`Global: ${empleado.objetivo?.horas_mes ?? '—'}`} />
            </label>
            {error && <div className={styles.error}>{error}</div>}
            <div className={styles.formRow}>
              <button type="submit" className={styles.btnPrimary} disabled={cargando}>
                {cargando ? 'Guardando...' : 'Guardar objetivo'}
              </button>
              <button type="button" className={styles.btnSecondary}
                onClick={async () => {
                  setCargando(true);
                  await authFetch(`/api/horas/admin/objetivo/${empleado.id}`, { method: 'PUT', body: JSON.stringify({}) });
                  onSave(); setCargando(false);
                }}>
                Usar global
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Modal detalle empleado ───────────────────────────────────────────────────
function ModalDetalle({ empleadoId, onClose, authFetch }) {
  const [data, setData] = useState(null);
  const [eliminando, setEliminando] = useState(null);

  const cargar = useCallback(() => {
    authFetch(`/api/horas/admin/empleado/${empleadoId}`)
      .then(r => r.json())
      .then(setData);
  }, [authFetch, empleadoId]);

  useEffect(() => { cargar(); }, [cargar]);

  const eliminarAjuste = async id => {
    setEliminando(id);
    await authFetch(`/api/horas/admin/ajuste/${id}`, { method: 'DELETE' });
    cargar();
    setEliminando(null);
  };

  if (!data) return (
    <div className={styles.overlay}>
      <div className={styles.modal}><p className={styles.loading}>Cargando...</p></div>
    </div>
  );

  return (
    <div className={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className={`${styles.modal} ${styles.modalGrande}`}>
        <div className={styles.modalHeader}>
          <h3>{data.empleado.nombre} {data.empleado.apellidos} — Historial</h3>
          <button className={styles.btnCerrar} onClick={onClose}>✕</button>
        </div>

        <div className={`${styles.balanceBadge} ${data.balanceAcumulado >= 0 ? styles.balancePos : styles.balanceNeg}`}>
          Balance acumulado: <strong>{data.balanceAcumulado >= 0 ? '+' : ''}{fmtH(data.balanceAcumulado)}</strong>
        </div>

        <h4 className={styles.seccion}>Historial mensual</h4>
        <div className={styles.tablaWrap}>
          <table className={styles.tabla}>
            <thead>
              <tr><th>Mes</th><th>Trabajadas</th><th>Objetivo</th><th>Diferencia</th><th>Balance acum.</th></tr>
            </thead>
            <tbody>
              {data.historial?.map(m => (
                <tr key={`${m.anio}-${m.mes}`}>
                  <td>{MESES[m.mes - 1]} {m.anio}</td>
                  <td>{fmtH(m.trabajadas)}</td>
                  <td>{fmtH(m.objetivo)}</td>
                  <td className={m.diferencia >= 0 ? styles.positivo : styles.negativo}>
                    {m.diferencia >= 0 ? '+' : ''}{fmtH(m.diferencia)}
                  </td>
                  <td className={m.balanceAcumulado >= 0 ? styles.positivo : styles.negativo}>
                    {m.balanceAcumulado >= 0 ? '+' : ''}{fmtH(m.balanceAcumulado)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {data.ajustes?.length > 0 && (
          <>
            <h4 className={styles.seccion}>Ajustes manuales</h4>
            <div className={styles.listaAjustes}>
              {data.ajustes.map(a => (
                <div key={a.id} className={styles.ajuste}>
                  <div className={`${styles.ajusteCant} ${parseFloat(a.cantidad_horas) >= 0 ? styles.positivo : styles.negativo}`}>
                    {parseFloat(a.cantidad_horas) >= 0 ? '+' : ''}{fmtH(a.cantidad_horas)}
                  </div>
                  <div className={styles.ajusteInfo}>
                    <span className={styles.ajusteConcepto}>{a.concepto}</span>
                    <span className={styles.ajusteMeta}>{new Date(a.fecha).toLocaleDateString('es-ES')} · Por {a.admin_nombre} {a.admin_apellidos}</span>
                  </div>
                  <button className={styles.btnEliminar} onClick={() => eliminarAjuste(a.id)}
                    disabled={eliminando === a.id}>
                    {eliminando === a.id ? '...' : '✕'}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const hoy = new Date();
const ISO = d => d.toISOString().split('T')[0];

function fmtSemana(lunes, domingo) {
  const l = new Date(lunes + 'T12:00:00');
  const d = new Date(domingo + 'T12:00:00');
  return `${l.getDate()}/${l.getMonth()+1} – ${d.getDate()}/${d.getMonth()+1}`;
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function AdminHorasPage() {
  const { authFetch } = useAuth();
  const [datos, setDatos] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [modalAjuste, setModalAjuste] = useState(null);
  const [modalDetalle, setModalDetalle] = useState(null);
  const [configGlobal, setConfigGlobal] = useState({ horas_semana: 40, horas_mes: 160 });
  const [editConfig, setEditConfig] = useState(false);
  const [configForm, setConfigForm] = useState({});
  const [guardandoConfig, setGuardandoConfig] = useState(false);
  const [vistaTabla, setVistaTabla] = useState('resumen'); // 'resumen' | 'semanal'

  // Filtros
  const [modo, setModo] = useState('mes');
  const [desde, setDesde] = useState(ISO(new Date(hoy.getFullYear(), hoy.getMonth(), 1)));
  const [hasta, setHasta] = useState(ISO(hoy));

  const cargar = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams({ modo });
    if (modo === 'rango') { params.set('desde', desde); params.set('hasta', hasta); }
    const [r1, r2] = await Promise.all([
      authFetch(`/api/horas/admin/todos?${params}`).then(r => r.json()),
      authFetch('/api/config').then(r => r.json())
    ]);
    setDatos(r1);
    setConfigGlobal({ horas_semana: parseFloat(r2.horas_objetivo_semana) || 40, horas_mes: parseFloat(r2.horas_objetivo_mes) || 160 });
    setConfigForm({ horas_semana: r2.horas_objetivo_semana || '40', horas_mes: r2.horas_objetivo_mes || '160' });
    setCargando(false);
  }, [authFetch, modo, desde, hasta]);

  useEffect(() => { cargar(); }, [cargar]);

  const guardarConfig = async e => {
    e.preventDefault();
    setGuardandoConfig(true);
    await authFetch('/api/horas/admin/config', {
      method: 'PUT',
      body: JSON.stringify({ horas_semana: parseFloat(configForm.horas_semana), horas_mes: parseFloat(configForm.horas_mes) })
    });
    setEditConfig(false);
    cargar();
    setGuardandoConfig(false);
  };

  const empleados = datos?.empleados || [];
  const semanas = datos?.semanas || [];

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.titulo}>Control de horas</h1>
        <button className={styles.btnConfig} onClick={() => setEditConfig(v => !v)}>
          ⚙ Objetivo global
        </button>
      </div>

      {editConfig && (
        <form onSubmit={guardarConfig} className={styles.configPanel}>
          <div className={styles.configRow}>
            <label>Horas/semana (defecto)
              <input type="number" step="0.5" min="1" value={configForm.horas_semana}
                onChange={e => setConfigForm(p => ({...p, horas_semana: e.target.value}))} />
            </label>
            <label>Horas/mes (defecto)
              <input type="number" step="0.5" min="1" value={configForm.horas_mes}
                onChange={e => setConfigForm(p => ({...p, horas_mes: e.target.value}))} />
            </label>
          </div>
          <button type="submit" className={styles.btnPrimary} disabled={guardandoConfig}>
            {guardandoConfig ? 'Guardando...' : 'Guardar configuración global'}
          </button>
        </form>
      )}

      {/* Filtros de periodo */}
      <div className={styles.filtroBar}>
        <div className={styles.filtroModos}>
          {[['semana','Esta semana'],['mes','Este mes'],['anio','Este año'],['rango','Rango']].map(([v,l]) => (
            <button key={v}
              className={`${styles.modoBtn} ${modo === v ? styles.modoBtnActivo : ''}`}
              onClick={() => setModo(v)}
            >{l}</button>
          ))}
        </div>
        {modo === 'rango' && (
          <div className={styles.rangoInputs}>
            <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className={styles.dateInput} />
            <span>—</span>
            <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className={styles.dateInput} />
          </div>
        )}
        <div className={styles.vistaToggle}>
          <button className={`${styles.modoBtn} ${vistaTabla === 'resumen' ? styles.modoBtnActivo : ''}`} onClick={() => setVistaTabla('resumen')}>Resumen</button>
          <button className={`${styles.modoBtn} ${vistaTabla === 'semanal' ? styles.modoBtnActivo : ''}`} onClick={() => setVistaTabla('semanal')}>Por semanas</button>
        </div>
      </div>

      {cargando ? <div className={styles.loading}>Cargando...</div> : (
        <>
          {/* Vista resumen */}
          {vistaTabla === 'resumen' && (
            <div className={styles.tabla2Wrap}>
              <table className={styles.tabla2}>
                <thead>
                  <tr>
                    <th>Empleado</th>
                    <th>Trabajadas</th>
                    <th>Objetivo periodo</th>
                    <th>Diferencia</th>
                    <th>Balance acum.</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {empleados.map(emp => {
                    const pos = emp.periodo.diferencia >= 0;
                    const balPos = emp.balanceAcumulado >= 0;
                    return (
                      <tr key={emp.id}>
                        <td>
                          <div className={styles.empNombre}>{emp.nombre} {emp.apellidos}</div>
                          <div className={styles.empDept}>{emp.departamento}</div>
                        </td>
                        <td>{fmtH(emp.periodo.trabajadas)}</td>
                        <td>{fmtH(emp.periodo.objetivo)}</td>
                        <td className={pos ? styles.positivo : styles.negativo}>
                          {pos ? '+' : ''}{fmtH(emp.periodo.diferencia)}
                        </td>
                        <td className={balPos ? styles.positivo : styles.negativo}>
                          {balPos ? '+' : ''}{fmtH(emp.balanceAcumulado)}
                        </td>
                        <td>
                          <div className={styles.acciones}>
                            <button className={styles.btnAcc} onClick={() => setModalDetalle(emp.id)} title="Ver historial">📋</button>
                            <button className={styles.btnAcc} onClick={() => setModalAjuste(emp)} title="Ajustar horas">✏️</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Vista semanal */}
          {vistaTabla === 'semanal' && (
            <div className={styles.tablaSemanasWrap}>
              <table className={styles.tablaSemanas}>
                <thead>
                  <tr>
                    <th className={styles.thEmpleado}>Empleado</th>
                    {semanas.map(s => (
                      <th key={s.lunes} className={styles.thSemana}>
                        {fmtSemana(s.lunes, s.domingo)}
                      </th>
                    ))}
                    <th>Balance acum.</th>
                  </tr>
                  <tr className={styles.subhead}>
                    <td></td>
                    {semanas.map(s => (
                      <td key={s.lunes} className={styles.subheadObj}>
                        obj. {fmtH(configGlobal.horas_semana)}
                      </td>
                    ))}
                    <td></td>
                  </tr>
                </thead>
                <tbody>
                  {empleados.map(emp => (
                    <tr key={emp.id}>
                      <td>
                        <div className={styles.empNombre}>{emp.nombre} {emp.apellidos}</div>
                        <div className={styles.empDept}>{emp.departamento}</div>
                      </td>
                      {emp.desgloseSemanas.map(s => {
                        const pos = s.diferencia >= 0;
                        return (
                          <td key={s.lunes} className={styles.tdSemana}>
                            <div className={styles.celdaHoras}>{fmtH(s.trabajadas)}</div>
                            <div className={`${styles.celdaDif} ${pos ? styles.positivo : styles.negativo}`}>
                              {pos ? '+' : ''}{fmtH(s.diferencia)}
                            </div>
                          </td>
                        );
                      })}
                      <td className={emp.balanceAcumulado >= 0 ? styles.positivo : styles.negativo}>
                        <strong>{emp.balanceAcumulado >= 0 ? '+' : ''}{fmtH(emp.balanceAcumulado)}</strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {modalAjuste && (
        <Modal
          empleado={modalAjuste}
          authFetch={authFetch}
          onClose={() => setModalAjuste(null)}
          onSave={() => { setModalAjuste(null); cargar(); }}
        />
      )}

      {modalDetalle && (
        <ModalDetalle
          empleadoId={modalDetalle}
          authFetch={authFetch}
          onClose={() => setModalDetalle(null)}
        />
      )}
    </div>
  );
}
