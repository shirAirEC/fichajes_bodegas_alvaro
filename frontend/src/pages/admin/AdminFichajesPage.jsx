import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import styles from './AdminFichajesPage.module.css';
import { getApiUrl } from '../../lib/apiUrl';

const API_URL = getApiUrl();


// ─── Generación de PDF del informe ───────────────────────────────────────────
async function generarInformePDF(empleadosData, filtros) {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const { savePdf } = await import('../../lib/savePdf');

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pW = doc.internal.pageSize.getWidth();
  const pH = doc.internal.pageSize.getHeight();

  const PRIMARY   = [139, 38, 53];
  const PRIMARY_L = [245, 236, 238];
  const GOLD      = [201, 169, 97];
  const CREAM     = [245, 241, 232];
  const BORDER    = [224, 216, 200];
  const TEXT      = [45, 45, 45];
  const TEXT_L    = [102, 102, 102];
  const VERDE     = [45, 122, 58];
  const ROJO      = [192, 57, 43];
  const WHITE     = [255, 255, 255];

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
    : '--';
  const fmtFecha = str => new Date(str + 'T12:00:00').toLocaleDateString('es-ES', {
    weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric'
  });

  // Texto y color del saldo acumulado
  const textoSaldo = acum => {
    if (Math.abs(acum) < 0.17) return { texto: 'Sin deuda acumulada', color: TEXT_L };
    if (acum > 0) return { texto: `+${fmtH(acum)} de mas acumuladas`, color: ROJO };
    return { texto: `-${fmtH(Math.abs(acum))} acumuladas de deuda`, color: VERDE };
  };

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
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text('Informe de horas y fichajes', 14, 17);
    doc.text(`Pag. ${paginaNum}`, pW - 14, 14, { align: 'right' });
  };

  const dibujarPie = () => {
    doc.setDrawColor(...BORDER);
    doc.line(14, pH - 10, pW - 14, pH - 10);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...TEXT_L);
    doc.text(
      `Bodegas Alvaro - Generado el ${new Date().toLocaleString('es-ES')}  -  Periodo: ${filtros.desde || '-'} a ${filtros.hasta || '-'}`,
      14, pH - 5
    );
    doc.text(`${paginaNum}`, pW - 14, pH - 5, { align: 'right' });
  };

  dibujarCabecera();
  dibujarPie();

  // Bloque de cabecera del informe
  const esUno = empleadosData.length === 1;
  const empLabel = esUno
    ? `${empleadosData[0].nombre} ${empleadosData[0].apellidos}${empleadosData[0].departamento ? ' - ' + empleadosData[0].departamento : ''}`
    : `${empleadosData.length} empleados`;

  doc.setFillColor(...CREAM);
  doc.setDrawColor(...BORDER);
  doc.roundedRect(14, 27, pW - 28, 10, 1.5, 1.5, 'FD');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...TEXT_L);
  doc.text('Empleado:', 18, 33.5);
  doc.setTextColor(...TEXT);
  doc.setFont('helvetica', 'bold');
  doc.text(empLabel, 38, 33.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...TEXT_L);
  doc.text(`Periodo: ${filtros.desde || '-'} a ${filtros.hasta || '-'}`, pW - 18, 33.5, { align: 'right' });

  let cursorY = 42;

  for (const emp of empleadosData) {
    if (!emp.meses.length) continue;

    if (!esUno) {
      if (cursorY > 255) {
        doc.addPage(); paginaNum++;
        dibujarCabecera(); dibujarPie(); cursorY = 28;
      }
      doc.setFillColor(...PRIMARY);
      doc.roundedRect(14, cursorY, pW - 28, 9, 1.5, 1.5, 'F');
      doc.setTextColor(...WHITE);
      doc.setFontSize(9.5);
      doc.setFont('helvetica', 'bold');
      doc.text(
        `${emp.nombre} ${emp.apellidos}${emp.departamento ? ' - ' + emp.departamento : ''}`,
        18, cursorY + 6.2
      );
      cursorY += 13;
    }

    for (const m of emp.meses) {
      if (cursorY > 252) {
        doc.addPage(); paginaNum++;
        dibujarCabecera(); dibujarPie(); cursorY = 28;
      }

      // Barra dorada + nombre del mes + horas trabajadas
      doc.setFillColor(...GOLD);
      doc.rect(14, cursorY, 3, 7, 'F');
      doc.setTextColor(...TEXT);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'bold');
      doc.text(m.label.toUpperCase(), 20, cursorY + 5.2);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...TEXT_L);
      doc.text(`${fmtH(m.trabajadas)} trabajadas`, pW - 18, cursorY + 5.2, { align: 'right' });

      cursorY += 10;

      // Tabla de jornadas
      autoTable(doc, {
        startY: cursorY,
        margin: { left: 14, right: 14 },
        head: [['Fecha', 'Entrada', 'Salida', 'Horas']],
        body: m.jornadas.map(j => [
          fmtFecha(j.fecha),
          fmtHora(j.primeraEntrada),
          j.enCurso ? 'En curso' : fmtHora(j.ultimaSalida),
          fmtMin(j.minutos)
        ]),
        theme: 'plain',
        styles: {
          fontSize: 8,
          cellPadding: { top: 2.5, bottom: 2.5, left: 4, right: 4 },
          textColor: TEXT, lineColor: BORDER, lineWidth: 0.25
        },
        headStyles: {
          fillColor: CREAM, textColor: PRIMARY, fontStyle: 'bold',
          fontSize: 7.5, halign: 'center', lineColor: BORDER, lineWidth: 0.25
        },
        columnStyles: {
          0: { cellWidth: 56 },
          1: { halign: 'center', cellWidth: 32 },
          2: { halign: 'center', cellWidth: 32 },
          3: { halign: 'center', cellWidth: 30 }
        },
        alternateRowStyles: { fillColor: [250, 248, 244] },
        didDrawPage: () => {
          paginaNum = doc.internal.getCurrentPageInfo().pageNumber;
          dibujarCabecera(); dibujarPie();
        }
      });

      cursorY = doc.lastAutoTable.finalY;

      // Separador fino entre meses
      doc.setFillColor(...PRIMARY_L);
      doc.rect(14, cursorY, pW - 28, 5, 'F');
      doc.setFontSize(7.5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(...PRIMARY);
      doc.text(`Total ${m.label}:`, 18, cursorY + 3.5);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...TEXT_L);
      doc.text(fmtH(m.trabajadas), pW - 18, cursorY + 3.5, { align: 'right' });

      cursorY += 10;
    }

    // ── Saldo acumulado semanal al final del empleado (calculado en servidor, con vacaciones) ──
    const acum = emp.balanceAcumulado ?? 0;
    const saldo = textoSaldo(acum);

    if (cursorY > 258) {
      doc.addPage(); paginaNum++;
      dibujarCabecera(); dibujarPie(); cursorY = 28;
    }

    const saldoColor = acum > 0.17 ? ROJO : acum < -0.17 ? VERDE : TEXT_L;
    doc.setFillColor(...(acum > 0.17 ? [253, 236, 234] : acum < -0.17 ? [232, 245, 233] : [245, 241, 232]));
    doc.setDrawColor(...BORDER);
    doc.roundedRect(14, cursorY, pW - 28, 10, 1.5, 1.5, 'FD');
    doc.setFontSize(8.5);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...saldoColor);
    doc.text('Saldo acumulado (semanas cerradas):', 18, cursorY + 6.5);
    doc.text(saldo.texto, pW - 18, cursorY + 6.5, { align: 'right' });

    cursorY += 18;
  }

  // Redibujar pie en todas las páginas con número correcto
  const totalPags = doc.internal.getNumberOfPages();
  for (let i = 1; i <= totalPags; i++) {
    doc.setPage(i);
    paginaNum = i;
    dibujarPie();
  }

  const nombre = esUno
    ? `${empleadosData[0].apellidos}_${empleadosData[0].nombre}`.replace(/\s+/g, '_')
    : 'todos';
  await savePdf(doc, `informe_${nombre}_${filtros.desde || 'inicio'}_${filtros.hasta || 'hoy'}.pdf`);
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
function InformeMensual({ informe, filtros }) {
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

  // balanceAcumulado viene del servidor con vacaciones ya descontadas
  const saldoEmp = emp => {
    const acum = emp.balanceAcumulado ?? 0;
    if (Math.abs(acum) < 0.17) return null;
    if (acum > 0) return { texto: `+${fmtH(acum)} de más acumuladas`, cls: styles.estadoExceso };
    return { texto: `-${fmtH(Math.abs(acum))} acumuladas de deuda`, cls: styles.estadoDeficit };
  };

  if (!informe.length) return <p className={styles.empty}>No hay datos en el periodo seleccionado.</p>;

  return (
    <div className={styles.informeWrap}>
      {informe.map(emp => (
        <div key={emp.id} className={styles.informeEmp}>
          <div className={styles.informeEmpHeader}>
            <div className={styles.informeEmpHeaderLeft} onClick={() => toggle(`emp_${emp.id}`)}>
              <span className={styles.informeChevron}>{expandidos[`emp_${emp.id}`] ? '▴' : '▾'}</span>
              <span className={styles.informeEmpNombre}>{emp.nombre} {emp.apellidos}</span>
              {emp.departamento && <span className={styles.informeEmpDept}>{emp.departamento}</span>}
            </div>
            <button
              className={styles.btnEmpPDF}
              title="Descargar informe PDF de este empleado"
              onClick={() => generarInformePDF([emp], filtros)}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <polyline points="14,2 14,8 20,8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
              PDF
            </button>
          </div>

          {expandidos[`emp_${emp.id}`] && (
            <>
              {emp.meses.map(m => (
                <div key={m.label} className={styles.informeMes}>
                  <div className={styles.informeMesHeader}>
                    <span className={styles.informeMesLabel}>{m.label}</span>
                    <span className={styles.informeStat}>
                      <span className={styles.informeStatLabel}>Trabajadas</span>
                      <strong>{fmtH(m.trabajadas)}</strong>
                    </span>
                  </div>

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
                        <td><strong>{fmtH(m.trabajadas)}</strong></td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              ))}

              {/* Saldo acumulado semanal */}
              {(() => {
                const saldo = saldoEmp(emp);
                return (
                  <div className={`${styles.informeSaldoBox} ${saldo ? (saldo.cls === styles.estadoExceso ? styles.saldoExceso : styles.saldoDeficit) : styles.saldoOk}`}>
                    <span className={styles.informeSaldoLabel}>Saldo acumulado (semanas cerradas)</span>
                    <strong>{saldo ? saldo.texto : 'Sin deuda acumulada'}</strong>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Página principal ─────────────────────────────────────────────────────────
export default function AdminFichajesPage() {
  const { authFetch } = useAuth();
  const hoy = new Date().toISOString().split('T')[0];
  const inicioAnio = `${new Date().getFullYear()}-01-01`;
  const LIMITE = 50;

  const [vista, setVista] = useState('jornadas');
  const [jornadas, setJornadas] = useState([]);
  const [fichajes, setFichajes] = useState([]);
  const [informe, setInforme] = useState([]);
  const [empleados, setEmpleados] = useState([]);
  const [total, setTotal] = useState(0);
  const [pagina, setPagina] = useState(1);
  const [cargando, setCargando] = useState(true);
  const [filtros, setFiltros] = useState({ empleado_id: '', desde: inicioAnio, hasta: hoy });
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [editModal, setEditModal] = useState(null);
  const [editForm, setEditForm] = useState({ tipo: '', fecha: '', hora: '' });
  const [editando, setEditando] = useState(false);
  const [addModal, setAddModal] = useState(false);
  const [addForm, setAddForm] = useState({ empleado_id: '', tipo: 'salida', fecha: hoy, hora: '18:00', notas: '' });
  const [guardandoAdd, setGuardandoAdd] = useState(false);

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

  const handleGuardarNuevo = async (e) => {
    e.preventDefault();
    setGuardandoAdd(true);
    const res = await authFetch('/api/fichajes/admin', {
      method: 'POST',
      body: JSON.stringify(addForm)
    });
    setGuardandoAdd(false);
    if (!res.ok) {
      const err = await res.json();
      alert(err.error || 'Error al crear el fichaje');
      return;
    }
    setAddModal(false);
    setAddForm({ empleado_id: '', tipo: 'salida', fecha: hoy, hora: '18:00', notas: '' });
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
    generarInformePDF(informe, filtros);
  };

  const totalHorasJornadas = jornadas.reduce((s, j) => s + j.minutosTrabajados, 0);
  const totalPaginas = Math.ceil(total / LIMITE);

  return (
    <div className={styles.page}>
      <div className={styles.topBar}>
        <h1 className={styles.title}>Fichajes</h1>
        <div className={styles.topBtns}>
          <button onClick={() => setAddModal(true)} className={styles.btnAnadir}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            Añadir fichaje
          </button>
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
          Informe
        </button>
      </div>

      {cargando ? (
        <div className={styles.loading}>Cargando...</div>
      ) : vista === 'informe' ? (
        <InformeMensual informe={informe} filtros={filtros} />
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

      {addModal && (
        <div className={styles.confirmOverlay} onClick={e => e.target === e.currentTarget && setAddModal(false)}>
          <div className={styles.editBox}>
            <div className={styles.editHeader}>
              <h3>Añadir fichaje manualmente</h3>
              <button className={styles.editClose} onClick={() => setAddModal(false)}>×</button>
            </div>
            <form onSubmit={handleGuardarNuevo} className={styles.editForm}>
              <div className={styles.editField}>
                <label>Empleado</label>
                <select required value={addForm.empleado_id}
                  onChange={e => setAddForm(f => ({ ...f, empleado_id: e.target.value }))}>
                  <option value="">— Selecciona empleado —</option>
                  {empleados.map(e => (
                    <option key={e.id} value={e.id}>{e.nombre} {e.apellidos}</option>
                  ))}
                </select>
              </div>
              <div className={styles.editField}>
                <label>Tipo</label>
                <select value={addForm.tipo} onChange={e => setAddForm(f => ({ ...f, tipo: e.target.value }))}>
                  <option value="salida">Salida</option>
                  <option value="entrada">Entrada</option>
                </select>
              </div>
              <div className={styles.editField}>
                <label>Fecha</label>
                <input type="date" required value={addForm.fecha}
                  max={new Date().toISOString().split('T')[0]}
                  onChange={e => setAddForm(f => ({ ...f, fecha: e.target.value }))} />
              </div>
              <div className={styles.editField}>
                <label>Hora</label>
                <input type="time" required value={addForm.hora}
                  onChange={e => setAddForm(f => ({ ...f, hora: e.target.value }))} />
              </div>
              <div className={styles.editField}>
                <label>Notas <span style={{ fontWeight: 400, color: '#999' }}>(opcional)</span></label>
                <input type="text" placeholder="Ej: Olvidó fichar salida" value={addForm.notas}
                  onChange={e => setAddForm(f => ({ ...f, notas: e.target.value }))} />
              </div>
              <p className={styles.editNota}>El empleado recibirá una notificación de este registro.</p>
              <div className={styles.editFooter}>
                <button type="button" className={styles.btnCancelar} onClick={() => setAddModal(false)}>Cancelar</button>
                <button type="submit" className={styles.btnGuardarEdit} disabled={guardandoAdd}>
                  {guardandoAdd ? 'Guardando...' : 'Añadir fichaje'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
