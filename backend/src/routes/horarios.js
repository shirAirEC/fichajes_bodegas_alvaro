const express = require('express');
const { pool } = require('../db/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// Convierte "HH:MM:SS" o "HH:MM" a milisegundos desde medianoche
function timeToMs(timeStr) {
  const [h, m, s] = (timeStr || '').split(':').map(Number);
  return ((h * 60 + m) * 60 + (s || 0)) * 1000;
}

// Encuentra el horario aplicable a un empleado en una fecha dada (fecha = string 'YYYY-MM-DD')
async function encontrarHorario(empleadoId, fecha) {
  const d = new Date(fecha + 'T12:00:00');
  const diaSemana = d.getDay() === 0 ? 7 : d.getDay(); // 1=lun ... 7=dom

  const { rows } = await pool.query(
    `SELECT * FROM horarios
     WHERE (empleado_id = $1 OR empleado_id IS NULL)
       AND activo = 1
       AND (
         (tipo = 'fecha'    AND fecha = $2::date)
         OR (tipo = 'rango' AND fecha_inicio <= $2::date AND (fecha_fin IS NULL OR fecha_fin >= $2::date))
         OR (tipo = 'semanal' AND dias_semana LIKE '%' || $3::text || '%')
         OR tipo = 'diario'
       )
     ORDER BY
       CASE WHEN empleado_id = $1 THEN 0 ELSE 1 END,
       CASE tipo WHEN 'fecha' THEN 0 WHEN 'rango' THEN 1 WHEN 'semanal' THEN 2 ELSE 3 END
     LIMIT 1`,
    [empleadoId, fecha, diaSemana]
  );
  return rows[0] || null;
}

module.exports.encontrarHorario = encontrarHorario;
module.exports.timeToMs = timeToMs;

// GET /api/horarios — listar todos (admin)
router.get('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { empleado_id } = req.query;
    let query = `
      SELECT h.*, e.nombre || ' ' || e.apellidos AS empleado_nombre
      FROM horarios h
      LEFT JOIN empleados e ON e.id = h.empleado_id
      WHERE h.activo = 1
    `;
    const params = [];
    if (empleado_id) {
      params.push(empleado_id);
      query += ` AND h.empleado_id = $${params.length}`;
    }
    query += ' ORDER BY h.created_at DESC';
    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/horarios — crear horario
router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { empleado_id, tipo, dias_semana, fecha, fecha_inicio, fecha_fin, hora_entrada, hora_salida } = req.body;
    if (!tipo || !hora_entrada) {
      return res.status(400).json({ error: 'Faltan campos obligatorios (tipo, hora_entrada)' });
    }
    const { rows } = await pool.query(
      `INSERT INTO horarios (empleado_id, tipo, dias_semana, fecha, fecha_inicio, fecha_fin, hora_entrada, hora_salida, admin_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [empleado_id || null, tipo, dias_semana || null, fecha || null,
       fecha_inicio || null, fecha_fin || null, hora_entrada, hora_salida || null, req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PUT /api/horarios/:id — actualizar horario
router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { empleado_id, tipo, dias_semana, fecha, fecha_inicio, fecha_fin, hora_entrada, hora_salida } = req.body;
    const { rows } = await pool.query(
      `UPDATE horarios SET
         empleado_id = $1, tipo = $2, dias_semana = $3, fecha = $4,
         fecha_inicio = $5, fecha_fin = $6, hora_entrada = $7, hora_salida = $8
       WHERE id = $9 RETURNING *`,
      [empleado_id || null, tipo, dias_semana || null, fecha || null,
       fecha_inicio || null, fecha_fin || null, hora_entrada, hora_salida || null, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Horario no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/horarios/:id
router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    await pool.query('UPDATE horarios SET activo = 0 WHERE id = $1', [req.params.id]);
    res.json({ message: 'Horario eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
module.exports.encontrarHorario = encontrarHorario;
module.exports.timeToMs = timeToMs;
