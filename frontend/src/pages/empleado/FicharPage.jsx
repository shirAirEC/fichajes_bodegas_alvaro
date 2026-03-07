import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../../hooks/useAuth';
import styles from './FicharPage.module.css';

function formatTime(date) {
  return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatDate(date) {
  return date.toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function formatDuration(minutos) {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return `${h}h ${m}m`;
}

function formatTimestamp(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

const REVERT_WINDOW_S = 120; // 2 minutos

export default function FicharPage() {
  const { authFetch, user, notificaciones, marcarNotificacionesLeidas, refrescarNotificaciones } = useAuth();
  const [ahora, setAhora] = useState(new Date());
  const [estado, setEstado] = useState(null);
  const [resumen, setResumen] = useState(null);
  const [config, setConfig] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [fichando, setFichando] = useState(false);
  const [descansando, setDescansando] = useState(false);
  const [mensaje, setMensaje] = useState(null);
  const [errorRed, setErrorRed] = useState(null);
  const [errorAnticipado, setErrorAnticipado] = useState(null);
  const [avisoExcesoDescanso, setAvisoExcesoDescanso] = useState(null);
  const [segsRevertir, setSegsRevertir] = useState(null);

  // Reloj en tiempo real
  useEffect(() => {
    const id = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const cargarEstado = useCallback(async () => {
    try {
      const [resEstado, resResumen, resConfig] = await Promise.all([
        authFetch('/api/fichajes/estado'),
        authFetch('/api/fichajes/resumen-hoy'),
        authFetch('/api/config')
      ]);
      setEstado(await resEstado.json());
      setResumen(await resResumen.json());
      setConfig(await resConfig.json());
    } catch (err) {
      console.error(err);
    } finally {
      setCargando(false);
    }
  }, [authFetch]);

  useEffect(() => { cargarEstado(); }, [cargarEstado]);

  // Refrescar notificaciones al entrar a la pantalla (puede haber nuevas desde el último login)
  useEffect(() => { refrescarNotificaciones(); }, [refrescarNotificaciones]);

  // Cuenta atrás para revertir descanso (2 min desde que se registró)
  useEffect(() => {
    if (!estado?.enDescanso || !estado?.descansoHoy) {
      setSegsRevertir(null);
      return;
    }
    const calcular = () => {
      const transcurridos = Math.floor((Date.now() - new Date(estado.descansoHoy.timestamp).getTime()) / 1000);
      const restantes = REVERT_WINDOW_S - transcurridos;
      setSegsRevertir(restantes > 0 ? restantes : 0);
    };
    calcular();
    const id = setInterval(calcular, 1000);
    return () => clearInterval(id);
  }, [estado]);

  const handleFichar = async () => {
    setFichando(true);
    setMensaje(null);
    setErrorRed(null);
    setErrorAnticipado(null);

    try {
      const res = await authFetch('/api/fichajes/fichar', {
        method: 'POST',
        body: JSON.stringify({ notas: '' })
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.requiereRed) {
          setErrorRed(data.error);
        } else if (data.requiereAprobacion) {
          setErrorAnticipado({
            horaEntrada: data.horaEntrada,
            graciaMinutos: data.graciaMinutos,
            horaDisponible: data.horaDisponible
          });
        } else {
          throw new Error(data.error);
        }
        return;
      }

      const tipoLabel = data.tipo === 'entrada' ? 'Entrada registrada' : 'Salida registrada';
      setMensaje({ tipo: 'success', texto: `${tipoLabel} a las ${formatTimestamp(data.fichaje.timestamp)}` });
      if (data.excesoDescanso) {
        const { exceso, permitido, real } = data.excesoDescanso;
        setAvisoExcesoDescanso({ exceso, permitido, real });
      }
      await cargarEstado();
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message || 'Error al registrar fichaje' });
    } finally {
      setFichando(false);
      setTimeout(() => setMensaje(null), 6000);
    }
  };

  const handleDescanso = async () => {
    setDescansando(true);
    setMensaje(null);
    setErrorRed(null);
    try {
      const res = await authFetch('/api/fichajes/descanso', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        if (data.requiereRed) {
          setErrorRed(data.error);
        } else {
          throw new Error(data.error);
        }
        return;
      }
      const mins = data.descansoMinutos ?? 30;
      setMensaje({ tipo: 'success', texto: `Descanso iniciado a las ${formatTimestamp(data.fichaje.timestamp)} · Se acreditarán ${mins} min de tiempo efectivo` });
      await cargarEstado();
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message || 'Error al registrar descanso' });
    } finally {
      setDescansando(false);
      setTimeout(() => setMensaje(null), 8000);
    }
  };

  const handleRevertirDescanso = async () => {
    if (!window.confirm(`¿Revertir el descanso? Se eliminará el registro y no se acreditarán los ${descansoMinutos} minutos.`)) return;
    setDescansando(true);
    setMensaje(null);
    try {
      const res = await authFetch('/api/fichajes/descanso', { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setMensaje({ tipo: 'success', texto: 'Descanso revertido. Puedes continuar trabajando.' });
      await cargarEstado();
    } catch (err) {
      setMensaje({ tipo: 'error', texto: err.message || 'Error al revertir descanso' });
    } finally {
      setDescansando(false);
      setTimeout(() => setMensaje(null), 6000);
    }
  };

  if (cargando) return <div className={styles.loading}>Cargando...</div>;

  const esDentro = estado?.dentro;
  const enDescanso = estado?.enDescanso;
  const yaDescanso = estado?.yaDescanso;
  const descansoActivo = estado?.descansoActivo !== false;
  const descansoMinutos = estado?.descansoMinutos ?? 30;
  const hayNotificaciones = notificaciones?.length > 0;
  const proximoTipo = estado?.proximoTipo;
  const redActiva = config?.ip_activo === '1';

  return (
    <div className={styles.page}>
      {hayNotificaciones && (
        <div className={styles.notifBox}>
          <div className={styles.notifTitulo}>📋 Tienes {notificaciones.length} aviso{notificaciones.length > 1 ? 's' : ''} del administrador</div>
          {notificaciones.map(n => (
            <div key={n.id} className={styles.notifItem}>{n.mensaje}</div>
          ))}
          <button className={styles.notifBtn} onClick={marcarNotificacionesLeidas}>Entendido, marcar como leído</button>
        </div>
      )}

      <div className={styles.relojCard}>
        <div className={styles.fecha}>{formatDate(ahora)}</div>
        <div className={styles.hora}>{formatTime(ahora)}</div>

        <div className={`${styles.estadoBadge} ${esDentro ? styles.dentro : enDescanso ? styles.enDescanso : styles.fuera}`}>
          <span className={styles.estadoDot}></span>
          {esDentro ? 'En el trabajo' : enDescanso ? '☕ En descanso' : 'Fuera del trabajo'}
        </div>

        {redActiva && !errorRed && (
          <div className={styles.geoInfo}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M1.42 9a16 16 0 0121.16 0"/><path d="M5 12.55a11 11 0 0114.08 0"/><path d="M10.54 16.1a6 6 0 012.92 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>
            </svg>
            Verificación por red WiFi activa
          </div>
        )}

        {errorRed && (
          <div className={styles.geoErrorBox}>
            <strong>⚠️ Red no autorizada</strong>
            <br />
            {errorRed}
          </div>
        )}

        {errorAnticipado && (
          <div className={styles.anticipadoBox}>
            <strong>⏰ Fuera del horario de entrada</strong>
            <p>
              Tu hora de entrada es las <strong>{errorAnticipado.horaEntrada}</strong>.
              Podrás fichar normalmente a partir de las <strong>{errorAnticipado.horaDisponible}</strong> ({errorAnticipado.graciaMinutos} min antes).
              Aunque fiches dentro de ese margen, el fichaje se guardará exactamente a las <strong>{errorAnticipado.horaEntrada}</strong>.
            </p>
            <p className={styles.anticipadoSub}>
              Este intento ha sido enviado al administrador para su aprobación. Si lo aprueba, se registrará tu entrada con la hora actual.
            </p>
          </div>
        )}

        {mensaje && (
          <div className={`${styles.mensaje} ${styles[mensaje.tipo]}`}>
            {mensaje.texto}
          </div>
        )}

        {avisoExcesoDescanso && (
          <div className={styles.excesoDescansoBox}>
            <strong>⚠️ Has superado el tiempo de descanso</strong>
            <p>
              Has estado <strong>{avisoExcesoDescanso.real} min</strong> en descanso,
              pero el tiempo permitido es <strong>{avisoExcesoDescanso.permitido} min</strong>.
              Los <strong>{avisoExcesoDescanso.exceso} min</strong> de exceso <strong>no se contabilizan</strong> como jornada laboral.
            </p>
            <button className={styles.excesoDescansoClose} onClick={() => setAvisoExcesoDescanso(null)}>Entendido ✕</button>
          </div>
        )}

        {enDescanso && (
          <div className={styles.descansoInfo}>
            ☕ Estás en descanso. Cuando vuelvas, pulsa <strong>Registrar Entrada</strong>.
            <span className={styles.descansoCredito}>+{descansoMinutos} min acreditados automáticamente</span>
          </div>
        )}

        <button
          className={`${styles.btnFichar} ${proximoTipo === 'entrada' ? styles.btnEntrada : styles.btnSalida}`}
          onClick={handleFichar}
          disabled={fichando || descansando}
        >
          {fichando ? (
            <>
              <span className={styles.spinner}></span>
              Registrando...
            </>
          ) : (
            <>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                {proximoTipo === 'entrada'
                  ? <><path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4"/><polyline points="10,17 15,12 10,7"/><line x1="15" y1="12" x2="3" y2="12"/></>
                  : <><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/></>
                }
              </svg>
              Registrar {proximoTipo === 'entrada' ? 'Entrada' : 'Salida'}
            </>
          )}
        </button>

        {esDentro && !yaDescanso && descansoActivo && (
          <button
            className={styles.btnDescanso}
            onClick={handleDescanso}
            disabled={descansando || fichando}
          >
            {descansando ? (
              <><span className={styles.spinner}></span>Registrando descanso...</>
            ) : (
              <>☕ Iniciar descanso ({descansoMinutos} min)</>
            )}
          </button>
        )}

        {esDentro && yaDescanso && (
          <div className={styles.descansoUsado}>
            ☕ Descanso ya utilizado hoy
          </div>
        )}

        {enDescanso && segsRevertir > 0 && (
          <button
            className={styles.btnRevertirDescanso}
            onClick={handleRevertirDescanso}
            disabled={descansando || fichando}
          >
            ↩ Revertir descanso (pulsado por error) · {segsRevertir}s
          </button>
        )}
        {enDescanso && segsRevertir === 0 && (
          <div className={styles.revertirExpirado}>
            Plazo de corrección expirado · Para corregirlo, avisa al administrador
          </div>
        )}

        {estado?.ultimoFichaje && (
          <p className={styles.ultimoFichaje}>
            Último fichaje: <strong>{estado.ultimoFichaje.tipo}</strong> a las{' '}
            <strong>{formatTimestamp(estado.ultimoFichaje.timestamp)}</strong>
          </p>
        )}
      </div>

      {resumen && (
        <div className={styles.resumenCard}>
          <h2 className={styles.resumenTitle}>Resumen de hoy</h2>

          <div className={styles.statsGrid}>
            <div className={styles.stat}>
              <span className={styles.statValue}>{formatDuration(resumen.minutosHoy)}</span>
              <span className={styles.statLabel}>Tiempo trabajado</span>
            </div>
            <div className={styles.stat}>
              <span className={styles.statValue}>{resumen.fichajesHoy.length}</span>
              <span className={styles.statLabel}>Fichajes hoy</span>
            </div>
          </div>

          {resumen.fichajesHoy.length > 0 && (
            <div className={styles.timeline}>
              {resumen.fichajesHoy.map(f => (
                <div key={f.id} className={`${styles.timelineItem} ${f.tipo === 'entrada' ? styles.tiEntrada : f.es_descanso ? styles.tiDescanso : f.notas?.startsWith('Exceso descanso') ? styles.tiExceso : styles.tiSalida}`}>
                  <div className={styles.tiDot}></div>
                  <div className={styles.tiContent}>
                    <span className={styles.tiTipo}>
                      {f.tipo === 'entrada' ? 'Entrada' : f.es_descanso ? '☕ Descanso' : f.notas?.startsWith('Exceso descanso') ? '⚠️ Exceso descanso' : 'Salida'}
                    </span>
                    <div className={styles.tiRight}>
                      <span className={styles.tiHora}>{formatTimestamp(f.timestamp)}</span>
                      {f.es_descanso && (
                      <span className={styles.tiDescansoBadge}>
                        +{(() => { const m = f.notas?.match(/(\d+)\s*min/); return m ? m[1] : descansoMinutos; })()} min
                      </span>
                    )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
