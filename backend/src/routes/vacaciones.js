const express = require('express');
const { pool } = require('../db/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { isOdooSyncRequest } = require('../middleware/odooSyncAuth');

const router = express.Router();

const { syncVacacionToOdoo, deleteVacacionFromOdoo } = require('../sync/sync-vacaciones');

function triggerVacacionSync(req, vacacionId, deleted = false) {
  if (isOdooSyncRequest(req)) return;
  const fn = deleted ? deleteVacacionFromOdoo : syncVacacionToOdoo;
  fn(vacacionId).catch((err) => {
    console.error('[odoo-sync] vacacion', vacacionId, err.message);
  });
}

const TIPOS_AUSENCIA = ['vacaciones', 'permiso_especial', 'baja_medica'];
const TIPO_LABELS = {
  vacaciones: 'Vacaciones',
  permiso_especial: 'Permiso especial',
  baja_medica: 'Baja médica',
};

// Número de días naturales entre dos fechas ISO (ambas incluidas)
function diasEntreFechas(inicio, fin) {
  const d1 = new Date(inicio + 'T12:00:00');
  const d2 = new Date(fin + 'T12:00:00');
  return Math.round((d2 - d1) / 86400000) + 1;
}

// GET /api/vacaciones?empleado_id=X
router.get('/', authMiddleware, async (req, res) => {
  try {
    const isAdmin = req.user.rol === 'admin';
    const empId = isAdmin ? (req.query.empleado_id || null) : req.user.id;

    let rows;
    if (empId) {
      ({ rows } = await pool.query(
        `SELECT v.id, v.empleado_id, v.fecha_inicio, v.fecha_fin, v.tipo, v.motivo, v.saldo_id, v.created_at,
                e.nombre, e.apellidos
           FROM vacaciones v JOIN empleados e ON v.empleado_id = e.id
          WHERE v.empleado_id = $1
          ORDER BY v.fecha_inicio DESC`,
        [empId]
      ));
    } else {
      ({ rows } = await pool.query(
        `SELECT v.id, v.empleado_id, v.fecha_inicio, v.fecha_fin, v.tipo, v.motivo, v.saldo_id, v.created_at,
                e.nombre, e.apellidos
           FROM vacaciones v JOIN empleados e ON v.empleado_id = e.id
          ORDER BY e.apellidos, v.fecha_inicio DESC`
      ));
    }
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/vacaciones  — crea el período y descuenta automáticamente los días del saldo
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const { empleado_id, fecha_inicio, fecha_fin, tipo = 'vacaciones', motivo } = req.body;

    if (!empleado_id || !fecha_inicio || !fecha_fin) {
      return res.status(400).json({ error: 'empleado_id, fecha_inicio y fecha_fin son obligatorios' });
    }
    if (!TIPOS_AUSENCIA.includes(tipo)) {
      return res.status(400).json({ error: `Tipo inválido. Permitidos: ${TIPOS_AUSENCIA.join(', ')}` });
    }
    if (fecha_inicio > fecha_fin) {
      return res.status(400).json({ error: 'La fecha de inicio debe ser anterior o igual a la de fin' });
    }

    await client.query('BEGIN');

    // 1. Crear el apunte de saldo negativo (descuento automático, sin validar saldo disponible)
    const dias = diasEntreFechas(fecha_inicio, fecha_fin);
    const concepto = `${TIPO_LABELS[tipo]}: ${fecha_inicio} – ${fecha_fin}${motivo ? ` (${motivo})` : ''}`;

    const { rows: saldoRows } = await client.query(
      `INSERT INTO saldos (empleado_id, tipo, cantidad, concepto, admin_id, fecha_referencia)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [empleado_id, tipo, -dias, concepto, req.user.id, fecha_inicio]
    );
    const saldo_id = saldoRows[0].id;

    // 2. Crear el período de ausencia vinculado al apunte de saldo
    const { rows: vacRows } = await client.query(
      `INSERT INTO vacaciones (empleado_id, fecha_inicio, fecha_fin, tipo, motivo, saldo_id, admin_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [empleado_id, fecha_inicio, fecha_fin, tipo, motivo || '', saldo_id, req.user.id]
    );

    await client.query('COMMIT');
    triggerVacacionSync(req, vacRows[0].id);
    res.json({ ...vacRows[0], dias });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    client.release();
  }
});

// PUT /api/vacaciones/:id — actualiza fechas/tipo/motivo y ajusta saldo
router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows: existing } = await client.query(
      'SELECT * FROM vacaciones WHERE id = $1',
      [req.params.id]
    );
    if (!existing[0]) return res.status(404).json({ error: 'No encontrado' });
    const vac = existing[0];

    const fecha_inicio = req.body.fecha_inicio || vac.fecha_inicio;
    const fecha_fin = req.body.fecha_fin || vac.fecha_fin;
    const tipo = req.body.tipo || vac.tipo;
    const motivo = req.body.motivo !== undefined ? req.body.motivo : vac.motivo;

    if (!TIPOS_AUSENCIA.includes(tipo)) {
      return res.status(400).json({ error: `Tipo inválido. Permitidos: ${TIPOS_AUSENCIA.join(', ')}` });
    }
    if (fecha_inicio > fecha_fin) {
      return res.status(400).json({ error: 'La fecha de inicio debe ser anterior o igual a la de fin' });
    }

    const dias = diasEntreFechas(fecha_inicio, fecha_fin);
    const concepto = `${TIPO_LABELS[tipo]}: ${fecha_inicio} – ${fecha_fin}${motivo ? ` (${motivo})` : ''}`;

    await client.query('BEGIN');
    if (vac.saldo_id) {
      await client.query(
        `UPDATE saldos SET cantidad = $1, concepto = $2, tipo = $3, fecha_referencia = $4 WHERE id = $5`,
        [-dias, concepto, tipo, fecha_inicio, vac.saldo_id]
      );
    }
    const { rows } = await client.query(
      `UPDATE vacaciones
       SET fecha_inicio = $1, fecha_fin = $2, tipo = $3, motivo = $4
       WHERE id = $5 RETURNING *`,
      [fecha_inicio, fecha_fin, tipo, motivo || '', req.params.id]
    );
    await client.query('COMMIT');
    triggerVacacionSync(req, rows[0].id);
    res.json({ ...rows[0], dias });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    client.release();
  }
});

// DELETE /api/vacaciones/:id  — elimina el período y el saldo asociado
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  const client = await pool.connect();
  try {
    const { rows } = await client.query('SELECT * FROM vacaciones WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'No encontrado' });

    await client.query('BEGIN');
    const vac = rows[0];

    // Eliminar el apunte de saldo asociado si existe
    if (vac.saldo_id) {
      await client.query('DELETE FROM saldos WHERE id = $1', [vac.saldo_id]);
    }

    await client.query('DELETE FROM vacaciones WHERE id = $1', [req.params.id]);
    await client.query('COMMIT');
    triggerVacacionSync(req, vac.id, true);
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  } finally {
    client.release();
  }
});

module.exports = router;
