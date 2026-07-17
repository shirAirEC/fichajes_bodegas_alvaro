const { pool } = require('../db/database');
const odoo = require('./odoo-client');
const {
  ENTITY_TYPES,
  saveEntityMapping,
  deleteEntityMapping,
  getEntityMapping,
  getEntityMappingByOdooId,
  getOdooEmployeeId,
  getFichajesEmployeeId,
} = require('./sync-map');
const { getMappedEmpleadoIds } = require('./sync-empleado');

const TIPOS_AUSENCIA = ['vacaciones', 'permiso_especial', 'baja_medica'];
const TIPO_LABELS = {
  vacaciones: 'Vacaciones',
  permiso_especial: 'Permiso especial',
  baja_medica: 'Baja médica',
};
const TIPO_FROM_ODOO_NAME = {
  vacaciones: 'vacaciones',
  'permiso especial': 'permiso_especial',
  'baja médica': 'baja_medica',
  'baja medica': 'baja_medica',
};

function leaveDatetimes(fechaInicio, fechaFin) {
  return {
    date_from: `${fechaInicio} 00:00:00`,
    date_to: `${fechaFin} 23:59:59`,
    request_date_from: fechaInicio,
    request_date_to: fechaFin,
  };
}

function diasEntreFechas(inicio, fin) {
  const d1 = new Date(`${inicio}T12:00:00`);
  const d2 = new Date(`${fin}T12:00:00`);
  return Math.round((d2 - d1) / 86400000) + 1;
}

function normalizeTipo(tipo, leaveTypeName) {
  if (tipo && TIPOS_AUSENCIA.includes(tipo)) return tipo;
  const key = String(leaveTypeName || '').trim().toLowerCase();
  return TIPO_FROM_ODOO_NAME[key] || 'vacaciones';
}

function toDateOnly(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

async function getSystemAdminId() {
  const { rows } = await pool.query(
    `SELECT id FROM empleados WHERE rol = 'admin' AND activo = 1 ORDER BY id ASC LIMIT 1`
  );
  return rows[0]?.id || null;
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

/**
 * Inbound Odoo → Fichajes (tiempo real).
 * Payload: odoo_leave_id, odoo_employee_id, fecha_inicio, fecha_fin, tipo|leave_type_name, motivo,
 *          fichajes_vacacion_id?, deleted?
 */
async function upsertVacacionFromOdoo(payload = {}) {
  const odooLeaveId = payload.odoo_leave_id;
  if (!odooLeaveId && !payload.deleted) {
    throw new Error('odoo_leave_id es obligatorio');
  }

  let vacacionId = payload.fichajes_vacacion_id || null;
  if (!vacacionId && odooLeaveId) {
    const map = await getEntityMappingByOdooId(ENTITY_TYPES.LEAVE, odooLeaveId);
    if (map) vacacionId = map.fichajes_entity_id;
  }

  if (payload.deleted) {
    if (!vacacionId) return { deleted: true, skipped: true, reason: 'sin_mapeo' };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query('SELECT * FROM vacaciones WHERE id = $1', [vacacionId]);
      const vac = rows[0];
      if (vac?.saldo_id) {
        await client.query('DELETE FROM saldos WHERE id = $1', [vac.saldo_id]);
      }
      await client.query('DELETE FROM vacaciones WHERE id = $1', [vacacionId]);
      await client.query('COMMIT');
      await deleteEntityMapping(ENTITY_TYPES.LEAVE, vacacionId);
      return { deleted: true, vacacionId };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  const empleadoId =
    payload.fichajes_employee_id ||
    (await getFichajesEmployeeId(payload.odoo_employee_id));
  if (!empleadoId) {
    throw new Error('Empleado Fichajes no mapeado para esta ausencia Odoo');
  }

  const fechaInicio = toDateOnly(payload.fecha_inicio || payload.request_date_from || payload.date_from);
  const fechaFin = toDateOnly(payload.fecha_fin || payload.request_date_to || payload.date_to);
  if (!fechaInicio || !fechaFin) {
    throw new Error('fecha_inicio y fecha_fin son obligatorias');
  }
  if (fechaInicio > fechaFin) {
    throw new Error('fecha_inicio debe ser <= fecha_fin');
  }

  const tipo = normalizeTipo(payload.tipo, payload.leave_type_name);
  const motivo = payload.motivo || payload.name || '';
  const dias = diasEntreFechas(fechaInicio, fechaFin);
  const adminId = (await getSystemAdminId()) || empleadoId;
  const concepto = `${TIPO_LABELS[tipo]}: ${fechaInicio} – ${fechaFin}${motivo ? ` (${motivo})` : ''} [Odoo]`;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (vacacionId) {
      const { rows: existing } = await client.query(
        'SELECT * FROM vacaciones WHERE id = $1',
        [vacacionId]
      );
      if (!existing[0]) {
        vacacionId = null;
      } else {
        const vac = existing[0];
        if (vac.saldo_id) {
          await client.query(
            `UPDATE saldos SET cantidad = $1, concepto = $2, tipo = $3, fecha_referencia = $4
             WHERE id = $5`,
            [-dias, concepto, tipo, fechaInicio, vac.saldo_id]
          );
        }
        const { rows } = await client.query(
          `UPDATE vacaciones
           SET empleado_id = $1, fecha_inicio = $2, fecha_fin = $3, tipo = $4, motivo = $5
           WHERE id = $6
           RETURNING *`,
          [empleadoId, fechaInicio, fechaFin, tipo, motivo, vacacionId]
        );
        await client.query('COMMIT');
        await saveEntityMapping(ENTITY_TYPES.LEAVE, vacacionId, 'hr.leave', odooLeaveId);
        return { action: 'updated', vacacion: rows[0] };
      }
    }

    const { rows: saldoRows } = await client.query(
      `INSERT INTO saldos (empleado_id, tipo, cantidad, concepto, admin_id, fecha_referencia)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [empleadoId, tipo, -dias, concepto, adminId, fechaInicio]
    );
    const saldoId = saldoRows[0].id;
    const { rows } = await client.query(
      `INSERT INTO vacaciones (empleado_id, fecha_inicio, fecha_fin, tipo, motivo, saldo_id, admin_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [empleadoId, fechaInicio, fechaFin, tipo, motivo, saldoId, adminId]
    );
    await client.query('COMMIT');
    vacacionId = rows[0].id;
    await saveEntityMapping(ENTITY_TYPES.LEAVE, vacacionId, 'hr.leave', odooLeaveId);
    return { action: 'created', vacacion: rows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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
  upsertVacacionFromOdoo,
  syncAllVacaciones,
  getEntityMapping,
};
