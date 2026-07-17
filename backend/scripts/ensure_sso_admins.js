/**
 * Asegura empleados admin en Fichajes para SSO Odoo (match por email).
 * Uso: node scripts/ensure_sso_admins.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db/database');

const ADMINS = [
  { email: 'guedir12345@gmail.com', nombre: 'Airam', apellidos: 'Expósito Cruz' },
  { email: 'bodegaequipotrabajo@gmail.com', nombre: 'Bodega', apellidos: 'Equipo Trabajo' },
  { email: 'yaniralorenzoramos@gmail.com', nombre: 'Yanira', apellidos: 'Lorenzo Ramos' },
];

async function main() {
  // Password aleatoria: el acceso previsto es SSO; login password queda de respaldo.
  const randomPass = require('crypto').randomBytes(24).toString('hex');
  const hash = await bcrypt.hash(randomPass, 10);

  for (const a of ADMINS) {
    const { rows } = await pool.query(
      `SELECT id, email, rol, activo FROM empleados WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [a.email]
    );
    if (rows[0]) {
      await pool.query(
        `UPDATE empleados SET rol = 'admin', activo = 1, nombre = COALESCE(NULLIF(nombre,''), $2),
         apellidos = COALESCE(NULLIF(apellidos,''), $3) WHERE id = $1`,
        [rows[0].id, a.nombre, a.apellidos]
      );
      console.log('[OK] actualizado', a.email, 'id=', rows[0].id);
    } else {
      const { rows: ins } = await pool.query(
        `INSERT INTO empleados (nombre, apellidos, email, rol, activo, password_hash)
         VALUES ($1, $2, $3, 'admin', 1, $4) RETURNING id`,
        [a.nombre, a.apellidos, a.email, hash]
      );
      console.log('[OK] creado', a.email, 'id=', ins[0].id);
    }
  }
  await pool.end();
  console.log('DONE');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
