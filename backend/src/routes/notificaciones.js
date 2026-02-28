const express = require('express');
const { pool } = require('../db/database');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /api/notificaciones — devuelve las no leídas del empleado autenticado
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT * FROM notificaciones WHERE empleado_id = $1 AND leida = 0 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PUT /api/notificaciones/marcar-leidas — marca todas como leídas
router.put('/marcar-leidas', authMiddleware, async (req, res) => {
  try {
    await pool.query(
      `UPDATE notificaciones SET leida = 1 WHERE empleado_id = $1 AND leida = 0`,
      [req.user.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
