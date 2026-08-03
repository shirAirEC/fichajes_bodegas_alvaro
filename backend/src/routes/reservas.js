const express = require('express');
const { pool } = require('../db/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { isOdooSyncRequest } = require('../middleware/odooSyncAuth');
const { enviarPushMultiple } = require('../firebase');
const { syncReservaToOdoo, deleteReservaFromOdoo, camposVaciados } = require('../sync/sync-reservas');

const router = express.Router();

function triggerReservaSync(reservaId, deleted = false, vaciados = []) {
  if (deleted) {
    deleteReservaFromOdoo(reservaId).catch((err) => {
      console.error('[odoo-sync] reserva', reservaId, err.message);
    });
    return;
  }
  syncReservaToOdoo(reservaId, vaciados).catch((err) => {
    console.error('[odoo-sync] reserva', reservaId, err.message);
  });
}

// Crea un aviso y envía push SOLO al usuario de Planificación
async function notificarCambioPlanificacion(adminId, titulo, mensaje) {
  try {
    // Buscar el usuario de Planificación (y su token FCM si lo tiene)
    const { rows: planUsers } = await pool.query(
      `SELECT e.id, f.token
       FROM empleados e
       LEFT JOIN fcm_tokens f ON f.empleado_id = e.id
       WHERE e.activo = 1
         AND (LOWER(e.nombre || ' ' || e.apellidos) LIKE '%planificaci%'
              OR LOWER(e.nombre || ' ' || e.apellidos) LIKE '%planificacion%')
       LIMIT 1`
    );
    const planUser = planUsers[0] || null;

    // Crear aviso con destinatario_id específico → solo ese usuario lo ve y confirma
    const { rows } = await pool.query(
      `INSERT INTO avisos (admin_id, titulo, mensaje, destinatario_id)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [adminId, titulo, mensaje, planUser?.id ?? null]
    );
    const avisoId = rows[0].id;

    // Enviar push solo si ese usuario tiene token registrado
    if (planUser?.token) {
      await enviarPushMultiple(
        [planUser.token],
        titulo,
        mensaje,
        { tipo: 'cambio_planificacion', aviso_id: String(avisoId) }
      );
    }
  } catch (err) {
    console.error('Error notificando cambio planificación:', err.message);
  }
}

// Middleware: acceso público solo con token TV
async function tvTokenMiddleware(req, res, next) {
  try {
    const { rows } = await pool.query("SELECT valor FROM configuracion WHERE clave = 'tv_token'");
    const token = rows[0]?.valor;
    if (token && req.query.token === token) return next();
    res.status(401).json({ error: 'Token inválido para pantalla TV' });
  } catch {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
}

// Construye cláusula WHERE + params para filtros de fecha
function buildFiltros(query, startIdx = 1) {
  const { desde, hasta, since } = query;
  const conditions = [];
  const params = [];
  let idx = startIdx;

  if (desde) { conditions.push(`fecha >= $${idx}::date`); params.push(desde); idx++; }
  if (hasta) { conditions.push(`fecha <= $${idx}::date`); params.push(hasta); idx++; }
  if (since) { conditions.push(`updated_at > $${idx}::timestamptz`); params.push(since); idx++; }

  return { conditions, params, nextIdx: idx };
}

// GET /api/reservas — lista (empleados y admin autenticados)
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { conditions, params } = buildFiltros(req.query);
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const { rows } = await pool.query(
      `SELECT * FROM reservas ${where} ORDER BY fecha ASC, orden ASC, hora ASC NULLS LAST`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/reservas/tv — acceso público con token (para la pantalla TV)
router.get('/tv', tvTokenMiddleware, async (req, res) => {
  try {
    const hoy = new Date().toISOString().split('T')[0];
    const defaultHasta = new Date(Date.now() + 6 * 86400000).toISOString().split('T')[0];
    const desde = req.query.desde || hoy;
    const hasta = req.query.hasta || defaultHasta;

    const conditions = ['fecha >= $1::date', 'fecha <= $2::date'];
    const params = [desde, hasta];

    if (req.query.since) {
      conditions.push('updated_at > $3::timestamptz');
      params.push(req.query.since);
    }

    const { rows } = await pool.query(
      `SELECT * FROM reservas WHERE ${conditions.join(' AND ')} ORDER BY fecha ASC, orden ASC, hora ASC NULLS LAST`,
      params
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/reservas — crear (solo admin)
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const {
      fecha, hora, nombre, pax, estado, tipo_servicio, notas, guia, menu, necesidades_especiales, orden,
      turoperador_odoo_id, turoperador_nombre, bus_ref, pax_confirmado,
      pax_ninos, servicio_ninos_odoo_id, servicio_ninos_nombre,
    } = req.body;
    if (!fecha || !nombre) return res.status(400).json({ error: 'Fecha y nombre son obligatorios' });

    const numeroONulo = (valor) => (valor !== undefined && valor !== null && valor !== '' ? parseInt(valor, 10) : null);

    const { rows } = await pool.query(
      `INSERT INTO reservas (
         fecha, hora, nombre, pax, estado, tipo_servicio, notas, guia, menu, necesidades_especiales, orden, admin_id,
         turoperador_odoo_id, turoperador_nombre, bus_ref, pax_confirmado,
         pax_ninos, servicio_ninos_odoo_id, servicio_ninos_nombre
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING *`,
      [
        fecha, hora || null, nombre, pax ? String(pax) : null,
        estado || 'sin_confirmar', tipo_servicio || '',
        notas || '', guia || '',
        JSON.stringify(Array.isArray(menu) ? menu : []),
        JSON.stringify(Array.isArray(necesidades_especiales) ? necesidades_especiales : []),
        orden || 0, req.user.id,
        turoperador_odoo_id || null, turoperador_nombre || null, bus_ref || null,
        numeroONulo(pax_confirmado),
        numeroONulo(pax_ninos), servicio_ninos_odoo_id || null, servicio_ninos_nombre || null,
      ]
    );
    const reserva = rows[0];
    const fechaStr = new Date(reserva.fecha + 'T00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    notificarCambioPlanificacion(
      req.user.id,
      'Planificacion actualizada',
      `Nueva reserva: ${reserva.nombre} el ${fechaStr}${reserva.hora ? ' a las ' + reserva.hora.slice(0,5) : ''}`
    );
    if (!isOdooSyncRequest(req)) {
      triggerReservaSync(reserva.id);
    }
    res.status(201).json(reserva);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PUT /api/reservas/:id — actualizar (solo admin)
router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const {
      fecha, hora, nombre, pax, estado, tipo_servicio, notas, guia, menu, necesidades_especiales, orden,
      turoperador_odoo_id, turoperador_nombre, bus_ref, pax_confirmado,
      pax_ninos, servicio_ninos_odoo_id, servicio_ninos_nombre,
    } = req.body;

    // Estado anterior: hace falta para saber qué ha vaciado el administrador a
    // propósito en esta edición (eso sí debe borrarse también en Odoo) frente
    // a lo que simplemente nunca se rellenó (eso no se toca allí).
    const { rows: previas } = await pool.query('SELECT * FROM reservas WHERE id = $1', [req.params.id]);
    const antes = previas[0];
    if (!antes) return res.status(404).json({ error: 'Reserva no encontrada' });

    // Los datos de facturación solo se tocan si vienen en la petición: así una
    // actualización parcial (o una llamada de otro cliente) no los borra.
    const traeCampo = (nombreCampo) => Object.prototype.hasOwnProperty.call(req.body, nombreCampo);
    const numeroONulo = (valor) => (valor !== undefined && valor !== null && valor !== '' ? parseInt(valor, 10) : null);

    const { rows } = await pool.query(
      `UPDATE reservas
       SET fecha                  = COALESCE($1, fecha),
           hora                   = $2,
           nombre                 = COALESCE($3, nombre),
           pax                    = $4,
           estado                 = COALESCE($5, estado),
           tipo_servicio          = COALESCE($6, tipo_servicio),
           notas                  = COALESCE($7, notas),
           guia                   = COALESCE($8, guia),
           menu                   = COALESCE($9::jsonb, menu),
           necesidades_especiales = COALESCE($10::jsonb, necesidades_especiales),
           orden                  = COALESCE($11, orden),
           turoperador_odoo_id    = CASE WHEN $12 THEN $13::integer ELSE turoperador_odoo_id END,
           turoperador_nombre     = CASE WHEN $12 THEN $14::text    ELSE turoperador_nombre  END,
           bus_ref                = CASE WHEN $15 THEN $16::text    ELSE bus_ref             END,
           pax_confirmado         = CASE WHEN $17 THEN $18::integer ELSE pax_confirmado      END,
           pax_ninos              = CASE WHEN $19 THEN $20::integer ELSE pax_ninos           END,
           servicio_ninos_odoo_id = CASE WHEN $21 THEN $22::integer ELSE servicio_ninos_odoo_id END,
           servicio_ninos_nombre  = CASE WHEN $21 THEN $23::text    ELSE servicio_ninos_nombre  END,
           updated_at             = NOW()
       WHERE id = $24 RETURNING *`,
      [
        fecha, hora || null, nombre, pax ? String(pax) : null,
        estado, tipo_servicio ?? '',
        notas ?? '', guia ?? '',
        menu !== undefined ? JSON.stringify(menu) : null,
        necesidades_especiales !== undefined ? JSON.stringify(necesidades_especiales) : null,
        orden ?? 0,
        traeCampo('turoperador_odoo_id'), turoperador_odoo_id || null, turoperador_nombre || null,
        traeCampo('bus_ref'), bus_ref || null,
        traeCampo('pax_confirmado'), numeroONulo(pax_confirmado),
        traeCampo('pax_ninos'), numeroONulo(pax_ninos),
        traeCampo('servicio_ninos_odoo_id'), servicio_ninos_odoo_id || null, servicio_ninos_nombre || null,
        req.params.id
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Reserva no encontrada' });
    const reserva = rows[0];
    const vaciados = camposVaciados(antes, reserva);
    const fechaStr = new Date(reserva.fecha + 'T00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    notificarCambioPlanificacion(
      req.user.id,
      'Planificacion actualizada',
      `Cambio en reserva: ${reserva.nombre} el ${fechaStr}${reserva.hora ? ' a las ' + reserva.hora.slice(0,5) : ''}`
    );
    if (!isOdooSyncRequest(req)) {
      triggerReservaSync(reserva.id, false, vaciados);
    }
    res.json(reserva);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/reservas/informe — informe mensual (admin, JSON o CSV)
router.get('/informe', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const mes = req.query.mes; // YYYY-MM
    if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
      return res.status(400).json({ error: 'Parámetro mes requerido con formato YYYY-MM' });
    }
    const desde = `${mes}-01`;
    const [y, m] = mes.split('-').map(Number);
    const ultimoDia = new Date(y, m, 0).getDate();
    const hasta = `${mes}-${String(ultimoDia).padStart(2, '0')}`;

    const { rows } = await pool.query(
      `SELECT * FROM reservas WHERE fecha >= $1::date AND fecha <= $2::date ORDER BY fecha ASC, orden ASC, hora ASC NULLS LAST`,
      [desde, hasta]
    );

    const formato = req.query.formato;

    if (formato === 'csv') {
      const lineas = [
        ['Fecha', 'Hora', 'Grupo', 'Turoperadora', 'Pax', 'Pax confirmado', 'Tipo servicio', 'Bus/Guagua', 'Estado', 'Guía', 'Necesidades especiales', 'Notas'].join(';')
      ];
      for (const r of rows) {
        const nec = Array.isArray(r.necesidades_especiales)
          ? r.necesidades_especiales.map(n => `${n.cantidad}x ${n.tipo}`).join(', ')
          : '';
        lineas.push([
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
        ].join(';'));
      }
      const bom = '\uFEFF';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="informe_reservas_${mes}.csv"`);
      return res.send(bom + lineas.join('\n'));
    }

    // JSON: devolver datos + resumen
    let totalPax = 0;
    const porEstado = {};
    const porTipo = {};
    const porDia = {};
    const necesidadesAgg = {};

    for (const r of rows) {
      const paxNum = parseInt(r.pax, 10) || 0;
      totalPax += paxNum;
      porEstado[r.estado] = (porEstado[r.estado] || 0) + 1;
      const tipo = r.tipo_servicio || 'Sin especificar';
      porTipo[tipo] = (porTipo[tipo] || { grupos: 0, pax: 0 });
      porTipo[tipo].grupos++;
      porTipo[tipo].pax += paxNum;

      if (!porDia[r.fecha]) porDia[r.fecha] = [];
      porDia[r.fecha].push(r);

      if (Array.isArray(r.necesidades_especiales)) {
        for (const n of r.necesidades_especiales) {
          const key = (n.tipo || '').toLowerCase().trim();
          if (key) necesidadesAgg[key] = (necesidadesAgg[key] || 0) + (n.cantidad || 1);
        }
      }
    }

    res.json({
      mes, desde, hasta,
      totalGrupos: rows.length,
      totalPax,
      porEstado,
      porTipo,
      necesidades: necesidadesAgg,
      porDia,
      reservas: rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/reservas/:id (solo admin)
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { rows: prev } = await pool.query('SELECT nombre, fecha FROM reservas WHERE id = $1', [req.params.id]);
    const { rowCount } = await pool.query('DELETE FROM reservas WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Reserva no encontrada' });
    if (prev[0]) {
      const fechaStr = new Date(prev[0].fecha + 'T00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
      notificarCambioPlanificacion(
        req.user.id,
        'Planificacion actualizada',
        `Reserva cancelada: ${prev[0].nombre} el ${fechaStr}`
      );
    }
    if (!isOdooSyncRequest(req)) {
      triggerReservaSync(parseInt(req.params.id, 10), true);
    }
    res.json({ message: 'Reserva eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
