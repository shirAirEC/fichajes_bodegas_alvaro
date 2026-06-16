const { pool } = require('../db/database');
const { getFechaLocal } = require('../timezone');
const odoo = require('./odoo-client');
const {
  ENTITY_TYPES,
  getEntityMapping,
  saveEntityMapping,
  deleteEntityMapping,
  getOdooEmployeeId,
} = require('./sync-map');
const { getMappedEmpleadoIds } = require('./sync-empleado');

/**
 * Empareja fichajes en tramos de trabajo. Los descansos (es_descanso) cierran
 * el tramo en la salida al descanso y abren uno nuevo al volver (entrada).
 */
function pairFichajes(fichajes) {
  const pairs = [];
  let pendingEntrada = null;
  let inBreak = false;

  for (const f of fichajes) {
    if (f.tipo === 'entrada') {
      if (inBreak) {
        inBreak = false;
        pendingEntrada = f;
      } else if (pendingEntrada) {
        pairs.push({ entrada: pendingEntrada, salida: null });
        pendingEntrada = f;
      } else {
        pendingEntrada = f;
      }
    } else if (f.tipo === 'salida') {
      if (pendingEntrada) {
        pairs.push({ entrada: pendingEntrada, salida: f });
        pendingEntrada = null;
        if (f.es_descanso) inBreak = true;
      } else if (f.es_descanso) {
        inBreak = true;
      }
    }
  }
  if (pendingEntrada) {
    pairs.push({ entrada: pendingEntrada, salida: null });
  }
  return pairs;
}

function toOdooDatetime(ts) {
  if (!ts) return false;
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

async function syncAttendancePair(pair) {
  const { entrada, salida } = pair;
  const odooEmployeeId = await getOdooEmployeeId(entrada.empleado_id);
  if (!odooEmployeeId) {
    return { skipped: true, reason: 'empleado_sin_mapeo', entradaId: entrada.id };
  }

  const vals = {
    employee_id: odooEmployeeId,
    check_in: toOdooDatetime(entrada.timestamp),
    check_out: salida ? toOdooDatetime(salida.timestamp) : false,
  };

  const odooId = await odoo.upsertAttendance(vals, entrada.id);
  await saveEntityMapping(ENTITY_TYPES.ATTENDANCE, entrada.id, 'hr.attendance', odooId);
  return { synced: true, odooId, entradaId: entrada.id, salidaId: salida?.id || null };
}

async function deleteAttendanceForEntrada(entradaId) {
  if (!odoo.isConfigured()) return null;
  const mapping = await getEntityMapping(ENTITY_TYPES.ATTENDANCE, entradaId);
  if (!mapping) return { skipped: true, reason: 'sin_mapeo' };
  await odoo.deleteAttendanceByFichajesId(entradaId);
  await deleteEntityMapping(ENTITY_TYPES.ATTENDANCE, entradaId);
  return { deleted: true, entradaId, odooId: mapping.odoo_record_id };
}

async function syncAsistenciaForEmpleado(empleadoId, options = {}) {
  const { desde, hasta, limit = 5000 } = options;
  const condiciones = ['empleado_id = $1'];
  const params = [empleadoId];
  let idx = 2;

  if (desde) {
    condiciones.push(`(timestamp AT TIME ZONE 'Atlantic/Canary')::date >= $${idx}::date`);
    params.push(desde);
    idx++;
  }
  if (hasta) {
    condiciones.push(`(timestamp AT TIME ZONE 'Atlantic/Canary')::date <= $${idx}::date`);
    params.push(hasta);
    idx++;
  }

  const { rows } = await pool.query(
    `SELECT * FROM fichajes
     WHERE ${condiciones.join(' AND ')}
     ORDER BY timestamp ASC, id ASC
     LIMIT $${idx}`,
    [...params, limit]
  );

  const pairs = pairFichajes(rows);
  const results = [];
  for (const pair of pairs) {
    results.push(await syncAttendancePair(pair));
  }
  return results;
}

async function resyncAsistenciaDia(empleadoId, fechaLocal) {
  return syncAsistenciaForEmpleado(empleadoId, { desde: fechaLocal, hasta: fechaLocal });
}

async function resyncAsistenciaForFichaje(fichajeId) {
  if (!odoo.isConfigured()) return null;
  if (!(await odoo.isModelAvailable('hr.attendance'))) return null;

  const { rows } = await pool.query('SELECT * FROM fichajes WHERE id = $1', [fichajeId]);
  const fichaje = rows[0];
  if (!fichaje) return null;

  const fechaLocal = getFechaLocal(new Date(fichaje.timestamp));
  return resyncAsistenciaDia(fichaje.empleado_id, fechaLocal);
}

async function syncAsistenciaAfterFichaje(fichajeId) {
  return resyncAsistenciaForFichaje(fichajeId);
}

async function syncAsistenciaAfterFichajeDelete(fichaje) {
  if (!odoo.isConfigured()) return null;
  if (!(await odoo.isModelAvailable('hr.attendance'))) return null;
  if (!fichaje) return null;

  if (fichaje.tipo === 'entrada' && !fichaje.es_descanso) {
    await deleteAttendanceForEntrada(fichaje.id);
  }

  const fechaLocal = getFechaLocal(new Date(fichaje.timestamp));
  return resyncAsistenciaDia(fichaje.empleado_id, fechaLocal);
}

async function syncAllAsistencias(options = {}) {
  if (!odoo.isConfigured()) {
    console.warn('[odoo-sync] Odoo no configurado; omitiendo sync asistencias');
    return { skipped: true, reason: 'odoo_not_configured' };
  }
  if (!(await odoo.isModelAvailable('hr.attendance'))) {
    return { skipped: true, reason: 'hr_attendance_unavailable' };
  }

  const { empleadoId, desde, hasta, limit = 5000 } = options;
  let empleadoIds = [];
  if (empleadoId) {
    empleadoIds = [empleadoId];
  } else {
    empleadoIds = await getMappedEmpleadoIds();
  }

  const summary = { synced: 0, skipped: 0, errors: 0, details: [] };
  for (const empId of empleadoIds) {
    try {
      const results = await syncAsistenciaForEmpleado(empId, { desde, hasta, limit });
      for (const r of results) {
        if (r.synced) summary.synced++;
        else if (r.skipped || r.deleted) summary.skipped++;
        summary.details.push(r);
      }
    } catch (err) {
      summary.errors++;
      summary.details.push({ empleadoId: empId, error: err.message });
    }
  }
  return summary;
}

module.exports = {
  pairFichajes,
  syncAttendancePair,
  syncAsistenciaForEmpleado,
  resyncAsistenciaDia,
  resyncAsistenciaForFichaje,
  syncAsistenciaAfterFichaje,
  syncAsistenciaAfterFichajeDelete,
  deleteAttendanceForEntrada,
  syncAllAsistencias,
};
