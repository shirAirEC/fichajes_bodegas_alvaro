const express = require('express');
const { pool } = require('../db/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();
const CLAVES_PERMITIDAS = ['geo_activo','geo_lat','geo_lng','geo_radio_metros','empresa_nombre','empresa_direccion','ip_activo','ip_permitidas','gracia_minutos','descanso_activo','descanso_minutos','version_minima'];

function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || req.ip || '';
}

// GET /api/config/mi-ip — devuelve la IP pública del cliente (sin auth, para diagnóstico)
router.get('/mi-ip', (req, res) => {
  res.json({ ip: getClientIP(req) });
});

// GET /api/config/version — versión mínima requerida de la app (sin auth, para el check de actualización)
router.get('/version', async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT valor FROM configuracion WHERE clave = 'version_minima'"
    );
    res.json({ version_minima: rows[0]?.valor || '1.0' });
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

router.get('/', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT clave, valor FROM configuracion');
    const config = Object.fromEntries(rows.map(r => [r.clave, r.valor]));

    if (req.user.rol !== 'admin') {
      return res.json({
        geo_activo: config.geo_activo,
        geo_radio_metros: config.geo_radio_metros,
        empresa_nombre: config.empresa_nombre,
        gracia_minutos: config.gracia_minutos
      });
    }
    res.json(config);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.put('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    for (const [clave, valor] of Object.entries(req.body)) {
      if (!CLAVES_PERMITIDAS.includes(clave)) continue;
      await pool.query(
        `INSERT INTO configuracion (clave, valor) VALUES ($2, $1)
         ON CONFLICT (clave) DO UPDATE SET valor = $1`,
        [String(valor), clave]
      );
    }
    const { rows } = await pool.query('SELECT clave, valor FROM configuracion');
    res.json(Object.fromEntries(rows.map(r => [r.clave, r.valor])));
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/config/audit — log de auditoría para admins
router.get('/audit', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { desde, hasta, accion, limite = 200 } = req.query;
    const conds = [];
    const vals = [];
    let i = 1;
    if (desde) { conds.push(`created_at >= $${i++}`); vals.push(desde); }
    if (hasta) { conds.push(`created_at < ($${i++}::date + INTERVAL '1 day')`); vals.push(hasta); }
    if (accion) { conds.push(`accion = $${i++}`); vals.push(accion); }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const { rows } = await pool.query(
      `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT $${i}`,
      [...vals, parseInt(limite)]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error interno' });
  }
});

module.exports = router;
