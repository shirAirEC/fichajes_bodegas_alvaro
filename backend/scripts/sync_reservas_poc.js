require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
require('dotenv').config();

const { initializeDatabase, pool } = require('../src/db/database');
const { syncAllReservas } = require('../src/sync/sync-reservas');
const odoo = require('../src/sync/odoo-client');

async function main() {
  console.log('=== Fichajes -> Odoo PoC sync (reservas) ===');
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

  const calendarOk = await odoo.isModelAvailable('calendar.event');
  console.log('[calendar.event]', calendarOk ? 'disponible' : 'NO disponible');
  if (!calendarOk) {
    console.error('Instalar calendar y actualizar l10n_es_verifactu_bodegas antes del batch.');
    process.exit(1);
  }

  console.log('\n--- Reservas (todas) ---');
  const reservas = await syncAllReservas();
  console.log(JSON.stringify({
    synced: reservas.synced,
    skipped: reservas.skipped,
    errors: reservas.errors,
    reason: reservas.reason,
  }, null, 2));

  console.log('\n=== PoC sync reservas completado ===');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
