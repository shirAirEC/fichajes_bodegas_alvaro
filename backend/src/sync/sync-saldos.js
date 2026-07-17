const { pool } = require('../db/database');
const odoo = require('./odoo-client');
const {
  ENTITY_TYPES,
  saveEntityMapping,
  deleteEntityMapping,
  getEntityMappingByOdooId,
  getOdooEmployeeId,
  getFichajesEmployeeId,
} = require('./sync-map');
const { getMappedEmpleadoIds } = require('./sync-empleado');

/** Solo estos tipos se reflejan como hr.leave.allocation (días disponibles). */
const TIPOS_ALLOCATION = new Set(['vacaciones', 'permiso_especial', 'baja_medica']);

function yearFromValue(value) {
  if (!value) return String(new Date().getFullYear());
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return String(value.getFullYear());
  }
  const s = String(value);
  if (/^\d{4}/.test(s)) return s.slice(0, 4);
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return String(d.getFullYear());
  return String(new Date().getFullYear());
}

async function syncSaldoToOdoo(saldoId) {
  if (!odoo.isConfigured()) {
    return { skipped: true, reason: 'odoo_not_configured' };
  }
  if (!(await odoo.isModelAvailable('hr.leave.allocation'))) {
    return { skipped: true, reason: 'hr_leave_allocation_unavailable' };
  }

  const { rows } = await pool.query('SELECT * FROM saldos WHERE id = $1', [saldoId]);
  const saldo = rows[0];
  if (!saldo) return null;

  // Los descuentos (cantidad < 0) van ligados a hr.leave; aquí solo asignaciones positivas.
  if (!TIPOS_ALLOCATION.has(saldo.tipo) || !(Number(saldo.cantidad) > 0)) {
    return { skipped: true, reason: 'no_es_asignacion_positiva', saldoId };
  }

  const odooEmployeeId = await getOdooEmployeeId(saldo.empleado_id);
  if (!odooEmployeeId) {
    return { skipped: true, reason: 'empleado_sin_mapeo', saldoId };
  }

  const holidayStatusId = await odoo.getLeaveTypeId(saldo.tipo);
  const year = yearFromValue(saldo.fecha_referencia || saldo.created_at);
  const dateFrom = `${year}-01-01`;
  const dateTo = `${year}-12-31`;

  const vals = {
    name: saldo.concepto || `${odoo.LEAVE_TYPE_NAMES[saldo.tipo] || 'Ausencia'} ${year}`,
    employee_id: odooEmployeeId,
    holiday_status_id: holidayStatusId,
    number_of_days: Number(saldo.cantidad),
    date_from: dateFrom,
    date_to: dateTo,
    notes: `Fichajes saldo #${saldo.id}`,
  };

  const odooId = await odoo.upsertAllocation(vals, saldo.id);
  await saveEntityMapping(ENTITY_TYPES.SALDO, saldo.id, 'hr.leave.allocation', odooId);
  return { synced: true, odooId, saldoId: saldo.id };
}

async function deleteSaldoFromOdoo(saldoId) {
  if (!odoo.isConfigured()) return null;
  if (!(await odoo.isModelAvailable('hr.leave.allocation'))) {
    return { skipped: true, reason: 'hr_leave_allocation_unavailable' };
  }
  await odoo.deleteAllocationByFichajesId(saldoId);
  await deleteEntityMapping(ENTITY_TYPES.SALDO, saldoId);
  return { deleted: true, saldoId };
}

/**
 * Inbound Odoo → Fichajes: allocation positiva → movimiento de saldo.
 */
