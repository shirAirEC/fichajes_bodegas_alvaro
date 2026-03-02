const express = require('express');
const { pool } = require('../db/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

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
    const { fecha, hora, nombre, pax, estado, tipo_servicio, notas, guia, menu, necesidades_especiales, orden } = req.body;
    if (!fecha || !nombre) return res.status(400).json({ error: 'Fecha y nombre son obligatorios' });

    const { rows } = await pool.query(
      `INSERT INTO reservas (fecha, hora, nombre, pax, estado, tipo_servicio, notas, guia, menu, necesidades_especiales, orden, admin_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12) RETURNING *`,
      [
        fecha, hora || null, nombre, pax ? String(pax) : null,
        estado || 'sin_confirmar', tipo_servicio || '',
        notas || '', guia || '',
        JSON.stringify(Array.isArray(menu) ? menu : []),
        JSON.stringify(Array.isArray(necesidades_especiales) ? necesidades_especiales : []),
        orden || 0, req.user.id
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PUT /api/reservas/:id — actualizar (solo admin)
router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { fecha, hora, nombre, pax, estado, tipo_servicio, notas, guia, menu, necesidades_especiales, orden } = req.body;
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
           updated_at             = NOW()
       WHERE id = $12 RETURNING *`,
      [
        fecha, hora || null, nombre, pax ? String(pax) : null,
        estado, tipo_servicio ?? '',
        notas ?? '', guia ?? '',
        menu !== undefined ? JSON.stringify(menu) : null,
        necesidades_especiales !== undefined ? JSON.stringify(necesidades_especiales) : null,
        orden ?? 0, req.params.id
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Reserva no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/reservas/:id (solo admin)
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM reservas WHERE id = $1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Reserva no encontrada' });
    res.json({ message: 'Reserva eliminada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
