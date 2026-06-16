const { pool } = require('../db/database');
const odoo = require('./odoo-client');
const {
  ENTITY_TYPES,
  saveEntityMapping,
  deleteEntityMapping,
  getOdooEmployeeId,
} = require('./sync-map');
const { getMappedEmpleadoIds } = require('./sync-empleado');

function leaveDatetimes(fechaInicio, fechaFin) {
  return {
    date_from: `${fechaInicio} 00:00:00`,
    date_to: `${fechaFin} 23:59:59`,
    request_date_from: fechaInicio,
    request_date_to: fechaFin,
  };
}

async function syncVacacionToOdoo(vacacionId) {
  if (!odoo.isConfigured()) {
    console.warn('[odoo-sync] Odoo no configurado; omitiendo sync vacacion', vacacionId);
    return null;
  }
  if (!(await odoo.isModelAvailable('hr.leave'))) {
    return { skipped: true, reason: 'hr_holidays_unavailable' };
  }

  const { rows } = await pool.query('SELECT * FROM vacaciones WHERE id = $1', [vacacionId]);
  const vac = rows[0];
  if (!vac) return null;

  const odooEmployeeId = await getOdooEmployeeId(vac.empleado_id);
  if (!odooEmployeeId) {
    return { skipped: true, reason: 'empleado_sin_mapeo', vacacionId };
  }

  const holidayStatusId = await odoo.getLeaveTypeId(vac.tipo);
  const dates = leaveDatetimes(vac.fecha_inicio, vac.fecha_fin);
  const vals = {
    employee_id: odooEmployeeId,
    holiday_status_id: holidayStatusId,
    name: vac.motivo || odoo.LEAVE_TYPE_NAMES[vac.tipo] || 'Ausencia',
    ...dates,
  };

  const odooId = await odoo.upsertLeave(vals, vac.id);
  await saveEntityMapping(ENTITY_TYPES.LEAVE, vac.id, 'hr.leave', odooId);
  return { synced: true, odooId, vacacionId: vac.id };
}

async function deleteVacacionFromOdoo(vacacionId) {
  if (!odoo.isConfigured()) return null;
  if (!(await odoo.isModelAvailable('hr.leave'))) {
    return { skipped: true, reason: 'hr_holidays_unavailable' };
  }
  await odoo.deleteLeave(vacacionId);
  await deleteEntityMapping(ENTITY_TYPES.LEAVE, vacacionId);
  return { deleted: true, vacacionId };
}

async function syncAllVacaciones(options = {}) {
  if (!odoo.isConfigured()) {
    return { skipped: true, reason: 'odoo_not_configured' };
  }
  if (!(await odoo.isModelAvailable('hr.leave'))) {
    return { skipped: true, reason: 'hr_holidays_unavailable' };
  }

  const { empleadoId, limit = 1000 } = options;
  const params = [];
  const condiciones = [];
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
    `SELECT id FROM vacaciones ${where} ORDER BY id ASC LIMIT $${params.length}`,
    params
  );

  const summary = { synced: 0, skipped: 0, errors: 0, details: [] };
  for (const row of rows) {
    try {
      const result = await syncVacacionToOdoo(row.id);
      if (result?.synced) summary.synced++;
      else if (result?.skipped) summary.skipped++;
      summary.details.push(result);
    } catch (err) {
      summary.errors++;
      summary.details.push({ vacacionId: row.id, error: err.message });
    }
  }
  return summary;
}

module.exports = {
  syncVacacionToOdoo,
  deleteVacacionFromOdoo,
  syncAllVacaciones,
};
