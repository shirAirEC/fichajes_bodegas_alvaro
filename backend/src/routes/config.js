const express = require('express');
const { pool } = require('../db/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();
const CLAVES_PERMITIDAS = ['geo_activo','geo_lat','geo_lng','geo_radio_metros','empresa_nombre','empresa_direccion','ip_activo','ip_permitidas','gracia_minutos','descanso_activo','descanso_minutos'];

function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || req.ip || '';
}

// GET /api/config/mi-ip — devuelve la IP pública del cliente (sin auth, para diagnóstico)
router.get('/mi-ip', (req, res) => {
  res.json({ ip: getClientIP(req) });
});

router.get('/', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT clave, valor FROM configuracion');
    const config = Object.fromEntries(rows.map(r => [r.clave, r.valor]));

    if (req.user.rol !== 'admin') {
      return res.json({
        geo_activo: config.geo_activo,
        geo_radio_metros: config.geo_radio_metros,
        empresa_nombre: config.empresa_nombre
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
        'UPDATE configuracion SET valor = $1 WHERE clave = $2',
        [String(valor), clave]
      );
    }
    const { rows } = await pool.query('SELECT clave, valor FROM configuracion');
    res.json(Object.fromEntries(rows.map(r => [r.clave, r.valor])));
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
