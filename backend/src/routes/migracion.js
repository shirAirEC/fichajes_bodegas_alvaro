const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { pool } = require('../db/database');

const TABLAS = [
  'empleados',
  'horarios',
  'horas_objetivo',
  'fichajes',
  'saldos',
  'ajustes_horas',
  'solicitudes_correccion',
  'configuracion',
  'notificaciones',
  'reservas',
  'vacaciones',
  'fcm_tokens',
  'avisos',
  'avisos_visto',
];

// GET /api/migracion/dump  — exporta todos los datos como JSON
router.get('/dump', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const dump = {};
    for (const tabla of TABLAS) {
      try {
        const result = await pool.query(`SELECT * FROM ${tabla} ORDER BY 1`);
        dump[tabla] = result.rows;
      } catch (e) {
        dump[tabla] = [];
      }
    }
    res.json({ ok: true, dump });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/migracion/restore  — recibe JSON y restaura tablas (solo en entorno developed)
router.post('/restore', authMiddleware, adminMiddleware, async (req, res) => {
  const entorno = process.env.RAILWAY_ENVIRONMENT_NAME || process.env.RAILWAY_ENVIRONMENT || '';
  if (entorno === 'production') {
    return res.status(403).json({ error: 'Solo disponible en developed' });
  }

  const { dump } = req.body;
  if (!dump) return res.status(400).json({ error: 'Falta dump' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Truncar en orden inverso para respetar FK
    const tablasInverso = [...TABLAS].reverse();
    for (const tabla of tablasInverso) {
      try {
        await client.query(`TRUNCATE TABLE ${tabla} CASCADE`);
      } catch (e) {
        // tabla puede no existir todavía
      }
    }

    // Insertar datos
    const errores = [];
    const resumen = {};

    for (const tabla of TABLAS) {
      const filas = dump[tabla];
      if (!filas || filas.length === 0) { resumen[tabla] = 0; continue; }

      const columnas = Object.keys(filas[0]);
      const colNames = columnas.map(c => `"${c}"`).join(', ');
      let insertados = 0;

      for (const fila of filas) {
        const valores = columnas.map((_, i) => `$${i + 1}`).join(', ');
        const datos = columnas.map(c => fila[c]);
        try {
          const r = await client.query(
            `INSERT INTO ${tabla} (${colNames}) VALUES (${valores}) ON CONFLICT DO NOTHING`,
            datos
          );
          if (r.rowCount > 0) insertados++;
        } catch (e) {
          errores.push(`${tabla}[id=${fila.id}]: ${e.message}`);
        }
      }
      resumen[tabla] = `${insertados}/${filas.length}`;
    }

    // Actualizar secuencias
    for (const tabla of TABLAS) {
      try {
        await client.query(`
          SELECT setval(
            pg_get_serial_sequence('${tabla}', 'id'),
            COALESCE((SELECT MAX(id) FROM ${tabla}), 0) + 1,
            false
          )
        `);
      } catch (e) { /* tabla sin serial */ }
    }

    await client.query('COMMIT');
    res.json({ ok: true, mensaje: 'Datos restaurados', resumen, errores: errores.slice(0, 20) });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
