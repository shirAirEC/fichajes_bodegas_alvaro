const { pool } = require('../db/database');
const odoo = require('./odoo-client');
const {
  ENTITY_TYPES,
  saveEntityMapping,
  deleteEntityMapping,
  getOdooEmployeeId,
} = require('./sync-map');
const { getMappedEmpleadoIds } = require('./sync-empleado');

function formatTime(value) {
  if (!value) return false;
  const s = String(value);
  return s.length >= 5 ? s.slice(0, 8) : s;
}

function horarioToOdooVals(horario) {
  const odooEmployeeIdPromise = horario.empleado_id
    ? getOdooEmployeeId(horario.empleado_id)
    : Promise.resolve(null);

  return odooEmployeeIdPromise.then((odooEmployeeId) => ({
    employee_id: odooEmployeeId || false,
    fichajes_employee_id: horario.empleado_id || false,
    tipo: horario.tipo,
    dias_semana: horario.dias_semana || false,
    fecha: horario.fecha || false,
    fecha_inicio: horario.fecha_inicio || false,
    fecha_fin: horario.fecha_fin || false,
    hora_entrada: formatTime(horario.hora_entrada),
    hora_salida: formatTime(horario.hora_salida),
    activo: horario.activo === 1,
  }));
}

async function syncHorarioToOdoo(horarioId) {
  if (!odoo.isConfigured()) {
    console.warn('[odoo-sync] Odoo no configurado; omitiendo sync horario', horarioId);
    return null;
  }
  if (!(await odoo.isModelAvailable('bodegas.fichajes.horario'))) {
    return { skipped: true, reason: 'bodegas_horario_model_unavailable' };
  }

  const { rows } = await pool.query('SELECT * FROM horarios WHERE id = $1', [horarioId]);
  const horario = rows[0];
  if (!horario) return null;

  const vals = await horarioToOdooVals(horario);
  if (horario.empleado_id && !vals.employee_id) {
    return { skipped: true, reason: 'empleado_sin_mapeo', horarioId };
  }

  const odooId = await odoo.upsertHorario(vals, horario.id);
  await saveEntityMapping(ENTITY_TYPES.HORARIO, horario.id, 'bodegas.fichajes.horario', odooId);
  return { synced: true, odooId, horarioId: horario.id };
}

async function deleteHorarioFromOdoo(horarioId) {
  if (!odoo.isConfigured()) return null;
  if (!(await odoo.isModelAvailable('bodegas.fichajes.horario'))) {
    return { skipped: true, reason: 'bodegas_horario_model_unavailable' };
  }
  await odoo.deactivateHorario(horarioId);
  await deleteEntityMapping(ENTITY_TYPES.HORARIO, horarioId);
  return { deactivated: true, horarioId };
}

async function syncAllHorarios(options = {}) {
  if (!odoo.isConfigured()) {
    return { skipped: true, reason: 'odoo_not_configured' };
  }
  if (!(await odoo.isModelAvailable('bodegas.fichajes.horario'))) {
    return { skipped: true, reason: 'bodegas_horario_model_unavailable' };
  }

  const { empleadoId, activoOnly = false, limit = 1000 } = options;
  const condiciones = [];
  const params = [];
  if (activoOnly) condiciones.push('activo = 1');
  if (empleadoId) {
    params.push(empleadoId);
    condiciones.push(`empleado_id = $${params.length}`);
  } else {
    const mappedIds = await getMappedEmpleadoIds();
    if (!mappedIds.length) {
      return { synced: 0, skipped: 0, errors: 0, details: [], reason: 'sin_empleados_mapeados' };
    }
    params.push(mappedIds);
    condiciones.push(`(empleado_id IS NULL OR empleado_id = ANY($${params.length}))`);
  }
  params.push(limit);
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT id FROM horarios ${where} ORDER BY id ASC LIMIT $${params.length}`,
    params
  );

  const summary = { synced: 0, skipped: 0, errors: 0, details: [] };
  for (const row of rows) {
    try {
      const result = await syncHorarioToOdoo(row.id);
      if (result?.synced) summary.synced++;
      else if (result?.skipped || result?.deactivated) summary.skipped++;
      summary.details.push(result);
    } catch (err) {
      summary.errors++;
      summary.details.push({ horarioId: row.id, error: err.message });
    }
  }
  return summary;
}

module.exports = {
  syncHorarioToOdoo,
  deleteHorarioFromOdoo,
  syncAllHorarios,
};
