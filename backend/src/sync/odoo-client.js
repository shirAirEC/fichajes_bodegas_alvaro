const ODOO_URL = (process.env.ODOO_URL || '').replace(/\/$/, '');
const ODOO_DB = process.env.ODOO_DB || '';
const ODOO_USER = process.env.ODOO_USER || '';
const ODOO_PASSWORD = process.env.ODOO_PASSWORD || process.env.ODOO_API_KEY || '';

let cachedUid = null;
const modelAvailability = {};

function isConfigured() {
  return Boolean(ODOO_URL && ODOO_DB && ODOO_USER && ODOO_PASSWORD);
}

async function jsonRpc(service, method, args) {
  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'call',
      params: { service, method, args },
      id: Date.now(),
    }),
  });
  const data = await res.json();
  if (data.error) {
    const msg = data.error.data?.message || data.error.message || JSON.stringify(data.error);
    throw new Error(`Odoo JSON-RPC: ${msg}`);
  }
  return data.result;
}

async function authenticate() {
  if (cachedUid) return cachedUid;
  const uid = await jsonRpc('common', 'authenticate', [ODOO_DB, ODOO_USER, ODOO_PASSWORD, {}]);
  if (!uid) throw new Error('Autenticacion Odoo fallida: credenciales invalidas');
  cachedUid = uid;
  return uid;
}

async function executeKw(model, method, args, kwargs = {}) {
  const uid = await authenticate();
  return jsonRpc('object', 'execute_kw', [
    ODOO_DB,
    uid,
    ODOO_PASSWORD,
    model,
    method,
    args,
    kwargs,
  ]);
}

const SYNC_CONTEXT = { context: { skip_fichajes_sync: true } };
const EMPLOYEE_CONTEXT = { context: { skip_fichajes_sync: true, active_test: false } };

