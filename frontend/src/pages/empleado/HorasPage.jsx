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

export default function HorasPage() {
  const { authFetch } = useAuth();
  const [resumen, setResumen] = useState(null);
  const [historial, setHistorial] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [verHistorial, setVerHistorial] = useState(false);

  useEffect(() => {
    authFetch('/api/horas/resumen')
      .then(r => r.json())
      .then(setResumen)
      .finally(() => setCargando(false));
  }, [authFetch]);

  const cargarHistorial = () => {
    if (historial) { setVerHistorial(true); return; }
    authFetch('/api/horas/historial')
      .then(r => r.json())
      .then(d => { setHistorial(d); setVerHistorial(true); });
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
          {balancePos
            ? 'Llevas más horas de las necesarias'
            : 'Te faltan horas por cumplir'}
        </div>
      </div>

      <div className={styles.grid}>
        <TarjetaPeriodo titulo="Esta semana" datos={resumen?.semana} />
        <TarjetaPeriodo titulo="Este mes" datos={resumen?.mes} />
      </div>

      <div className={styles.objetivoInfo}>
        Objetivo: <strong>{resumen?.objetivo?.horas_semana}h/semana</strong> · <strong>{resumen?.objetivo?.horas_mes}h/mes</strong>
      </div>

      <button className={styles.btnHistorial} onClick={cargarHistorial}>
        {verHistorial ? 'Ocultar historial' : 'Ver historial mensual'}
      </button>

      {verHistorial && historial && (
        <div className={styles.historialCard}>
          <h2 className={styles.subtitulo}>Historial mensual</h2>
          <div className={styles.tablaWrap}>
            <table className={styles.tabla}>
              <thead>
                <tr>
                  <th>Mes</th>
                  <th>Trabajadas</th>
                  <th>Objetivo</th>
                  <th>Diferencia</th>
                  <th>Balance acum.</th>
                </tr>
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