async function upsertSaldoFromOdoo(payload = {}) {
  const odooAllocationId = payload.odoo_allocation_id;
  if (!odooAllocationId && !payload.deleted) {
    throw new Error('odoo_allocation_id es obligatorio');
  }

  let saldoId = payload.fichajes_saldo_id || null;
  if (!saldoId && odooAllocationId) {
    const map = await getEntityMappingByOdooId(ENTITY_TYPES.SALDO, odooAllocationId);
    if (map) saldoId = map.fichajes_entity_id;
  }

  if (payload.deleted) {
    if (!saldoId) return { deleted: true, skipped: true, reason: 'sin_mapeo' };
    await pool.query('DELETE FROM saldos WHERE id = $1', [saldoId]);
    await deleteEntityMapping(ENTITY_TYPES.SALDO, saldoId);
    return { deleted: true, saldoId };
  }

  const empleadoId =
    payload.fichajes_employee_id ||
    (await getFichajesEmployeeId(payload.odoo_employee_id));
  if (!empleadoId) {
    throw new Error('Empleado Fichajes no mapeado para esta allocation Odoo');
  }

  const cantidad = Number(payload.number_of_days || payload.cantidad || 0);
  if (!(cantidad > 0)) {
    throw new Error('number_of_days debe ser > 0');
  }

  const tipo = ['vacaciones', 'permiso_especial', 'baja_medica'].includes(payload.tipo)
    ? payload.tipo
    : 'vacaciones';
  const concepto = payload.concepto || payload.name || `Asignación Odoo #${odooAllocationId}`;
  const fechaRef = payload.date_from ? String(payload.date_from).slice(0, 10) : null;

  const { rows: adminRows } = await pool.query(
    `SELECT id FROM empleados WHERE rol = 'admin' AND activo = 1 ORDER BY id ASC LIMIT 1`
  );
  const adminId = adminRows[0]?.id || empleadoId;

  if (saldoId) {
    const { rows } = await pool.query(
      `UPDATE saldos
       SET empleado_id = $1, tipo = $2, cantidad = $3, concepto = $4, fecha_referencia = $5
       WHERE id = $6 RETURNING *`,
      [empleadoId, tipo, cantidad, concepto, fechaRef, saldoId]
    );
    if (rows[0]) {
      await saveEntityMapping(ENTITY_TYPES.SALDO, saldoId, 'hr.leave.allocation', odooAllocationId);
      return { action: 'updated', saldo: rows[0] };
    }
    saldoId = null;
  }

  const { rows } = await pool.query(
    `INSERT INTO saldos (empleado_id, tipo, cantidad, concepto, admin_id, fecha_referencia)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [empleadoId, tipo, cantidad, concepto, adminId, fechaRef]
  );
  await saveEntityMapping(ENTITY_TYPES.SALDO, rows[0].id, 'hr.leave.allocation', odooAllocationId);
  return { action: 'created', saldo: rows[0] };
}

async function syncAllSaldos(options = {}) {
  if (!odoo.isConfigured()) {
    return { skipped: true, reason: 'odoo_not_configured' };
  }
  if (!(await odoo.isModelAvailable('hr.leave.allocation'))) {
    return { skipped: true, reason: 'hr_leave_allocation_unavailable' };
  }

  const { empleadoId, limit = 2000 } = options;
  const params = [];
  const condiciones = [`cantidad > 0`, `tipo = ANY($1)`];
  params.push(['vacaciones', 'permiso_especial', 'baja_medica']);

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

  const { rows } = await pool.query(
    `SELECT id FROM saldos
     WHERE ${condiciones.join(' AND ')}
     ORDER BY id ASC
     LIMIT $${params.length}`,
    params
  );

  const summary = { synced: 0, skipped: 0, errors: 0, details: [] };
  for (const row of rows) {
    try {
      const result = await syncSaldoToOdoo(row.id);
      if (result?.synced) summary.synced++;
      else if (result?.skipped) summary.skipped++;
      summary.details.push(result);
    } catch (err) {
      summary.errors++;
      summary.details.push({ saldoId: row.id, error: err.message });
      console.error('[odoo-sync] saldo', row.id, err.message);
    }
  }
  return summary;
}

module.exports = {
  syncSaldoToOdoo,
  deleteSaldoFromOdoo,
  upsertSaldoFromOdoo,
  syncAllSaldos,
};