function splitName(fullName) {
  const parts = (fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { nombre: 'Empleado', apellidos: 'Sin apellido' };
  if (parts.length === 1) return { nombre: parts[0], apellidos: '-' };
  return { nombre: parts[0], apellidos: parts.slice(1).join(' ') };
}

function combineName(nombre, apellidos) {
  return [nombre, apellidos].filter(Boolean).join(' ').trim();
}

async function isModelAvailable(model) {
  if (Object.prototype.hasOwnProperty.call(modelAvailability, model)) {
    return modelAvailability[model];
  }
  try {
    await executeKw(model, 'search', [[]], { limit: 1, ...SYNC_CONTEXT });
    modelAvailability[model] = true;
  } catch (err) {
    console.warn(`[odoo-sync] Modelo ${model} no disponible:`, err.message);
    modelAvailability[model] = false;
  }
  return modelAvailability[model];
}

async function search(model, domain, options = {}) {
  return executeKw(model, 'search', [domain], { ...SYNC_CONTEXT, ...options });
}

async function searchRead(model, domain, fields = [], options = {}) {
  return executeKw(model, 'search_read', [domain, fields], { ...SYNC_CONTEXT, ...options });
}

async function create(model, vals) {
  return executeKw(model, 'create', [vals], SYNC_CONTEXT);
}

async function write(model, ids, vals) {
  return executeKw(model, 'write', [ids, vals], SYNC_CONTEXT);
}

async function unlink(model, ids) {
  return executeKw(model, 'unlink', [ids], SYNC_CONTEXT);
}

async function createEmployee(vals) {
  return executeKw('hr.employee', 'create', [vals], EMPLOYEE_CONTEXT);
}

async function writeEmployee(odooId, vals) {
  return executeKw('hr.employee', 'write', [[odooId], vals], EMPLOYEE_CONTEXT);
}

async function searchEmployee(domain) {
  return executeKw('hr.employee', 'search', [domain], { limit: 1, ...EMPLOYEE_CONTEXT });
}

async function readEmployee(odooId, fields = ['name', 'work_email', 'active', 'fichajes_employee_id']) {
  const rows = await executeKw('hr.employee', 'read', [[odooId], fields], EMPLOYEE_CONTEXT);
  return rows[0] || null;
}

async function upsertAttendance(vals, fichajesEntradaId) {
  const existing = await search('hr.attendance', [['fichajes_entrada_id', '=', fichajesEntradaId]], { limit: 1 });
  if (existing.length) {
    await write('hr.attendance', existing, vals);
    return existing[0];
  }
  return create('hr.attendance', { ...vals, fichajes_entrada_id: fichajesEntradaId });
}

async function deleteAttendanceByFichajesId(fichajesEntradaId) {
  const existing = await search('hr.attendance', [['fichajes_entrada_id', '=', fichajesEntradaId]], { limit: 1 });
  if (!existing.length) return false;
  await unlink('hr.attendance', existing);
  return true;
}

async function upsertOvertimeAdjustment(odooEmployeeId, fecha, horas, fichajesAjusteId, concepto) {
  const domain = [['fichajes_ajuste_id', '=', fichajesAjusteId]];
  let existing = await search('hr.attendance.overtime', domain, { limit: 1 });

  if (!existing.length) {
    existing = await search('hr.attendance.overtime', [
      ['employee_id', '=', odooEmployeeId],
      ['date', '=', fecha],
      ['adjustment', '=', true],
    ], { limit: 1 });
  }

  const vals = {
    employee_id: odooEmployeeId,
    date: fecha,
    duration: horas,
    adjustment: true,
    fichajes_ajuste_id: fichajesAjusteId,
  };

  if (existing.length) {
    await write('hr.attendance.overtime', existing, vals);
    return existing[0];
  }
  return create('hr.attendance.overtime', vals);
}

async function deleteOvertimeAdjustment(fichajesAjusteId) {
  const existing = await search('hr.attendance.overtime', [['fichajes_ajuste_id', '=', fichajesAjusteId]], { limit: 1 });
  if (!existing.length) {
    return false;
  }
  await unlink('hr.attendance.overtime', existing);
  return true;
}

async function upsertEmployeeCalendar(odooEmployeeId, calendarVals) {
  const calName = calendarVals.name;
  let calIds = await search('resource.calendar', [['name', '=', calName]], { limit: 1 });
  if (calIds.length) {
    await write('resource.calendar', calIds, calendarVals);
  } else {
    calIds = [await create('resource.calendar', calendarVals)];
  }
  await writeEmployee(odooEmployeeId, { resource_calendar_id: calIds[0] });
  return calIds[0];
}

async function upsertHorario(vals, fichajesHorarioId) {
  const existing = await search('bodegas.fichajes.horario', [['fichajes_horario_id', '=', fichajesHorarioId]], { limit: 1 });
  if (existing.length) {
    await write('bodegas.fichajes.horario', existing, vals);
    return existing[0];
  }
  return create('bodegas.fichajes.horario', { ...vals, fichajes_horario_id: fichajesHorarioId });
}

// Estados de hr.leave que ya no admiten modificación (idempotencia).
const LEAVE_LOCKED_STATES = ['validate', 'validate1', 'refuse'];

async function upsertLeave(vals, fichajesVacacionId) {
  const existing = await search('hr.leave', [['fichajes_vacacion_id', '=', fichajesVacacionId]], { limit: 1 });
  if (existing.length) {
    // Una ausencia ya validada no se puede reescribir en Odoo. En re-sync la
    // tratamos como ya sincronizada (idempotente) en vez de provocar un error.
    const [rec] = await executeKw('hr.leave', 'read', [existing, ['state']], SYNC_CONTEXT);
    if (rec && LEAVE_LOCKED_STATES.includes(rec.state)) {
      return existing[0];
    }
    await write('hr.leave', existing, vals);
    try {
      await executeKw('hr.leave', 'action_validate', [existing], SYNC_CONTEXT);
    } catch (err) {
      console.warn('[odoo-sync] No se pudo validar hr.leave', existing[0], err.message);
    }
    return existing[0];
  }
  const leaveId = await create('hr.leave', { ...vals, fichajes_vacacion_id: fichajesVacacionId });
  try {
    await executeKw('hr.leave', 'action_validate', [[leaveId]], SYNC_CONTEXT);
  } catch (err) {
    console.warn('[odoo-sync] No se pudo validar hr.leave', leaveId, err.message);
  }
  return leaveId;
}

async function deleteLeave(fichajesVacacionId) {
  const existing = await search('hr.leave', [['fichajes_vacacion_id', '=', fichajesVacacionId]], { limit: 1 });
  if (!existing.length) return false;
  await unlink('hr.leave', existing);
  return true;
}

async function deactivateHorario(fichajesHorarioId) {
  const existing = await search('bodegas.fichajes.horario', [['fichajes_horario_id', '=', fichajesHorarioId]], { limit: 1 });
  if (!existing.length) return false;
  await write('bodegas.fichajes.horario', existing, { activo: false });
  return true;
}

async function upsertReserva(vals, fichajesReservaId) {
  const existing = await search('calendar.event', [['fichajes_reserva_id', '=', fichajesReservaId]], { limit: 1 });
  if (existing.length) {
    await write('calendar.event', existing, vals);
    return existing[0];
  }
  return create('calendar.event', { ...vals, fichajes_reserva_id: fichajesReservaId });
}

async function deleteReserva(fichajesReservaId) {
  const existing = await search('calendar.event', [['fichajes_reserva_id', '=', fichajesReservaId]], { limit: 1 });
  if (!existing.length) return false;
  await unlink('calendar.event', existing);
  return true;
}

const LEAVE_TYPE_NAMES = {
  // Nombre distinto a "Vacaciones": Odoo no deja cambiar requires_allocation
  // de un tipo que ya tiene ausencias tomadas.
  vacaciones: 'Vacaciones con saldo',
  permiso_especial: 'Permiso especial',
  baja_medica: 'Baja médica',
};

/** Tipos que en Odoo deben llevar allocation (días disponibles). */
const LEAVE_TYPE_REQUIRES_ALLOCATION = {
  vacaciones: 'yes',
  permiso_especial: 'yes',
  baja_medica: 'no',
};

async function getLeaveTypeId(tipo) {
  const name = LEAVE_TYPE_NAMES[tipo] || LEAVE_TYPE_NAMES.vacaciones;
  const requires = LEAVE_TYPE_REQUIRES_ALLOCATION[tipo] || 'no';
  let ids = await search('hr.leave.type', [['name', '=', name]], { limit: 1 });
  if (ids.length) {
    const [current] = await executeKw(
      'hr.leave.type',
      'read',
      [ids, ['requires_allocation']],
      SYNC_CONTEXT
    );
    if (current && current.requires_allocation !== requires) {
      try {
        await write('hr.leave.type', ids, { requires_allocation: requires });
      } catch (err) {
        console.warn('[odoo-sync] No se pudo actualizar requires_allocation', name, err.message);
      }
    }
    return ids[0];
  }
  return create('hr.leave.type', {
    name,
    requires_allocation: requires,
    leave_validation_type: 'hr',
  });
}

async function upsertAllocation(vals, fichajesSaldoId) {
  const existing = await search(
    'hr.leave.allocation',
    [['fichajes_saldo_id', '=', fichajesSaldoId]],
    { limit: 1 }
  );
  if (existing.length) {
    await write('hr.leave.allocation', existing, vals);
    const [rec] = await executeKw('hr.leave.allocation', 'read', [existing, ['state']], SYNC_CONTEXT);
    if (rec && rec.state !== 'validate') {
      try {
        await executeKw('hr.leave.allocation', 'action_validate', [existing], SYNC_CONTEXT);
      } catch (err) {
        try {
          await executeKw('hr.leave.allocation', 'action_approve', [existing], SYNC_CONTEXT);
        } catch (err2) {
          console.warn('[odoo-sync] No se pudo validar allocation', existing[0], err2.message);
        }
      }
    }
    return existing[0];
  }
  const allocationId = await create('hr.leave.allocation', {
    ...vals,
    fichajes_saldo_id: fichajesSaldoId,
    allocation_type: 'regular',
  });
  try {
    await executeKw('hr.leave.allocation', 'action_validate', [[allocationId]], SYNC_CONTEXT);
  } catch (err) {
    try {
      await executeKw('hr.leave.allocation', 'action_approve', [[allocationId]], SYNC_CONTEXT);
    } catch (err2) {
      console.warn('[odoo-sync] No se pudo validar allocation', allocationId, err2.message);
    }
  }
  return allocationId;
}

async function deleteAllocationByFichajesId(fichajesSaldoId) {
  const existing = await search(
    'hr.leave.allocation',
    [['fichajes_saldo_id', '=', fichajesSaldoId]],
    { limit: 1 }
  );
  if (!existing.length) return false;
  // Si está validada, intentar refuse/cancel antes de unlink
  try {
    await executeKw('hr.leave.allocation', 'action_refuse', [existing], SYNC_CONTEXT);
  } catch (_) {
    /* ignore */
  }
  await unlink('hr.leave.allocation', existing);
  return true;
}

module.exports = {
  isConfigured,
  isModelAvailable,
  splitName,
  combineName,
  executeKw,
  search,
  searchRead,
  create,
  write,
  unlink,
  createEmployee,
  writeEmployee,
  searchEmployee,
  readEmployee,
  upsertAttendance,
  deleteAttendanceByFichajesId,
  upsertOvertimeAdjustment,
  deleteOvertimeAdjustment,
  upsertEmployeeCalendar,
  upsertHorario,
  upsertLeave,
  deleteLeave,
  deactivateHorario,
  upsertReserva,
  deleteReserva,
  upsertAllocation,
  deleteAllocationByFichajesId,
  getLeaveTypeId,
  LEAVE_TYPE_NAMES,
};
