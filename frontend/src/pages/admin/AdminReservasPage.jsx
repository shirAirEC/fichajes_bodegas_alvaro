import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import styles from './AdminReservasPage.module.css';

const ESTADOS = [
  { value: 'sin_confirmar', label: 'Sin confirmar' },
  { value: 'pendiente',     label: 'Pendiente' },
  { value: 'confirmado',    label: 'Confirmado' },
  { value: 'cancelado',     label: 'Cancelado' },
];

const TIPOS_SERVICIO_SUGERIDOS = [
  'Normal', 'Degustación pincho', 'Taller mojo', 'Menú especial', 'Buffet', 'Cóctel',
];

const NECESIDADES_SUGERIDAS = [
  'Vegetariana', 'Vegana', 'Celíaca', 'Sin lactosa', 'Sin gluten', 'Alergia frutos secos',
  'Alergia marisco', 'Halal', 'Kosher',
];

const RESERVA_VACIA = {
  fecha: '', hora: '', nombre: '', pax: '',
  tipo_servicio: '', estado: 'sin_confirmar', notas: '', guia: '',
  menu: [],
  necesidades_especiales: [],
  orden: 0,
};

function formatHora(hora) {
  if (!hora) return '';
  return hora.slice(0, 5);
}

function formatFechaHeader(fechaStr) {
  const [y, m, d] = fechaStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function getLunesDeHoy() {
  const hoy = new Date();
  const dia = hoy.getDay();
  const diff = dia === 0 ? -6 : 1 - dia;
  hoy.setDate(hoy.getDate() + diff);
  return hoy.toISOString().split('T')[0];
}

// ─── Subcomponente: editor de menú dinámico ─────────────────────────────────
function MenuEditor({ menu = [], onChange }) {
  const addCategoria = () => onChange([...menu, { categoria: '', platos: [''] }]);

  const removeCategoria = (ci) => onChange(menu.filter((_, i) => i !== ci));

  const updateCategoria = (ci, val) =>
    onChange(menu.map((c, i) => i === ci ? { ...c, categoria: val } : c));

  const addPlato = (ci) =>
    onChange(menu.map((c, i) => i === ci ? { ...c, platos: [...c.platos, ''] } : c));

  const removePlato = (ci, pi) =>
    onChange(menu.map((c, i) => i === ci ? { ...c, platos: c.platos.filter((_, j) => j !== pi) } : c));

  const updatePlato = (ci, pi, val) =>
    onChange(menu.map((c, i) => i === ci
      ? { ...c, platos: c.platos.map((p, j) => j === pi ? val : p) }
      : c));

  const moveCategoria = (ci, dir) => {
    const arr = [...menu];
    const target = ci + dir;
    if (target < 0 || target >= arr.length) return;
    [arr[ci], arr[target]] = [arr[target], arr[ci]];
    onChange(arr);
  };

  return (
    <div className={styles.menuEditor}>
      {menu.map((cat, ci) => (
        <div key={ci} className={styles.menuCategoria}>
          <div className={styles.menuCatHeader}>
            <input
              className={styles.inputCategoria}
              placeholder="Nombre de la categoría (ej: Entrantes, Postres...)"
              value={cat.categoria}
              onChange={e => updateCategoria(ci, e.target.value)}
            />
            <div className={styles.menuCatActions}>
              <button type="button" className={styles.btnMover} onClick={() => moveCategoria(ci, -1)} title="Subir" disabled={ci === 0}>↑</button>
              <button type="button" className={styles.btnMover} onClick={() => moveCategoria(ci, 1)} title="Bajar" disabled={ci === menu.length - 1}>↓</button>
              <button type="button" className={styles.btnQuitarCat} onClick={() => removeCategoria(ci)} title="Eliminar categoría">✕</button>
            </div>
          </div>
          <div className={styles.menuPlatos}>
            {cat.platos.map((plato, pi) => (
              <div key={pi} className={styles.menuPlatoRow}>
                <span className={styles.platoBullet}>•</span>
                <input
                  className={styles.inputPlato}
                  placeholder="Descripción del plato..."
                  value={plato}
                  onChange={e => updatePlato(ci, pi, e.target.value)}
                />
                <button
                  type="button"
                  className={styles.btnQuitarPlato}
                  onClick={() => removePlato(ci, pi)}
                  disabled={cat.platos.length === 1}
                  title="Eliminar plato"
                >✕</button>
              </div>
            ))}
            <button type="button" className={styles.btnAddPlato} onClick={() => addPlato(ci)}>
              + Añadir plato
            </button>
          </div>
        </div>
      ))}
      <button type="button" className={styles.btnAddCategoria} onClick={addCategoria}>
        + Añadir categoría (Entrantes, Principales, Postres...)
      </button>
    </div>
  );
}

// ─── Subcomponente: necesidades especiales ───────────────────────────────────
function NecesidadesEditor({ necesidades = [], onChange }) {
  const add = () => onChange([...necesidades, { tipo: '', cantidad: 1 }]);
  const remove = (i) => onChange(necesidades.filter((_, j) => j !== i));
  const update = (i, campo, val) =>
    onChange(necesidades.map((n, j) => j === i ? { ...n, [campo]: val } : n));

  return (
    <div className={styles.necesidadesEditor}>
      {necesidades.map((n, i) => (
        <div key={i} className={styles.necesidadRow}>
          <input
            type="number"
            min="1"
            className={styles.inputCantidad}
            value={n.cantidad}
            onChange={e => update(i, 'cantidad', Number(e.target.value) || 1)}
          />
          <input
            className={styles.inputNecesidad}
            list="necesidades-list"
            placeholder="Tipo (ej: vegetariana, celiaca...)"
            value={n.tipo}
            onChange={e => update(i, 'tipo', e.target.value)}
          />
          <datalist id="necesidades-list">
            {NECESIDADES_SUGERIDAS.map(s => <option key={s} value={s} />)}
          </datalist>
          <button type="button" className={styles.btnQuitarNecesidad} onClick={() => remove(i)} title="Eliminar">✕</button>
        </div>
      ))}
      <button type="button" className={styles.btnAddNecesidad} onClick={add}>
        + Añadir necesidad alimenticia
      </button>
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function AdminReservasPage() {
  const { authFetch } = useAuth();
  const [desde, setDesde] = useState(getLunesDeHoy());
  const [reservas, setReservas] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [modal, setModal] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [errorModal, setErrorModal] = useState('');
  const [tvToken, setTvToken] = useState('');
  const [expandida, setExpandida] = useState(null);

  const hasta = addDays(desde, 6);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await authFetch(`/api/reservas?desde=${desde}&hasta=${hasta}`);
      const data = await res.json();
      setReservas(Array.isArray(data) ? data : []);
    } finally {
      setCargando(false);
    }
  }, [authFetch, desde, hasta]);

  useEffect(() => { cargar(); }, [cargar]);

  useEffect(() => {
    authFetch('/api/config').then(r => r.json()).then(data => {
      if (data.tv_token) setTvToken(data.tv_token);
    }).catch(() => {});
  }, [authFetch]);

  const semanaAnterior = () => setDesde(d => addDays(d, -7));
  const semanaSiguiente = () => setDesde(d => addDays(d, 7));
  const irHoy = () => setDesde(getLunesDeHoy());

  const abrirNuevo = (fechaPre = '') => {
    setErrorModal('');
    setModal({ modo: 'nuevo', datos: { ...RESERVA_VACIA, fecha: fechaPre || desde } });
  };

  const abrirEditar = (r) => {
    setErrorModal('');
    setModal({
      modo: 'editar',
      datos: {
        id: r.id,
        fecha: r.fecha,
        hora: r.hora ? r.hora.slice(0, 5) : '',
        nombre: r.nombre,
        pax: r.pax ?? '',
        tipo_servicio: r.tipo_servicio || '',
        estado: r.estado,
        notas: r.notas || '',
        guia: r.guia || '',
        menu: Array.isArray(r.menu) ? r.menu : [],
        necesidades_especiales: Array.isArray(r.necesidades_especiales) ? r.necesidades_especiales : [],
        orden: r.orden ?? 0,
      },
    });
  };

  const cerrarModal = () => setModal(null);

  const handleChange = (campo, valor) =>
    setModal(m => ({ ...m, datos: { ...m.datos, [campo]: valor } }));

  const handleGuardar = async () => {
    const { datos, modo } = modal;
    if (!datos.fecha || !datos.nombre.trim()) {
      setErrorModal('La fecha y el nombre son obligatorios.');
      return;
    }
    setGuardando(true);
    setErrorModal('');
    try {
      const menuLimpio = datos.menu
        .filter(c => c.categoria.trim() || c.platos.some(p => p.trim()))
        .map(c => ({
          categoria: c.categoria.trim() || 'Sin nombre',
          platos: c.platos.filter(p => p.trim()).map(p => p.trim()),
        }));

      const necesidadesLimpias = datos.necesidades_especiales
        .filter(n => n.tipo.trim())
        .map(n => ({ tipo: n.tipo.trim(), cantidad: Number(n.cantidad) || 1 }));

      const body = {
        fecha: datos.fecha,
        hora: datos.hora || null,
        nombre: datos.nombre.trim(),
        pax: datos.pax !== '' ? datos.pax.trim() : null,
        tipo_servicio: datos.tipo_servicio,
        estado: datos.estado,
        notas: datos.notas,
        guia: datos.guia || '',
        menu: menuLimpio,
        necesidades_especiales: necesidadesLimpias,
        orden: Number(datos.orden) || 0,
      };
      const res = await authFetch(
        modo === 'editar' ? `/api/reservas/${datos.id}` : '/api/reservas',
        { method: modo === 'editar' ? 'PUT' : 'POST', body: JSON.stringify(body) }
      );
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Error al guardar');
      }
      await cargar();
      cerrarModal();
    } catch (err) {
      setErrorModal(err.message);
    } finally {
      setGuardando(false);
    }
  };

  const handleEliminar = async (id, e) => {
    e.stopPropagation();
    if (!confirm('¿Eliminar esta reserva?')) return;
    await authFetch(`/api/reservas/${id}`, { method: 'DELETE' });
    await cargar();
  };

  const tvUrl = tvToken ? `${window.location.origin}/tv?token=${tvToken}` : '';
  const diasSemana = Array.from({ length: 7 }, (_, i) => addDays(desde, i));

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.titulo}>Planificación de reservas</h1>
        {tvUrl && (
          <div className={styles.tvLink}>
            <span className={styles.tvLabel}>Pantalla TV:</span>
            <a href={tvUrl} target="_blank" rel="noreferrer" className={styles.tvUrl}>{tvUrl}</a>
            <button className={styles.btnCopiar} onClick={() => navigator.clipboard.writeText(tvUrl)} title="Copiar enlace">📋</button>
          </div>
        )}
      </div>

      <div className={styles.semanaNav}>
        <button className={styles.btnNav} onClick={semanaAnterior}>← Semana anterior</button>
        <div className={styles.semanaInfo}>
          <span className={styles.semanaRango}>
            {new Date(desde + 'T00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}
            {' — '}
            {new Date(hasta + 'T00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
          <button className={styles.btnHoy} onClick={irHoy}>Esta semana</button>
        </div>
        <button className={styles.btnNav} onClick={semanaSiguiente}>Semana siguiente →</button>
      </div>

      <div className={styles.btnNuevaWrapper}>
        <button className={styles.btnNueva} onClick={() => abrirNuevo()}>+ Nueva reserva</button>
      </div>

      {cargando && <div className={styles.cargando}>Cargando...</div>}

      <div className={styles.semana}>
        {diasSemana.map(dia => {
          const filas = reservas.filter(r => r.fecha === dia);
          return (
            <div key={dia} className={styles.diaCol}>
              <div className={styles.diaHeader}>
                <span className={styles.diaNombre}>{formatFechaHeader(dia)}</span>
                <button className={styles.btnAddDia} onClick={() => abrirNuevo(dia)} title="Añadir reserva">+</button>
              </div>
              <div className={styles.diaReservas}>
                {filas.length === 0 && <div className={styles.vacio}>Sin reservas</div>}
                {filas.map(r => {
                  const tieneMenu = Array.isArray(r.menu) && r.menu.length > 0;
                  const necesidades = Array.isArray(r.necesidades_especiales) ? r.necesidades_especiales : [];
                  const isOpen = expandida === r.id;
                  return (
                    <div key={r.id} className={`${styles.tarjeta} ${styles['e_' + r.estado]}`}>
                      <div className={styles.tarjetaClick} onClick={() => abrirEditar(r)}>
                        <div className={styles.tarjetaTop}>
                          <span className={styles.tarjetaHora}>{formatHora(r.hora) || '—'}</span>
                          <span className={`${styles.badge} ${styles['b_' + r.estado]}`}>
                            {ESTADOS.find(e => e.value === r.estado)?.label}
                          </span>
                        </div>
                        <div className={styles.tarjetaNombre}>
                          {r.nombre}
                          {r.guia && <span className={styles.tarjetaGuia}> · {r.guia}</span>}
                        </div>
                        <div className={styles.tarjetaMeta}>
                          {r.pax && <span className={styles.tarjetaPax}>{r.pax} pax</span>}
                          {r.tipo_servicio && (
                            <span className={styles.tarjetaTipo}>{r.tipo_servicio}</span>
                          )}
                        </div>
                        {necesidades.length > 0 && (
                          <div className={styles.necesidadesPills}>
                            {necesidades.map((n, i) => (
                              <span key={i} className={styles.necesidadPill}>
                                {n.cantidad}× {n.tipo}
                              </span>
                            ))}
                          </div>
                        )}
                        {r.notas && <div className={styles.tarjetaNotas}>{r.notas}</div>}
                      </div>

                      {tieneMenu && (
                        <>
                          <button
                            className={styles.btnToggleMenu}
                            onClick={e => { e.stopPropagation(); setExpandida(isOpen ? null : r.id); }}
                          >
                            🍽 {isOpen ? 'Ocultar menú' : 'Ver menú'}
                          </button>
                          {isOpen && (
                            <div className={styles.menuDetalle}>
                              {r.menu.map((cat, ci) => (
                                <div key={ci} className={styles.menuCatVer}>
                                  <strong>{cat.categoria}</strong>
                                  <ul>
                                    {cat.platos.map((p, pi) => <li key={pi}>{p}</li>)}
                                  </ul>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}

                      <button className={styles.btnEliminar} onClick={e => handleEliminar(r.id, e)} title="Eliminar">✕</button>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal */}
      {modal && (
        <div className={styles.overlay} onClick={cerrarModal}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>{modal.modo === 'nuevo' ? 'Nueva reserva' : 'Editar reserva'}</h2>
              <button className={styles.btnCerrarModal} onClick={cerrarModal}>✕</button>
            </div>

            {errorModal && <div className={styles.errorBox}>{errorModal}</div>}

            <div className={styles.modalBody}>
              {/* Fecha y hora */}
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label>Fecha *</label>
                  <input type="date" value={modal.datos.fecha} onChange={e => handleChange('fecha', e.target.value)} />
                </div>
                <div className={styles.field}>
                  <label>Hora</label>
                  <input type="time" value={modal.datos.hora} onChange={e => handleChange('hora', e.target.value)} />
                </div>
              </div>

              {/* Nombre y guía */}
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label>Nombre / Grupo *</label>
                  <input
                    type="text"
                    placeholder="Ej: M.Schiff, Privado Anca, T.T.Azura..."
                    value={modal.datos.nombre}
                    onChange={e => handleChange('nombre', e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label>Nombre del guía</label>
                  <input
                    type="text"
                    placeholder="Ej: Corina, Ana, Eberhardt..."
                    value={modal.datos.guia}
                    onChange={e => handleChange('guia', e.target.value)}
                  />
                </div>
              </div>

              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label>Número de personas (pax)</label>
                  <input
                    type="text"
                    placeholder="Ej: 22  ó  10/11  ó  10-15"
                    value={modal.datos.pax}
                    onChange={e => handleChange('pax', e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label>Tipo de servicio</label>
                  <input
                    list="tipos-servicio"
                    placeholder="Normal, Degustación pincho, Taller mojo..."
                    value={modal.datos.tipo_servicio}
                    onChange={e => handleChange('tipo_servicio', e.target.value)}
                  />
                  <datalist id="tipos-servicio">
                    {TIPOS_SERVICIO_SUGERIDOS.map(t => <option key={t} value={t} />)}
                  </datalist>
                </div>
              </div>

              {/* Necesidades alimenticias — junto al pax */}
              <div className={styles.field}>
                <label>Necesidades alimenticias (cantidad × tipo)</label>
                <span className={styles.fieldHint}>Indica cuántas personas de las anteriores tienen cada restricción.</span>
                <NecesidadesEditor
                  necesidades={modal.datos.necesidades_especiales}
                  onChange={val => handleChange('necesidades_especiales', val)}
                />
              </div>

              {/* Estado */}
              <div className={styles.field}>
                <label>Estado</label>
                <select value={modal.datos.estado} onChange={e => handleChange('estado', e.target.value)}>
                  {ESTADOS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
                </select>
              </div>

              {/* Notas */}
              <div className={styles.field}>
                <label>Notas / Observaciones</label>
                <textarea
                  rows={2}
                  placeholder="Ej: llegada en bus, mesa exterior, confirmar el jueves..."
                  value={modal.datos.notas}
                  onChange={e => handleChange('notas', e.target.value)}
                />
              </div>

              {/* Menú dinámico */}
              <div className={styles.field}>
                <label>Menú del día</label>
                <span className={styles.fieldHint}>Añade categorías (Entrantes, Principales, Postres, Bebidas...) y los platos de cada una.</span>
                <MenuEditor
                  menu={modal.datos.menu}
                  onChange={val => handleChange('menu', val)}
                />
              </div>

              <div className={styles.field} style={{ maxWidth: 160 }}>
                <label>Orden (posición en el día)</label>
                <input
                  type="number" min="0"
                  value={modal.datos.orden}
                  onChange={e => handleChange('orden', e.target.value)}
                />
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button className={styles.btnCancelar} onClick={cerrarModal} disabled={guardando}>Cancelar</button>
              <button className={styles.btnGuardar} onClick={handleGuardar} disabled={guardando}>
                {guardando ? 'Guardando...' : modal.modo === 'nuevo' ? 'Crear reserva' : 'Guardar cambios'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
