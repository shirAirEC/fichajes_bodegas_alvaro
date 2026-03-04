const express = require('express');
const router = express.Router();
const { pool } = require('../db/database');
const { authMiddleware: verificarToken, adminMiddleware: verificarAdmin } = require('../middleware/auth');
const { enviarPushMultiple, enviarPush } = require('../firebase');

// ── Registrar / actualizar token FCM del dispositivo ─────────────────────────
router.post('/token', verificarToken, async (req, res) => {
  const { token, plataforma = 'android' } = req.body;
  if (!token) return res.status(400).json({ error: 'Token requerido' });
  try {
    await pool.query(
      `INSERT INTO fcm_tokens (empleado_id, token, plataforma, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (empleado_id) DO UPDATE SET token = $2, plataforma = $3, updated_at = NOW()`,
      [req.user.id, token, plataforma]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── Listar avisos activos visibles para el usuario actual ─────────────────────
// Solo ve el aviso si: destinatario_id IS NULL (global) O destinatario_id = su ID
router.get('/', verificarToken, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.titulo, a.mensaje, a.created_at,
              EXISTS(
                SELECT 1 FROM avisos_visto v
                WHERE v.aviso_id = a.id AND v.empleado_id = $1
              ) AS visto
       FROM avisos a
       WHERE a.activo = TRUE
         AND (a.destinatario_id IS NULL OR a.destinatario_id = $1)
       ORDER BY a.created_at DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── Confirmar que el empleado ha visto un aviso ───────────────────────────────
router.post('/:id/visto', verificarToken, async (req, res) => {
  const avisoId = parseInt(req.params.id);
  const empleadoId = req.user.id;
  try {
    await pool.query(
      `INSERT INTO avisos_visto (aviso_id, empleado_id) VALUES ($1, $2)
       ON CONFLICT (aviso_id, empleado_id) DO NOTHING`,
      [avisoId, empleadoId]
    );

    // Notificar al admin via push
    const { rows: admins } = await pool.query(
      `SELECT f.token, e.nombre, e.apellidos
       FROM fcm_tokens f
       JOIN empleados e ON e.id = f.empleado_id
       WHERE e.rol = 'admin'`
    );
    const { rows: emp } = await pool.query(
      'SELECT nombre, apellidos FROM empleados WHERE id = $1',
      [empleadoId]
    );
    const { rows: aviso } = await pool.query(
      'SELECT titulo FROM avisos WHERE id = $1',
      [avisoId]
    );

    if (emp.length && aviso.length && admins.length) {
      const nombre = `${emp[0].nombre} ${emp[0].apellidos}`;
      for (const admin of admins) {
        await enviarPush(
          admin.token,
          'Aviso confirmado',
          `${nombre} ha visto el aviso "${aviso[0].titulo}"`,
          { tipo: 'aviso_visto', aviso_id: String(avisoId) }
        );
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── Admin: crear aviso y enviar push a todos los empleados ────────────────────
router.post('/', verificarToken, verificarAdmin, async (req, res) => {
  const { titulo, mensaje } = req.body;
  if (!titulo || !mensaje) return res.status(400).json({ error: 'Título y mensaje requeridos' });
  try {
    const { rows } = await pool.query(
      `INSERT INTO avisos (admin_id, titulo, mensaje) VALUES ($1, $2, $3) RETURNING *`,
      [req.user.id, titulo, mensaje]
    );
    const aviso = rows[0];

    // Obtener tokens de todos los empleados activos
    const { rows: tokens } = await pool.query(
      `SELECT f.token FROM fcm_tokens f
       JOIN empleados e ON e.id = f.empleado_id
       WHERE e.activo = 1 AND e.rol = 'empleado'`
    );
    if (tokens.length) {
      await enviarPushMultiple(
        tokens.map(t => t.token),
        titulo,
        mensaje,
        { tipo: 'nuevo_aviso', aviso_id: String(aviso.id) }
      );
    }

    res.status(201).json(aviso);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── Admin: ver lista de avisos con confirmaciones ─────────────────────────────
router.get('/admin', verificarToken, verificarAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.id, a.titulo, a.mensaje, a.activo, a.created_at,
              a.destinatario_id,
              COUNT(DISTINCT v.empleado_id) AS total_visto,
              -- Si tiene destinatario específico → total esperado = 1; si es global → todos los empleados activos
              CASE
                WHEN a.destinatario_id IS NOT NULL THEN 1
                ELSE (SELECT COUNT(*) FROM empleados WHERE activo = 1 AND rol = 'empleado')
              END AS total_empleados,
              JSON_AGG(
                JSON_BUILD_OBJECT('nombre', e.nombre, 'apellidos', e.apellidos, 'visto_at', v.visto_at)
              ) FILTER (WHERE v.id IS NOT NULL) AS vistos
       FROM avisos a
       LEFT JOIN avisos_visto v ON v.aviso_id = a.id
       LEFT JOIN empleados e ON e.id = v.empleado_id
       GROUP BY a.id
       ORDER BY a.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── Admin: desactivar aviso ───────────────────────────────────────────────────
router.patch('/:id/desactivar', verificarToken, verificarAdmin, async (req, res) => {
  try {
    await pool.query('UPDATE avisos SET activo = FALSE WHERE id = $1', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

// ── Admin: limpiar TODOS los avisos y confirmaciones ─────────────────────────
router.delete('/limpiar', verificarToken, verificarAdmin, async (req, res) => {
  try {
    await pool.query('DELETE FROM avisos_visto');
    const { rowCount } = await pool.query('DELETE FROM avisos');
    res.json({ ok: true, eliminados: rowCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
