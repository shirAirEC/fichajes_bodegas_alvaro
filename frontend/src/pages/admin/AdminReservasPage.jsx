import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';
import styles from './AdminReservasPage.module.css';

const DIAS_SEMANA = [
  { value: 1, label: 'Lunes' },
  { value: 2, label: 'Martes' },
  { value: 3, label: 'Miércoles' },
  { value: 4, label: 'Jueves' },
  { value: 5, label: 'Viernes' },
  { value: 6, label: 'Sábado' },
  { value: 7, label: 'Domingo' },
];

const PLANTILLA_VACIA = {
  dia_semana: 1, hora: '', nombre: '', pax: '',
  tipo_servicio: '', guia: '',
  turoperador_odoo_id: '', bus_ref: '',
  menu: [], necesidades_especiales: [],
};

const ESTADOS = [
  { value: 'sin_confirmar', label: 'Sin confirmar' },
  { value: 'pendiente',     label: 'Pendiente' },
  { value: 'confirmado',    label: 'Confirmado' },
  { value: 'cancelado',     label: 'Cancelado' },
];

const ESTADO_LABELS = Object.fromEntries(ESTADOS.map(e => [e.value, e.label]));

/** CSV con el mismo esquema que el backend (separador `;`, UTF-8 BOM). */
function csvInformeDesdeJson(data) {
  const lineas = [
    ['Fecha', 'Hora', 'Grupo', 'Turoperadora', 'Pax', 'Pax confirmado', 'Tipo servicio', 'Bus/Guagua', 'Estado', 'Guía', 'Necesidades especiales', 'Notas'].join(';'),
  ];
  for (const r of data.reservas || []) {
    const nec = Array.isArray(r.necesidades_especiales)
      ? r.necesidades_especiales.map(n => `${n.cantidad}x ${n.tipo}`).join(', ')
      : '';
    lineas.push(
      [
        r.fecha,
        r.hora ? r.hora.slice(0, 5) : '',
        `"${(r.nombre || '').replace(/"/g, '""')}"`,
        `"${(r.turoperador_nombre || '').replace(/"/g, '""')}"`,
        r.pax || '',
        r.pax_confirmado ?? '',
        `"${(r.tipo_servicio || '').replace(/"/g, '""')}"`,
        `"${(r.bus_ref || '').replace(/"/g, '""')}"`,
        r.estado || '',
        `"${(r.guia || '').replace(/"/g, '""')}"`,
        `"${nec.replace(/"/g, '""')}"`,
        `"${(r.notas || '').replace(/"/g, '""')}"`,
      ].join(';')
    );
  }
  return '\uFEFF' + lineas.join('\n');
}

const SIN_TUROPERADORA = ''; // valor del <select>: particular / no factura a turoperadora

const NECESIDADES_SUGERIDAS = [
  'Vegetariana', 'Vegana', 'Celíaca', 'Sin lactosa', 'Sin gluten', 'Alergia frutos secos',
  'Alergia marisco', 'Halal', 'Kosher',
];

const RESERVA_VACIA = {
  fecha: '', hora: '', nombre: '', pax: '',
  tipo_servicio: '', estado: 'sin_confirmar', notas: '', guia: '',
  turoperador_odoo_id: SIN_TUROPERADORA, bus_ref: '', pax_confirmado: '',
  pax_ninos: '', servicio_ninos_odoo_id: '',
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

function dateToStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return dateToStr(date);
}

function getLunesDe(fechaStr) {
  const [y, m, d] = fechaStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const dia = date.getDay();
  const diff = dia === 0 ? -6 : 1 - dia;
  date.setDate(date.getDate() + diff);
  return dateToStr(date);
}

function getLunesDeHoy() {
  return getLunesDe(dateToStr(new Date()));
}

function parseDeepLinkReservas(searchParams) {
  const qs = typeof window !== 'undefined'
    ? new URLSearchParams(window.location.search)
    : searchParams;
  const fechaRaw = qs?.get('fecha');
  const reservaRaw = qs?.get('reserva_id');
  const fecha = fechaRaw && /^\d{4}-\d{2}-\d{2}$/.test(fechaRaw) ? fechaRaw : null;
  const reservaId = reservaRaw && /^\d+$/.test(String(reservaRaw)) ? Number(reservaRaw) : null;
  return {
    fecha,
    reservaId,
    desde: fecha ? getLunesDe(fecha) : getLunesDeHoy(),
    pendiente: Boolean(fecha || reservaId),
  };
}

