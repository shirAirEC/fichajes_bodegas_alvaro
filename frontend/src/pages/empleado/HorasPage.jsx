import { useState, useEffect } from 'react';
import { useAuth } from '../../hooks/useAuth';
import styles from './HorasPage.module.css';

const MESES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function fmtH(h) {
  const abs = Math.abs(h);
  const hh = Math.floor(abs);
  const mm = Math.round((abs - hh) * 60);
  const signo = h < 0 ? '-' : '';
  return mm > 0 ? `${signo}${hh}h ${mm}m` : `${signo}${hh}h`;
}

function BarraProgreso({ trabajadas, objetivo }) {
  const pct = objetivo > 0 ? Math.min((trabajadas / objetivo) * 100, 100) : 0;
  const exceso = objetivo > 0 && trabajadas > objetivo;
  return (
    <div className={styles.barra}>
      <div
        className={`${styles.barraRelleno} ${exceso ? styles.barraExceso : ''}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function TarjetaPeriodo({ titulo, datos }) {
  if (!datos) return null;
  const positivo = datos.diferencia >= 0;
  return (
    <div className={styles.tarjeta}>
      <h3 className={styles.tarjetaTitulo}>{titulo}</h3>
      <div className={styles.tarjetaHoras}>
        <span className={styles.horasTrabajadas}>{fmtH(datos.trabajadas)}</span>
        <span className={styles.horasSeparador}>/</span>
        <span className={styles.horasObjetivo}>{fmtH(datos.objetivo)}</span>
      </div>
      <BarraProgreso trabajadas={datos.trabajadas} objetivo={datos.objetivo} />
      <div className={`${styles.diferencia} ${positivo ? styles.positivo : styles.negativo}`}>
        {positivo ? '▲' : '▼'} {fmtH(Math.abs(datos.diferencia))}
        {positivo ? ' de sobra' : ' pendientes'}
        {datos.ajuste !== 0 && (
          <span className={styles.ajusteNote}> (incl. {datos.ajuste > 0 ? '+' : ''}{fmtH(datos.ajuste)} ajuste)</span>
        )}
      </div>
    </div>
  );
}

const hoy = new Date();
const ISO = d => d.toISOString().split('T')[0];

export default function HorasPage() {
  const { authFetch } = useAuth();
  const [resumen, setResumen] = useState(null);
  const [historial, setHistorial] = useState(null);
  const [filtro, setFiltro] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [cargandoFiltro, setCargandoFiltro] = useState(false);
  const [verHistorial, setVerHistorial] = useState(false);

  // Filtro avanzado
  const [modo, setModo] = useState('semana');
  const [desde, setDesde] = useState(ISO(new Date(hoy.getFullYear(), hoy.getMonth(), 1)));
  const [hasta, setHasta] = useState(ISO(hoy));

  useEffect(() => {
    authFetch('/api/horas/resumen')
      .then(r => r.json())
      .then(setResumen)
      .finally(() => setCargando(false));
  }, [authFetch]);

  const cargarHistorial = () => {
    if (historial) { setVerHistorial(v => !v); return; }
    authFetch('/api/horas/historial')
      .then(r => r.json())
      .then(d => { setHistorial(d); setVerHistorial(true); });
  };

  const aplicarFiltro = async () => {
    setCargandoFiltro(true);
    const params = new URLSearchParams({ modo });
    if (modo === 'rango') { params.set('desde', desde); params.set('hasta', hasta); }
    const res = await authFetch(`/api/horas/filtro?${params}`);
    setFiltro(await res.json());
    setCargandoFiltro(false);
  };

  if (cargando) return <div className={styles.loading}>Cargando horas...</div>;

  const balancePos = (resumen?.balanceAcumulado ?? 0) >= 0;

  return (
    <div className={styles.page}>
      <h1 className={styles.titulo}>Mis horas</h1>

      <div className={`${styles.balanceAcum} ${balancePos ? styles.balancePos : styles.balanceNeg}`}>
        <div className={styles.balanceLabel}>Balance acumulado</div>
        <div className={styles.balanceValor}>
          {balancePos ? '+' : ''}{fmtH(resumen?.balanceAcumulado ?? 0)}
        </div>
        <div className={styles.balanceDesc}>
          {balancePos ? 'Llevas más horas de las necesarias' : 'Te faltan horas por cumplir'}
        </div>
      </div>

      <div className={styles.grid}>
        <TarjetaPeriodo titulo="Esta semana" datos={resumen?.semana} />
        <TarjetaPeriodo titulo="Este mes" datos={resumen?.mes} />
      </div>

      <div className={styles.objetivoInfo}>
        Objetivo: <strong>{resumen?.objetivo?.horas_semana}h/semana</strong> · <strong>{resumen?.objetivo?.horas_mes}h/mes</strong>
      </div>

      {/* Filtro avanzado */}
      <div className={styles.filtroCard}>
        <h2 className={styles.subtitulo}>Consulta personalizada</h2>
        <div className={styles.filtroRow}>
          <div className={styles.filtroModos}>
            {[['semana','Esta semana'],['mes','Este mes'],['anio','Este año'],['rango','Rango']].map(([v,l]) => (
              <button key={v} className={`${styles.modoBtn} ${modo === v ? styles.modoBtnActivo : ''}`} onClick={() => setModo(v)}>{l}</button>
            ))}
          </div>
          {modo === 'rango' && (
            <div className={styles.rangoInputs}>
              <input type="date" value={desde} onChange={e => setDesde(e.target.value)} className={styles.dateInput} />
              <span>—</span>
              <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} className={styles.dateInput} />
            </div>
          )}
          <button className={styles.btnConsultar} onClick={aplicarFiltro} disabled={cargandoFiltro}>
            {cargandoFiltro ? 'Cargando...' : 'Consultar'}
          </button>
        </div>

        {filtro && (
          <div className={styles.filtroResultado}>
            <div className={styles.filtroStats}>
              <div className={styles.fStat}>
                <span className={styles.fStatVal}>{fmtH(filtro.trabajadas)}</span>
                <span className={styles.fStatLbl}>Trabajadas</span>
              </div>
              <div className={styles.fStat}>
                <span className={styles.fStatVal}>{fmtH(filtro.objetivoPeriodo)}</span>
                <span className={styles.fStatLbl}>Objetivo periodo</span>
              </div>
              <div className={`${styles.fStat} ${filtro.diferencia >= 0 ? styles.positivo : styles.negativo}`}>
                <span className={styles.fStatVal}>{filtro.diferencia >= 0 ? '+' : ''}{fmtH(filtro.diferencia)}</span>
                <span className={styles.fStatLbl}>Balance</span>
              </div>
            </div>
            {filtro.desgloseDiario?.length > 0 && (
              <div className={styles.tablaWrap} style={{ marginTop: '0.75rem' }}>
                <table className={styles.tabla}>
                  <thead><tr><th>Día</th><th>Horas trabajadas</th></tr></thead>
                  <tbody>
                    {filtro.desgloseDiario.map(d => (
                      <tr key={d.fecha}>
                        <td>{new Date(d.fecha + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                        <td>{fmtH(d.horas)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>

      <button className={styles.btnHistorial} onClick={cargarHistorial}>
        {verHistorial ? 'Ocultar historial mensual' : 'Ver historial mensual'}
      </button>

      {verHistorial && historial && (
        <div className={styles.historialCard}>
          <h2 className={styles.subtitulo}>Historial mensual</h2>
          <div className={styles.tablaWrap}>
            <table className={styles.tabla}>
              <thead>
                <tr><th>Mes</th><th>Trabajadas</th><th>Objetivo</th><th>Diferencia</th><th>Balance acum.</th></tr>
              </thead>
              <tbody>
                {historial.historial?.map(m => {
                  const pos = m.diferencia >= 0;
                  return (
                    <tr key={`${m.anio}-${m.mes}`}>
                      <td>{MESES[m.mes - 1]} {m.anio}</td>
                      <td>{fmtH(m.trabajadas)}</td>
                      <td>{fmtH(m.objetivo)}</td>
                      <td className={pos ? styles.positivo : styles.negativo}>
                        {pos ? '+' : ''}{fmtH(m.diferencia)}
                        {m.ajuste !== 0 && <span className={styles.ajusteTag}> *</span>}
                      </td>
                      <td className={(m.balanceAcumulado >= 0) ? styles.positivo : styles.negativo}>
                        {m.balanceAcumulado >= 0 ? '+' : ''}{fmtH(m.balanceAcumulado)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className={styles.nota}>* Mes con ajuste manual incluido</p>
        </div>
      )}
    </div>
  );
}
