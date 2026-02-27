const express = require('express');
const db = require('../db/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /api/config — obtener configuración pública (para app)
router.get('/', authMiddleware, (req, res) => {
  const filas = db.prepare('SELECT clave, valor FROM configuracion').all();
  const config = {};
  for (const f of filas) config[f.clave] = f.valor;

  // Solo devolver campos no sensibles al empleado normal
  if (req.user.rol !== 'admin') {
    return res.json({
      geo_activo: config.geo_activo,
      geo_radio_metros: config.geo_radio_metros,
      empresa_nombre: config.empresa_nombre
    });
  }

  res.json(config);
});

// PUT /api/config — actualizar configuración (solo admin)
router.put('/', authMiddleware, adminMiddleware, (req, res) => {
  const campos = req.body;
  const claves_permitidas = [
    'geo_activo', 'geo_lat', 'geo_lng', 'geo_radio_metros',
    'empresa_nombre', 'empresa_direccion'
  ];

  const actualizar = db.prepare('UPDATE configuracion SET valor = ? WHERE clave = ?');

  for (const [clave, valor] of Object.entries(campos)) {
    if (!claves_permitidas.includes(clave)) continue;
    actualizar.run(String(valor), clave);
  }

  const todas = db.prepare('SELECT clave, valor FROM configuracion').all();
  const config = {};
  for (const f of todas) config[f.clave] = f.valor;

  res.json(config);
});

module.exports = router;
