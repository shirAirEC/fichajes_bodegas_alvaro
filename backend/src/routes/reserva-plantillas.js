const express = require('express');
const { pool } = require('../db/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { generarReservasDesdePlantillas } = require('../jobs/generar-reservas-plantillas');

const router = express.Router();

function parseJsonArray(val) {
  if (Array.isArray(val)) return val;
  return [];
}

function parseDiaSemana(valor) {
  const dia = parseInt(valor, 10);
  if (!Number.isInteger(dia) || dia < 1 || dia > 7) return null;
  return dia;
}

// GET /api/reserva-plantillas — listar plantillas (admin)
// ?activas=0 incluye desactivadas; por defecto solo activas
router.get('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const soloActivas = req.query.activas !== '0';
    const { rows } = await pool.query(
      `SELECT * FROM reserva_plantillas
       ${soloActivas ? 'WHERE activa = 1' : ''}
       ORDER BY dia_semana ASC, hora ASC NULLS LAST, nombre ASC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/reserva-plantillas/generar — generar reservas (manual / pruebas)
// Body opcional: { fecha: 'YYYY-MM-DD' } → semana de esa fecha.
// Sin fecha → semana ENTRANTE (lunes siguiente).
router.post('/generar', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const fecha = req.body?.fecha || req.body?.semana_desde || null;
    if (fecha && !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ error: 'fecha debe ser YYYY-MM-DD' });
    }
    const resultado = await generarReservasDesdePlantillas(fecha ? { fecha } : {});
    res.json(resultado);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Error al generar reservas' });
  }
});

// POST /api/reserva-plantillas — crear plantilla
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const {
      dia_semana, hora, nombre, pax, tipo_servicio, guia, menu, necesidades_especiales,
      turoperador_odoo_id, turoperador_nombre, bus_ref, activa,
    } = req.body;

    if (!dia_semana || !nombre?.trim()) {
      return res.status(400).json({ error: 'Día de la semana y nombre son obligatorios' });
    }
    const dia = parseDiaSemana(dia_semana);
    if (!dia) {
      return res.status(400).json({ error: 'dia_semana debe ser 1 (lunes) … 7 (domingo)' });
    }

    const { rows } = await pool.query(
      `INSERT INTO reserva_plantillas (
         dia_semana, hora, nombre, pax, tipo_servicio, guia, menu, necesidades_especiales,
         turoperador_odoo_id, turoperador_nombre, bus_ref, activa, admin_id
       ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        dia,
        hora || null,
        nombre.trim(),
        pax ? String(pax) : null,
        tipo_servicio || '',
        guia || '',
        JSON.stringify(parseJsonArray(menu)),
        JSON.stringify(parseJsonArray(necesidades_especiales)),
        turoperador_odoo_id || null,
        turoperador_nombre || null,
        bus_ref || null,
        activa === 0 || activa === false ? 0 : 1,
        req.user.id,
      ]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PUT /api/reserva-plantillas/:id — actualizar plantilla
router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const {
      dia_semana, hora, nombre, pax, tipo_servicio, guia, menu, necesidades_especiales,
      turoperador_odoo_id, turoperador_nombre, bus_ref, activa,
    } = req.body;

    const traeCampo = (campo) => Object.prototype.hasOwnProperty.call(req.body, campo);

    let dia = null;
    if (dia_semana != null && dia_semana !== '') {
      dia = parseDiaSemana(dia_semana);
      if (!dia) {
        return res.status(400).json({ error: 'dia_semana debe ser 1 (lunes) … 7 (domingo)' });
      }
    }

    const { rows } = await pool.query(
      `UPDATE reserva_plantillas SET
         dia_semana             = COALESCE($1, dia_semana),
         hora                   = $2,
         nombre                 = COALESCE($3, nombre),
         pax                    = CASE WHEN $4 THEN $5::text ELSE pax END,
         tipo_servicio          = COALESCE($6, tipo_servicio),
         guia                   = COALESCE($7, guia),
         menu                   = COALESCE($8::jsonb, menu),
         necesidades_especiales = COALESCE($9::jsonb, necesidades_especiales),
         turoperador_odoo_id    = CASE WHEN $10 THEN $11::integer ELSE turoperador_odoo_id END,
         turoperador_nombre     = CASE WHEN $10 THEN $12::text    ELSE turoperador_nombre  END,
         bus_ref                = CASE WHEN $13 THEN $14::text   ELSE bus_ref              END,
         activa                 = COALESCE($15, activa),
         updated_at             = NOW()
       WHERE id = $16 RETURNING *`,
      [
        dia,
        hora || null,
        nombre?.trim() || null,
        traeCampo('pax'), pax ? String(pax) : null,
        tipo_servicio ?? null,
        guia ?? null,
        menu !== undefined ? JSON.stringify(parseJsonArray(menu)) : null,
        necesidades_especiales !== undefined ? JSON.stringify(parseJsonArray(necesidades_especiales)) : null,
        traeCampo('turoperador_odoo_id'), turoperador_odoo_id || null, turoperador_nombre || null,
        traeCampo('bus_ref'), bus_ref || null,
        activa === 0 || activa === false ? 0 : (activa === 1 || activa === true ? 1 : null),
        req.params.id,
      ]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Plantilla no encontrada' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/reserva-plantillas/:id — desactivar plantilla (no borra reservas ya generadas)
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `UPDATE reserva_plantillas SET activa = 0, updated_at = NOW()
       WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Plantilla no encontrada' });
    res.json({ message: 'Plantilla desactivada' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
