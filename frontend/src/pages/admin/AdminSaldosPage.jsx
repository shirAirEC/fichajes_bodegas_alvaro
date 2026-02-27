import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import styles from './AdminSaldosPage.module.css';

const TIPOS = {
  vacaciones: { label: 'Vacaciones', unidad: 'días', color: '#2980b9' },
  horas_extra: { label: 'Horas extra', unidad: 'horas', color: '#8B2635' },
  permiso_especial: { label: 'Permiso especial', unidad: 'días', color: '#8e44ad' },
  baja_medica: { label: 'Baja médica', unidad: 'días', color: '#e67e22' }
};

const FORM_VACIO = { empleado_id: '', tipo: 'vacaciones', cantidad: '', concepto: '', fecha_referencia: '' };

function formatFecha(ts) {
  return new Date(ts).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function AdminSaldosPage() {
  const { authFetch } = useAuth();
  const [vista, setVista] = useState('resumen'); // 'resumen' | 'empleado'
  const [resumenTodos, setResumenTodos] = useState([]);
  const [empleadoSeleccionado, setEmpleadoSeleccionado] = useState(null);
  const [detalleEmpleado, setDetalleEmpleado] = useState(null);
  const [empleados, setEmpleados] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(FORM_VACIO);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargarResumen = useCallback(async () => {
    setCargando(true);
    const [r1, r2] = await Promise.all([
      authFetch('/api/saldos/resumen-todos').then(r => r.json()),
      authFetch('/api/empleados').then(r => r.json())
    ]);
    setResumenTodos(r1);
    setEmpleados(r2.filter(e => e.activo));
    setCargando(false);
  }, [authFetch]);

  useEffect(() => { cargarResumen(); }, [cargarResumen]);

  const verDetalle = async (empId) => {
    const emp = empleados.find(e => e.id === empId) || resumenTodos.find(e => e.id === empId);
    setEmpleadoSeleccionado(emp);
    const data = await authFetch(`/api/saldos/empleado/${empId}`).then(r => r.json());
    setDetalleEmpleado(data);
    setVista('empleado');
  };

  const abrirNuevo = (empleadoId = '') => {
    setForm({ ...FORM_VACIO, empleado_id: String(empleadoId) });
    setError('');
    setModalOpen(true);
  };

  const handleGuardar = async (e) => {
    e.preventDefault();
    setError('');
    setGuardando(true);
    try {
      const body = {
        ...form,
        empleado_id: parseInt(form.empleado_id),
        cantidad: parseFloat(form.cantidad)
      };
      const res = await authFetch('/api/saldos', { method: 'POST', body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setModalOpen(false);
      cargarResumen();
      if (vista === 'empleado' && empleadoSeleccionado) {
        verDetalle(empleadoSeleccionado.id);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  const handleEliminar = async (id) => {
    if (!confirm('¿Eliminar este movimiento de saldo?')) return;
    await authFetch(`/api/saldos/${id}`, { method: 'DELETE' });
    cargarResumen();
    if (vista === 'empleado' && empleadoSeleccionado) {
      verDetalle(empleadoSeleccionado.id);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <div className={styles.titleGroup}>
          {vista === 'empleado' && (
            <button className={styles.btnVolver} onClick={() => setVista('resumen')}>
              ← Volver
            </button>
          )}
          <h1 className={styles.title}>
            {vista === 'resumen'
              ? 'Gestión de Saldos'
              : `Saldos: ${empleadoSeleccionado?.nombre} ${empleadoSeleccionado?.apellidos}`
            }
          </h1>
        </div>
        <button className={styles.btnNuevo} onClick={() => abrirNuevo(empleadoSeleccionado?.id)}>
          + Añadir movimiento
        </button>
      </div>

      {cargando ? (
        <div className={styles.loading}>Cargando...</div>
      ) : vista === 'resumen' ? (
        <VistaResumen
          empleados={resumenTodos}
          onVerDetalle={id => verDetalle(id)}
          onNuevo={id => abrirNuevo(id)}
        />
      ) : (
        <VistaDetalle
          detalle={detalleEmpleado}
          onEliminar={handleEliminar}
          onNuevo={() => abrirNuevo(empleadoSeleccionado?.id)}
        />
      )}

      {modalOpen && (
        <div className={styles.overlay} onClick={e => e.target === e.currentTarget && setModalOpen(false)}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>Nuevo movimiento de saldo</h2>
              <button className={styles.modalClose} onClick={() => setModalOpen(false)}>×</button>
            </div>
            <form onSubmit={handleGuardar} className={styles.modalForm}>
              {error && <div className={styles.error}>{error}</div>}
              <div className={styles.field}>
                <label>Empleado *</label>
                <select required value={form.empleado_id} onChange={e => setForm(f => ({ ...f, empleado_id: e.target.value }))}>
                  <option value="">— Selecciona —</option>
                  {empleados.map(e => (
                    <option key={e.id} value={e.id}>{e.nombre} {e.apellidos}</option>
                  ))}
                </select>
              </div>
              <div className={styles.formRow}>
                <div className={styles.field}>
                  <label>Tipo *</label>
                  <select value={form.tipo} onChange={e => setForm(f => ({ ...f, tipo: e.target.value }))}>
                    {Object.entries(TIPOS).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label>Cantidad * <span className={styles.hint}>(negativo = descontar)</span></label>
                  <input
                    type="number"
                    step="0.5"
                    required
                    value={form.cantidad}
                    onChange={e => setForm(f => ({ ...f, cantidad: e.target.value }))}
                    placeholder="Ej: 5 o -2"
                  />
                </div>
              </div>
              <div className={styles.field}>
                <label>Concepto / Descripción *</label>
                <input
                  required
                  value={form.concepto}
                  onChange={e => setForm(f => ({ ...f, concepto: e.target.value }))}
                  placeholder="Ej: Vacaciones verano 2025, Horas extra semana 12..."
                />
              </div>
              <div className={styles.field}>
                <label>Fecha de referencia (opcional)</label>
                <input
                  type="date"
                  value={form.fecha_referencia}
                  onChange={e => setForm(f => ({ ...f, fecha_referencia: e.target.value }))}
                />
              </div>
              <div className={styles.modalFooter}>
                <button type="button" className={styles.btnCancelar} onClick={() => setModalOpen(false)}>Cancelar</button>
                <button type="submit" className={styles.btnGuardar} disabled={guardando}>
                  {guardando ? 'Guardando...' : 'Guardar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function VistaResumen({ empleados, onVerDetalle, onNuevo }) {
  return (
    <div className={styles.tabla}>
      <div className={styles.tablaHeader}>
        <span>Empleado</span>
        <span>Vacaciones</span>
        <span>Horas extra</span>
        <span>Permisos</span>
        <span>Baja médica</span>
        <span></span>
      </div>
      {empleados.length === 0 && <div className={styles.empty}>No hay empleados activos.</div>}
      {empleados.map(emp => (
        <div key={emp.id} className={styles.tablaRow}>
          <span className={styles.empNombre}>
            <span className={styles.empAvatar}>{emp.nombre[0]}{emp.apellidos[0]}</span>
            <span>
              <span className={styles.nombre}>{emp.nombre} {emp.apellidos}</span>
              <span className={styles.dept}>{emp.departamento || ''}</span>
            </span>
          </span>
          <span className={`${styles.saldoCell} ${emp.resumen?.vacaciones < 0 ? styles.negativo : ''}`}>
            {emp.resumen?.vacaciones ?? 0} días
          </span>
          <span className={`${styles.saldoCell} ${emp.resumen?.horas_extra < 0 ? styles.negativo : ''}`}>
            {emp.resumen?.horas_extra ?? 0} h
          </span>
          <span className={`${styles.saldoCell} ${emp.resumen?.permiso_especial < 0 ? styles.negativo : ''}`}>
            {emp.resumen?.permiso_especial ?? 0} días
          </span>
          <span className={`${styles.saldoCell} ${emp.resumen?.baja_medica < 0 ? styles.negativo : ''}`}>
            {emp.resumen?.baja_medica ?? 0} días
          </span>
          <span className={styles.acciones}>
            <button className={styles.btnVer} onClick={() => onVerDetalle(emp.id)}>Ver detalle</button>
            <button className={styles.btnAdd} onClick={() => onNuevo(emp.id)} title="Añadir">+</button>
          </span>
        </div>
      ))}
    </div>
  );
}

function VistaDetalle({ detalle, onEliminar }) {
  if (!detalle) return <div className={styles.loading}>Cargando...</div>;
  const { resumen, movimientos } = detalle;

  return (
    <div>
      <div className={styles.resumenMini}>
        {Object.entries(TIPOS).map(([tipo, info]) => (
          <div key={tipo} className={styles.resumenItem} style={{ borderLeftColor: info.color }}>
            <span className={styles.resumenVal} style={{ color: (resumen?.[tipo] ?? 0) < 0 ? '#c0392b' : info.color }}>
              {(resumen?.[tipo] ?? 0).toFixed(1)}
            </span>
            <span className={styles.resumenLabel}>{info.label} ({info.unidad})</span>
          </div>
        ))}
      </div>

      <div className={styles.historialCard}>
        <h3 className={styles.subtitulo}>Historial de movimientos</h3>
        {movimientos.length === 0 ? (
          <div className={styles.empty}>Sin movimientos.</div>
        ) : movimientos.map(m => {
          const info = TIPOS[m.tipo];
          return (
            <div key={m.id} className={styles.movRow}>
              <span className={styles.movTipoBadge} style={{ background: info.color + '18', color: info.color }}>
                {info.label}
              </span>
              <span className={styles.movConcepto}>{m.concepto}</span>
              <span className={styles.movFecha}>{formatFecha(m.created_at)}</span>
              <span className={`${styles.movCant} ${m.cantidad >= 0 ? styles.positivo : styles.negativo}`}>
                {m.cantidad >= 0 ? '+' : ''}{m.cantidad} {info.unidad}
              </span>
              <button className={styles.btnEliminar} onClick={() => onEliminar(m.id)} title="Eliminar">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14H6L5,6"/>
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
