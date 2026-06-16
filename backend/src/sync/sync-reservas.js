const { pool } = require('../db/database');
const { crearTimestampLocal } = require('../timezone');
const odoo = require('./odoo-client');
const {
  ENTITY_TYPES,
  saveEntityMapping,
  deleteEntityMapping,
} = require('./sync-map');

const DEFAULT_DURATION_MS = 60 * 60 * 1000;

function formatOdooDatetime(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function normalizeFecha(fecha) {
  if (!fecha) return null;
  if (typeof fecha === 'string') return fecha.slice(0, 10);
  return fecha.toISOString().slice(0, 10);
}

function serializeJsonField(value) {
  if (value == null || value === '') return false;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

function reservaDateTimes(reserva) {
  const fecha = normalizeFecha(reserva.fecha);
  if (!fecha) {
    throw new Error('Reserva sin fecha');
  }

  if (!reserva.hora) {
    const start = crearTimestampLocal(fecha, '00:00:00');
    const stop = crearTimestampLocal(fecha, '23:59:59');
    return {
      allday: true,
      start: formatOdooDatetime(start),
      stop: formatOdooDatetime(stop),
    };
  }

  const horaStr = String(reserva.hora).slice(0, 8);
  const start = crearTimestampLocal(fecha, horaStr);
  const stop = new Date(start.getTime() + DEFAULT_DURATION_MS);
  return {
    allday: false,
    start: formatOdooDatetime(start),
    stop: formatOdooDatetime(stop),
  };
}

function reservaToOdooVals(reserva) {
  const { allday, start, stop } = reservaDateTimes(reserva);
  return {
    name: reserva.nombre || 'Reserva',
    privacy: 'public',
    allday,
    start,
    stop,
    x_pax: reserva.pax || false,
    x_estado: reserva.estado || 'sin_confirmar',
    x_tipo_servicio: reserva.tipo_servicio || false,
    x_guia: reserva.guia || false,
    x_menu: serializeJsonField(reserva.menu),
    x_necesidades: serializeJsonField(reserva.necesidades_especiales),
    x_notas: reserva.notas || false,
  };
}

async function syncReservaToOdoo(reservaId) {
  if (!odoo.isConfigured()) {
    console.warn('[odoo-sync] Odoo no configurado; omitiendo sync reserva', reservaId);
    return null;
  }
  if (!(await odoo.isModelAvailable('calendar.event'))) {
    return { skipped: true, reason: 'calendar_event_unavailable' };
  }

  const { rows } = await pool.query('SELECT * FROM reservas WHERE id = $1', [reservaId]);
  const reserva = rows[0];
  if (!reserva) return null;

  const vals = reservaToOdooVals(reserva);
  const odooId = await odoo.upsertReserva(vals, reserva.id);
  await saveEntityMapping(ENTITY_TYPES.RESERVA, reserva.id, 'calendar.event', odooId);
  return { synced: true, odooId, reservaId: reserva.id };
}

async function deleteReservaFromOdoo(reservaId) {
  if (!odoo.isConfigured()) return null;
  if (!(await odoo.isModelAvailable('calendar.event'))) {
    return { skipped: true, reason: 'calendar_event_unavailable' };
  }
  await odoo.deleteReserva(reservaId);
  await deleteEntityMapping(ENTITY_TYPES.RESERVA, reservaId);
  return { deleted: true, reservaId };
}

async function syncAllReservas(options = {}) {
  if (!odoo.isConfigured()) {
    return { skipped: true, reason: 'odoo_not_configured' };
  }
  if (!(await odoo.isModelAvailable('calendar.event'))) {
    return { skipped: true, reason: 'calendar_event_unavailable' };
  }

  const { desde, hasta, limit = 1000 } = options;
  const condiciones = [];
  const params = [];
  if (desde) {
    params.push(desde);
    condiciones.push(`fecha >= $${params.length}::date`);
  }
  if (hasta) {
    params.push(hasta);
    condiciones.push(`fecha <= $${params.length}::date`);
  }
  params.push(limit);
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT id FROM reservas ${where} ORDER BY fecha ASC, id ASC LIMIT $${params.length}`,
    params
  );

  const summary = { synced: 0, skipped: 0, errors: 0, details: [] };
  for (const row of rows) {
    try {
      const result = await syncReservaToOdoo(row.id);
      if (result?.synced) summary.synced++;
      else if (result?.skipped) summary.skipped++;
      summary.details.push(result);
    } catch (err) {
      summary.errors++;
      summary.details.push({ reservaId: row.id, error: err.message });
    }
  }
  return summary;
}

module.exports = {
  reservaToOdooVals,
  syncReservaToOdoo,
  deleteReservaFromOdoo,
  syncAllReservas,
};
