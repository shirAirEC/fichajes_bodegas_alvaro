const express = require('express');
const { pool } = require('../db/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { crearNotificacion } = require('./solicitudes');
const { encontrarHorario, timeToMs } = require('./horarios');

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

    if (cfg.ip_activo === '1') {
      // Verificar si este empleado tiene exención de IP (teletrabajo)
      const { rows: empRows } = await pool.query(
        'SELECT sin_restriccion_ip FROM empleados WHERE id = $1', [empleadoId]
      );
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
      'SELECT tipo FROM fichajes WHERE empleado_id = $1 AND timestamp <= NOW() ORDER BY timestamp DESC LIMIT 1',
      [empleadoId]
    );
    const tipo = (!lastRows[0] || lastRows[0].tipo === 'salida') ? 'entrada' : 'salida';

    // Aplicar tiempo de gracia usando el horario programado del empleado
    const graciaMinutos = parseInt(cfg.gracia_minutos || '0');
    let timestampFichaje = new Date();

    if (graciaMinutos > 0) {
      const graciaMsVal = graciaMinutos * 60 * 1000;
      const fechaHoy = timestampFichaje.toISOString().split('T')[0];
      const horario = await encontrarHorario(empleadoId, fechaHoy);

      if (horario) {
        // Redondear al horario programado si estamos dentro del margen
        const inicioDelDia = new Date(timestampFichaje);
        inicioDelDia.setHours(0, 0, 0, 0);
        const msDelDia = timestampFichaje - inicioDelDia;

        const msEntrada = horario.hora_entrada ? timeToMs(horario.hora_entrada) : null;
        const msSalida  = horario.hora_salida  ? timeToMs(horario.hora_salida)  : null;

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

    res.status(201).json({ fichaje: rows[0], tipo });
  } catch (err) {
    console.error('Fichar error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/fichajes/estado
router.get('/estado', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT * FROM fichajes WHERE empleado_id = $1 AND timestamp <= NOW() ORDER BY timestamp DESC LIMIT 1',
      [req.user.id]
    );
    const ultimo = rows[0] || null;
    const dentro = ultimo?.tipo === 'entrada';
    const enDescanso = !dentro && ultimo?.es_descanso === true;

    // Comprobar si ya hubo un descanso hoy
    const { rows: descHoy } = await pool.query(
      `SELECT id, timestamp FROM fichajes
       WHERE empleado_id = $1 AND es_descanso = TRUE AND timestamp::date = CURRENT_DATE
       ORDER BY timestamp DESC LIMIT 1`,
      [req.user.id]
    );
    const yaDescanso = descHoy.length > 0;
    const descansoHoy = descHoy[0] || null;

    // Config descanso
    const { rows: cfgDesc } = await pool.query(
      "SELECT clave, valor FROM configuracion WHERE clave IN ('descanso_activo','descanso_minutos')"
    );
    const cfgD = Object.fromEntries(cfgDesc.map(r => [r.clave, r.valor]));

    res.json({
      dentro, enDescanso, ultimoFichaje: ultimo,
      proximoTipo: dentro ? 'salida' : 'entrada',
      yaDescanso, descansoHoy,
      descansoActivo: cfgD.descanso_activo !== '0',
      descansoMinutos: parseInt(cfgD.descanso_minutos || '30')
    });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/fichajes/descanso — iniciar pausa (registra salida con es_descanso=true)
router.post('/descanso', authMiddleware, async (req, res) => {
  try {
    const empleadoId = req.user.id;

    // Verificar config descanso
    const { rows: cfgRows } = await pool.query(
      "SELECT clave, valor FROM configuracion WHERE clave IN ('ip_activo','ip_permitidas','descanso_activo','descanso_minutos')"
    );
    const cfg = Object.fromEntries(cfgRows.map(r => [r.clave, r.valor]));

    if (cfg.descanso_activo === '0') {
      return res.status(403).json({ error: 'El descanso no está disponible en este momento.' });
    }

    const descansoMinutos = parseInt(cfg.descanso_minutos || '30');

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
      const { rows: empRows } = await pool.query(
        'SELECT sin_restriccion_ip FROM empleados WHERE id = $1', [empleadoId]
      );
      if (!empRows[0]?.sin_restriccion_ip) {
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
    const { rows } = await pool.query('SELECT id, empleado_id FROM fichajes WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Fichaje no encontrado' });
    await pool.query('DELETE FROM fichajes WHERE id = $1', [req.params.id]);
    res.json({ message: 'Fichaje eliminado' });
  } catch (err) {
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
      if (f.es_descanso) {
        // Leer duración del descanso desde notas ("Descanso 30 min" o "Descanso 15 min")
        const match = (f.notas || '').match(/(\d+)\s*min/);
        minutos += match ? parseInt(match[1]) : 30;
      }
    }
  }
  return Math.round(minutos);
}

module.exports = router;
