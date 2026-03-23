import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import styles from './AdminExcesosDescansoPage.module.css';
import { savePdf } from '../../lib/savePdf';

function fmtFecha(fechaStr) {
  return new Date(fechaStr + 'T12:00:00').toLocaleDateString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric'
  });
}

function fmtHora(ts) {
  return new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

function fmtMin(min) {
  if (!min) return '0 min';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

const ISO = d => d.toISOString().split('T')[0];

export default function AdminExcesosDescansoPage() {
  const { authFetch } = useAuth();
  const [empleados, setEmpleados] = useState([]);
  const [cargando, setCargando] = useState(true);
  const [desde, setDesde] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return ISO(d);
  });
  const [hasta, setHasta] = useState(() => ISO(new Date()));
  const [expandido, setExpandido] = useState(null);
  const [generandoPdf, setGenerandoPdf] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    const params = new URLSearchParams();
    if (desde) params.set('desde', desde);
    if (hasta) params.set('hasta', hasta);
    const res = await authFetch(`/api/fichajes/admin/excesos?${params}`);
    const data = await res.json();
    setEmpleados(data.empleados || []);
    setCargando(false);
  }, [authFetch, desde, hasta]);

  useEffect(() => { cargar(); }, [cargar]);

  const totalVeces = empleados.reduce((s, e) => s + e.veces, 0);
  const totalMin = empleados.reduce((s, e) => s + e.exceso_total, 0);

  const generarPDF = async () => {
    setGenerandoPdf(true);
    try {
      const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

      // Cabecera
      doc.setFillColor(93, 14, 65);
      doc.rect(0, 0, 210, 32, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(18);
      doc.setFont('helvetica', 'bold');
      doc.text('Bodegas Álvaro', 14, 13);
      doc.setFontSize(11);
      doc.setFont('helvetica', 'normal');
      doc.text('Informe de excesos en descansos', 14, 21);
      doc.setFontSize(9);
      doc.text(`Período: ${fmtFecha(desde)} — ${fmtFecha(hasta)}`, 14, 28);
      doc.text(`Generado: ${new Date().toLocaleString('es-ES')}`, 140, 28);

      doc.setTextColor(0, 0, 0);

      // Resumen global
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text('Resumen global', 14, 42);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.text(`Empleados con excesos: ${empleados.length}`, 14, 50);
      doc.text(`Total de incidencias: ${totalVeces}`, 80, 50);
      doc.text(`Tiempo total excedido: ${fmtMin(totalMin)}`, 145, 50);

      // Tabla resumen
      autoTable(doc, {
        startY: 56,
        head: [['Empleado', 'Departamento', 'Incidencias', 'Exceso prom.', 'Exceso total']],
        body: empleados.map(e => [
          `${e.nombre} ${e.apellidos}`,
          e.departamento || '—',
          e.veces,
          fmtMin(e.exceso_promedio),
          fmtMin(e.exceso_total)
        ]),
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [93, 14, 65], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [249, 245, 248] },
        columnStyles: {
          0: { cellWidth: 55 },
          1: { cellWidth: 40 },
          2: { cellWidth: 25, halign: 'center' },
          3: { cellWidth: 30, halign: 'right' },
          4: { cellWidth: 30, halign: 'right' }
        },
        margin: { left: 14, right: 14 }
      });

      // Detalle por empleado
      empleados.forEach(emp => {
        if (!emp.detalle || emp.detalle.length === 0) return;
        const pageH = doc.internal.pageSize.getHeight();
        if (doc.lastAutoTable.finalY > pageH - 60) doc.addPage();

        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(93, 14, 65);
        doc.text(
          `${emp.nombre} ${emp.apellidos} — ${emp.departamento || ''}`,
          14,
          doc.lastAutoTable.finalY + 10
        );
        doc.setTextColor(0, 0, 0);

        autoTable(doc, {
          startY: doc.lastAutoTable.finalY + 14,
          head: [['Fecha', 'Inicio descanso', 'Fin descanso', 'Tiempo real', 'Permitido', 'Exceso']],
          body: emp.detalle.map(d => [
            fmtFecha(d.fecha),
            fmtHora(d.hora_inicio),
            fmtHora(d.hora_fin),
            `${d.minutos_real} min`,
            `${d.minutos_permitido} min`,
            `+${d.minutos_exceso} min`
          ]),
          styles: { fontSize: 8, cellPadding: 2.5 },
          headStyles: { fillColor: [180, 120, 160], textColor: 255, fontStyle: 'bold' },
          alternateRowStyles: { fillColor: [252, 248, 251] },
          columnStyles: {
            5: { textColor: [180, 50, 0], fontStyle: 'bold' }
          },
          margin: { left: 14, right: 14 }
        });
      });

      // Pie de página
      const pags = doc.getNumberOfPages();
      for (let i = 1; i <= pags; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor(150, 150, 150);
        doc.text(`Bodegas Álvaro · Informe de excesos en descansos · Página ${i} de ${pags}`, 14, 290);
      }

      await savePdf(doc, `informe-excesos-descanso-${desde}-${hasta}.pdf`);
    } finally {
      setGenerandoPdf(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.titulo}>Excesos en descansos</h1>
        <button
          className={styles.btnPdf}
          onClick={generarPDF}
          disabled={generandoPdf || empleados.length === 0}
        >
          {generandoPdf ? 'Generando...' : '↓ Exportar PDF'}
        </button>
      </div>

      <div className={styles.filtros}>
        <label className={styles.filtroGrupo}>
          <span>Desde</span>
          <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className={styles.dateInput} />
        </label>
        <label className={styles.filtroGrupo}>
          <span>Hasta</span>
          <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className={styles.dateInput} />
        </label>
      </div>

      {!cargando && empleados.length > 0 && (
        <div className={styles.resumenGlobal}>
          <div className={styles.stat}>
            <span className={styles.statVal}>{empleados.length}</span>
            <span className={styles.statLbl}>Empleados con excesos</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statVal}>{totalVeces}</span>
            <span className={styles.statLbl}>Total incidencias</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statVal}>{fmtMin(totalMin)}</span>
            <span className={styles.statLbl}>Tiempo total excedido</span>
          </div>
          <div className={styles.stat}>
            <span className={styles.statVal}>{fmtMin(Math.round(totalMin / totalVeces))}</span>
            <span className={styles.statLbl}>Exceso promedio</span>
          </div>
        </div>
      )}

      {cargando ? (
        <div className={styles.loading}>Cargando datos...</div>
      ) : empleados.length === 0 ? (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>✅</span>
          <p>No hay excesos de descanso registrados en el período seleccionado.</p>
        </div>
      ) : (
        <div className={styles.tablaWrap}>
          <table className={styles.tabla}>
            <thead>
              <tr>
                <th>Empleado</th>
                <th>Departamento</th>
                <th className={styles.center}>Incidencias</th>
                <th className={styles.right}>Exceso promedio</th>
                <th className={styles.right}>Exceso total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {empleados.map(emp => (
                <>
                  <tr key={emp.id} className={styles.trEmpleado}>
                    <td className={styles.empNombre}>{emp.nombre} {emp.apellidos}</td>
                    <td className={styles.empDept}>{emp.departamento || '—'}</td>
                    <td className={styles.center}>
                      <span className={styles.veces}>{emp.veces}</span>
                    </td>
                    <td className={styles.right}>{fmtMin(emp.exceso_promedio)}</td>
                    <td className={`${styles.right} ${styles.excesoTotal}`}>{fmtMin(emp.exceso_total)}</td>
                    <td>
                      <button
                        className={styles.btnDetalle}
                        onClick={() => setExpandido(v => v === emp.id ? null : emp.id)}
                      >
                        {expandido === emp.id ? '▲ Ocultar' : '▼ Detalle'}
                      </button>
                    </td>
                  </tr>
                  {expandido === emp.id && (
                    <tr key={`det-${emp.id}`} className={styles.trDetalle}>
                      <td colSpan={6} className={styles.tdDetalle}>
                        <div className={styles.detalleWrap}>
                          <table className={styles.tablaDetalle}>
                            <thead>
                              <tr>
                                <th>Fecha</th>
                                <th>Inicio descanso</th>
                                <th>Fin descanso</th>
                                <th className={styles.right}>Tiempo real</th>
                                <th className={styles.right}>Permitido</th>
                                <th className={styles.right}>Exceso</th>
                              </tr>
                            </thead>
                            <tbody>
                              {emp.detalle.map(d => (
                                <tr key={d.id}>
                                  <td>{fmtFecha(d.fecha)}</td>
                                  <td>{fmtHora(d.hora_inicio)}</td>
                                  <td>{fmtHora(d.hora_fin)}</td>
                                  <td className={styles.right}>{d.minutos_real} min</td>
                                  <td className={styles.right}>{d.minutos_permitido} min</td>
                                  <td className={`${styles.right} ${styles.excesoBadge}`}>+{d.minutos_exceso} min</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
