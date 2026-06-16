const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/database');
const odoo = require('./odoo-client');

function randomPassword(length = 12) {
  const chars = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[crypto.randomInt(chars.length)];
  }
  return out;
}

async function getMappingByFichajesId(fichajesId) {
  const { rows } = await pool.query(
    'SELECT * FROM sync_odoo_map WHERE fichajes_empleado_id = $1',
    [fichajesId]
  );
  return rows[0] || null;
}

async function getMappingByOdooId(odooId) {
  const { rows } = await pool.query(
    'SELECT * FROM sync_odoo_map WHERE odoo_employee_id = $1',
    [odooId]
  );
  return rows[0] || null;
}

async function saveMapping(fichajesId, odooId) {
  await pool.query(
    `INSERT INTO sync_odoo_map (fichajes_empleado_id, odoo_employee_id, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (fichajes_empleado_id) DO UPDATE
       SET odoo_employee_id = EXCLUDED.odoo_employee_id, updated_at = NOW()`,
    [fichajesId, odooId]
  );
  await pool.query(
    'UPDATE empleados SET odoo_employee_id = $1 WHERE id = $2',
    [odooId, fichajesId]
  );
}

async function getMappedEmpleadoIds() {
  const { rows } = await pool.query(
    `SELECT DISTINCT e.id
     FROM empleados e
     LEFT JOIN sync_odoo_map m ON m.fichajes_empleado_id = e.id
     WHERE e.odoo_employee_id IS NOT NULL OR m.odoo_employee_id IS NOT NULL
     ORDER BY e.id`
  );
  return rows.map((r) => r.id);
}

async function syncAllEmpleados(options = {}) {
  if (!odoo.isConfigured()) {
    console.warn('[odoo-sync] Odoo no configurado; omitiendo sync empleados');
    return { skipped: true, reason: 'odoo_not_configured' };
  }

  const { limit = 500 } = options;
  const { rows } = await pool.query(
    `SELECT id, activo FROM empleados ORDER BY id LIMIT $1`,
    [limit]
  );

  const summary = { synced: 0, skipped: 0, errors: 0, active: 0, inactive: 0, ids: [] };
  for (const row of rows) {
    try {
      const odooId = await syncEmpleadoToOdoo(row.id);
      if (odooId) {
        summary.synced++;
        if (row.activo === 1) summary.active++;
        else summary.inactive++;
        summary.ids.push({ fichajes: row.id, odoo: odooId, activo: row.activo === 1 });
      } else {
        summary.skipped++;
      }
    } catch (err) {
      summary.errors++;
      console.error('[odoo-sync] empleado', row.id, err.message);
    }
  }
  return summary;
}

async function syncEmpleadoToOdoo(empleadoId) {
  if (!odoo.isConfigured()) {
    console.warn('[odoo-sync] Odoo no configurado; omitiendo sync empleado', empleadoId);
    return null;
  }

  const { rows } = await pool.query(
    'SELECT id, nombre, apellidos, email, activo, odoo_employee_id FROM empleados WHERE id = $1',
    [empleadoId]
  );
  const emp = rows[0];
  if (!emp) return null;

  // Modelo "fijo discontinuo": un único hr.employee permanente por persona.
  // active sigue a fichajes.activo (1 -> activo, 0 -> archivado). Al regresar
  // (activo=1) se reactiva el MISMO registro, nunca se crea un duplicado.
  const vals = {
    name: odoo.combineName(emp.nombre, emp.apellidos),
    work_email: emp.email || false,
    active: emp.activo === 1,
    fichajes_employee_id: emp.id,
    fijo_discontinuo: true,
  };

  // Búsqueda estable por mapeo (fichajes_empleado_id). Primero la columna
  // directa, luego la tabla de mapeo y, como último recurso, por email.
  let odooId = emp.odoo_employee_id;
  const mapping = await getMappingByFichajesId(emp.id);
  if (!odooId && mapping) odooId = mapping.odoo_employee_id;

  if (!odooId && emp.email) {
    const found = await odoo.searchEmployee([['work_email', '=', emp.email]]);
    if (found.length) odooId = found[0];
  }

  if (odooId) {
    // writeEmployee usa active_test=False, por lo que reactiva (active=True)
    // un registro archivado en lugar de crear uno nuevo.
    await odoo.writeEmployee(odooId, vals);
  } else {
    odooId = await odoo.createEmployee(vals);
  }

  await saveMapping(emp.id, odooId);
  return odooId;
}

async function upsertEmpleadoFromOdoo(payload) {
  const {
    odoo_employee_id: odooEmployeeId,
    name,
    work_email: workEmail,
    active = true,
    fichajes_employee_id: fichajesEmployeeId,
  } = payload;

  if (!odooEmployeeId) {
    throw new Error('odoo_employee_id es obligatorio');
  }

  const { nombre, apellidos } = odoo.splitName(name);
  const email = (workEmail || '').toLowerCase().trim();
  const activo = active ? 1 : 0;

  let empleadoId = fichajesEmployeeId || null;
  if (!empleadoId) {
    const mapping = await getMappingByOdooId(odooEmployeeId);
    if (mapping) empleadoId = mapping.fichajes_empleado_id;
  }
  if (!empleadoId) {
    const { rows } = await pool.query(
      'SELECT id FROM empleados WHERE odoo_employee_id = $1',
      [odooEmployeeId]
    );
    if (rows[0]) empleadoId = rows[0].id;
  }
  if (!empleadoId && email) {
    const { rows } = await pool.query(
      'SELECT id FROM empleados WHERE email = $1',
      [email]
    );
    if (rows[0]) empleadoId = rows[0].id;
  }

  if (empleadoId) {
    const { rows } = await pool.query(
      `UPDATE empleados
       SET nombre = $1, apellidos = $2,
           email = COALESCE(NULLIF($3, ''), email),
           activo = $4, odoo_employee_id = $5
       WHERE id = $6
       RETURNING id, nombre, apellidos, email, activo, odoo_employee_id`,
      [nombre, apellidos, email, activo, odooEmployeeId, empleadoId]
    );
    await saveMapping(empleadoId, odooEmployeeId);
    return { action: 'updated', empleado: rows[0] };
  }

  if (!email) {
    throw new Error('work_email obligatorio para crear empleado desde Odoo');
  }

  const password = randomPassword(12);
  const { rows } = await pool.query(
    `INSERT INTO empleados (nombre, apellidos, email, password, rol, departamento, activo, odoo_employee_id)
     VALUES ($1, $2, $3, $4, 'empleado', '', $5, $6)
     RETURNING id, nombre, apellidos, email, activo, odoo_employee_id`,
    [nombre, apellidos, email, bcrypt.hashSync(password, 10), activo, odooEmployeeId]
  );
  await saveMapping(rows[0].id, odooEmployeeId);
  return { action: 'created', empleado: rows[0], passwordGenerated: true };
}

module.exports = {
  syncEmpleadoToOdoo,
  syncAllEmpleados,
  getMappedEmpleadoIds,
  upsertEmpleadoFromOdoo,
};
