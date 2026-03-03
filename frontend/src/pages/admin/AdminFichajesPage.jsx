import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import styles from './AdminFichajesPage.module.css';

const API_URL = import.meta.env.VITE_API_URL || '';

// ─── Generación de PDF del informe ───────────────────────────────────────────
async function generarInformePDF(informe, filtros, empleados) {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pW = doc.internal.pageSize.getWidth();

  const fmtH = h => {
    const abs = Math.abs(h);
    const hh = Math.floor(abs);
    const mm = Math.round((abs - hh) * 60);
    return mm > 0 ? `${hh}h ${mm}m` : `${hh}h`;
  };
  const fmtMin = m => {
    const h = Math.floor(Math.abs(m) / 60);
    const mm = Math.abs(m) % 60;
    return mm > 0 ? `${h}h ${mm}m` : `${h}h`;
  };
  const fmtHora = ts => ts
    ? new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    : '—';
  const fmtFecha = str => new Date(str + 'T12:00:00').toLocaleDateString('es-ES', {
    weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric'
  });
  const fmtDif = h => `${h > 0 ? '+' : ''}${fmtH(h)}`;

  const VERDE  = [39, 174, 96];
  const ROJO   = [192, 57, 43];
  const GRIS   = [120, 120, 120];
  const AZUL   = [52, 73, 94];
  const CLARO  = [248, 249, 251];
  const BORDE  = [220, 225, 230];

  // ── Cabecera de página ──
  const dibujarCabeceraPagina = pageNum => {
    doc.setFillColor(...AZUL);
    doc.rect(0, 0, pW, 18, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.setFont('helvetica', 'bold');
    doc.text('Bodegas Álvaro · Informe de fichajes', 14, 12);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`Pág. ${pageNum}`, pW - 14, 12, { align: 'right' });
  };

  // ── Filtros aplicados ──
  const empLabel = filtros.empleado_id
    ? empleados.find(e => String(e.id) === String(filtros.empleado_id))
      ? (() => { const e = empleados.find(x => String(x.id) === String(filtros.empleado_id)); return `${e.nombre} ${e.apellidos}`; })()
      : 'Empleado seleccionado'
    : 'Todos los empleados';

  const subtitulo = `Periodo: ${filtros.desde} → ${filtros.hasta}  ·  Empleado: ${empLabel}  ·  Generado: ${new Date().toLocaleDateString('es-ES')}`;

  let pagina = 1;
  dibujarCabeceraPagina(pagina);

  doc.setTextColor(...GRIS);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'italic');
  doc.text(subtitulo, 14, 24);

  let cursorY = 30;

  for (const emp of informe) {
    if (!emp.meses.length) continue;

    // ── Nombre del empleado ──
    if (cursorY > 260) {
      doc.addPage();
      pagina++;
      dibujarCabeceraPagina(pagina);
      cursorY = 26;
    }

    doc.setFillColor(...CLARO);
    doc.setDrawColor(...BORDE);
    doc.roundedRect(10, cursorY, pW - 20, 9, 1.5, 1.5, 'FD');
    doc.setTextColor(...AZUL);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text(`${emp.nombre} ${emp.apellidos}${emp.departamento ? '  ·  ' + emp.departamento : ''}`, 14, cursorY + 6);
    cursorY += 13;

    for (const m of emp.meses) {
      // ── Título mes ──
      if (cursorY > 255) {
        doc.addPage();
        pagina++;
        dibujarCabeceraPagina(pagina);
        cursorY = 26;
      }

      doc.setTextColor(...GRIS);
      doc.setFontSize(8.5);
      doc.setFont('helvetica', 'bold');
      doc.text(m.label.toUpperCase(), 14, cursorY);
      cursorY += 4;

      // ── Tabla de jornadas ──
      const filas = m.jornadas.map(j => [
        fmtFecha(j.fecha),
        fmtHora(j.primeraEntrada),
        j.enCurso ? 'En curso' : fmtHora(j.ultimaSalida),
        fmtMin(j.minutos)
      ]);

      autoTable(doc, {
        startY: cursorY,
        margin: { left: 14, right: 14 },
        head: [['Fecha', 'Entrada', 'Salida', 'Horas']],
        body: filas,
        foot: [[
          { content: `Total ${m.label}`, colSpan: 3, styles: { fontStyle: 'bold', halign: 'right' } },
          { content: fmtMin(m.trabajadas * 60), styles: { fontStyle: 'bold', halign: 'center' } }
        ]],
        showFoot: 'lastPage',
        theme: 'grid',
        styles: { fontSize: 8, cellPadding: 2.5, textColor: [50, 50, 50] },
        headStyles: { fillColor: AZUL, textColor: 255, fontStyle: 'bold', fontSize: 8, halign: 'center' },
        footStyles: { fillColor: CLARO, textColor: AZUL, fontSize: 8 },
        columnStyles: {
          0: { cellWidth: 52 },
          1: { halign: 'center', cellWidth: 28 },
          2: { halign: 'center', cellWidth: 28 },
          3: { halign: 'center', cellWidth: 22 }
        },
        alternateRowStyles: { fillColor: [252, 253, 254] },
        didDrawPage: () => {
          pagina = doc.internal.getCurrentPageInfo().pageNumber;
          dibujarCabeceraPagina(pagina);
        }
      });

      cursorY = doc.lastAutoTable.finalY + 3;

      // ── Resumen mes ──
      const difColor = m.diferencia > 0 ? ROJO : m.diferencia < 0 ? VERDE : GRIS;
      doc.setFillColor(245, 247, 250);
      doc.roundedRect(14, cursorY, pW - 28, 8, 1, 1, 'F');
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...GRIS);
      doc.text(`Trabajadas: `, 18, cursorY + 5.2);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(50, 50, 50);
      doc.text(fmtH(m.trabajadas), 40, cursorY + 5.2);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...GRIS);
      doc.text(`Objetivo: `, 60, cursorY + 5.2);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(50, 50, 50);
      doc.text(fmtH(m.objetivo), 78, cursorY + 5.2);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...GRIS);
      doc.text(`Diferencia: `, 100, cursorY + 5.2);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...difColor);
      doc.text(fmtDif(m.diferencia), 122, cursorY + 5.2);

      cursorY += 13;
    }

    cursorY += 4;
  }

  // ── Pie con fecha de generación ──
  const totalPages = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...BORDE);
    doc.line(14, 288, pW - 14, 288);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...GRIS);
    doc.text(`Bodegas Álvaro · Informe generado el ${new Date().toLocaleString('es-ES')}`, 14, 293);
    doc.text(`${i} / ${totalPages}`, pW - 14, 293, { align: 'right' });
  }

  const desde = filtros.desde || 'inicio';
  const hasta = filtros.hasta || 'hoy';
  doc.save(`informe_${desde}_${hasta}.pdf`);
}

