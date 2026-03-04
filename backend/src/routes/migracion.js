const express = require('express');
const router = express.Router();
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { pool } = require('../db/database');

const TABLAS = [
  'empleados', 'horarios', 'horas_objetivo', 'fichajes', 'saldos',
  'ajustes_horas', 'solicitudes_correccion', 'configuracion', 'notificaciones',
  'reservas', 'vacaciones', 'fcm_tokens', 'avisos', 'avisos_visto',
];

// GET /api/migracion/info — diagnóstico de conexión
router.get('/info', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const r = await pool.query("SELECT current_database(), inet_server_addr(), COUNT(*) as empleados FROM empleados");
    const dbUrl = (process.env.DATABASE_URL || '').replace(/:([^:@]+)@/, ':***@');
    res.json({ dbUrl, dbInfo: r.rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/migracion/dump
router.get('/dump', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const dump = {};
    for (const tabla of TABLAS) {
      try {
        const result = await pool.query(`SELECT * FROM ${tabla} ORDER BY 1`);
        dump[tabla] = result.rows;
      } catch (e) { dump[tabla] = []; }
    }
    res.json({ ok: true, dump });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/migracion/restore
router.post('/restore', authMiddleware, adminMiddleware, async (req, res) => {
  const entorno = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || '';
  if (entorno === 'production') return res.status(403).json({ error: 'Solo en developed' });

  const { dump } = req.body;
  if (!dump) return res.status(400).json({ error: 'Falta dump' });

  const errores = [];
  const resumen = {};

  try {
    // Borrar datos en orden inverso (sin transacción global para evitar aborts)
    for (const tabla of [...TABLAS].reverse()) {
      try {
        await pool.query(`DELETE FROM ${tabla}`);
      } catch (e) {
        errores.push(`DELETE ${tabla}: ${e.message}`);
      }
    }

    // Insertar datos tabla a tabla
    for (const tabla of TABLAS) {
      const filas = dump[tabla];
      if (!filas || filas.length === 0) { resumen[tabla] = 0; continue; }

      const columnas = Object.keys(filas[0]);
      const colNames = columnas.map(c => `"${c}"`).join(', ');
      let insertados = 0;

      for (const fila of filas) {
        const valores = columnas.map((_, i) => `$${i + 1}`).join(', ');
        const datos = columnas.map(c => {
          const v = fila[c];
          if (v !== null && (typeof v === 'object' || Array.isArray(v))) return JSON.stringify(v);
          return v;
        });
        try {
          const r = await pool.query(
            `INSERT INTO ${tabla} (${colNames}) VALUES (${valores}) ON CONFLICT DO NOTHING`, datos
          );
          if (r.rowCount > 0) insertados++;
        } catch (e) {
          errores.push(`INSERT ${tabla}[id=${fila.id}]: ${e.message}`);
        }
      }
      resumen[tabla] = `${insertados}/${filas.length}`;
    }

    // Actualizar secuencias
    for (const tabla of TABLAS) {
      try {
        await pool.query(`SELECT setval(pg_get_serial_sequence('${tabla}','id'), COALESCE((SELECT MAX(id) FROM ${tabla}),0)+1, false)`);
      } catch (e) {}
    }

    const finalCount = (await pool.query('SELECT COUNT(*) as n FROM empleados')).rows[0].n;
    res.json({ ok: true, resumen, errores: errores.slice(0, 30), finalEmpleados: finalCount });

  } catch (err) {
    res.status(500).json({ error: err.message, errores });
  }
});

module.exports = router;
