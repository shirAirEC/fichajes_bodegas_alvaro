const express = require('express');
const { pool } = require('../db/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { crearNotificacion } = require('./solicitudes');
const { encontrarHorario, timeToMs } = require('./horarios');
const { enviarPush } = require('../firebase');
const { registrarAudit } = require('../audit');

const router = express.Router();

function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || req.ip || '';
}

// POST /api/fichajes/fichar
router.post('/fichar', authMiddleware, async (req, res) => {
  try {
    const { notas = '' } = req.body;
    const empleadoId = req.user.id;

    // Validar red WiFi si está activa
    const { rows: cfgRows } = await pool.query(
      "SELECT clave, valor FROM configuracion WHERE clave IN ('ip_activo','ip_permitidas','gracia_minutos')"
    );
    const cfg = Object.fromEntries(cfgRows.map(r => [r.clave, r.valor]));

    // Leer datos del empleado una sola vez (fichaje_libre + sin_restriccion_ip)
    const { rows: empRows } = await pool.query(
      'SELECT sin_restriccion_ip, fichaje_libre FROM empleados WHERE id = $1', [empleadoId]
    );
    const fichajeLibre = empRows[0]?.fichaje_libre === 1;

    if (cfg.ip_activo === '1') {
      const tieneExencion = empRows[0]?.sin_restriccion_ip === 1;

      if (!tieneExencion) {
        const ipCliente = getClientIP(req);
        const ipsPermitidas = (cfg.ip_permitidas || '').split(',').map(ip => ip.trim()).filter(Boolean);
        if (ipsPermitidas.length === 0) {
          return res.status(403).json({
            error: 'La restricción por red está activa pero no hay ninguna IP configurada. Contacta con el administrador.',
            requiereRed: true
          });
        }
        if (!ipsPermitidas.includes(ipCliente)) {
          return res.status(403).json({
            error: 'No puedes fichar desde esta red. Conéctate al WiFi de la bodega. Si el problema persiste, avisa al administrador para que actualice la configuración.',
            requiereRed: true
          });
        }
      }
    }

    // Determinar tipo por último fichaje (ignorar fichajes con timestamp futuro)
    const { rows: lastRows } = await pool.query(
      'SELECT id, tipo, es_descanso, timestamp, notas FROM fichajes WHERE empleado_id = $1 AND timestamp <= NOW() ORDER BY timestamp DESC, id DESC LIMIT 1',
      [empleadoId]
    );

    // Si el último fichaje es una ENTRADA de un día anterior (sesión sin cerrar),
    // tratamos al empleado como "fuera" para que hoy empiece con una entrada nueva.
    // Excepción: si era un descanso activo (es_descanso=true), sí hay que procesarlo.
    const lastEsDeOtroDia = lastRows[0] && (() => {
      const fechaUltimo = new Date(lastRows[0].timestamp).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' });
      const fechaHoy = new Date().toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' });
      return fechaUltimo !== fechaHoy;
    })();

    const tipo = (!lastRows[0] || lastRows[0].tipo === 'salida' ||
      (lastRows[0].tipo === 'entrada' && lastEsDeOtroDia && !lastRows[0].es_descanso))
      ? 'entrada' : 'salida';

    // Prevenir duplicados: si ya hay un fichaje del mismo tipo en los últimos 30 segundos, retornar el existente
    const { rows: reciente } = await pool.query(
      `SELECT id, tipo, timestamp, notas FROM fichajes
       WHERE empleado_id = $1 AND tipo = $2 AND timestamp > NOW() - INTERVAL '30 seconds'
       ORDER BY timestamp DESC, id DESC LIMIT 1`,
      [empleadoId, tipo]
    );
    if (reciente[0]) {
      return res.status(200).json({ fichaje: reciente[0], tipo, duplicado: true });
    }

    // Detectar retorno de descanso con exceso de tiempo
    let excesoDescanso = null;
    if (tipo === 'entrada' && lastRows[0]?.es_descanso) {
      const breakStartMs = new Date(lastRows[0].timestamp).getTime();
      const breakEndMs = Date.now();
      const realMin = Math.round((breakEndMs - breakStartMs) / 60000);
      const matchNotas = (lastRows[0].notas || '').match(/(\d+)\s*min/);
      const allowedMin = matchNotas ? parseInt(matchNotas[1]) : 30;

      if (realMin > allowedMin) {
        const excessMin = realMin - allowedMin;

        // Insertar una salida real en el momento exacto en que expiró el tiempo permitido
        const horaFinDescanso = new Date(new Date(lastRows[0].timestamp).getTime() + allowedMin * 60000);
        await pool.query(
          `INSERT INTO fichajes (empleado_id, tipo, es_descanso, notas, timestamp)
           VALUES ($1, 'salida', false, $2, $3)`,
          [empleadoId, `Exceso descanso — ${excessMin} min no contabilizados`, horaFinDescanso.toISOString()]
        );

        // Registrar en tabla de excesos para el informe
        await pool.query(
          `INSERT INTO excesos_descanso
             (empleado_id, fecha, hora_inicio_descanso, hora_fin_descanso, minutos_real, minutos_permitido, minutos_exceso, fichaje_descanso_id)
           VALUES ($1, CURRENT_DATE, $2, NOW(), $3, $4, $5, $6)`,
          [empleadoId, lastRows[0].timestamp, realMin, allowedMin, excessMin, lastRows[0].id]
        );
        excesoDescanso = { exceso: excessMin, permitido: allowedMin, real: realMin };
        await crearNotificacion(
          empleadoId,
          `Has superado el tiempo de descanso permitido (${allowedMin} min). Estuviste ${realMin} min en descanso. Los ${excessMin} min de exceso no se contabilizan como jornada laboral.`
        );
      }
    }

    // Aplicar tiempo de gracia usando el horario programado del empleado
    const graciaMinutos = parseInt(cfg.gracia_minutos || '0');
    let timestampFichaje = new Date();

    // Empleados con jornada flexible: saltar todas las validaciones de horario
    if (graciaMinutos > 0 && !fichajeLibre) {
      const graciaMsVal = graciaMinutos * 60 * 1000;
      const fechaHoy = timestampFichaje.toISOString().split('T')[0];
      const horario = await encontrarHorario(empleadoId, fechaHoy);

      if (horario) {
        const inicioDelDia = new Date(timestampFichaje);
        inicioDelDia.setHours(0, 0, 0, 0);
        const msDelDia = timestampFichaje - inicioDelDia;

        const msEntrada = horario.hora_entrada ? timeToMs(horario.hora_entrada) : null;
        const msSalida  = horario.hora_salida  ? timeToMs(horario.hora_salida)  : null;

        // Detectar entrada demasiado anticipada (antes del margen de cortesía)
        // Si el último fichaje era un descanso es un retorno, no una entrada nueva → omitir
        if (!fichajeLibre && tipo === 'entrada' && !lastRows[0]?.es_descanso && msEntrada !== null && msDelDia < msEntrada - graciaMsVal) {
          // Guardar solicitud pendiente de aprobación
          const yaExiste = await pool.query(
            `SELECT id FROM fichajes_anticipados WHERE empleado_id = $1 AND fecha = $2 AND estado = 'pendiente'`,
            [empleadoId, fechaHoy]
          );
          if (!yaExiste.rows[0]) {
            await pool.query(
              `INSERT INTO fichajes_anticipados (empleado_id, hora_intento, hora_entrada_programada, fecha)
               VALUES ($1, NOW(), $2, $3)`,
              [empleadoId, horario.hora_entrada, fechaHoy]
            );
          }

          // Notificar push a todos los administradores
          const { rows: empData } = await pool.query(
            'SELECT nombre, apellidos FROM empleados WHERE id = $1', [empleadoId]
          );
          const nombreEmp = empData[0] ? `${empData[0].nombre} ${empData[0].apellidos}` : 'Un empleado';
          const { rows: admins } = await pool.query(
            `SELECT f.token FROM fcm_tokens f
             JOIN empleados e ON e.id = f.empleado_id
             WHERE e.rol = 'admin' AND f.token IS NOT NULL`
          );
          for (const admin of admins) {
            await enviarPush(
              admin.token,
              'Fichaje anticipado pendiente',
              `${nombreEmp} ha intentado fichar antes del horario permitido. Requiere tu aprobación.`,
              { tipo: 'fichaje_anticipado', empleado_id: String(empleadoId), url: '/admin/fichajes-anticipados' }
            );
          }

          // Formatear hora de entrada para el mensaje
          const [hh, mm] = horario.hora_entrada.split(':');
          const horaEntradaLeg = `${hh}:${mm}`;
          const minutosAntes = graciaMinutos;
          const horaDisponible = new Date(inicioDelDia.getTime() + msEntrada - graciaMsVal);
          const horaDispLeg = horaDisponible.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

          return res.status(403).json({
            requiereAprobacion: true,
            horaEntrada: horaEntradaLeg,
            graciaMinutos: minutosAntes,
            horaDisponible: horaDispLeg,
            error: `No es el horario de entrada. Podrás fichar a partir de las ${horaDispLeg} (${minutosAntes} min antes de las ${horaEntradaLeg}). Este intento ha sido enviado al administrador para su aprobación.`
          });
        }

        // Redondear al horario programado si estamos dentro del margen
        if (msEntrada !== null && Math.abs(msDelDia - msEntrada) <= graciaMsVal) {
          timestampFichaje = new Date(inicioDelDia.getTime() + msEntrada);
        } else if (msSalida !== null && Math.abs(msDelDia - msSalida) <= graciaMsVal) {
          timestampFichaje = new Date(inicioDelDia.getTime() + msSalida);
        }
      } else {
        // Sin horario programado: redondear a la hora exacta más cercana
        const minutos = timestampFichaje.getMinutes();
        const segundos = timestampFichaje.getSeconds();
        const totalSegundos = minutos * 60 + segundos;
        const margenSegundos = graciaMinutos * 60;
        if (totalSegundos <= margenSegundos) {
          timestampFichaje.setMinutes(0, 0, 0);
        } else if (totalSegundos >= 3600 - margenSegundos) {
          timestampFichaje.setHours(timestampFichaje.getHours() + 1, 0, 0, 0);
        }
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO fichajes (empleado_id, tipo, notas, timestamp) VALUES ($1, $2, $3, $4) RETURNING *`,
      [empleadoId, tipo, notas, timestampFichaje]
    );

    res.status(201).json({ fichaje: rows[0], tipo, excesoDescanso });
  } catch (err) {
    console.error('Fichar error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/fichajes/estado
router.get('/estado', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM fichajes WHERE empleado_id = $1 AND timestamp <= NOW() ORDER BY timestamp DESC, id DESC LIMIT 1',
      [req.user.id]
    );
    const ultimo = rows[0] || null;

    // Si el último fichaje fue una entrada de un día anterior (sesión sin cerrar),
    // el empleado se considera "fuera" para el día de hoy.
    const ultimoEsDeOtroDia = ultimo && (() => {
      const fechaUltimo = new Date(ultimo.timestamp).toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' });
      const fechaHoy = new Date().toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid' });
      return fechaUltimo !== fechaHoy;
    })();

    const estaFueraPorSinCerrar = ultimoEsDeOtroDia && ultimo?.tipo === 'entrada' && !ultimo?.es_descanso;
    const dentro = estaFueraPorSinCerrar ? false : (ultimo?.tipo === 'entrada');
    const enDescanso = !dentro && ultimo?.es_descanso === true && !estaFueraPorSinCerrar;

    // Comprobar si ya hubo un descanso hoy
    const { rows: descHoy } = await pool.query(
      `SELECT id, timestamp FROM fichajes
       WHERE empleado_id = $1 AND es_descanso = TRUE AND timestamp::date = CURRENT_DATE
       ORDER BY timestamp DESC LIMIT 1`,
      [req.user.id]
    );
    const yaDescanso = descHoy.length > 0;
    const descansoHoy = descHoy[0] || null;

    // Config descanso: global + por empleado
    const { rows: cfgDesc } = await pool.query(
      "SELECT clave, valor FROM configuracion WHERE clave IN ('descanso_activo','descanso_minutos')"
    );
    const cfgD = Object.fromEntries(cfgDesc.map(r => [r.clave, r.valor]));
    const { rows: empDesc } = await pool.query(
      'SELECT descanso_activo, descanso_minutos FROM empleados WHERE id = $1',
      [req.user.id]
    );
    const empCfg = empDesc[0] || {};

    // Global OFF → nadie; si tiene config propia úsala; si no, hereda global
    const globalActivo = cfgD.descanso_activo !== '0';
    const descansoActivo = !globalActivo
      ? false
      : (empCfg.descanso_activo === null || empCfg.descanso_activo === undefined)
        ? true
        : empCfg.descanso_activo;
    const descansoMinutos = empCfg.descanso_minutos ?? parseInt(cfgD.descanso_minutos || '30');

    // Horario de hoy para mostrar info de cortesía al empleado
    const fechaHoy = new Date().toISOString().split('T')[0];
    const horarioHoy = await encontrarHorario(req.user.id, fechaHoy);

    res.json({
      dentro, enDescanso, ultimoFichaje: ultimo,
      proximoTipo: dentro ? 'salida' : 'entrada',
      yaDescanso, descansoHoy,
      descansoActivo,
      descansoMinutos,
      horarioHoy: horarioHoy ? {
        hora_entrada: horarioHoy.hora_entrada,
        hora_salida: horarioHoy.hora_salida
      } : null
    });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/fichajes/descanso — iniciar pausa (registra salida con es_descanso=true)
router.post('/descanso', authMiddleware, async (req, res) => {
  try {
    const empleadoId = req.user.id;

    // Verificar config descanso (global + por empleado)
    const { rows: cfgRows } = await pool.query(
      "SELECT clave, valor FROM configuracion WHERE clave IN ('ip_activo','ip_permitidas','descanso_activo','descanso_minutos')"
    );
    const cfg = Object.fromEntries(cfgRows.map(r => [r.clave, r.valor]));
    const { rows: empCfgRows } = await pool.query(
      'SELECT sin_restriccion_ip, descanso_activo, descanso_minutos FROM empleados WHERE id = $1',
      [empleadoId]
    );
    const empCfg = empCfgRows[0] || {};

    // Global OFF → nadie; si empleado tiene su propia config úsala; si no, hereda global
    const globalActivo = cfg.descanso_activo !== '0';
    const descansoPermitido = !globalActivo
      ? false
      : (empCfg.descanso_activo === null || empCfg.descanso_activo === undefined)
        ? true
        : empCfg.descanso_activo;

    if (!descansoPermitido) {
      return res.status(403).json({ error: 'El descanso no está disponible para tu cuenta.' });
    }

    const descansoMinutos = empCfg.descanso_minutos ?? parseInt(cfg.descanso_minutos || '30');

    // Solo puede iniciar descanso si está dentro (última acción es entrada)
    const { rows: lastRows } = await pool.query(
      'SELECT tipo FROM fichajes WHERE empleado_id = $1 AND timestamp <= NOW() ORDER BY timestamp DESC LIMIT 1',
      [empleadoId]
    );
    if (!lastRows[0] || lastRows[0].tipo !== 'entrada') {
      return res.status(400).json({ error: 'Solo puedes iniciar el descanso si estás dentro del trabajo.' });
    }

    // Solo un descanso por jornada (por día)
    const { rows: descHoy } = await pool.query(
      `SELECT id FROM fichajes
       WHERE empleado_id = $1 AND es_descanso = TRUE AND timestamp::date = CURRENT_DATE`,
      [empleadoId]
    );
    if (descHoy.length > 0) {
      return res.status(400).json({ error: 'Ya has utilizado el descanso de hoy. Solo se permite un descanso por jornada.' });
    }
    if (cfg.ip_activo === '1') {
      if (!empCfg.sin_restriccion_ip) {
        const ipCliente = getClientIP(req);
        const ipsPermitidas = (cfg.ip_permitidas || '').split(',').map(ip => ip.trim()).filter(Boolean);
        if (ipsPermitidas.length > 0 && !ipsPermitidas.includes(ipCliente)) {
          return res.status(403).json({
            error: 'No puedes registrar el descanso desde esta red.',
            requiereRed: true
          });
        }
      }
    }

    const { rows } = await pool.query(
      `INSERT INTO fichajes (empleado_id, tipo, notas, es_descanso) VALUES ($1, 'salida', $2, TRUE) RETURNING *`,
      [empleadoId, `Descanso ${descansoMinutos} min`]
    );
    res.status(201).json({ fichaje: rows[0], descansoMinutos });
  } catch (err) {
    console.error('Descanso error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/fichajes/descanso — revertir descanso pulsado por error (solo 2 min de plazo)
router.delete('/descanso', authMiddleware, async (req, res) => {
  try {
    const empleadoId = req.user.id;

    // Solo se puede revertir si el estado actual ES descanso (último fichaje es_descanso)
    const { rows: lastRows } = await pool.query(
      'SELECT id, es_descanso, timestamp FROM fichajes WHERE empleado_id = $1 AND timestamp <= NOW() ORDER BY timestamp DESC LIMIT 1',
      [empleadoId]
    );
    if (!lastRows[0] || !lastRows[0].es_descanso) {
      return res.status(400).json({ error: 'No hay ningún descanso activo que revertir.' });
    }

    // Plazo máximo: 2 minutos desde que se registró
    const segundosTranscurridos = (Date.now() - new Date(lastRows[0].timestamp).getTime()) / 1000;
    if (segundosTranscurridos > 120) {
      return res.status(403).json({
        error: 'El plazo de 2 minutos para revertir el descanso ha expirado. Pide al administrador que lo corrija.',
        expirado: true
      });
    }

    await pool.query('DELETE FROM fichajes WHERE id = $1', [lastRows[0].id]);
    res.json({ message: 'Descanso revertido correctamente.' });
  } catch (err) {
    console.error('Revertir descanso error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/fichajes/mis-fichajes
router.get('/mis-fichajes', authMiddleware, async (req, res) => {
  try {
    const { desde, hasta, pagina = 1, limite = 30 } = req.query;
    const offset = (parseInt(pagina) - 1) * parseInt(limite);
    const condiciones = ['empleado_id = $1'];
    const params = [req.user.id];
    let idx = 2;

    if (desde) { condiciones.push(`timestamp::date >= $${idx}::date`); params.push(desde); idx++; }
    if (hasta) { condiciones.push(`timestamp::date <= $${idx}::date`); params.push(hasta); idx++; }

    const where = condiciones.join(' AND ');
    const { rows: countRows } = await pool.query(`SELECT COUNT(*) AS n FROM fichajes WHERE ${where}`, params);
    const total = parseInt(countRows[0].n);

    const { rows: fichajes } = await pool.query(
      `SELECT * FROM fichajes WHERE ${where} ORDER BY timestamp DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(limite), offset]
    );

    res.json({ fichajes, total, pagina: parseInt(pagina), limite: parseInt(limite) });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/fichajes/resumen-hoy
router.get('/resumen-hoy', authMiddleware, async (req, res) => {
  try {
    const { rows: fichajesHoy } = await pool.query(
      `SELECT * FROM fichajes
       WHERE empleado_id = $1 AND timestamp::date = CURRENT_DATE
       ORDER BY timestamp ASC`,
      [req.user.id]
    );
    const minutosHoy = calcularMinutosTrabajados(fichajesHoy);
    res.json({ fichajesHoy, minutosHoy, horasHoy: minutosHoy / 60 });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── ADMIN ────────────────────────────────────────────────────────────────────

// GET /api/fichajes/admin/todos
router.get('/admin/todos', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { empleado_id, desde, hasta, pagina = 1, limite = 50 } = req.query;
    const offset = (parseInt(pagina) - 1) * parseInt(limite);
    const condiciones = [];
    const params = [];
    let idx = 1;

    if (empleado_id) { condiciones.push(`f.empleado_id = $${idx}`); params.push(empleado_id); idx++; }
    if (desde) { condiciones.push(`f.timestamp::date >= $${idx}::date`); params.push(desde); idx++; }
    if (hasta) { condiciones.push(`f.timestamp::date <= $${idx}::date`); params.push(hasta); idx++; }

    const where = condiciones.length > 0 ? 'WHERE ' + condiciones.join(' AND ') : '';

    const { rows: countRows } = await pool.query(
      `SELECT COUNT(*) AS n FROM fichajes f ${where}`, params
    );
    const total = parseInt(countRows[0].n);

    const { rows: fichajes } = await pool.query(
      `SELECT f.*, e.nombre, e.apellidos, e.departamento
       FROM fichajes f JOIN empleados e ON f.empleado_id = e.id
       ${where} ORDER BY f.timestamp DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, parseInt(limite), offset]
    );

    res.json({ fichajes, total, pagina: parseInt(pagina), limite: parseInt(limite) });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/fichajes/admin/resumen
router.get('/admin/resumen', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const fecha = req.query.fecha || new Date().toISOString().split('T')[0];

    const { rows: empleados } = await pool.query(
      "SELECT id, nombre, apellidos, departamento FROM empleados WHERE activo = 1 AND rol = 'empleado'"
    );

    const resumen = await Promise.all(empleados.map(async emp => {
      const { rows: fichajes } = await pool.query(
        `SELECT * FROM fichajes WHERE empleado_id = $1 AND timestamp::date = $2::date ORDER BY timestamp ASC`,
        [emp.id, fecha]
      );
      const ultimo = fichajes[fichajes.length - 1] || null;
      const dentro = ultimo?.tipo === 'entrada';
      const minutos = calcularMinutosTrabajados(fichajes);
      return { ...emp, dentro, minutosTrabajados: minutos,
        horasTrabajadas: (minutos / 60).toFixed(2), ultimoFichaje: ultimo, fichajesToday: fichajes.length };
    }));

    res.json({ fecha, resumen });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/fichajes/admin/jornadas — fichajes agrupados por empleado+día con horas calculadas
router.get('/admin/jornadas', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { empleado_id, desde, hasta } = req.query;

    const hoy = new Date().toISOString().split('T')[0];
    const fechaDesde = desde || new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
    const fechaHasta = hasta || hoy;

    const condiciones = ['f.timestamp::date >= $1::date', 'f.timestamp::date <= $2::date'];
    const params = [fechaDesde, fechaHasta];
    let idx = 3;

    if (empleado_id) { condiciones.push(`f.empleado_id = $${idx}`); params.push(empleado_id); idx++; }

    const where = 'WHERE ' + condiciones.join(' AND ');
    const { rows: fichajes } = await pool.query(
      `SELECT f.*, e.nombre, e.apellidos, e.departamento
       FROM fichajes f JOIN empleados e ON f.empleado_id = e.id
       ${where} ORDER BY f.empleado_id, f.timestamp ASC`,
      params
    );

    // Agrupar por empleado + fecha
    const grupos = {};
    for (const f of fichajes) {
      const fecha = new Date(f.timestamp).toISOString().split('T')[0];
      const key = `${f.empleado_id}_${fecha}`;
      if (!grupos[key]) {
        grupos[key] = {
          empleado_id: f.empleado_id, nombre: f.nombre,
          apellidos: f.apellidos, departamento: f.departamento,
          fecha, fichajes: []
        };
      }
      grupos[key].fichajes.push(f);
    }

    const jornadas = Object.values(grupos).map(g => {
      const minutos = calcularMinutosTrabajados(g.fichajes);
      const entradas = g.fichajes.filter(f => f.tipo === 'entrada');
      const salidas = g.fichajes.filter(f => f.tipo === 'salida');
      const enProgreso = g.fichajes[g.fichajes.length - 1]?.tipo === 'entrada';
      return {
        empleado_id: g.empleado_id, nombre: g.nombre,
        apellidos: g.apellidos, departamento: g.departamento,
        fecha: g.fecha,
        minutosTrabajados: minutos,
        horasTrabajadas: Math.round(minutos / 60 * 100) / 100,
        primeraEntrada: entradas[0]?.timestamp || null,
        ultimaSalida: salidas[salidas.length - 1]?.timestamp || null,
        enProgreso,
        numEntradas: entradas.length,
        numSalidas: salidas.length,
        fichajes: g.fichajes
      };
    }).sort((a, b) => b.fecha.localeCompare(a.fecha) || a.apellidos.localeCompare(b.apellidos));

    res.json({ jornadas, desde: fechaDesde, hasta: fechaHasta });
  } catch (err) {
    console.error('jornadas error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/fichajes/admin/exportar
router.get('/admin/exportar', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { desde, hasta, empleado_id } = req.query;
    const condiciones = [];
    const params = [];
    let idx = 1;

    if (empleado_id) { condiciones.push(`f.empleado_id = $${idx}`); params.push(empleado_id); idx++; }
    if (desde) { condiciones.push(`f.timestamp::date >= $${idx}::date`); params.push(desde); idx++; }
    if (hasta) { condiciones.push(`f.timestamp::date <= $${idx}::date`); params.push(hasta); idx++; }

    const where = condiciones.length > 0 ? 'WHERE ' + condiciones.join(' AND ') : '';
    const { rows } = await pool.query(
      `SELECT f.timestamp, e.nombre, e.apellidos, e.departamento, f.tipo, f.notas
       FROM fichajes f JOIN empleados e ON f.empleado_id = e.id
       ${where} ORDER BY e.apellidos, f.timestamp ASC`,
      params
    );

    const cabecera = 'Fecha y Hora,Nombre,Apellidos,Departamento,Tipo,Notas\n';
    const filas = rows.map(f => {
      const ts = new Date(f.timestamp).toLocaleString('es-ES');
      return `"${ts}","${f.nombre}","${f.apellidos}","${f.departamento}","${f.tipo}","${f.notas}"`;
    }).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="fichajes.csv"`);
    res.send('\uFEFF' + cabecera + filas);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/fichajes/admin — crear fichaje manualmente por administrador
router.post('/admin', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { empleado_id, tipo, fecha, hora, notas = '' } = req.body;
    if (!empleado_id || !tipo || !fecha || !hora) {
      return res.status(400).json({ error: 'Faltan campos obligatorios: empleado_id, tipo, fecha, hora' });
    }
    if (!['entrada', 'salida'].includes(tipo)) {
      return res.status(400).json({ error: 'El tipo debe ser "entrada" o "salida"' });
    }

    const timestamp = new Date(`${fecha}T${hora}:00`);
    if (isNaN(timestamp.getTime())) {
      return res.status(400).json({ error: 'Fecha u hora inválida' });
    }
    if (timestamp > new Date()) {
      return res.status(400).json({ error: 'No se puede crear un fichaje en el futuro' });
    }

    const { rows: empRows } = await pool.query('SELECT id, nombre, apellidos FROM empleados WHERE id = $1', [empleado_id]);
    if (!empRows[0]) return res.status(404).json({ error: 'Empleado no encontrado' });

    const { rows } = await pool.query(
      `INSERT INTO fichajes (empleado_id, tipo, notas, timestamp)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [empleado_id, tipo, notas || 'Añadido por administrador', timestamp]
    );

    const fechaLeg = timestamp.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const horaLeg  = timestamp.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    await crearNotificacion(
      empleado_id,
      `El administrador ha registrado una ${tipo} el ${fechaLeg} a las ${horaLeg}.`
    );
    await registrarAudit(req, 'crear_fichaje', 'fichaje', rows[0].id,
      `Tipo: ${tipo} | Hora: ${fechaLeg} ${horaLeg} | Empleado ID ${empleado_id}${notas ? ` | Notas: ${notas}` : ''}`
    );

    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PUT /api/fichajes/admin/:id — editar fichaje directamente
router.put('/admin/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { tipo, fecha, hora, notificar = true } = req.body;
    const { rows: exist } = await pool.query(
      'SELECT * FROM fichajes WHERE id = $1', [req.params.id]
    );
    if (!exist[0]) return res.status(404).json({ error: 'Fichaje no encontrado' });

    const fichaje = exist[0];
    const nuevoTimestamp = fecha && hora ? new Date(`${fecha}T${hora}:00`) : null;

    if (nuevoTimestamp && nuevoTimestamp > new Date()) {
      return res.status(400).json({ error: 'No se puede establecer un fichaje en el futuro. Las modificaciones deben ser de tiempo pasado.' });
    }

    const { rows } = await pool.query(
      `UPDATE fichajes SET
         tipo = COALESCE($1, tipo),
         timestamp = COALESCE($2, timestamp),
         notas = $3
       WHERE id = $4 RETURNING *`,
      [tipo || null, nuevoTimestamp, `Editado por administrador`, req.params.id]
    );

    const tsAnterior = new Date(fichaje.timestamp).toLocaleString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
    const tsNuevo = nuevoTimestamp ? nuevoTimestamp.toLocaleString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : tsAnterior;
    await registrarAudit(req, 'editar_fichaje', 'fichaje', fichaje.id,
      `Tipo: ${fichaje.tipo}→${tipo || fichaje.tipo} | Hora: ${tsAnterior}→${tsNuevo} | Empleado ID ${fichaje.empleado_id}`
    );

    if (notificar) {
      const fechaLeg = (nuevoTimestamp || new Date(fichaje.timestamp))
        .toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const horaLeg = (nuevoTimestamp || new Date(fichaje.timestamp))
        .toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      await crearNotificacion(
        fichaje.empleado_id,
        `El administrador ha modificado tu fichaje del ${fechaLeg}: ahora registrado como ${tipo || fichaje.tipo} a las ${horaLeg}.`
      );
    }

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/fichajes/admin/:id
router.delete('/admin/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, empleado_id, tipo, timestamp FROM fichajes WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Fichaje no encontrado' });
    const f = rows[0];
    await pool.query('DELETE FROM fichajes WHERE id = $1', [req.params.id]);
    const ts = new Date(f.timestamp).toLocaleString('es-ES', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
    await registrarAudit(req, 'eliminar_fichaje', 'fichaje', f.id,
      `Tipo: ${f.tipo} | Hora: ${ts} | Empleado ID ${f.empleado_id}`
    );
    res.json({ message: 'Fichaje eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── FICHAJES ANTICIPADOS ──────────────────────────────────────────────────────

// GET /api/fichajes/anticipados — admin lista los pendientes
router.get('/anticipados', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { estado = 'pendiente' } = req.query;
    const { rows } = await pool.query(
      `SELECT fa.*, e.nombre, e.apellidos, e.departamento
       FROM fichajes_anticipados fa
       JOIN empleados e ON e.id = fa.empleado_id
       WHERE fa.estado = $1
       ORDER BY fa.created_at DESC`,
      [estado]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/fichajes/anticipados/:id/aprobar — admin aprueba y crea el fichaje
router.post('/anticipados/:id/aprobar', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { admin_nota = '' } = req.body;
    const { rows: anticipados } = await pool.query(
      'SELECT * FROM fichajes_anticipados WHERE id = $1', [req.params.id]
    );
    if (!anticipados[0]) return res.status(404).json({ error: 'Solicitud no encontrada' });
    const ant = anticipados[0];
    if (ant.estado !== 'pendiente') return res.status(400).json({ error: 'Esta solicitud ya fue procesada' });

    // Crear el fichaje con el timestamp del momento del intento
    const { rows: fichaje } = await pool.query(
      `INSERT INTO fichajes (empleado_id, tipo, notas, timestamp)
       VALUES ($1, 'entrada', $2, $3) RETURNING *`,
      [ant.empleado_id, 'Fichaje anticipado aprobado por administrador', ant.hora_intento]
    );

    // Actualizar estado de la solicitud
    await pool.query(
      `UPDATE fichajes_anticipados SET estado = 'aprobado', admin_id = $1, admin_nota = $2, updated_at = NOW()
       WHERE id = $3`,
      [req.user.id, admin_nota, ant.id]
    );

    // Notificar al empleado
    await crearNotificacion(
      ant.empleado_id,
      `El administrador ha aprobado tu fichaje anticipado del ${new Date(ant.hora_intento).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.${admin_nota ? ` Nota: ${admin_nota}` : ''}`
    );

    // Push al empleado si tiene token
    const { rows: tokenEmp } = await pool.query(
      'SELECT token FROM fcm_tokens WHERE empleado_id = $1', [ant.empleado_id]
    );
    if (tokenEmp[0]?.token) {
      await enviarPush(
        tokenEmp[0].token,
        'Fichaje aprobado',
        `Tu entrada anticipada ha sido aprobada por el administrador.${admin_nota ? ` "${admin_nota}"` : ''}`
      );
    }

    res.json({ ok: true, fichaje: fichaje[0] });
  } catch (err) {
    console.error('Aprobar anticipado error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/fichajes/anticipados/:id/rechazar — admin rechaza
router.post('/anticipados/:id/rechazar', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { admin_nota = '' } = req.body;
    const { rows: anticipados } = await pool.query(
      'SELECT * FROM fichajes_anticipados WHERE id = $1', [req.params.id]
    );
    if (!anticipados[0]) return res.status(404).json({ error: 'Solicitud no encontrada' });
    const ant = anticipados[0];
    if (ant.estado !== 'pendiente') return res.status(400).json({ error: 'Esta solicitud ya fue procesada' });

    await pool.query(
      `UPDATE fichajes_anticipados SET estado = 'rechazado', admin_id = $1, admin_nota = $2, updated_at = NOW()
       WHERE id = $3`,
      [req.user.id, admin_nota, ant.id]
    );

    // Notificar al empleado
    await crearNotificacion(
      ant.empleado_id,
      `El administrador ha rechazado tu fichaje anticipado del ${new Date(ant.hora_intento).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}.${admin_nota ? ` Motivo: ${admin_nota}` : ''}`
    );

    // Push al empleado si tiene token
    const { rows: tokenEmp } = await pool.query(
      'SELECT token FROM fcm_tokens WHERE empleado_id = $1', [ant.empleado_id]
    );
    if (tokenEmp[0]?.token) {
      await enviarPush(
        tokenEmp[0].token,
        'Fichaje rechazado',
        `Tu entrada anticipada ha sido rechazada.${admin_nota ? ` "${admin_nota}"` : ''}`
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Rechazar anticipado error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

function calcularDistanciaMetros(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function calcularMinutosTrabajados(fichajes) {
  let minutos = 0;
  let entrada = null;
  for (const f of fichajes) {
    if (f.tipo === 'entrada') {
      entrada = new Date(f.timestamp);
    } else if (f.tipo === 'salida' && entrada) {
      minutos += (new Date(f.timestamp) - entrada) / 60000;
      entrada = null;
    }
  }
  return Math.round(minutos);
}

// ─── Excesos descanso: historial propio ─────────────────────────────────────
router.get('/mis-excesos', authMiddleware, async (req, res) => {
  const empleadoId = req.user.id;
  const { desde, hasta } = req.query;
  const params = [empleadoId];
  let where = 'WHERE ed.empleado_id = $1';
  if (desde) { params.push(desde); where += ` AND ed.fecha >= $${params.length}`; }
  if (hasta) { params.push(hasta); where += ` AND ed.fecha <= $${params.length}`; }

  const { rows } = await pool.query(
    `SELECT ed.id, ed.fecha, ed.hora_inicio_descanso, ed.hora_fin_descanso,
            ed.minutos_real, ed.minutos_permitido, ed.minutos_exceso
     FROM excesos_descanso ed
     ${where}
     ORDER BY ed.fecha DESC, ed.hora_inicio_descanso DESC`,
    params
  );
  res.json({ excesos: rows });
});

// ─── Excesos descanso: informe admin ────────────────────────────────────────
router.get('/admin/excesos', authMiddleware, adminMiddleware, async (req, res) => {
  const { desde, hasta } = req.query;
  const params = [];
  let where = '';
  if (desde) { params.push(desde); where += `${where ? ' AND' : 'WHERE'} ed.fecha >= $${params.length}`; }
  if (hasta) { params.push(hasta); where += `${where ? ' AND' : 'WHERE'} ed.fecha <= $${params.length}`; }

  const { rows } = await pool.query(
    `SELECT e.id, e.nombre, e.apellidos, e.departamento,
            COUNT(ed.id)::int                         AS veces,
            ROUND(AVG(ed.minutos_exceso))::int        AS exceso_promedio,
            SUM(ed.minutos_exceso)::int               AS exceso_total,
            json_agg(
              json_build_object(
                'id', ed.id,
                'fecha', ed.fecha,
                'hora_inicio', ed.hora_inicio_descanso,
                'hora_fin', ed.hora_fin_descanso,
                'minutos_real', ed.minutos_real,
                'minutos_permitido', ed.minutos_permitido,
                'minutos_exceso', ed.minutos_exceso
              ) ORDER BY ed.fecha DESC, ed.hora_inicio_descanso DESC
            )                                         AS detalle
     FROM excesos_descanso ed
     JOIN empleados e ON e.id = ed.empleado_id
     ${where}
     GROUP BY e.id, e.nombre, e.apellidos, e.departamento
     ORDER BY exceso_total DESC`,
    params
  );
  res.json({ empleados: rows });
});

module.exports = router;
