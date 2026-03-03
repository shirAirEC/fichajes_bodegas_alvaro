import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import styles from './AdminEmpleadosPage.module.css';

const MODAL_VACIO = { nombre: '', apellidos: '', email: '', password: '', rol: 'empleado', departamento: '' };

export default function AdminEmpleadosPage() {
  const { authFetch, user } = useAuth();
  const [empleados, setEmpleados] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editando, setEditando] = useState(null);
  const [form, setForm] = useState(MODAL_VACIO);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    const res = await authFetch('/api/empleados');
    const data = await res.json();
    setEmpleados(data);
    setCargando(false);
  }, [authFetch]);

  useEffect(() => { cargar(); }, [cargar]);

  const abrirCrear = () => {
    setEditando(null);
    setForm(MODAL_VACIO);
    setError('');
    setModalOpen(true);
  };

  const abrirEditar = (emp) => {
    setEditando(emp);
    setForm({ ...emp, password: '' });
    setError('');
    setModalOpen(true);
  };

  const handleGuardar = async (e) => {
    e.preventDefault();
    setError('');
    setGuardando(true);
    try {
      const body = { ...form };
      if (!body.password) delete body.password;
      const url = editando ? `/api/empleados/${editando.id}` : '/api/empleados';
      const method = editando ? 'PUT' : 'POST';
      const res = await authFetch(url, { method, body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setModalOpen(false);
      cargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  };

  const handleDesactivar = async (emp) => {
    if (!confirm(`¿${emp.activo ? 'Desactivar' : 'Activar'} a ${emp.nombre} ${emp.apellidos}?`)) return;
    await authFetch(`/api/empleados/${emp.id}`, {
      method: 'PUT',
      body: JSON.stringify({ activo: emp.activo ? 0 : 1 })
    });
    cargar();
  };

  const activos = empleados.filter(e => e.activo);
  const inactivos = empleados.filter(e => !e.activo);

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <h1 className={styles.title}>Gestión de Empleados</h1>
        <button className={styles.btnNuevo} onClick={abrirCrear}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Nuevo empleado
        </button>
      </div>

      {cargando ? <div className={styles.loading}>Cargando...</div> : (
        <>
          <h2 className={styles.subtitulo}>Empleados activos ({activos.length})</h2>
          <div className={styles.grid}>
            {activos.map(emp => (
              <EmpleadoCard
                key={emp.id}
                emp={emp}
                esMismo={emp.id === user?.id}
                onEditar={() => abrirEditar(emp)}
                onToggle={() => handleDesactivar(emp)}
              />
            ))}
          </div>

          {inactivos.length > 0 && (
            <>
              <h2 className={`${styles.subtitulo} ${styles.inactivos}`}>Empleados inactivos ({inactivos.length})</h2>
              <div className={styles.grid}>
                {inactivos.map(emp => (
                  <EmpleadoCard
                    key={emp.id}
                    emp={emp}
                    esMismo={false}
                    inactivo
                    onEditar={() => abrirEditar(emp)}
                    onToggle={() => handleDesactivar(emp)}
                  />
                ))}
              </div>
            </>
          )}
        </>
      )}

      {modalOpen && (
        <div className={styles.overlay} onClick={e => e.target === e.currentTarget && setModalOpen(false)}>
          <div className={styles.modal}>
            <div className={styles.modalHeader}>
              <h2>{editando ? 'Editar empleado' : 'Nuevo empleado'}</h2>
              <button className={styles.modalClose} onClick={() => setModalOpen(false)}>×</button>
            </div>
            <form onSubmit={handleGuardar} className={styles.modalForm}>
              {error && <div className={styles.error}>{error}</div>}
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label>Nombre *</label>
                  <input required value={form.nombre} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} />
                </div>
                <div className={styles.field}>
                  <label>Apellidos *</label>
                  <input required value={form.apellidos} onChange={e => setForm(f => ({ ...f, apellidos: e.target.value }))} />
                </div>
                <div className={styles.field}>
                  <label>Email *</label>
                  <input type="email" required value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
                <div className={styles.field}>
                  <label>{editando ? 'Nueva contraseña (dejar vacío para no cambiar)' : 'Contraseña *'}</label>
                  <input
                    type="password"
                    required={!editando}
                    minLength={6}
                    value={form.password}
                    onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                    placeholder={editando ? '••••••' : 'Mínimo 6 caracteres'}
                  />
                </div>
                <div className={styles.field}>
                  <label>Departamento</label>
                  <input value={form.departamento} onChange={e => setForm(f => ({ ...f, departamento: e.target.value }))} placeholder="Ej: Bodega, Administración..." />
                </div>
                <div className={styles.field}>
                  <label>Rol</label>
                  <select value={form.rol} onChange={e => setForm(f => ({ ...f, rol: e.target.value }))}>
                    <option value="empleado">Empleado</option>
                    <option value="admin">Administrador</option>
                  </select>
                </div>
              </div>
              {form.rol === 'empleado' && (
                <div className={styles.exencionRow}>
                  <div>
                    <span className={styles.exencionLabel}>Exención de restricción por red WiFi</span>
                    <p className={styles.exencionDesc}>Permite a este empleado fichar desde cualquier red (teletrabajo, trabajo en exterior).</p>
                  </div>
                  <label className={styles.switchSmall}>
                    <input
                      type="checkbox"
                      checked={!!form.sin_restriccion_ip}
                      onChange={e => setForm(f => ({ ...f, sin_restriccion_ip: e.target.checked ? 1 : 0 }))}
                    />
                    <span className={styles.switchSliderSmall}></span>
                  </label>
                </div>
              )}
              <div className={styles.modalFooter}>
                <button type="button" className={styles.btnCancelar} onClick={() => setModalOpen(false)}>Cancelar</button>
                <button type="submit" className={styles.btnGuardar} disabled={guardando}>
                  {guardando ? 'Guardando...' : (editando ? 'Guardar cambios' : 'Crear empleado')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function EmpleadoCard({ emp, esMismo, inactivo, onEditar, onToggle }) {
  return (
    <div className={`${styles.card} ${inactivo ? styles.cardInactivo : ''}`}>
      <div className={styles.cardAvatar}>
        {emp.nombre[0]}{emp.apellidos[0]}
      </div>
      <div className={styles.cardInfo}>
        <span className={styles.cardNombre}>{emp.nombre} {emp.apellidos}</span>
        <span className={styles.cardEmail}>{emp.email}</span>
        <span className={styles.cardDept}>{emp.departamento || 'Sin departamento'}</span>
      </div>
      <div className={styles.cardBadges}>
        <span className={`${styles.rolBadge} ${emp.rol === 'admin' ? styles.rolAdmin : styles.rolEmp}`}>
          {emp.rol === 'admin' ? 'Admin' : 'Empleado'}
        </span>
        {emp.sin_restriccion_ip === 1 && (
          <span className={styles.exencionBadge} title="Exento de restricción WiFi">🌐 Teletrabajo</span>
        )}
      </div>
      <div className={styles.cardActions}>
        <button className={styles.btnEditar} onClick={onEditar} title="Editar">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        {!esMismo && (
          <button
            className={`${styles.btnToggle} ${inactivo ? styles.btnActivar : styles.btnDesactivar}`}
            onClick={onToggle}
            title={inactivo ? 'Activar' : 'Desactivar'}
          >
            {inactivo ? 'Activar' : 'Desactivar'}
          </button>
        )}
      </div>
    </div>
  );
}
