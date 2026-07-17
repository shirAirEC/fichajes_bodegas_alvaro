require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
require('dotenv').config();

const { initializeDatabase, pool } = require('../src/db/database');
const { syncAllEmpleados } = require('../src/sync/sync-empleado');
const { syncAllAsistencias } = require('../src/sync/sync-asistencia');
const { syncAllVacaciones } = require('../src/sync/sync-vacaciones');
const { syncAllHorarios } = require('../src/sync/sync-horarios');
const odoo = require('../src/sync/odoo-client');

async function main() {
  console.log('=== Fichajes -> Odoo PoC sync ===');
  console.log('ODOO_URL:', process.env.ODOO_URL || '(no configurado)');
  console.log('ODOO_DB:', process.env.ODOO_DB || '(no configurado)');

  await initializeDatabase();

  if (!odoo.isConfigured()) {
    console.error('Odoo no configurado en .env (ODOO_URL, ODOO_DB, ODOO_USER, ODOO_PASSWORD)');
    process.exit(1);
  }

  try {
    await odoo.search('hr.employee', [], { limit: 1 });
    console.log('[OK] Autenticacion Odoo');
  } catch (err) {
    console.error('[ERROR] Autenticacion Odoo fallida:', err.message);
    process.exit(1);
  }

  console.log('\n--- Empleados (todos, activos e inactivos) ---');
  const empleados = await syncAllEmpleados();
  console.log(JSON.stringify(empleados, null, 2));

  console.log('\n--- Asistencias (empleados mapeados) ---');
  const asistencias = await syncAllAsistencias();
  console.log(JSON.stringify({
    synced: asistencias.synced,
    skipped: asistencias.skipped,
    errors: asistencias.errors,
  }, null, 2));

  console.log('\n--- Vacaciones (empleados mapeados) ---');
  const vacaciones = await syncAllVacaciones();
  console.log(JSON.stringify({
    synced: vacaciones.synced,
    skipped: vacaciones.skipped,
    errors: vacaciones.errors,
    reason: vacaciones.reason,
  }, null, 2));

  console.log('\n--- Horarios (empleados mapeados, incl. historicos) ---');
  const horarios = await syncAllHorarios();
  console.log(JSON.stringify({
    synced: horarios.synced,
    skipped: horarios.skipped,
    errors: horarios.errors,
    reason: horarios.reason,
  }, null, 2));

  console.log('\n=== PoC sync completado ===');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
