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

/** Un valor "sin rellenar" en planificación: no se envía a Odoo. */
function vacio(valor) {
  return valor == null || valor === '';
}

/**
 * Traduce una reserva de planificación a los campos de la visita en Odoo.
 *
 * Cada dato tiene un dueño, y de ahí salen dos comportamientos distintos:
 *
 *  - DATOS DE PLANIFICACIÓN (fecha, hora, estado, título, guía, menú, notas y
 *    el texto libre del pax): esto es nuestro, aquí está la verdad. Se envían
 *    SIEMPRE, incluso vacíos, para que Odoo refleje exactamente lo que ve el
 *    empleado en su móvil. Si un servicio se reprograma o se cancela, tiene
 *    que llegar sí o sí.
 *
 *  - DATOS DE FACTURACIÓN (turoperadora, tipo de servicio, referencia de
 *    guagua, número de personas y el desglose de niños): el dueño es Odoo.
 *    Solo se envían cuando aquí tienen valor. Antes se mandaba «vacío» y eso
 *    BORRABA en Odoo lo que se hubiera rellenado allí para facturar. Perder un
 *    dato de facturación es mucho peor que no enviarlo, así que ante la duda
 *    no se toca.
 *
 * `vaciados` son los datos de facturación que el administrador acaba de dejar
 * en blanco a propósito en esta misma edición. Esos sí se envían vacíos,
 * porque ahí la intención de borrar es explícita y conocida.
 */
function reservaToOdooVals(reserva, vaciados = []) {
  const { allday, start, stop } = reservaDateTimes(reserva);

  // Lo que manda planificación: siempre, tal cual está aquí.
  const vals = {
    name: reserva.nombre || 'Reserva',
    privacy: 'public',
    allday,
    start,
    stop,
    x_estado: reserva.estado || 'sin_confirmar',
    x_pax: reserva.pax || false,
    x_guia: reserva.guia || false,
    x_notas: reserva.notas || false,
    x_menu: serializeJsonField(reserva.menu),
    x_necesidades: serializeJsonField(reserva.necesidades_especiales),
  };

  // Lo que manda Odoo: solo si aquí hay algo que aportar.
  const facturacion = {
    x_tipo_servicio: reserva.tipo_servicio,
    x_turoperador_id: reserva.turoperador_odoo_id,
    x_bus_ref: reserva.bus_ref,
    x_servicio_ninos_id: reserva.servicio_ninos_odoo_id,
  };
  for (const [campo, valor] of Object.entries(facturacion)) {
    if (!vacio(valor)) vals[campo] = valor;
  }

  // Reparto de personas. Odoo espera los adultos SIN los niños, y solo
  // entiende que hay desglose si le llegan los dos números.
  const total = vacio(reserva.pax_confirmado) ? null : Number(reserva.pax_confirmado);
  const ninos = vacio(reserva.pax_ninos) ? null : Number(reserva.pax_ninos);
  if (total != null && Number.isFinite(total)) {
    vals.x_pax_real = total;
    if (ninos != null && Number.isFinite(ninos) && ninos > 0 && ninos <= total) {
      vals.x_pax_ninos = ninos;
      vals.x_pax_adultos = total - ninos;
    }
  }

  // Borrados explícitos de esta edición.
  for (const campo of vaciados) {
    vals[campo] = false;
  }
  return vals;
}

/**
 * Datos de facturación que se vacían al dejarlos en blanco en el panel. Los de
 * planificación no están aquí porque se envían siempre y no necesitan aviso.
 */
const CAMPO_ODOO_POR_COLUMNA = {
  tipo_servicio: 'x_tipo_servicio',
  turoperador_odoo_id: 'x_turoperador_id',
  bus_ref: 'x_bus_ref',
  servicio_ninos_odoo_id: 'x_servicio_ninos_id',
};

/**
 * Compara la reserva antes y después de una edición y devuelve los campos de
 * Odoo que el administrador ha vaciado a propósito.
 */
function camposVaciados(antes, despues) {
  if (!antes || !despues) return [];
  const salida = [];
  for (const [columna, campoOdoo] of Object.entries(CAMPO_ODOO_POR_COLUMNA)) {
    if (!vacio(antes[columna]) && vacio(despues[columna])) salida.push(campoOdoo);
  }
  // Quitar los niños es dejar la visita sin desglose infantil.
  if (!vacio(antes.pax_ninos) && Number(antes.pax_ninos) > 0
      && (vacio(despues.pax_ninos) || Number(despues.pax_ninos) === 0)) {
    salida.push('x_pax_ninos', 'x_pax_adultos');
  }
  return salida;
}

async function syncReservaToOdoo(reservaId, vaciados = []) {
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

  const vals = reservaToOdooVals(reserva, vaciados);
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
  camposVaciados,
  syncReservaToOdoo,
  deleteReservaFromOdoo,
  syncAllReservas,
};
