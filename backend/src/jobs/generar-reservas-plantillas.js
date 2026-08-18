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
    : addDaysStr(getLunesSemana(getFechaLocal()), 7);

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

function iniciarCronGenerarReservasPlantillas() {
  console.log(`[plantillas] Cron semanal activo (${TZ}, lunes 00:05 → semana entrante)`);

  setInterval(async () => {
    try {
      const now = new Date();
      if (getDiaSemanaCanarias(now) !== 1) return;

      const ms = getMsDelDiaLocal(now);
      const ventanaInicio = (0 * 60 + 5) * 60 * 1000;
      const ventanaFin = ventanaInicio + 60 * 1000;
      if (ms < ventanaInicio || ms >= ventanaFin) return;

      const runKey = getFechaLocal(now);
      if (lastRunKey === runKey) return;
      lastRunKey = runKey;

      console.log('[plantillas] Generando reservas de la semana entrante…');
      const resultado = await generarReservasDesdePlantillas();
      console.log(
        `[plantillas] Semana ${resultado.semana_desde}: ${resultado.creadas.length} creadas, ${resultado.omitidas.length} ya existían`
      );
    } catch (err) {
      console.error('[plantillas] Error en cron:', err.message);
    }
  }, 30_000);
}

module.exports = {
  generarReservasDesdePlantillas,
  iniciarCronGenerarReservasPlantillas,
  DIAS_SEMANA,
};
