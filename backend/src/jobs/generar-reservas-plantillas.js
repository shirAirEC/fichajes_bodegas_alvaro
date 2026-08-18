const { pool } = require('../db/database');
const { TZ, getFechaLocal, getMsDelDiaLocal } = require('../timezone');
const { syncReservaToOdoo } = require('../sync/sync-reservas');

const DIAS_SEMANA = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

function dateToStr(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysStr(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return dateToStr(d);
}

function getLunesSemana(fechaStr) {
  const d = new Date(fechaStr + 'T12:00:00');
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return dateToStr(d);
}

/** Lunes de la semana ENTRANTE (la que materializa el cron del lunes 00:05). */
function getLunesSemanaEntrante(date = new Date()) {
  return addDaysStr(getLunesSemana(getFechaLocal(date)), 7);
}

function enVentanaCronLunes(date = new Date()) {
  if (getDiaSemanaCanarias(date) !== 1) return false;
  const ms = getMsDelDiaLocal(date);
  const ventanaInicio = (0 * 60 + 5) * 60 * 1000;
  const ventanaFin = ventanaInicio + 60 * 1000;
  return ms >= ventanaInicio && ms < ventanaFin;
}

function getDiaSemanaCanarias(date = new Date()) {
  const fecha = getFechaLocal(date);
  const d = new Date(fecha + 'T12:00:00');
  const jsDay = d.getDay();
  return jsDay === 0 ? 7 : jsDay;
}

function asJsonb(val) {
  if (Array.isArray(val) || (val && typeof val === 'object')) {
    return JSON.stringify(val);
  }
  return JSON.stringify([]);
}

/**
 * Materializa reservas desde plantillas activas.
 *
 * - Sin `fecha`: semana ENTRANTE (el lunes siguiente al de la semana actual en Canarias).
 *   El cron del lunes 00:05 usa este modo: así cada visita existe ≥7 días y el aviso D-1 de Odoo puede dispararse.
 * - Con `fecha` (YYYY-MM-DD): semana que contiene esa fecha (lun–dom). Útil para backfill y pruebas.
 *
 * Idempotente: no duplica (plantilla_id, fecha).
 */
async function generarReservasDesdePlantillas({ fecha } = {}) {
  const lunes = fecha
    ? getLunesSemana(fecha)
    : getLunesSemanaEntrante();

  const { rows: plantillas } = await pool.query(
    `SELECT * FROM reserva_plantillas WHERE activa = 1 ORDER BY dia_semana, hora NULLS LAST`
  );

  const creadas = [];
  const omitidas = [];

  for (const p of plantillas) {
    const fechaInstancia = addDaysStr(lunes, p.dia_semana - 1);

    const { rows: existentes } = await pool.query(
      `SELECT id FROM reservas WHERE plantilla_id = $1 AND fecha = $2::date`,
      [p.id, fechaInstancia]
    );
    if (existentes.length > 0) {
      omitidas.push({ plantilla_id: p.id, fecha: fechaInstancia, reserva_id: existentes[0].id });
      continue;
    }

    const { rows } = await pool.query(
      `INSERT INTO reservas (
         fecha, hora, nombre, pax, estado, tipo_servicio, guia, menu, necesidades_especiales,
         turoperador_odoo_id, turoperador_nombre, bus_ref, plantilla_id, admin_id, pax_confirmado
       ) VALUES ($1, $2, $3, $4, 'sin_confirmar', $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12, $13, NULL)
       ON CONFLICT (plantilla_id, fecha) WHERE plantilla_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [
        fechaInstancia,
        p.hora || null,
        p.nombre,
        p.pax,
        p.tipo_servicio || '',
        p.guia || '',
        asJsonb(p.menu),
        asJsonb(p.necesidades_especiales),
        p.turoperador_odoo_id || null,
        p.turoperador_nombre || null,
        p.bus_ref || null,
        p.id,
        p.admin_id,
      ]
    );

    if (!rows[0]) {
      omitidas.push({ plantilla_id: p.id, fecha: fechaInstancia, reserva_id: null });
      continue;
    }

    const reserva = rows[0];
    creadas.push({ plantilla_id: p.id, fecha: fechaInstancia, reserva_id: reserva.id });

    syncReservaToOdoo(reserva.id).catch((err) => {
      console.error('[plantillas] sync Odoo reserva', reserva.id, err.message);
    });
  }

  return {
    semana_desde: lunes,
    semana_hasta: addDaysStr(lunes, 6),
    plantillas_activas: plantillas.length,
    creadas,
    omitidas,
  };
}

let lastRunKey = null;
let generando = false;

async function contarPlantillasSinInstancia(lunesEntrante) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM reserva_plantillas p
      WHERE p.activa = 1
        AND NOT EXISTS (
          SELECT 1 FROM reservas r
           WHERE r.plantilla_id = p.id
             AND r.fecha = ($1::date + (p.dia_semana - 1))
        )`,
    [lunesEntrante]
  );
  return rows[0]?.n || 0;
}

async function ejecutarGeneracionSemanaEntrante(motivo) {
  console.log(`[plantillas] Generando reservas de la semana entrante (${motivo})…`);
  const resultado = await generarReservasDesdePlantillas();
  console.log(
    `[plantillas] Semana ${resultado.semana_desde}: ${resultado.creadas.length} creadas, ${resultado.omitidas.length} ya existían`
  );
  return resultado;
}

/**
 * Catch-up: cualquier día lun–dom, si faltan instancias de la semana ENTRANTE
 * (la que el cron del lunes debería haber creado), materializarlas.
 * Idempotente (ON CONFLICT). No toca la semana actual.
 */
async function catchupSemanaEntrante(motivo) {
  const lunesEntrante = getLunesSemanaEntrante();
  const faltan = await contarPlantillasSinInstancia(lunesEntrante);
  if (faltan === 0) return null;
  return ejecutarGeneracionSemanaEntrante(motivo);
}

async function tickCronPlantillas({ arranque = false } = {}) {
  if (generando) return;
  generando = true;
  try {
    const now = new Date();
    if (enVentanaCronLunes(now)) {
      const runKey = getFechaLocal(now);
      if (lastRunKey === runKey) return;
      await ejecutarGeneracionSemanaEntrante(arranque ? 'arranque' : 'cron');
      lastRunKey = runKey;
      return;
    }
    await catchupSemanaEntrante(arranque ? 'arranque' : 'catch-up');
  } catch (err) {
    console.error('[plantillas] Error en cron:', err.message);
  } finally {
    generando = false;
  }
}

function iniciarCronGenerarReservasPlantillas() {
  console.log(`[plantillas] Cron semanal activo (${TZ}, lunes 00:05 → semana entrante)`);

  tickCronPlantillas({ arranque: true });

  setInterval(() => {
    tickCronPlantillas();
  }, 30_000);
}

module.exports = {
  generarReservasDesdePlantillas,
  iniciarCronGenerarReservasPlantillas,
  DIAS_SEMANA,
};
