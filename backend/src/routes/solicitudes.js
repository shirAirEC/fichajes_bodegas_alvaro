const express = require('express');
const { pool } = require('../db/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /api/solicitudes — empleado ve sus propias solicitudes
router.get('/', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT s.*, f.timestamp AS fichaje_timestamp
       FROM solicitudes_correccion s
       LEFT JOIN fichajes f ON f.id = s.fichaje_id
       WHERE s.empleado_id = $1
       ORDER BY s.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/solicitudes — empleado crea una solicitud
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { fichaje_id, tipo, fecha_solicitada, hora_solicitada, tipo_fichaje, motivo } = req.body;
    if (!tipo || !fecha_solicitada || !hora_solicitada || !tipo_fichaje || !motivo) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' });
    }
    const { rows } = await pool.query(
      `INSERT INTO solicitudes_correccion
         (empleado_id, fichaje_id, tipo, fecha_solicitada, hora_solicitada, tipo_fichaje, motivo)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [req.user.id, fichaje_id || null, tipo, fecha_solicitada, hora_solicitada, tipo_fichaje, motivo.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/solicitudes/admin — admin ve todas las pendientes
router.get('/admin', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { estado = 'pendiente' } = req.query;
    const { rows } = await pool.query(
      `SELECT s.*,
              e.nombre || ' ' || e.apellidos AS empleado_nombre,
              f.timestamp AS fichaje_timestamp
       FROM solicitudes_correccion s
       JOIN empleados e ON e.id = s.empleado_id
       LEFT JOIN fichajes f ON f.id = s.fichaje_id
       WHERE s.estado = $1
       ORDER BY s.created_at ASC`,
      [estado]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PUT /api/solicitudes/admin/:id — admin aprueba o rechaza
router.put('/admin/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { estado, admin_nota } = req.body;
    if (!['aprobada', 'rechazada'].includes(estado)) {
      return res.status(400).json({ error: 'Estado inválido' });
    }

    const { rows: sol } = await pool.query(
      'SELECT * FROM solicitudes_correccion WHERE id = $1', [id]
    );
    if (!sol[0]) return res.status(404).json({ error: 'Solicitud no encontrada' });
    const solicitud = sol[0];

    if (estado === 'aprobada') {
      const fechaHora = new Date(`${solicitud.fecha_solicitada.toISOString().split('T')[0]}T${solicitud.hora_solicitada}`);

      if (solicitud.tipo === 'nuevo') {
        await pool.query(
          `INSERT INTO fichajes (empleado_id, tipo, timestamp, notas)
           VALUES ($1, $2, $3, $4)`,
          [solicitud.empleado_id, solicitud.tipo_fichaje, fechaHora, `Añadido por admin (solicitud #${id})`]
        );
      } else if (solicitud.tipo === 'correccion' && solicitud.fichaje_id) {
        await pool.query(
          `UPDATE fichajes SET tipo = $1, timestamp = $2, notas = $3 WHERE id = $4`,
          [solicitud.tipo_fichaje, fechaHora, `Corregido por admin (solicitud #${id})`, solicitud.fichaje_id]
        );
      } else if (solicitud.tipo === 'eliminar' && solicitud.fichaje_id) {
        await pool.query('DELETE FROM fichajes WHERE id = $1', [solicitud.fichaje_id]);
      }
    }

    const { rows } = await pool.query(
      `UPDATE solicitudes_correccion
       SET estado = $1, admin_nota = $2, admin_id = $3, updated_at = NOW()
       WHERE id = $4 RETURNING *`,
      [estado, admin_nota || '', req.user.id, id]
    );
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
