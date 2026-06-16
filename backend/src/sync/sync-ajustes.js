const { pool } = require('../db/database');
const odoo = require('./odoo-client');
const {
  ENTITY_TYPES,
  saveEntityMapping,
  deleteEntityMapping,
  getOdooEmployeeId,
} = require('./sync-map');
const { getMappedEmpleadoIds } = require('./sync-empleado');

function toDateStr(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.split('T')[0];
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return String(value).split('T')[0];
}

async function syncAjusteToOdoo(ajusteId) {
  if (!odoo.isConfigured()) {
    console.warn('[odoo-sync] Odoo no configurado; omitiendo sync ajuste', ajusteId);
    return null;
  }
  if (!(await odoo.isModelAvailable('hr.attendance.overtime'))) {
    return { skipped: true, reason: 'hr_attendance_overtime_unavailable' };
  }

  const { rows } = await pool.query('SELECT * FROM ajustes_horas WHERE id = $1', [ajusteId]);
  const ajuste = rows[0];
  if (!ajuste) return null;

  const odooEmployeeId = await getOdooEmployeeId(ajuste.empleado_id);
  if (!odooEmployeeId) {
    return { skipped: true, reason: 'empleado_sin_mapeo', ajusteId };
  }

  const fecha = toDateStr(ajuste.fecha);
  const horas = parseFloat(ajuste.cantidad_horas);
  const odooId = await odoo.upsertOvertimeAdjustment(
    odooEmployeeId,
    fecha,
    horas,
    ajuste.id
  );
  await saveEntityMapping(ENTITY_TYPES.AJUSTE, ajuste.id, 'hr.attendance.overtime', odooId);
  return { synced: true, odooId, ajusteId: ajuste.id };
}

async function deleteAjusteFromOdoo(ajusteId) {
  if (!odoo.isConfigured()) return null;
  if (!(await odoo.isModelAvailable('hr.attendance.overtime'))) {
    return { skipped: true, reason: 'hr_attendance_overtime_unavailable' };
  }
  await odoo.deleteOvertimeAdjustment(ajusteId);
  await deleteEntityMapping(ENTITY_TYPES.AJUSTE, ajusteId);
  return { deleted: true, ajusteId };
}

async function syncAllAjustes(options = {}) {
  if (!odoo.isConfigured()) {
    return { skipped: true, reason: 'odoo_not_configured' };
  }
  if (!(await odoo.isModelAvailable('hr.attendance.overtime'))) {
    return { skipped: true, reason: 'hr_attendance_overtime_unavailable' };
  }

  const { empleadoId, limit = 5000 } = options;
  const condiciones = [];
  const params = [];

  if (empleadoId) {
    params.push(empleadoId);
    condiciones.push(`empleado_id = $${params.length}`);
  } else {
    const mappedIds = await getMappedEmpleadoIds();
    if (!mappedIds.length) {
      return { synced: 0, skipped: 0, errors: 0, details: [], reason: 'sin_empleados_mapeados' };
    }
    params.push(mappedIds);
    condiciones.push(`empleado_id = ANY($${params.length})`);
  }
  params.push(limit);
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT id FROM ajustes_horas ${where} ORDER BY id ASC LIMIT $${params.length}`,
    params
  );

  const summary = { synced: 0, skipped: 0, errors: 0, details: [] };
  for (const row of rows) {
    try {
      const result = await syncAjusteToOdoo(row.id);
      if (result?.synced) summary.synced++;
      else if (result?.skipped) summary.skipped++;
      summary.details.push(result);
    } catch (err) {
      summary.errors++;
      summary.details.push({ ajusteId: row.id, error: err.message });
    }
  }
  return summary;
}

module.exports = {
  syncAjusteToOdoo,
  deleteAjusteFromOdoo,
  syncAllAjustes,
};
