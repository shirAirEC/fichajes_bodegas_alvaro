import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import styles from './AdminHorariosPage.module.css';

const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const DIAS_VAL = [1, 2, 3, 4, 5, 6, 7];

const TIPO_LABELS = {
  diario:  'Todos los días',
  semanal: 'Días de la semana',
  rango:   'Rango de fechas',
  fecha:   'Fecha concreta',
};

const FORM_VACIO = {
  empleado_id: '', tipo: 'diario',
  dias_semana: [], fecha: '', fecha_inicio: '', fecha_fin: '',
  hora_entrada: '', hora_salida: ''
};

function describir(h) {
  if (h.tipo === 'diario') return 'Todos los días';
  if (h.tipo === 'semanal') {
    const dias = (h.dias_semana || '').split(',').map(Number).map(d => DIAS[d - 1]).join(', ');
    return `Semanas: ${dias}`;
  }
  if (h.tipo === 'rango') return `${h.fecha_inicio} → ${h.fecha_fin || 'indefinido'}`;
  if (h.tipo === 'fecha') return `Fecha: ${h.fecha}`;
  return '';
}

export default function AdminHorariosPage() {
  const { authFetch } = useAuth();
  const [horarios, setHorarios] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [filtroEmp, setFiltroEmp] = useState('');
  const [modal, setModal] = useState(null); // null | 'nuevo' | horario (editar)
  const [form, setForm] = useState(FORM_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [exito, setExito] = useState('');
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    setCargando(true);
    const params = filtroEmp ? `?empleado_id=${filtroEmp}` : '';
    const [rH, rE] = await Promise.all([
      authFetch(`/api/horarios${params}`),
      authFetch('/api/empleados')
    ]);
    setHorarios(await rH.json());
    setEmpleados(await rE.json());
    setCargando(false);
  }, [authFetch, filtroEmp]);

  useEffect(() => { cargar(); }, [cargar]);

  const abrirNuevo = () => { setForm(FORM_VACIO); setError(''); setModal('nuevo'); };
  const abrirEditar = (h) => {
    setForm({
      empleado_id: h.empleado_id || '',
      tipo: h.tipo,
      dias_semana: h.dias_semana ? h.dias_semana.split(',').map(Number) : [],
      fecha: h.fecha || '',
      fecha_inicio: h.fecha_inicio || '',
      fecha_fin: h.fecha_fin || '',
      hora_entrada: h.hora_entrada?.slice(0, 5) || '',
      hora_salida: h.hora_salida?.slice(0, 5) || ''
    });
    setError('');
    setModal(h);
  };

  const toggleDia = (d) => {
    setForm(f => ({
      ...f,
      dias_semana: f.dias_semana.includes(d)
        ? f.dias_semana.filter(x => x !== d)
        : [...f.dias_semana, d].sort((a, b) => a - b)
    }));
  };

  const handleGuardar = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.hora_entrada) { setError('La hora de entrada es obligatoria.'); return; }
    if (form.tipo === 'semanal' && form.dias_semana.length === 0) {
      setError('Selecciona al menos un día de la semana.'); return;
    }
    if (form.tipo === 'fecha' && !form.fecha) { setError('Indica la fecha concreta.'); return; }
    if (form.tipo === 'rango' && !form.fecha_inicio) { setError('Indica la fecha de inicio del rango.'); return; }

    const body = {
      empleado_id: form.empleado_id || null,
      tipo: form.tipo,
      dias_semana: form.tipo === 'semanal' ? form.dias_semana.join(',') : null,
      fecha: form.tipo === 'fecha' ? form.fecha : null,
      fecha_inicio: form.tipo === 'rango' ? form.fecha_inicio : null,
      fecha_fin: form.tipo === 'rango' ? form.fecha_fin || null : null,
      hora_entrada: form.hora_entrada,
      hora_salida: form.hora_salida || null
    };

    setGuardando(true);
    try {
      const url = modal === 'nuevo' ? '/api/horarios' : `/api/horarios/${modal.id}`;
      const method = modal === 'nuevo' ? 'POST' : 'PUT';
      const res = await authFetch(url, { method, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setModal(null);
      setExito(modal === 'nuevo' ? 'Horario creado correctamente.' : 'Horario actualizado.');
      setTimeout(() => setExito(''), 4000);
      cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  const handleEliminar = async (id) => {
    if (!window.confirm('¿Eliminar este horario?')) return;
    await authFetch(`/api/horarios/${id}`, { method: 'DELETE' });
    cargar();
  };

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <h1 className={styles.title}>Horarios de trabajo</h1>
        <button className={styles.btnNuevo} onClick={abrirNuevo}>+ Nuevo horario</button>
      </div>

      <p className={styles.desc}>
        Define los turnos de entrada y salida. El sistema usa estas horas como referencia para el tiempo de gracia al fichar.
      </p>

      {exito && <div className={styles.successBox}>{exito}</div>}

      <div className={styles.filtroBar}>
        <select value={filtroEmp} onChange={e => setFiltroEmp(e.target.value)} className={styles.select}>
          <option value="">Todos los empleados</option>
          <option value="null">Solo horarios globales</option>
          {empleados.map(e => <option key={e.id} value={e.id}>{e.nombre} {e.apellidos}</option>)}
        </select>
      </div>

      {cargando ? (
        <div className={styles.loading}>Cargando...</div>
      ) : horarios.length === 0 ? (
        <div className={styles.vacio}>No hay horarios definidos. Crea uno con el botón superior.</div>
      ) : (
        <div className={styles.lista}>
          {horarios.map(h => (
            <div key={h.id} className={styles.tarjeta}>
              <div className={styles.tarjetaLeft}>
                <div className={styles.tarjetaEmp}>
                  {h.empleado_nombre
                    ? <><span className={styles.empTag}>{h.empleado_nombre}</span></>
                    : <span className={styles.empTagGlobal}>Todos los empleados</span>
                  }
                  <span className={styles.tipoTag}>{TIPO_LABELS[h.tipo]}</span>
                </div>
                <div className={styles.tarjetaPeriodo}>{describir(h)}</div>
                <div className={styles.tarjetaHoras}>
                  <span className={styles.horaEntrada}>▶ Entrada: <strong>{h.hora_entrada?.slice(0,5)}</strong></span>
                  {h.hora_salida && <span className={styles.horaSalida}>■ Salida: <strong>{h.hora_salida?.slice(0,5)}</strong></span>}
                </div>
              </div>
              <div className={styles.tarjetaActions}>
                <button className={styles.btnEditar} onClick={() => abrirEditar(h)}>Editar</button>
                <button className={styles.btnEliminar} onClick={() => handleEliminar(h.id)}>Eliminar</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className={styles.overlay} onClick={e => e.target === e.currentTarget && setModal(null)}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>{modal === 'nuevo' ? 'Nuevo horario' : 'Editar horario'}</h2>
              <button className={styles.modalClose} onClick={() => setModal(null)}>×</button>
            </div>
            <form onSubmit={handleGuardar} className={styles.modalForm}>
              {error && <div className={styles.errorBox}>{error}</div>}

              <div className={styles.field}>
                <label>Empleado</label>
                <select value={form.empleado_id} onChange={e => setForm(f => ({ ...f, empleado_id: e.target.value }))}>
                  <option value="">Todos los empleados (global)</option>
                  {empleados.map(e => <option key={e.id} value={e.id}>{e.nombre} {e.apellidos}</option>)}
                </select>
              </div>

              <div className={styles.field}>
                <label>Tipo de aplicación</label>
                <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value, dias_semana: [] }))}>
                  <option value="diario">Todos los días</option>
                  <option value="semanal">Días de la semana específicos</option>
                  <option value="rango">Rango de fechas</option>
                  <option value="fecha">Fecha concreta</option>
                </select>
              </div>

              {form.tipo === 'semanal' && (
                <div className={styles.field}>
                  <label>Días de la semana</label>
                  <div className={styles.diasGrid}>
                    {DIAS_VAL.map((d, i) => (
                      <button key={d} type="button"
                        className={`${styles.diaBtn} ${form.dias_semana.includes(d) ? styles.diaBtnOn : ''}`}
                        onClick={() => toggleDia(d)}>
                        {DIAS[i]}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {form.tipo === 'rango' && (
                <div className={styles.fieldRow}>
                  <div className={styles.field}>
                    <label>Desde *</label>
                    <input type="date" value={form.fecha_inicio} onChange={e => setForm(f => ({ ...f, fecha_inicio: e.target.value }))} />
                  </div>
                  <div className={styles.field}>
                    <label>Hasta (vacío = indefinido)</label>
                    <input type="date" value={form.fecha_fin} onChange={e => setForm(f => ({ ...f, fecha_fin: e.target.value }))} />
                  </div>
                </div>
              )}

              {form.tipo === 'fecha' && (
                <div className={styles.field}>
                  <label>Fecha concreta *</label>
                  <input type="date" value={form.fecha} onChange={e => setForm(f => ({ ...f, fecha: e.target.value }))} />
                </div>
              )}

              <div className={styles.fieldRow}>
                <div className={styles.field}>
                  <label>Hora de entrada *</label>
                  <input type="time" required value={form.hora_entrada} onChange={e => setForm(f => ({ ...f, hora_entrada: e.target.value }))} />
                </div>
                <div className={styles.field}>
                  <label>Hora de salida (opcional)</label>
                  <input type="time" value={form.hora_salida} onChange={e => setForm(f => ({ ...f, hora_salida: e.target.value }))} />
                </div>
              </div>

              <p className={styles.infoGracia}>
                Con el tiempo de gracia activo, los fichajes realizados dentro del margen configurado se redondearán automáticamente a estas horas.
              </p>

              <div className={styles.modalFooter}>
                <button type="button" className={styles.btnCancelar} onClick={() => setModal(null)}>Cancelar</button>
                <button type="submit" className={styles.btnGuardar} disabled={guardando}>
                  {guardando ? 'Guardando...' : 'Guardar horario'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