function fmtHora(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}
function fmtFecha(str) {
  return new Date(str + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
}
function fmtDuracion(minutos) {
  if (!minutos) return '0h 0m';
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
function fmtFechaHora(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

// ─── Fila expandible de jornada ───────────────────────────────────────────────
function FilaJornada({ jornada, onEliminarFichaje, onEditarFichaje }) {
  const [expandida, setExpandida] = useState(false);

  // Detectar si hubo descanso en esta jornada y calcular hora de vuelta
  const descansoFichaje = jornada.fichajes.find(f => f.es_descanso);
  let vueltaDescanso = null;
  if (descansoFichaje) {
    const idxDesc = jornada.fichajes.indexOf(descansoFichaje);
    const siguiente = jornada.fichajes[idxDesc + 1];
    if (siguiente?.tipo === 'entrada') vueltaDescanso = siguiente;
  }

  return (
    <>
      <tr
        className={`${styles.fila} ${expandida ? styles.filaExpandida : ''}`}
        onClick={() => setExpandida(v => !v)}
        style={{ cursor: 'pointer' }}
      >
        <td>
          <div className={styles.empNombre}>{jornada.nombre} {jornada.apellidos}</div>
          <div className={styles.empDept}>{jornada.departamento || '—'}</div>
        </td>
        <td className={styles.tdFecha}>{fmtFecha(jornada.fecha)}</td>
        <td>
          <span className={styles.horasValor}>{fmtDuracion(jornada.minutosTrabajados)}</span>
          {jornada.enProgreso && <span className={styles.badgeVivo}>en curso</span>}
          {descansoFichaje && (
            <span className={styles.badgeDescanso} title={`Descanso: ${fmtHora(descansoFichaje.timestamp)}${vueltaDescanso ? ` → ${fmtHora(vueltaDescanso.timestamp)}` : ' (sin vuelta)'}`}>
              ☕
            </span>
          )}
        </td>
        <td className={styles.tdHorario}>
          {jornada.primeraEntrada ? (
            <span>{fmtHora(jornada.primeraEntrada)} → {jornada.ultimaSalida ? fmtHora(jornada.ultimaSalida) : <em>activo</em>}</span>
          ) : '—'}
        </td>
        <td className={styles.tdFichajes}>
          {jornada.numEntradas}E / {jornada.numSalidas}S
        </td>
        <td className={styles.tdExpand}>
          <span className={expandida ? styles.chevronUp : styles.chevronDown}>▾</span>
        </td>
      </tr>

      {expandida && (
        <tr className={styles.filaDetalle}>
          <td colSpan={6}>
            <div className={styles.detalleContainer}>
              {descansoFichaje && (
                <div className={styles.descansoResumen}>
                  <span className={styles.descansoResumenIcon}>☕</span>
                  <span>
                    <strong>Descanso:</strong> inicio {fmtHora(descansoFichaje.timestamp)}
                    {vueltaDescanso
                      ? <> · vuelta {fmtHora(vueltaDescanso.timestamp)} · duración real {fmtDuracion(Math.round((new Date(vueltaDescanso.timestamp) - new Date(descansoFichaje.timestamp)) / 60000))}</>
                      : <em> · aún en descanso</em>
                    }
                    <span className={styles.descansoResumenCredito}> (+30 min acreditados)</span>
                  </span>
                </div>
              )}
              <div className={styles.detalleTimeline}>
                {jornada.fichajes.map((f, i) => {
                  const esDescansoItem = f.es_descanso;
                  const esVueltaDescanso = vueltaDescanso && f.id === vueltaDescanso.id;
                  let tipoLabel = f.tipo === 'entrada' ? '▶ Entrada' : '■ Salida';
                  if (esDescansoItem) tipoLabel = '☕ Inicio descanso';
                  if (esVueltaDescanso) tipoLabel = '▶ Vuelta del descanso';
                  const itemClass = esDescansoItem
                    ? styles.dtDescanso
                    : esVueltaDescanso
                    ? styles.dtVuelta
                    : f.tipo === 'entrada' ? styles.dtEntrada : styles.dtSalida;

                  return (
                    <div key={f.id} className={`${styles.dtItem} ${itemClass}`}>
                      <div className={styles.dtDot} />
                      <div className={styles.dtInfo}>
                        <span className={styles.dtTipo}>{tipoLabel}</span>
                        <span className={styles.dtHora}>{fmtFechaHora(f.timestamp)}</span>
                        {i > 0 && f.tipo === 'salida' && !esDescansoItem && jornada.fichajes[i - 1]?.tipo === 'entrada' && (
                          <span className={styles.dtDuracion}>
                            {fmtDuracion(Math.round((new Date(f.timestamp) - new Date(jornada.fichajes[i - 1].timestamp)) / 60000))}
                          </span>
                        )}
                        {esDescansoItem && <span className={styles.dtCreditoBadge}>+30 min</span>}
                      </div>
                      <div className={styles.dtActions}>
                        <button
                          className={styles.btnEditar}
                          onClick={e => { e.stopPropagation(); onEditarFichaje(f); }}
                          title="Editar fichaje"
                        >✏️</button>
                        <button
                          className={styles.btnBorrar}
                          onClick={e => { e.stopPropagation(); onEliminarFichaje(f.id); }}
                          title="Eliminar este fichaje"
                        >✕</button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Informe mensual ──────────────────────────────────────────────────────────
function InformeMensual({ informe }) {
  const [expandidos, setExpandidos] = useState({});
  const toggle = key => setExpandidos(s => ({ ...s, [key]: !s[key] }));

  const fmtH = h => {
    const abs = Math.abs(h);
    const hh = Math.floor(abs);
    const mm = Math.round((abs - hh) * 60);
    return mm > 0 ? `${hh}h ${mm}m` : `${hh}h`;
  };
  const fmtMin = m => {
    const h = Math.floor(Math.abs(m) / 60);
    const mm = Math.abs(m) % 60;
    return mm > 0 ? `${h}h ${mm}m` : `${h}h`;
  };
  const fmtHora = ts => ts
    ? new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    : '—';
  const fmtFecha = str => new Date(str + 'T12:00:00').toLocaleDateString('es-ES', {
    weekday: 'short', day: '2-digit', month: '2-digit'
  });

  if (!informe.length) return <p className={styles.empty}>No hay datos en el periodo seleccionado.</p>;

  return (
    <div className={styles.informeWrap}>
      {informe.map(emp => (
        <div key={emp.id} className={styles.informeEmp}>
          <div className={styles.informeEmpHeader} onClick={() => toggle(`emp_${emp.id}`)}>
            <span className={styles.informeEmpNombre}>{emp.nombre} {emp.apellidos}</span>
            {emp.departamento && <span className={styles.informeEmpDept}>{emp.departamento}</span>}
            <span className={styles.informeChevron}>{expandidos[`emp_${emp.id}`] ? '▴' : '▾'}</span>
          </div>

          {expandidos[`emp_${emp.id}`] && emp.meses.map(m => (
            <div key={m.label} className={styles.informeMes}>
              {/* Cabecera mes con resumen */}
              <div className={styles.informeMesHeader}>
                <span className={styles.informeMesLabel}>{m.label}</span>
                <div className={styles.informeMesStats}>
                  <span className={styles.informeStat}>
                    <span className={styles.informeStatLabel}>Trabajadas</span>
                    <strong>{fmtH(m.trabajadas)}</strong>
                  </span>
                  <span className={styles.informeStat}>
                    <span className={styles.informeStatLabel}>Objetivo</span>
                    <strong>{fmtH(m.objetivo)}</strong>
                  </span>
                  <span className={`${styles.informeStat} ${m.diferencia > 0 ? styles.exceso : styles.deficit}`}>
                    <span className={styles.informeStatLabel}>Diferencia</span>
                    <strong>{m.diferencia > 0 ? '+' : ''}{fmtH(m.diferencia)}</strong>
                  </span>
                </div>
              </div>

              {/* Tabla de jornadas */}
              <table className={styles.informeTabla}>
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Entrada</th>
                    <th>Salida</th>
                    <th>Horas</th>
                  </tr>
                </thead>
                <tbody>
                  {m.jornadas.map(j => (
                    <tr key={j.fecha} className={styles.informeFila}>
                      <td>{fmtFecha(j.fecha)}</td>
                      <td>{fmtHora(j.primeraEntrada)}</td>
                      <td>{j.enCurso ? <em className={styles.enCurso}>en curso</em> : fmtHora(j.ultimaSalida)}</td>
                      <td><strong>{fmtMin(j.minutos)}</strong></td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className={styles.informeTotalFila}>
                    <td colSpan={3}><strong>Total {m.label}</strong></td>
                    <td>
                      <strong className={m.diferencia > 0 ? styles.excessText : styles.deficitText}>
                        {fmtH(m.trabajadas)}
                      </strong>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function AdminFichajesPage() {
  const { authFetch } = useAuth();
  const [vista, setVista] = useState('jornadas');
  const [jornadas, setJornadas] = useState([]);
  const [fichajes, setFichajes] = useState([]);
  const [informe, setInforme] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [cargando, setCargando] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [editForm, setEditForm] = useState({ tipo: '', fecha: '', hora: '' });
  const [editando, setEditando] = useState(false);
  const LIMITE = 50;

  const hoy = new Date().toISOString().split('T')[0];
  const inicioAnio = `${new Date().getFullYear()}-01-01`;
  const [filtros, setFiltros] = useState({ empleado_id: '', desde: inicioAnio, hasta: hoy });

  useEffect(() => {
    authFetch('/api/empleados').then(r => r.json()).then(setEmpleados);
  }, [authFetch]);

  const cargarJornadas = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams();
    if (filtros.empleado_id) params.append('empleado_id', filtros.empleado_id);
    if (filtros.desde) params.append('desde', filtros.desde);
    if (filtros.hasta) params.append('hasta', filtros.hasta);
    const res = await authFetch(`/api/fichajes/admin/jornadas?${params}`);
    const data = await res.json();
    setJornadas(data.jornadas || []);
    setCargando(false);
  }, [authFetch, filtros]);

  const cargarDetalle = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams({ pagina, limite: LIMITE });
    if (filtros.empleado_id) params.append('empleado_id', filtros.empleado_id);
    if (filtros.desde) params.append('desde', filtros.desde);
    if (filtros.hasta) params.append('hasta', filtros.hasta);
    const res = await authFetch(`/api/fichajes/admin/todos?${params}`);
    const data = await res.json();
    setFichajes(data.fichajes || []);
    setTotal(data.total || 0);
    setCargando(false);
  }, [authFetch, pagina, filtros]);

  const cargarInforme = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams();
    if (filtros.empleado_id) params.append('empleado_id', filtros.empleado_id);
    if (filtros.desde) params.append('desde', filtros.desde);
    if (filtros.hasta) params.append('hasta', filtros.hasta);
    const res = await authFetch(`/api/horas/admin/informe?${params}`);
    const data = await res.json();
    setInforme(Array.isArray(data) ? data : []);
    setCargando(false);
  }, [authFetch, filtros]);

  useEffect(() => {
    if (vista === 'jornadas') cargarJornadas();
    else if (vista === 'detalle') cargarDetalle();
    else cargarInforme();
  }, [vista, cargarJornadas, cargarDetalle, cargarInforme]);

  const handleEliminarFichaje = async (id) => {
    if (!window.confirm('¿Eliminar este fichaje?')) return;
    await authFetch(`/api/fichajes/admin/${id}`, { method: 'DELETE' });
    if (vista === 'jornadas') cargarJornadas();
    else cargarDetalle();
  };

  const abrirEditar = (f) => {
    const d = new Date(f.timestamp);
    setEditForm({
      tipo: f.tipo,
      fecha: d.toISOString().split('T')[0],
      hora: d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false })
    });
    setEditModal(f);
  };

  const handleGuardarEdicion = async (e) => {
    e.preventDefault();
    const nuevoTimestamp = new Date(`${editForm.fecha}T${editForm.hora}:00`);
    if (nuevoTimestamp > new Date()) {
      alert('No se puede establecer un fichaje en el futuro. Las modificaciones deben ser de tiempo pasado.');
      return;
    }
    setEditando(true);
    await authFetch(`/api/fichajes/admin/${editModal.id}`, {
      method: 'PUT',
      body: JSON.stringify(editForm)
    });
    setEditModal(null);
    setEditando(false);
    if (vista === 'jornadas') cargarJornadas();
    else cargarDetalle();
  };

  const handleExportarCSV = () => {
    const params = new URLSearchParams();
    if (filtros.empleado_id) params.append('empleado_id', filtros.empleado_id);
    if (filtros.desde) params.append('desde', filtros.desde);
    if (filtros.hasta) params.append('hasta', filtros.hasta);
    const token = localStorage.getItem('fichajes_token');

    if (vista === 'informe') {
      params.append('formato', 'csv');
      fetch(`${API_URL}/api/horas/admin/informe?${params}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.blob())
        .then(blob => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `informe_${filtros.desde}_${filtros.hasta}.csv`;
          a.click();
        });
    } else {
      fetch(`${API_URL}/api/fichajes/admin/exportar?${params}`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.blob())
        .then(blob => {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = `fichajes_${filtros.desde}_${filtros.hasta}.csv`;
          a.click();
        });
    }
  };

  const handleExportarPDF = () => {
    generarInformePDF(informe, filtros, empleados);
  };

  const totalHorasJornadas = jornadas.reduce((s, j) => s + j.minutosTrabajados, 0);
  const totalPaginas = Math.ceil(total / LIMITE);

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <h1 className={styles.title}>Fichajes</h1>
        <div className={styles.topBtns}>
          {vista === 'informe' && (
            <button onClick={handleExportarPDF} className={styles.btnPDF} disabled={!informe.length}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14,2 14,8 20,8"/>
                <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10,9 9,9 8,9"/>
              </svg>
              Descargar PDF
            </button>
          )}
          <button onClick={handleExportarCSV} className={styles.btnExportar}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7,10 12,15 17,10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            {vista === 'informe' ? 'CSV' : 'Exportar CSV'}
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className={styles.filtros}>
        <select className={styles.filtroSelect} value={filtros.empleado_id}
          onChange={e => setFiltros(f => ({ ...f, empleado_id: e.target.value }))}>
          <option value="">Todos los empleados</option>
          {empleados.map(e => <option key={e.id} value={e.id}>{e.nombre} {e.apellidos}</option>)}
        </select>
        <input type="date" className={styles.filtroInput} value={filtros.desde}
          onChange={e => setFiltros(f => ({ ...f, desde: e.target.value }))} />
        <span className={styles.filtroSep}>→</span>
        <input type="date" className={styles.filtroInput} value={filtros.hasta}
          onChange={e => setFiltros(f => ({ ...f, hasta: e.target.value }))} />
        <button className={styles.btnFiltrar} onClick={() => {
          setPagina(1);
          if (vista === 'jornadas') cargarJornadas();
          else if (vista === 'detalle') cargarDetalle();
          else cargarInforme();
        }}>
          Buscar
        </button>
      </div>

      {/* Selector de vista */}
      <div className={styles.vistaTabs}>
        <button className={vista === 'jornadas' ? styles.vistaTabActive : styles.vistaTab} onClick={() => setVista('jornadas')}>
          Resumen por jornada
        </button>
        <button className={vista === 'detalle' ? styles.vistaTabActive : styles.vistaTab} onClick={() => setVista('detalle')}>
          Detalle de fichajes
        </button>
        <button className={vista === 'informe' ? styles.vistaTabActive : styles.vistaTab} onClick={() => setVista('informe')}>
          📊 Informe mensual
        </button>
      </div>

      {cargando ? (
        <div className={styles.loading}>Cargando...</div>
      ) : vista === 'informe' ? (
        <InformeMensual informe={informe} />
      ) : vista === 'jornadas' ? (
        <>
          {jornadas.length > 0 && (
            <div className={styles.resumenBanner}>
              <span><strong>{jornadas.length}</strong> jornadas</span>
              <span>·</span>
              <span>Total: <strong>{fmtDuracion(totalHorasJornadas)}</strong></span>
              <span>·</span>
              <span>Media/jornada: <strong>{fmtDuracion(Math.round(totalHorasJornadas / jornadas.length))}</strong></span>
            </div>
          )}
          <div className={styles.tablaWrap}>
            <table className={styles.tabla}>
              <thead>
                <tr>
                  <th>Empleado</th>
                  <th>Fecha</th>
                  <th>Tiempo trabajado</th>
                  <th>Horario</th>
                  <th>Registros</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {jornadas.length === 0 ? (
                  <tr><td colSpan={6} className={styles.empty}>No hay jornadas en el período seleccionado.</td></tr>
                ) : jornadas.map(j => (
                  <FilaJornada
                    key={`${j.empleado_id}_${j.fecha}`}
                    jornada={j}
                    onEliminarFichaje={handleEliminarFichaje}
                    onEditarFichaje={abrirEditar}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <>
          <p className={styles.infoDetalle}>{total} fichajes · haz clic en ✕ para eliminar</p>
          <div className={styles.tablaWrap}>
            <table className={styles.tabla}>
              <thead>
                <tr><th>Empleado</th><th>Depto.</th><th>Tipo</th><th>Fecha y hora</th><th></th></tr>
              </thead>
              <tbody>
                {fichajes.length === 0 ? (
                  <tr><td colSpan={5} className={styles.empty}>No hay fichajes en el período seleccionado.</td></tr>
                ) : fichajes.map(f => (
                  <tr key={f.id} className={styles.fila}>
                    <td><div className={styles.empNombre}>{f.nombre} {f.apellidos}</div></td>
                    <td className={styles.tdDept}>{f.departamento || '—'}</td>
                    <td>
                      <span className={`${styles.badge} ${f.tipo === 'entrada' ? styles.badgeEntrada : styles.badgeSalida}`}>
                        {f.tipo}
                      </span>
                    </td>
                    <td>{new Date(f.timestamp).toLocaleString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' })}</td>
                    <td>
                      <button className={styles.btnBorrar} onClick={() => setConfirmDelete(f.id)} title="Eliminar">✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPaginas > 1 && (
            <div className={styles.paginacion}>
              <button disabled={pagina === 1} onClick={() => setPagina(p => p - 1)}>← Anterior</button>
              <span>{pagina} / {totalPaginas}</span>
              <button disabled={pagina === totalPaginas} onClick={() => setPagina(p => p + 1)}>Siguiente →</button>
            </div>
          )}
        </>
      )}

      {confirmDelete && (
        <div className={styles.confirmOverlay}>
          <div className={styles.confirmBox}>
            <p>¿Eliminar este fichaje? Esta acción no se puede deshacer.</p>
            <div className={styles.confirmBtns}>
              <button className={styles.btnEliminarConfirm} onClick={() => { handleEliminarFichaje(confirmDelete); setConfirmDelete(null); }}>Eliminar</button>
              <button className={styles.btnCancelar} onClick={() => setConfirmDelete(null)}>Cancelar</button>
            </div>
          </div>
        </div>
      )}

      {editModal && (
        <div className={styles.confirmOverlay} onClick={e => e.target === e.currentTarget && setEditModal(null)}>
          <div className={styles.editBox}>
            <div className={styles.editHeader}>
              <h3>Editar fichaje</h3>
              <button className={styles.editClose} onClick={() => setEditModal(null)}>×</button>
            </div>
            <form onSubmit={handleGuardarEdicion} className={styles.editForm}>
              <div className={styles.editField}>
                <label>Tipo</label>
                <select value={editForm.tipo} onChange={e => setEditForm(f => ({ ...f, tipo: e.target.value }))}>
                  <option value="entrada">Entrada</option>
                  <option value="salida">Salida</option>
                </select>
              </div>
              <div className={styles.editField}>
                <label>Fecha</label>
                <input type="date" required value={editForm.fecha}
                  max={new Date().toISOString().split('T')[0]}
                  onChange={e => setEditForm(f => ({ ...f, fecha: e.target.value }))} />
              </div>
              <div className={styles.editField}>
                <label>Hora</label>
                <input type="time" required value={editForm.hora}
                  onChange={e => setEditForm(f => ({ ...f, hora: e.target.value }))} />
              </div>
              <p className={styles.editNota}>El empleado recibirá una notificación del cambio en su próximo acceso.</p>
              <div className={styles.editFooter}>
                <button type="button" className={styles.btnCancelar} onClick={() => setEditModal(null)}>Cancelar</button>
                <button type="submit" className={styles.btnGuardarEdit} disabled={editando}>
                  {editando ? 'Guardando...' : 'Guardar cambio'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
