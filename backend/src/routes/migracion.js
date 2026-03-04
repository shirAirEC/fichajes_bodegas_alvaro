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

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Truncar en orden inverso para respetar FK
    for (const tabla of [...TABLAS].reverse()) {
      try { await client.query(`TRUNCATE TABLE ${tabla} CASCADE`); } catch (e) {}
    }

    const errores = [];
    const resumen = {};
    let spIndex = 0;

    for (const tabla of TABLAS) {
      const filas = dump[tabla];
      if (!filas || filas.length === 0) { resumen[tabla] = 0; continue; }

      const columnas = Object.keys(filas[0]);
      const colNames = columnas.map(c => `"${c}"`).join(', ');
      let insertados = 0;

      for (const fila of filas) {
        const sp = `sp${spIndex++}`;
        const valores = columnas.map((_, i) => `$${i + 1}`).join(', ');
        const datos = columnas.map(c => {
          const v = fila[c];
          if (v !== null && (typeof v === 'object' || Array.isArray(v))) return JSON.stringify(v);
          return v;
        });
        try {
          await client.query(`SAVEPOINT ${sp}`);
          const r = await client.query(
            `INSERT INTO ${tabla} (${colNames}) VALUES (${valores}) ON CONFLICT DO NOTHING`, datos
          );
          await client.query(`RELEASE SAVEPOINT ${sp}`);
          if (r.rowCount > 0) insertados++;
        } catch (e) {
          await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
          errores.push(`${tabla}[id=${fila.id}]: ${e.message}`);
        }
      }
      resumen[tabla] = `${insertados}/${filas.length}`;
    }

    // Actualizar secuencias
    for (const tabla of TABLAS) {
      try {
        await client.query(`SELECT setval(pg_get_serial_sequence('${tabla}','id'), COALESCE((SELECT MAX(id) FROM ${tabla}),0)+1, false)`);
      } catch (e) {}
    }

    await client.query('COMMIT');

    // Verificación post-commit
    const postCheck = {};
    for (const tabla of ['empleados', 'fichajes', 'reservas']) {
      const r = await pool.query(`SELECT COUNT(*) as n FROM ${tabla}`);
      postCheck[tabla] = parseInt(r.rows[0].n);
    }

    res.json({ ok: true, resumen, errores: errores.slice(0, 30), postCommitCount: postCheck });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