// ─── Generación de PDF del informe de reservas ──────────────────────────────
async function generarInformeReservasPDF(data) {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const { savePdf } = await import('../../lib/savePdf');

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const pW = doc.internal.pageSize.getWidth();
  const pH = doc.internal.pageSize.getHeight();

  const PRIMARY   = [139, 38, 53];
  const GOLD      = [201, 169, 97];
  const CREAM     = [245, 241, 232];
  const BORDER    = [224, 216, 200];
  const TEXT      = [45, 45, 45];
  const TEXT_L    = [102, 102, 102];
  const WHITE     = [255, 255, 255];

  const mesLabel = (() => {
    const [y, m] = data.mes.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  })();

  let paginaNum = 1;

  const dibujarCabecera = () => {
    doc.setFillColor(...PRIMARY);
    doc.rect(0, 0, pW, 22, 'F');
    doc.setFillColor(...GOLD);
    doc.rect(0, 22, pW, 1.5, 'F');
    doc.setTextColor(...WHITE);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('BODEGAS ALVARO', 14, 10);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Informe de reservas — ${mesLabel}`, 14, 17);
    doc.text(`Pág. ${paginaNum}`, pW - 14, 14, { align: 'right' });
  };

  const dibujarPie = () => {
    doc.setDrawColor(...BORDER);
    doc.line(14, pH - 10, pW - 14, pH - 10);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_L);
    doc.text(
      `Bodegas Alvaro — Generado el ${new Date().toLocaleString('es-ES')}  —  ${mesLabel}`,
      14, pH - 5
    );
    doc.text(`${paginaNum}`, pW - 14, pH - 5, { align: 'right' });
  };

  dibujarCabecera();
  dibujarPie();

  // Bloque resumen
  let y = 28;
  doc.setFillColor(...CREAM);
  doc.setDrawColor(...BORDER);
  doc.roundedRect(14, y, pW - 28, 22, 1.5, 1.5, 'FD');

  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...PRIMARY);
  doc.text('Resumen del mes', 20, y + 6);

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...TEXT);
  const estadoTexto = Object.entries(data.porEstado || {})
    .map(([k, v]) => `${ESTADO_LABELS[k] || k}: ${v}`)
    .join('   ·   ');
  doc.text(`Total grupos: ${data.totalGrupos}     |     Total pax: ${data.totalPax}`, 20, y + 12);
  doc.text(estadoTexto, 20, y + 18);

  y += 28;

  // Resumen por tipo de servicio
  const tipoEntries = Object.entries(data.porTipo || {});
  if (tipoEntries.length > 0) {
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...PRIMARY);
    doc.text('Desglose por tipo de servicio', 14, y);
    y += 2;

    autoTable(doc, {
      startY: y,
      margin: { top: 28, left: 14, right: 14 },
      head: [['Tipo de servicio', 'Grupos', 'Pax']],
      body: tipoEntries.map(([tipo, d]) => [tipo, d.grupos, d.pax]),
      styles: { fontSize: 7.5, cellPadding: 2, lineColor: BORDER, lineWidth: 0.2 },
      headStyles: { fillColor: PRIMARY, textColor: WHITE, fontStyle: 'bold', fontSize: 7.5 },
      alternateRowStyles: { fillColor: [252, 249, 245] },
      columnStyles: { 1: { halign: 'center' }, 2: { halign: 'center' } },
      didDrawPage: () => { paginaNum++; dibujarCabecera(); dibujarPie(); },
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  // Resumen de necesidades alimenticias
  const necEntries = Object.entries(data.necesidades || {});
  if (necEntries.length > 0) {
    if (y > pH - 40) {
      doc.addPage(); paginaNum++; dibujarCabecera(); dibujarPie(); y = 28;
    }
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...PRIMARY);
    doc.text('Necesidades alimenticias (total del mes)', 14, y);
    y += 2;

    autoTable(doc, {
      startY: y,
      margin: { top: 28, left: 14, right: 14 },
      head: [['Necesidad', 'Total personas']],
      body: necEntries.map(([tipo, cnt]) => [tipo.charAt(0).toUpperCase() + tipo.slice(1), cnt]),
      styles: { fontSize: 7.5, cellPadding: 2, lineColor: BORDER, lineWidth: 0.2 },
      headStyles: { fillColor: PRIMARY, textColor: WHITE, fontStyle: 'bold', fontSize: 7.5 },
      alternateRowStyles: { fillColor: [252, 249, 245] },
      columnStyles: { 1: { halign: 'center' } },
      didDrawPage: () => { paginaNum++; dibujarCabecera(); dibujarPie(); },
    });
    y = doc.lastAutoTable.finalY + 8;
  }

  // Tabla detallada por día
  if (y > pH - 40) {
    doc.addPage(); paginaNum++; dibujarCabecera(); dibujarPie(); y = 28;
  }
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...PRIMARY);
  doc.text('Detalle de reservas', 14, y);
  y += 2;

  const tableBody = (data.reservas || []).map(r => {
    const nec = Array.isArray(r.necesidades_especiales)
      ? r.necesidades_especiales.map(n => `${n.cantidad}x ${n.tipo}`).join(', ')
      : '';
    const fechaLabel = (() => {
      const [yy, mm, dd] = r.fecha.split('-').map(Number);
      return new Date(yy, mm - 1, dd).toLocaleDateString('es-ES', {
        weekday: 'short', day: '2-digit', month: '2-digit',
      });
    })();
    return [
      fechaLabel,
      r.hora ? r.hora.slice(0, 5) : '—',
      r.nombre || '',
      r.turoperador_nombre || '',
      r.pax || '',
      r.tipo_servicio || '',
      ESTADO_LABELS[r.estado] || r.estado,
      r.guia || '',
      nec,
      r.notas || '',
    ];
  });

  autoTable(doc, {
    startY: y,
    margin: { top: 28, left: 14, right: 14 },
    head: [['Fecha', 'Hora', 'Grupo', 'Turoperadora', 'Pax', 'Tipo', 'Estado', 'Guía', 'Necesidades', 'Notas']],
    body: tableBody,
    styles: { fontSize: 6.5, cellPadding: 1.8, lineColor: BORDER, lineWidth: 0.2, overflow: 'linebreak' },
    headStyles: { fillColor: PRIMARY, textColor: WHITE, fontStyle: 'bold', fontSize: 7 },
    alternateRowStyles: { fillColor: [252, 249, 245] },
    columnStyles: {
      0: { cellWidth: 26 },
      1: { cellWidth: 14, halign: 'center' },
      4: { cellWidth: 12, halign: 'center' },
      6: { cellWidth: 20 },
    },
    didDrawPage: () => {
      paginaNum++;
      dibujarCabecera();
      dibujarPie();
    },
  });

  await savePdf(doc, `informe_reservas_${data.mes}.pdf`);
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

// ─── Panel de confirmaciones de cambios ──────────────────────────────────────
function PanelAvisos({ authFetch }) {
  const [avisos, setAvisos] = useState([]);
  const [expandir, setExpandir] = useState(false);
  const [limpiando, setLimpiando] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const res = await authFetch('/api/avisos/admin');
      const data = await res.json();
      setAvisos(Array.isArray(data) ? data.filter(a => a.activo) : []);
    } catch {}
  }, [authFetch]);

  useEffect(() => { cargar(); }, [cargar]);

  const limpiarTodo = async () => {
    if (!window.confirm('¿Eliminar TODOS los avisos y confirmaciones? Esta acción no se puede deshacer.')) return;
    setLimpiando(true);
    try {
      await authFetch('/api/avisos/limpiar', { method: 'DELETE' });
      setAvisos([]);
    } catch {
      alert('Error al limpiar avisos');
    } finally {
      setLimpiando(false);
    }
  };

  const pendientes = avisos.filter(a => (a.total_visto ?? 0) < (a.total_empleados ?? 1));

  return (
    <div className={styles.panelAvisos}>
      <div className={styles.panelAvisosHeader}>
        <button className={styles.btnAvisosToggle} onClick={() => setExpandir(v => !v)}>
          👁 Confirmaciones de cambios {pendientes.length > 0 && (
            <span className={styles.badgeAvisos}>{pendientes.length} pendiente{pendientes.length !== 1 ? 's' : ''}</span>
          )}
          <span className={styles.chevron}>{expandir ? '▲' : '▼'}</span>
        </button>
        {avisos.length > 0 && (
          <button className={styles.btnLimpiarAvisos} onClick={limpiarTodo} disabled={limpiando} title="Eliminar todos los avisos">
            {limpiando ? '...' : '🗑 Limpiar'}
          </button>
        )}
      </div>

      {expandir && (
        <div className={styles.avisosPanel}>
          {avisos.length === 0 && (
            <p className={styles.avisoVacio}>No hay avisos registrados.</p>
          )}
          {avisos.map(a => (
            <div key={a.id} className={styles.avisoItem}>
              <div className={styles.avisoItemHeader}>
                <span className={styles.avisoItemTitulo}>{a.mensaje}</span>
                <span className={styles.avisoVisto}>
                  {a.total_visto ?? 0}/{a.total_empleados ?? 0} confirmado
                </span>
              </div>
              {a.vistos && a.vistos.length > 0 && (
                <div className={styles.vistosPor}>
                  {a.vistos.map((v, i) => (
                    <span key={i} className={styles.vistoBadge}>✓ {v.nombre} {v.apellidos}</span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Componente principal ─────────────────────────────────────────────────────
export default function AdminReservasPage() {
  const { authFetch } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLink = useRef(null);
  if (deepLink.current === null) {
    deepLink.current = parseDeepLinkReservas(searchParams);
  }
  const [desde, setDesde] = useState(deepLink.current.desde);
  const [reservas, setReservas] = useState([]);
  const [cargando, setCargando] = useState(false);
  const [modal, setModal] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [errorModal, setErrorModal] = useState('');
  const [tvToken, setTvToken] = useState('');
  const [expandida, setExpandida] = useState(null);
  const [informeMes, setInformeMes] = useState(() => {
    const hoy = new Date();
    return `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
  });
  const [generandoPDF, setGenerandoPDF] = useState(false);
  const [generandoCSV, setGenerandoCSV] = useState(false);
  const [catalogo, setCatalogo] = useState({ turoperadoras: [], tiposServicio: [], tarifasNinos: [], stale: false, error: null });
  const [plantillas, setPlantillas] = useState([]);
  const [plantillasAbiertas, setPlantillasAbiertas] = useState(false);
  const [modalPlantilla, setModalPlantilla] = useState(null);
  const [errorPlantilla, setErrorPlantilla] = useState('');
  const [guardandoPlantilla, setGuardandoPlantilla] = useState(false);
  const [generandoPlantillas, setGenerandoPlantillas] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);
  const [confirmando, setConfirmando] = useState(false);
  const [reservaDestacada, setReservaDestacada] = useState(deepLink.current.reservaId);
  const reservaRefs = useRef({});
  const cargarGen = useRef(0);

  const hasta = addDays(desde, 6);

  // Catálogo de turoperadoras y tipos de servicio facturables (viene de Odoo,
  // ver FICHAJES_PLANIFICACION.md). Se carga una vez al entrar en la página;
  // si Odoo no responde se muestra con las últimas opciones conocidas.
  const cargarCatalogo = useCallback(async (forzar = false) => {
    try {
      const res = await authFetch(
        forzar ? '/api/config/catalogo-planificacion/refresh' : '/api/config/catalogo-planificacion',
        forzar ? { method: 'POST' } : undefined
      );
      const data = await res.json();
      setCatalogo({
        turoperadoras: Array.isArray(data.turoperadoras) ? data.turoperadoras : [],
        tiposServicio: Array.isArray(data.tiposServicio) ? data.tiposServicio : [],
        tarifasNinos: Array.isArray(data.tarifasNinos) ? data.tarifasNinos : [],
        stale: Boolean(data.stale),
        error: data.error || null,
      });
    } catch {
      setCatalogo(c => ({ ...c, error: 'No se pudo cargar el catálogo de Odoo' }));
    }
  }, [authFetch]);

  useEffect(() => { cargarCatalogo(); }, [cargarCatalogo]);

  const cargarPlantillas = useCallback(async () => {
    try {
      const res = await authFetch('/api/reserva-plantillas');
      const data = await res.json();
      setPlantillas(Array.isArray(data) ? data : []);
    } catch {
      setPlantillas([]);
    }
  }, [authFetch]);

  useEffect(() => { cargarPlantillas(); }, [cargarPlantillas]);

  const cargar = useCallback(async (opts = {}) => {
    const { signal } = opts;
    const seq = ++cargarGen.current;
    setCargando(true);
    try {
      const res = await authFetch(
        `/api/reservas?desde=${desde}&hasta=${hasta}`,
        signal ? { signal } : undefined
      );
      const data = await res.json();
      if (signal?.aborted || seq !== cargarGen.current) return;
      setReservas(Array.isArray(data) ? data : []);
      const dl = deepLink.current;
      if (dl?.pendiente && !dl.limpiado) {
        const semanaOk = !dl.fecha || getLunesDe(dl.fecha) === desde;
        if (semanaOk) {
          dl.limpiado = true;
          setSearchParams({}, { replace: true });
        }
      }
    } catch (err) {
      if (err?.name === 'AbortError' || signal?.aborted || seq !== cargarGen.current) return;
      throw err;
    } finally {
      if (!signal?.aborted && seq === cargarGen.current) setCargando(false);
    }
  }, [authFetch, desde, hasta, setSearchParams]);

  useEffect(() => {
    const ac = new AbortController();
    cargar({ signal: ac.signal }).catch((err) => {
      if (err?.name === 'AbortError') return;
    });
    return () => ac.abort();
  }, [cargar]);

  useEffect(() => {
    if (!reservaDestacada || cargando) return;
    const el = reservaRefs.current[reservaDestacada];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const timer = setTimeout(() => setReservaDestacada(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [reservaDestacada, cargando, reservas]);

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
        plantilla_id: r.plantilla_id || null,
        fecha: r.fecha,
        hora: r.hora ? r.hora.slice(0, 5) : '',
        nombre: r.nombre,
        pax: r.pax ?? '',
        tipo_servicio: r.tipo_servicio || '',
        estado: r.estado,
        notas: r.notas || '',
        guia: r.guia || '',
        turoperador_odoo_id: r.turoperador_odoo_id != null ? String(r.turoperador_odoo_id) : SIN_TUROPERADORA,
        bus_ref: r.bus_ref || '',
        pax_confirmado: r.pax_confirmado != null ? String(r.pax_confirmado) : '',
        pax_ninos: r.pax_ninos != null ? String(r.pax_ninos) : '',
        servicio_ninos_odoo_id: r.servicio_ninos_odoo_id != null ? String(r.servicio_ninos_odoo_id) : '',
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

      const turoSeleccionado = catalogo.turoperadoras.find(
        t => String(t.id) === String(datos.turoperador_odoo_id)
      );
      const ninos = Number(datos.pax_ninos) || 0;
      const servicioNinos = ninos > 0
        ? catalogo.tarifasNinos.find(t => String(t.id) === String(datos.servicio_ninos_odoo_id))
        : null;

      const body = {
        fecha: datos.fecha,
        hora: datos.hora || null,
        nombre: datos.nombre.trim(),
        pax: datos.pax !== '' ? datos.pax.trim() : null,
        tipo_servicio: datos.tipo_servicio,
        estado: datos.estado,
        notas: datos.notas,
        guia: datos.guia || '',
        turoperador_odoo_id: turoSeleccionado ? turoSeleccionado.id : null,
        turoperador_nombre: turoSeleccionado ? turoSeleccionado.nombre : null,
        bus_ref: datos.bus_ref ? datos.bus_ref.trim() : null,
        pax_confirmado: datos.pax_confirmado !== '' ? datos.pax_confirmado : null,
        pax_ninos: ninos > 0 ? ninos : null,
        servicio_ninos_odoo_id: servicioNinos ? servicioNinos.id : null,
        servicio_ninos_nombre: servicioNinos ? servicioNinos.nombre : null,
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

  const abrirConfirmarPlantilla = (r, e) => {
    e.stopPropagation();
    setConfirmModal({ id: r.id, nombre: r.nombre, pax: '' });
  };

  const handleConfirmarPlantilla = async () => {
    const pax = Number(confirmModal.pax);
    if (!pax || pax <= 0) {
      alert('Indique un número de pax válido.');
      return;
    }
    setConfirmando(true);
    try {
      const res = await authFetch(`/api/reservas/${confirmModal.id}/confirmar`, {
        method: 'PUT',
        body: JSON.stringify({ pax_confirmado: pax }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Error al confirmar');
      }
      setConfirmModal(null);
      await cargar();
    } catch (err) {
      alert(err.message);
    } finally {
      setConfirmando(false);
    }
  };

  const handleSaltarSemana = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('¿Saltar esta semana? La reserva quedará cancelada (la plantilla no se modifica).')) return;
    try {
      const res = await authFetch(`/api/reservas/${id}/saltar-semana`, { method: 'PUT' });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Error al saltar la semana');
      }
      await cargar();
    } catch (err) {
      alert(err.message);
    }
  };

  const abrirNuevaPlantilla = () => {
    setErrorPlantilla('');
    setModalPlantilla({ modo: 'nuevo', datos: { ...PLANTILLA_VACIA } });
  };

  const abrirEditarPlantilla = (p) => {
    setErrorPlantilla('');
    setModalPlantilla({
      modo: 'editar',
      datos: {
        id: p.id,
        dia_semana: p.dia_semana,
        hora: p.hora ? p.hora.slice(0, 5) : '',
        nombre: p.nombre,
        pax: p.pax ?? '',
        tipo_servicio: p.tipo_servicio || '',
        guia: p.guia || '',
        turoperador_odoo_id: p.turoperador_odoo_id != null ? String(p.turoperador_odoo_id) : SIN_TUROPERADORA,
        bus_ref: p.bus_ref || '',
        menu: Array.isArray(p.menu) ? p.menu : [],
        necesidades_especiales: Array.isArray(p.necesidades_especiales) ? p.necesidades_especiales : [],
      },
    });
  };

  const handleChangePlantilla = (campo, valor) =>
    setModalPlantilla(m => ({ ...m, datos: { ...m.datos, [campo]: valor } }));

  const handleGuardarPlantilla = async () => {
    const { datos, modo } = modalPlantilla;
    if (!datos.nombre?.trim()) {
      setErrorPlantilla('El nombre es obligatorio.');
      return;
    }
    setGuardandoPlantilla(true);
    setErrorPlantilla('');
    try {
      const turoSeleccionado = catalogo.turoperadoras.find(
        t => String(t.id) === String(datos.turoperador_odoo_id)
      );
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
        dia_semana: Number(datos.dia_semana),
        hora: datos.hora || null,
        nombre: datos.nombre.trim(),
        pax: datos.pax !== '' ? datos.pax.trim() : null,
        tipo_servicio: datos.tipo_servicio,
        guia: datos.guia || '',
        turoperador_odoo_id: turoSeleccionado ? turoSeleccionado.id : null,
        turoperador_nombre: turoSeleccionado ? turoSeleccionado.nombre : null,
        bus_ref: datos.bus_ref ? datos.bus_ref.trim() : null,
        menu: menuLimpio,
        necesidades_especiales: necesidadesLimpias,
      };

      const res = await authFetch(
        modo === 'editar' ? `/api/reserva-plantillas/${datos.id}` : '/api/reserva-plantillas',
        { method: modo === 'editar' ? 'PUT' : 'POST', body: JSON.stringify(body) }
      );
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Error al guardar plantilla');
      }
      await cargarPlantillas();
      setModalPlantilla(null);
    } catch (err) {
      setErrorPlantilla(err.message);
    } finally {
      setGuardandoPlantilla(false);
    }
  };

  const handleDesactivarPlantilla = async (id) => {
    if (!window.confirm('¿Desactivar esta plantilla? Dejará de generar reservas semanales.')) return;
    await authFetch(`/api/reserva-plantillas/${id}`, { method: 'DELETE' });
    await cargarPlantillas();
  };

  const handleGenerarPlantillas = async () => {
    setGenerandoPlantillas(true);
    try {
      const res = await authFetch('/api/reserva-plantillas/generar', {
        method: 'POST',
        body: JSON.stringify({ fecha: desde }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al generar');
      await cargar();
      alert(`Semana ${data.semana_desde} — ${data.semana_hasta}: ${data.creadas.length} reserva(s) creada(s), ${data.omitidas.length} ya existían.`);
    } catch (err) {
      alert(err.message || 'Error al generar reservas');
    } finally {
      setGenerandoPlantillas(false);
    }
  };

  const handleEliminar = async (r, e) => {
    if (r.plantilla_id) {
      await handleSaltarSemana(r.id, e);
      return;
    }
    e.stopPropagation();
    if (!confirm('¿Eliminar esta reserva?')) return;
    await authFetch(`/api/reservas/${r.id}`, { method: 'DELETE' });
    await cargar();
  };

  const handleDescargarPDF = async () => {
    setGenerandoPDF(true);
    try {
      const res = await authFetch(`/api/reservas/informe?mes=${informeMes}`);
      if (!res.ok) throw new Error('Error al obtener datos');
      const data = await res.json();
      await generarInformeReservasPDF(data);
    } catch (err) {
      alert(err.message || 'Error al generar el PDF');
    } finally {
      setGenerandoPDF(false);
    }
  };

  const handleDescargarCSV = async () => {
    setGenerandoCSV(true);
    try {
      const res = await authFetch(`/api/reservas/informe?mes=${informeMes}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Error al obtener datos');
      }
      const data = await res.json();
      const csv = csvInformeDesdeJson(data);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `informe_reservas_${informeMes}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      alert(err.message || 'Error al descargar CSV');
    } finally {
      setGenerandoCSV(false);
    }
  };

  const tvUrl = tvToken ? `${window.location.origin}/tv?token=${tvToken}` : '';
  const diasSemana = Array.from({ length: 7 }, (_, i) => addDays(desde, i));

  // Ayudas del formulario de reserva (solo se usan con el modal abierto).
  const servicioActual = modal?.datos?.tipo_servicio || '';
  const servicioFueraDeCatalogo = Boolean(
    servicioActual && !catalogo.tiposServicio.some(t => t.nombre === servicioActual)
  );
  const numNinos = Number(modal?.datos?.pax_ninos) || 0;
  const numTotal = Number(modal?.datos?.pax_confirmado) || 0;
  const hayNinos = numNinos > 0;
  const ninosSinTotal = hayNinos && numTotal <= 0;
  const adultosCalculados = Math.max(numTotal - numNinos, 0);
  const servicioPlantilla = modalPlantilla?.datos?.tipo_servicio || '';
  const servicioPlantillaFueraDeCatalogo = Boolean(
    servicioPlantilla && !catalogo.tiposServicio.some(t => t.nombre === servicioPlantilla)
  );

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

      <PanelAvisos authFetch={authFetch} />

      <div className={styles.informeBar}>
        <span className={styles.informeLabel}>Informe mensual</span>
        <input
          type="month"
          className={styles.inputMes}
          value={informeMes}
          onChange={e => setInformeMes(e.target.value)}
        />
        <button
          className={styles.btnInformePDF}
          onClick={handleDescargarPDF}
          disabled={generandoPDF}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/>
            <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10,9 9,9 8,9"/>
          </svg>
          {generandoPDF ? 'Generando...' : 'Descargar PDF'}
        </button>
        <button
          className={styles.btnInformeCSV}
          onClick={handleDescargarCSV}
          disabled={generandoCSV}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          {generandoCSV ? 'Descargando...' : 'CSV'}
        </button>
      </div>

      <div className={styles.plantillasSection}>
        <div className={styles.plantillasHeader}>
          <button
            type="button"
            className={styles.btnPlantillasToggle}
            onClick={() => setPlantillasAbiertas(v => !v)}
          >
            📅 Plantillas semanales
            {plantillas.length > 0 && (
              <span className={styles.plantillasCount}>{plantillas.length}</span>
            )}
            <span className={styles.chevron}>{plantillasAbiertas ? '▲' : '▼'}</span>
          </button>
          <div className={styles.plantillasActions}>
            <button
              type="button"
              className={styles.btnGenerarPlantillas}
              onClick={handleGenerarPlantillas}
              disabled={generandoPlantillas}
              title="Generar reservas de la semana visible (lun–dom) desde plantillas activas"
            >
              {generandoPlantillas ? 'Generando…' : 'Generar semana'}
            </button>
            <button type="button" className={styles.btnNuevaPlantilla} onClick={abrirNuevaPlantilla}>
              + Nueva plantilla
            </button>
          </div>
        </div>

        {plantillasAbiertas && (
          <div className={styles.plantillasPanel}>
            {plantillas.length === 0 && (
              <p className={styles.plantillasVacio}>
                No hay plantillas activas. Crea una para generar reservas recurrentes.
                Cada lunes a las 00:05 se materializa la semana siguiente (lun–dom).
              </p>
            )}
            {plantillas.map(p => (
              <div key={p.id} className={styles.plantillaItem}>
                <div className={styles.plantillaInfo}>
                  <span className={styles.plantillaDia}>
                    {DIAS_SEMANA.find(d => d.value === p.dia_semana)?.label}
                    {p.hora ? ` · ${formatHora(p.hora)}` : ''}
                  </span>
                  <strong>{p.nombre}</strong>
                  <span className={styles.plantillaMeta}>
                    {p.pax && `${p.pax} pax`}
                    {p.tipo_servicio && ` · ${p.tipo_servicio}`}
                    {p.guia && ` · ${p.guia}`}
                  </span>
                </div>
                <div className={styles.plantillaBtns}>
                  <button type="button" className={styles.btnEditarPlantilla} onClick={() => abrirEditarPlantilla(p)}>
                    Editar
                  </button>
                  <button type="button" className={styles.btnDesactivarPlantilla} onClick={() => handleDesactivarPlantilla(p.id)}>
                    Desactivar
                  </button>
                </div>
              </div>
            ))}
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
                  const esPlantilla = Boolean(r.plantilla_id);
                  const mostrarAccionesPlantilla = esPlantilla && r.estado === 'sin_confirmar';
                  const destacada = reservaDestacada === r.id;
                  return (
                    <div
                      key={r.id}
                      ref={el => { if (el) reservaRefs.current[r.id] = el; }}
                      className={`${styles.tarjeta} ${styles['e_' + r.estado]} ${destacada ? styles.tarjetaDestacada : ''}`}
                    >
                      <div className={styles.tarjetaClick} onClick={() => abrirEditar(r)}>
                        <div className={styles.tarjetaTop}>
                          <span className={styles.tarjetaHora}>{formatHora(r.hora) || '—'}</span>
                          <div className={styles.tarjetaBadges}>
                            {esPlantilla && (
                              <span className={styles.badgePlantilla}>plantilla</span>
                            )}
                            <span className={`${styles.badge} ${styles['b_' + r.estado]}`}>
                              {ESTADOS.find(e => e.value === r.estado)?.label}
                            </span>
                          </div>
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
                          {r.turoperador_nombre && (
                            <span className={styles.tarjetaTipo} title="Turoperadora">🏢 {r.turoperador_nombre}</span>
                          )}
                          {r.bus_ref && (
                            <span className={styles.tarjetaTipo} title="Referencia bus/guagua">🚌 {r.bus_ref}</span>
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

                      {mostrarAccionesPlantilla && (
                        <div className={styles.accionesPlantilla}>
                          <button
                            type="button"
                            className={styles.btnConfirmarPlantilla}
                            onClick={e => abrirConfirmarPlantilla(r, e)}
                          >
                            Confirmar
                          </button>
                          <button
                            type="button"
                            className={styles.btnSaltarPlantilla}
                            onClick={e => handleSaltarSemana(r.id, e)}
                          >
                            Saltar esta semana
                          </button>
                        </div>
                      )}

                      <button
                        className={styles.btnEliminar}
                        onClick={e => handleEliminar(r, e)}
                        title={esPlantilla ? 'Saltar esta semana' : 'Eliminar'}
                      >✕</button>
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
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <button
                  type="button"
                  onClick={() => cargarCatalogo(true)}
                  title="Recargar turoperadoras y tipos de servicio desde Odoo"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.75rem', color: '#6366f1' }}
                >
                  ↻ Catálogo
                </button>
                <button className={styles.btnCerrarModal} onClick={cerrarModal}>✕</button>
              </div>
            </div>

            {errorModal && <div className={styles.errorBox}>{errorModal}</div>}

            <div className={styles.modalBody}>
              {/* Fecha y hora */}
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label>Fecha *</label>
                  <input
                    type="date"
                    value={modal.datos.fecha}
                    disabled={Boolean(modal.datos.plantilla_id)}
                    onChange={e => handleChange('fecha', e.target.value)}
                  />
                  {modal.datos.plantilla_id && (
                    <span className={styles.fieldHint}>
                      La fecha de una reserva de plantilla no se puede cambiar. Use «Saltar esta semana» para cancelarla.
                    </span>
                  )}
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
                  <label style={{ marginTop: '0.5rem' }}>Pax confirmado (para facturar)</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="Nº exacto de personas, niños incluidos"
                    value={modal.datos.pax_confirmado}
                    onChange={e => handleChange('pax_confirmado', e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label>Tipo de servicio</label>
                  <select
                    value={modal.datos.tipo_servicio}
                    onChange={e => handleChange('tipo_servicio', e.target.value)}
                  >
                    <option value="">Sin especificar (no factura)</option>
                    {/* Reservas antiguas con un servicio escrito a mano que ya
                        no está en el catálogo de Odoo: se conserva como opción
                        para no borrarlo sin querer al guardar. */}
                    {servicioFueraDeCatalogo && (
                      <option value={modal.datos.tipo_servicio}>
                        {modal.datos.tipo_servicio} (no está en el catálogo)
                      </option>
                    )}
                    {catalogo.tiposServicio.map(t => (
                      <option key={t.id} value={t.nombre}>{t.nombre}</option>
                    ))}
                  </select>
                  {servicioFueraDeCatalogo && (
                    <span className={styles.fieldHint}>
                      Este servicio no existe en las tarifas de Odoo, así que no
                      se podrá facturar. Elija uno de la lista cuando sepa cuál es.
                    </span>
                  )}
                  {catalogo.error && (
                    <span className={styles.fieldHint}>⚠ {catalogo.error} (mostrando último catálogo cargado)</span>
                  )}
                </div>
              </div>

              {/* Facturación: turoperadora + bus (desplegable cargado desde Odoo) */}
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label>Turoperadora / Cliente</label>
                  <select
                    value={modal.datos.turoperador_odoo_id}
                    onChange={e => handleChange('turoperador_odoo_id', e.target.value)}
                  >
                    <option value={SIN_TUROPERADORA}>Particular / Sin turoperadora</option>
                    {catalogo.turoperadoras.map(t => (
                      <option key={t.id} value={t.id}>{t.nombre}</option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label>Ref. bus/guagua</label>
                  <input
                    type="text"
                    placeholder="Ej: BUS-14 (si la turoperadora factura por bus)"
                    value={modal.datos.bus_ref}
                    onChange={e => handleChange('bus_ref', e.target.value)}
                  />
                </div>
              </div>

              {/* Niños: solo se despliega cuando realmente vienen niños. */}
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label>¿Cuántos niños? (de los anteriores)</label>
                  <input
                    type="number"
                    min="0"
                    placeholder="0"
                    value={modal.datos.pax_ninos}
                    onChange={e => handleChange('pax_ninos', e.target.value)}
                  />
                  <span className={styles.fieldHint}>
                    Déjelo vacío si no vienen niños. Se cobran aparte, con su
                    propia tarifa.
                  </span>
                </div>
                {hayNinos && (
                  <div className={styles.field}>
                    <label>Servicio de los niños</label>
                    <select
                      value={modal.datos.servicio_ninos_odoo_id}
                      onChange={e => handleChange('servicio_ninos_odoo_id', e.target.value)}
                    >
                      <option value="">Usar el habitual de la turoperadora</option>
                      {catalogo.tarifasNinos.map(t => (
                        <option key={t.id} value={t.id}>{t.nombre}</option>
                      ))}
                    </select>
                    <span className={styles.fieldHint}>
                      {ninosSinTotal
                        ? '⚠ Indique también el «Pax confirmado» (total, niños incluidos) para poder separarlos al facturar.'
                        : `Se facturarán ${adultosCalculados} adulto(s) y ${Number(modal.datos.pax_ninos)} niño(s).`}
                    </span>
                  </div>
                )}
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

      {confirmModal && (
        <div className={styles.overlay} onClick={() => setConfirmModal(null)}>
          <div className={`${styles.modal} ${styles.modalCorto}`} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Confirmar reserva</h2>
              <button className={styles.btnCerrarModal} onClick={() => setConfirmModal(null)}>✕</button>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.confirmTexto}>{confirmModal.nombre}</p>
              <div className={styles.field}>
                <label>Pax confirmado *</label>
                <input
                  type="number"
                  min="1"
                  autoFocus
                  placeholder="Número exacto de personas"
                  value={confirmModal.pax}
                  onChange={e => setConfirmModal(m => ({ ...m, pax: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') handleConfirmarPlantilla(); }}
                />
              </div>
            </div>
            <div className={styles.modalFooter}>
              <button className={styles.btnCancelar} onClick={() => setConfirmModal(null)} disabled={confirmando}>
                Cancelar
              </button>
              <button className={styles.btnGuardar} onClick={handleConfirmarPlantilla} disabled={confirmando}>
                {confirmando ? 'Confirmando…' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalPlantilla && (
        <div className={styles.overlay} onClick={() => setModalPlantilla(null)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>{modalPlantilla.modo === 'nuevo' ? 'Nueva plantilla semanal' : 'Editar plantilla'}</h2>
              <button className={styles.btnCerrarModal} onClick={() => setModalPlantilla(null)}>✕</button>
            </div>

            {errorPlantilla && <div className={styles.errorBox}>{errorPlantilla}</div>}

            <div className={styles.modalBody}>
              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label>Día de la semana *</label>
                  <select
                    value={modalPlantilla.datos.dia_semana}
                    onChange={e => handleChangePlantilla('dia_semana', e.target.value)}
                  >
                    {DIAS_SEMANA.map(d => (
                      <option key={d.value} value={d.value}>{d.label}</option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label>Hora</label>
                  <input
                    type="time"
                    value={modalPlantilla.datos.hora}
                    onChange={e => handleChangePlantilla('hora', e.target.value)}
                  />
                </div>
              </div>

              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label>Nombre / Grupo *</label>
                  <input
                    type="text"
                    value={modalPlantilla.datos.nombre}
                    onChange={e => handleChangePlantilla('nombre', e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label>Guía</label>
                  <input
                    type="text"
                    value={modalPlantilla.datos.guia}
                    onChange={e => handleChangePlantilla('guia', e.target.value)}
                  />
                </div>
              </div>

              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label>Pax estimado</label>
                  <input
                    type="text"
                    placeholder="Ej: 22  ó  10-15"
                    value={modalPlantilla.datos.pax}
                    onChange={e => handleChangePlantilla('pax', e.target.value)}
                  />
                </div>
                <div className={styles.field}>
                  <label>Tipo de servicio</label>
                  <select
                    value={modalPlantilla.datos.tipo_servicio}
                    onChange={e => handleChangePlantilla('tipo_servicio', e.target.value)}
                  >
                    <option value="">Sin especificar</option>
                    {servicioPlantillaFueraDeCatalogo && (
                      <option value={modalPlantilla.datos.tipo_servicio}>
                        {modalPlantilla.datos.tipo_servicio} (no está en el catálogo)
                      </option>
                    )}
                    {catalogo.tiposServicio.map(t => (
                      <option key={t.id} value={t.nombre}>{t.nombre}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className={styles.formGrid}>
                <div className={styles.field}>
                  <label>Turoperadora</label>
                  <select
                    value={modalPlantilla.datos.turoperador_odoo_id}
                    onChange={e => handleChangePlantilla('turoperador_odoo_id', e.target.value)}
                  >
                    <option value={SIN_TUROPERADORA}>Particular / Sin turoperadora</option>
                    {catalogo.turoperadoras.map(t => (
                      <option key={t.id} value={t.id}>{t.nombre}</option>
                    ))}
                  </select>
                </div>
                <div className={styles.field}>
                  <label>Ref. bus/guagua</label>
                  <input
                    type="text"
                    value={modalPlantilla.datos.bus_ref}
                    onChange={e => handleChangePlantilla('bus_ref', e.target.value)}
                  />
                </div>
              </div>

              <div className={styles.field}>
                <label>Necesidades alimenticias</label>
                <NecesidadesEditor
                  necesidades={modalPlantilla.datos.necesidades_especiales}
                  onChange={val => handleChangePlantilla('necesidades_especiales', val)}
                />
              </div>

              <div className={styles.field}>
                <label>Menú habitual</label>
                <MenuEditor
                  menu={modalPlantilla.datos.menu}
                  onChange={val => handleChangePlantilla('menu', val)}
                />
              </div>
            </div>

            <div className={styles.modalFooter}>
              <button className={styles.btnCancelar} onClick={() => setModalPlantilla(null)} disabled={guardandoPlantilla}>
                Cancelar
              </button>
              <button className={styles.btnGuardar} onClick={handleGuardarPlantilla} disabled={guardandoPlantilla}>
                {guardandoPlantilla ? 'Guardando…' : modalPlantilla.modo === 'nuevo' ? 'Crear plantilla' : 'Guardar plantilla'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
