const express = require('express');
const { pool } = require('../db/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /api/vacaciones?empleado_id=X
// Admin: filtra por empleado (o todos si no se pasa); Empleado: solo las suyas
router.get('/', authMiddleware, async (req, res) => {
  try {
    const isAdmin = req.user.rol === 'admin';
    const empId = isAdmin ? (req.query.empleado_id || null) : req.user.id;

    let rows;
    if (empId) {
      ({ rows } = await pool.query(
        `SELECT v.id, v.empleado_id, v.fecha_inicio, v.fecha_fin, v.motivo, v.created_at,
                e.nombre, e.apellidos
           FROM vacaciones v JOIN empleados e ON v.empleado_id = e.id
          WHERE v.empleado_id = $1
          ORDER BY v.fecha_inicio DESC`,
        [empId]
      ));
    } else {
      ({ rows } = await pool.query(
        `SELECT v.id, v.empleado_id, v.fecha_inicio, v.fecha_fin, v.motivo, v.created_at,
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

// POST /api/vacaciones  — admin: crear período
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { empleado_id, fecha_inicio, fecha_fin, motivo } = req.body;
    if (!empleado_id || !fecha_inicio || !fecha_fin) {
      return res.status(400).json({ error: 'empleado_id, fecha_inicio y fecha_fin son obligatorios' });
    }
    if (fecha_inicio > fecha_fin) {
      return res.status(400).json({ error: 'La fecha de inicio debe ser anterior o igual a la de fin' });
    }
    const { rows } = await pool.query(
      `INSERT INTO vacaciones (empleado_id, fecha_inicio, fecha_fin, motivo, admin_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [empleado_id, fecha_inicio, fecha_fin, motivo || '', req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/vacaciones/:id  — admin: eliminar período
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { rowCount } = await pool.query('DELETE FROM vacaciones WHERE id = $1', [req.params.id]);
    if (rowCount === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
