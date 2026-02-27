const express = require('express');
const { pool } = require('../db/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();
const TIPOS_SALDO = ['vacaciones', 'horas_extra', 'permiso_especial', 'baja_medica'];

router.get('/mio', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, e.nombre AS admin_nombre, e.apellidos AS admin_apellidos
       FROM saldos s JOIN empleados e ON s.admin_id = e.id
       WHERE s.empleado_id = $1 ORDER BY s.created_at DESC`,
      [req.user.id]
    );
    res.json({ movimientos: rows, resumen: calcularResumen(rows) });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.get('/empleado/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { rows: emp } = await pool.query(
      'SELECT id, nombre, apellidos FROM empleados WHERE id = $1', [req.params.id]
    );
    if (!emp[0]) return res.status(404).json({ error: 'Empleado no encontrado' });

    const { rows } = await pool.query(
      `SELECT s.*, e.nombre AS admin_nombre, e.apellidos AS admin_apellidos
       FROM saldos s JOIN empleados e ON s.admin_id = e.id
       WHERE s.empleado_id = $1 ORDER BY s.created_at DESC`,
      [req.params.id]
    );
    res.json({ empleado: emp[0], movimientos: rows, resumen: calcularResumen(rows) });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.get('/resumen-todos', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { rows: empleados } = await pool.query(
      "SELECT id, nombre, apellidos, departamento FROM empleados WHERE activo = 1 AND rol = 'empleado' ORDER BY apellidos"
    );
    const resultado = await Promise.all(empleados.map(async emp => {
      const { rows } = await pool.query('SELECT tipo, cantidad FROM saldos WHERE empleado_id = $1', [emp.id]);
      return { ...emp, resumen: calcularResumen(rows) };
    }));
    res.json(resultado);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { empleado_id, tipo, cantidad, concepto, fecha_referencia } = req.body;
    if (!empleado_id || !tipo || cantidad == null || !concepto) {
      return res.status(400).json({ error: 'empleado_id, tipo, cantidad y concepto son obligatorios' });
    }
    if (!TIPOS_SALDO.includes(tipo)) {
      return res.status(400).json({ error: `Tipo inválido. Permitidos: ${TIPOS_SALDO.join(', ')}` });
    }
    if (typeof cantidad !== 'number' || isNaN(cantidad) || cantidad === 0) {
      return res.status(400).json({ error: 'La cantidad debe ser un número distinto de 0' });
    }

    const { rows: emp } = await pool.query(
      'SELECT id FROM empleados WHERE id = $1 AND activo = 1', [empleado_id]
    );
    if (!emp[0]) return res.status(404).json({ error: 'Empleado no encontrado o inactivo' });

    const { rows } = await pool.query(
      `INSERT INTO saldos (empleado_id, tipo, cantidad, concepto, admin_id, fecha_referencia)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [empleado_id, tipo, cantidad, concepto.trim(), req.user.id, fecha_referencia || null]
    );

    const { rows: full } = await pool.query(
      `SELECT s.*, e.nombre AS admin_nombre, e.apellidos AS admin_apellidos
       FROM saldos s JOIN empleados e ON s.admin_id = e.id WHERE s.id = $1`,
      [rows[0].id]
    );
    res.status(201).json(full[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id FROM saldos WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Movimiento no encontrado' });
    await pool.query('DELETE FROM saldos WHERE id = $1', [req.params.id]);
    res.json({ message: 'Movimiento eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

function calcularResumen(movimientos) {
  const resumen = { vacaciones: 0, horas_extra: 0, permiso_especial: 0, baja_medica: 0 };
  for (const m of movimientos) {
    if (resumen[m.tipo] !== undefined) resumen[m.tipo] += parseFloat(m.cantidad);
  }
  for (const k of Object.keys(resumen)) resumen[k] = Math.round(resumen[k] * 100) / 100;
  return resumen;
}

module.exports = router;
