const express = require('express');
const { pool } = require('../db/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

async function crearNotificacion(empleadoId, mensaje) {
  await pool.query(
    `INSERT INTO notificaciones (empleado_id, mensaje) VALUES ($1, $2)`,
    [empleadoId, mensaje]
  );
}
module.exports.crearNotificacion = crearNotificacion;

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
      // Normalizar fecha (puede llegar como Date o string desde PostgreSQL)
      const fechaStr = typeof solicitud.fecha_solicitada === 'string'
        ? solicitud.fecha_solicitada.split('T')[0]
        : solicitud.fecha_solicitada.toISOString().split('T')[0];
      const horaStr = typeof solicitud.hora_solicitada === 'string'
        ? solicitud.hora_solicitada.slice(0, 5)
        : solicitud.hora_solicitada.toString().slice(0, 5);
      const fechaHora = new Date(`${fechaStr}T${horaStr}:00`);

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

    // Notificar al empleado
    const accion = estado === 'aprobada' ? 'aprobada y aplicada' : 'rechazada';
    const notaTexto = admin_nota ? ` Nota del administrador: "${admin_nota}"` : '';
    await crearNotificacion(
      solicitud.empleado_id,
      `Tu solicitud de corrección del ${fechaStr} (${solicitud.tipo_fichaje}) ha sido ${accion}.${notaTexto}`
    );

    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
