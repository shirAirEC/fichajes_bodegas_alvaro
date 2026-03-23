const express = require('express');
const { pool } = require('../db/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { timeToMs } = require('./horarios');

const router = express.Router();

// ─── UTILIDADES ───────────────────────────────────────────────────────────────

function calcularHorasDeFichajes(fichajes) {
  let minutos = 0;
  let entrada = null;
  let breakStart = null;
  let breakAllowed = 30;
  for (const f of fichajes) {
    if (f.tipo === 'entrada') {
      if (breakStart) {
        const breakReal = (new Date(f.timestamp) - breakStart) / 60000;
        minutos += Math.min(breakReal, breakAllowed);
        breakStart = null;
      }
      entrada = new Date(f.timestamp);
    } else if (f.tipo === 'salida' && entrada) {
      minutos += (new Date(f.timestamp) - entrada) / 60000;
      entrada = null;
      if (f.es_descanso) {
        breakStart = new Date(f.timestamp);
        const match = (f.notas || '').match(/(\d+)\s*min/);
        breakAllowed = match ? parseInt(match[1]) : 30;
      }
    }
  }
  return Math.round(minutos) / 60;
}

function tipoPrioridadHorario(tipo) {
  return { fecha: 0, rango: 1, semanal: 2, diario: 3 }[tipo] ?? 99;
}

// Calcula el objetivo de horas del mes basándose en los horarios configurados.
// Devuelve null si no hay horarios activos para ese empleado.
async function calcularObjetivoMensPorHorario(empleadoId, anio, mes) {
  const [{ rows: horarios }, { rows: empRows }, objConf] = await Promise.all([
    pool.query(
      `SELECT * FROM horarios WHERE (empleado_id = $1 OR empleado_id IS NULL) AND activo = 1`,
      [empleadoId]
    ),
    pool.query('SELECT fecha_alta FROM empleados WHERE id = $1', [empleadoId]),
    getObjetivoEmpleado(empleadoId)
  ]);

  if (horarios.length === 0) return null;

  // No contar días anteriores a la fecha de alta (primer mes parcial)
  const fechaAltaRaw = empRows[0]?.fecha_alta;
  const fechaAlta = fechaAltaRaw ? new Date(fechaAltaRaw + 'T12:00:00') : null;
  const desdeDia = (fechaAlta && fechaAlta.getFullYear() === anio && fechaAlta.getMonth() + 1 === mes)
    ? fechaAlta.getDate()
    : 1;

  // Obtener períodos de vacaciones del empleado que solapan este mes
  const fechaInicioMesStr = `${anio}-${String(mes).padStart(2, '0')}-01`;
  const fechaFinMesStr = new Date(anio, mes, 0).toISOString().split('T')[0];
  const { rows: vacRows } = await pool.query(
    `SELECT fecha_inicio, fecha_fin FROM vacaciones
     WHERE empleado_id = $1 AND fecha_inicio <= $2 AND fecha_fin >= $3`,
    [empleadoId, fechaFinMesStr, fechaInicioMesStr]
  );

  // Si el empleado tiene horarios personales, los días no cubiertos por ellos son libres
  // (no aplicar el horario global en esos días)
  const tieneHorarioPersonal = horarios.some(h => h.empleado_id == empleadoId);

  const diasEnMes = new Date(anio, mes, 0).getDate();
  let totalHoras = 0;
  let hayDiasConHorario = false;

  for (let dia = desdeDia; dia <= diasEnMes; dia++) {
    const fecha = `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    const d = new Date(fecha + 'T12:00:00');
    const diaSemana = d.getDay() === 0 ? 7 : d.getDay(); // 1=lun...7=dom

    let mejor = null;
    for (const h of horarios) {
      const esPersonal = h.empleado_id == empleadoId;
      const aplica =
        (h.tipo === 'fecha' && h.fecha === fecha) ||
        (h.tipo === 'rango' && h.fecha_inicio <= fecha && (!h.fecha_fin || h.fecha_fin >= fecha)) ||
        (h.tipo === 'semanal' && h.dias_semana && h.dias_semana.split(',').map(Number).includes(diaSemana)) ||
        h.tipo === 'diario';

      if (aplica) {
        if (!mejor ||
          (esPersonal && !mejor._esPersonal) ||
          (esPersonal === mejor._esPersonal && tipoPrioridadHorario(h.tipo) < tipoPrioridadHorario(mejor.tipo))) {
          mejor = { ...h, _esPersonal: esPersonal };
        }
      }
    }

    // Si el empleado tiene horario personal pero este día solo cubre el global → día libre
    if (tieneHorarioPersonal && mejor && !mejor._esPersonal) continue;

    // Si este día cae en un período de vacaciones registrado → no se espera trabajo
    const esVacaciones = vacRows.some(v => v.fecha_inicio <= fecha && v.fecha_fin >= fecha);
    if (esVacaciones) continue;

    if (mejor) {
      let horasDia = 0;
      if (mejor.hora_salida) {
        // Diferencia exacta entrada–salida
        const msEntrada = timeToMs(mejor.hora_entrada);
        const msSalida = timeToMs(mejor.hora_salida);
        if (msSalida > msEntrada) horasDia = (msSalida - msEntrada) / 3600000;
      } else if (mejor.dias_semana) {
        // Sin hora de salida: horas_semana ÷ nº días configurados = horas/día
        const diasConfig = mejor.dias_semana.split(',').filter(Boolean).length;
        if (diasConfig > 0) horasDia = objConf.horas_semana / diasConfig;
      } else if (mejor.tipo === 'diario') {
        // Horario diario sin días explícitos: jornada lunes–sábado (6 días)
        // Domingo (diaSemana=7) no cuenta
        if (diaSemana <= 6) horasDia = objConf.horas_semana / 6;
      }
      // Otros casos sin dias_semana ni hora_salida → fallback a horas_mes

      if (horasDia > 0) {
        totalHoras += horasDia;
        hayDiasConHorario = true;
      }
    }
  }

  if (!hayDiasConHorario) return null;

  return Math.max(0, Math.round(totalHoras * 100) / 100);
}

// Calcula el objetivo de horas para un rango arbitrario de fechas,
// aplicando la misma lógica de horarios + vacaciones que el cálculo mensual.
// Devuelve null si no hay horarios activos.
async function calcularObjetivoRango(empleadoId, fechaInicio, fechaFin) {
  const [{ rows: horarios }, { rows: empRows }, objConf] = await Promise.all([
    pool.query(
      `SELECT * FROM horarios WHERE (empleado_id = $1 OR empleado_id IS NULL) AND activo = 1`,
      [empleadoId]
    ),
    pool.query('SELECT fecha_alta FROM empleados WHERE id = $1', [empleadoId]),
    getObjetivoEmpleado(empleadoId)
  ]);

  if (horarios.length === 0) return null;

  const fechaAltaRaw = empRows[0]?.fecha_alta;
  // fecha_alta puede venir como YYYY-MM-DD o como ISO timestamp
  const fechaAltaStr = fechaAltaRaw
    ? (typeof fechaAltaRaw === 'string' ? fechaAltaRaw.split('T')[0] : new Date(fechaAltaRaw).toISOString().split('T')[0])
    : null;

  const { rows: vacRows } = await pool.query(
    `SELECT fecha_inicio, fecha_fin FROM vacaciones
     WHERE empleado_id = $1 AND fecha_inicio <= $2 AND fecha_fin >= $3`,
    [empleadoId, fechaFin, fechaInicio]
  );

  const tieneHorarioPersonal = horarios.some(h => h.empleado_id == empleadoId);

  let totalHoras = 0;
  let hayDiasConHorario = false;

  const dInicio = new Date(fechaInicio + 'T12:00:00');
  const dFin    = new Date(fechaFin    + 'T12:00:00');

  for (let d = new Date(dInicio); d <= dFin; d.setDate(d.getDate() + 1)) {
    const fecha = d.toISOString().split('T')[0];

    // No contar días anteriores a la fecha de alta
    if (fechaAltaStr && fecha < fechaAltaStr) continue;

    const diaSemana = d.getDay() === 0 ? 7 : d.getDay(); // 1=lun…7=dom

    let mejor = null;
    for (const h of horarios) {
      const esPersonal = h.empleado_id == empleadoId;
      const aplica =
        (h.tipo === 'fecha'    && h.fecha === fecha) ||
        (h.tipo === 'rango'    && h.fecha_inicio <= fecha && (!h.fecha_fin || h.fecha_fin >= fecha)) ||
        (h.tipo === 'semanal'  && h.dias_semana && h.dias_semana.split(',').map(Number).includes(diaSemana)) ||
        h.tipo === 'diario';

      if (aplica) {
        if (!mejor ||
          (esPersonal && !mejor._esPersonal) ||
          (esPersonal === mejor._esPersonal && tipoPrioridadHorario(h.tipo) < tipoPrioridadHorario(mejor.tipo))) {
          mejor = { ...h, _esPersonal: esPersonal };
        }
      }
    }

    // Día no cubierto por horario personal → día libre
    if (tieneHorarioPersonal && mejor && !mejor._esPersonal) continue;

    // Día de vacaciones → no se espera trabajo
    const esVacaciones = vacRows.some(v => v.fecha_inicio <= fecha && v.fecha_fin >= fecha);
    if (esVacaciones) continue;

    if (mejor) {
      let horasDia = 0;
      if (mejor.hora_salida) {
        const msEntrada = timeToMs(mejor.hora_entrada);
        const msSalida  = timeToMs(mejor.hora_salida);
        if (msSalida > msEntrada) horasDia = (msSalida - msEntrada) / 3600000;
      } else if (mejor.dias_semana) {
        const diasConfig = mejor.dias_semana.split(',').filter(Boolean).length;
        if (diasConfig > 0) horasDia = objConf.horas_semana / diasConfig;
      } else if (mejor.tipo === 'diario') {
        if (diaSemana <= 6) horasDia = objConf.horas_semana / 6;
      }
      if (horasDia > 0) { totalHoras += horasDia; hayDiasConHorario = true; }
    }
  }

  if (!hayDiasConHorario) return null;
  return Math.max(0, Math.round(totalHoras * 100) / 100);
}

// Objetivo mensual: usa horarios si están configurados, si no cae al valor configurado
async function getObjetivoMes(empleadoId, anio, mes) {
  const porHorario = await calcularObjetivoMensPorHorario(empleadoId, anio, mes);
  if (porHorario !== null) return porHorario;
  const objetivo = await getObjetivoEmpleado(empleadoId);
  return objetivo.horas_mes;
}

async function getObjetivoEmpleado(empleadoId) {
  // Intenta primero objetivo personalizado del empleado
  const { rows: custom } = await pool.query(
    'SELECT horas_semana, horas_mes FROM horas_objetivo WHERE empleado_id = $1',
    [empleadoId]
  );
  if (custom[0]?.horas_semana != null || custom[0]?.horas_mes != null) {
    const semana = parseFloat(custom[0].horas_semana) || 40;
    // Si solo se configura semana, derivar mes (52 semanas / 12 meses)
    const mes = custom[0].horas_mes != null
      ? parseFloat(custom[0].horas_mes)
      : Math.round(semana * 52 / 12 * 100) / 100;
    return { horas_semana: semana, horas_mes: mes };
  }
  // Fallback a configuración global
  const { rows: cfg } = await pool.query(
    "SELECT clave, valor FROM configuracion WHERE clave IN ('horas_objetivo_semana','horas_objetivo_mes')"
  );
  const config = Object.fromEntries(cfg.map(r => [r.clave, parseFloat(r.valor)]));
  const semana = config.horas_objetivo_semana || 40;
  // Si horas_mes no está configurado o es 0, derivarlo de horas_semana
  const mes = config.horas_objetivo_mes || Math.round(semana * 52 / 12 * 100) / 100;
  return { horas_semana: semana, horas_mes: mes };
}

async function calcularBalancePeriodo(empleadoId, fechaInicio, fechaFin) {
  const { rows: fichajes } = await pool.query(
    `SELECT tipo, timestamp, es_descanso FROM fichajes
     WHERE empleado_id = $1 AND timestamp::date >= $2::date AND timestamp::date <= $3::date
     ORDER BY timestamp ASC`,
    [empleadoId, fechaInicio, fechaFin]
  );
  const { rows: ajustesRow } = await pool.query(
    `SELECT COALESCE(SUM(cantidad_horas), 0) AS total FROM ajustes_horas
     WHERE empleado_id = $1 AND fecha >= $2::date AND fecha <= $3::date`,
    [empleadoId, fechaInicio, fechaFin]
  );
  return {
    horasTrabajadas: calcularHorasDeFichajes(fichajes),
    horasAjuste: parseFloat(ajustesRow[0].total)
  };
}

// Devuelve array de meses [{anio, mes, primerDia, ultimoDia}] desde fecha_alta hasta hoy
function mesesDesdeAlta(fechaAlta) {
  const meses = [];
  const inicio = new Date(fechaAlta);
  inicio.setDate(1);
  const hoy = new Date();
  const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 1);

  let cursor = new Date(inicio);
  while (cursor <= fin) {
    const anio = cursor.getFullYear();
    const mes = cursor.getMonth() + 1;
    const primerDia = `${anio}-${String(mes).padStart(2, '0')}-01`;
    const ultimoDia = new Date(anio, mes, 0).toISOString().split('T')[0];
    meses.push({ anio, mes, primerDia, ultimoDia });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return meses;
}

// ─── RUTAS EMPLEADO ───────────────────────────────────────────────────────────

// GET /api/horas/resumen  — resumen semana + mes actual + balance acumulado
router.get('/resumen', authMiddleware, async (req, res) => {
  try {
    const empleadoId = req.user.id;
    const objetivo = await getObjetivoEmpleado(empleadoId);

    // Semana actual (lunes - domingo)
    const hoy = new Date();
    const diaSemana = hoy.getDay() === 0 ? 6 : hoy.getDay() - 1;
    const lunesSemana = new Date(hoy); lunesSemana.setDate(hoy.getDate() - diaSemana);
    const domingoSemana = new Date(lunesSemana); domingoSemana.setDate(lunesSemana.getDate() + 6);
    const semanaInicio = lunesSemana.toISOString().split('T')[0];
    const semanaFin = domingoSemana.toISOString().split('T')[0];

    // Mes actual
    const mesInicio = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`;
    const mesFin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().split('T')[0];

    const [semana, mes] = await Promise.all([
      calcularBalancePeriodo(empleadoId, semanaInicio, semanaFin),
      calcularBalancePeriodo(empleadoId, mesInicio, mesFin)
    ]);

    // Balance acumulado (desde fecha_alta)
    const { rows: empRow } = await pool.query('SELECT fecha_alta FROM empleados WHERE id = $1', [empleadoId]);
    const meses = mesesDesdeAlta(empRow[0].fecha_alta);

    const objMesActual = await getObjetivoMes(empleadoId, hoy.getFullYear(), hoy.getMonth() + 1);

    let balanceAcumulado = 0;
    for (const m of meses) {
      const { horasTrabajadas, horasAjuste } = await calcularBalancePeriodo(empleadoId, m.primerDia, m.ultimoDia);
      const objM = await getObjetivoMes(empleadoId, m.anio, m.mes);
      balanceAcumulado += horasTrabajadas + horasAjuste - objM;
    }

    res.json({
      objetivo,
      semana: {
        inicio: semanaInicio, fin: semanaFin,
        trabajadas: Math.round(semana.horasTrabajadas * 100) / 100,
        ajuste: semana.horasAjuste,
        objetivo: objetivo.horas_semana,
        diferencia: Math.round((semana.horasTrabajadas + semana.horasAjuste - objetivo.horas_semana) * 100) / 100
      },
      mes: {
        inicio: mesInicio, fin: mesFin,
        trabajadas: Math.round(mes.horasTrabajadas * 100) / 100,
        ajuste: mes.horasAjuste,
        objetivo: objMesActual,
        diferencia: Math.round((mes.horasTrabajadas + mes.horasAjuste - objMesActual) * 100) / 100
      },
      balanceAcumulado: Math.round(balanceAcumulado * 100) / 100
    });
  } catch (err) {
    console.error('horas/resumen error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/horas/historial  — historial mensual del empleado
router.get('/historial', authMiddleware, async (req, res) => {
  try {
    const empleadoId = req.user.id;
    const objetivo = await getObjetivoEmpleado(empleadoId);
    const { rows: empRow } = await pool.query('SELECT fecha_alta FROM empleados WHERE id = $1', [empleadoId]);
    const meses = mesesDesdeAlta(empRow[0].fecha_alta);

    let balanceAcum = 0;
    const historial = [];
    for (const m of meses) {
      const { horasTrabajadas, horasAjuste } = await calcularBalancePeriodo(empleadoId, m.primerDia, m.ultimoDia);
      const objM = await getObjetivoMes(empleadoId, m.anio, m.mes);
      const diferencia = horasTrabajadas + horasAjuste - objM;
      balanceAcum += diferencia;
      historial.push({
        anio: m.anio, mes: m.mes,
        trabajadas: Math.round(horasTrabajadas * 100) / 100,
        ajuste: horasAjuste,
        objetivo: objM,
        diferencia: Math.round(diferencia * 100) / 100,
        balanceAcumulado: Math.round(balanceAcum * 100) / 100
      });
    }

    res.json({ historial: historial.reverse(), objetivo });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/horas/filtro?modo=semana|mes|anio|rango&desde=&hasta=
// Devuelve horas trabajadas en el periodo indicado con desglose semanal/mensual
router.get('/filtro', authMiddleware, async (req, res) => {
  try {
    const empleadoId = req.user.id;
    const { modo = 'mes', desde, hasta } = req.query;
    const objetivo = await getObjetivoEmpleado(empleadoId);
    const hoy = new Date();

    let fechaInicio, fechaFin;

    if (modo === 'semana') {
      const diaSemana = hoy.getDay() === 0 ? 6 : hoy.getDay() - 1;
      const lunes = new Date(hoy); lunes.setDate(hoy.getDate() - diaSemana);
      const domingo = new Date(lunes); domingo.setDate(lunes.getDate() + 6);
      fechaInicio = lunes.toISOString().split('T')[0];
      fechaFin = domingo.toISOString().split('T')[0];
    } else if (modo === 'mes') {
      fechaInicio = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`;
      fechaFin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().split('T')[0];
    } else if (modo === 'anio') {
      fechaInicio = `${hoy.getFullYear()}-01-01`;
      fechaFin = `${hoy.getFullYear()}-12-31`;
    } else if (modo === 'rango' && desde && hasta) {
      fechaInicio = desde;
      fechaFin = hasta;
    } else {
      return res.status(400).json({ error: 'Parámetros de filtro inválidos' });
    }

    // Desglose por semanas dentro del periodo
    const { rows: fichajes } = await pool.query(
      `SELECT tipo, timestamp, es_descanso FROM fichajes
       WHERE empleado_id = $1 AND timestamp::date >= $2::date AND timestamp::date <= $3::date
       ORDER BY timestamp ASC`,
      [empleadoId, fechaInicio, fechaFin]
    );
    const { rows: ajRow } = await pool.query(
      `SELECT COALESCE(SUM(cantidad_horas), 0) AS total FROM ajustes_horas
       WHERE empleado_id = $1 AND fecha >= $2::date AND fecha <= $3::date`,
      [empleadoId, fechaInicio, fechaFin]
    );

    const horasTrabajadas = calcularHorasDeFichajes(fichajes);
    const horasAjuste = parseFloat(ajRow[0].total);
    const semanasRango = Math.ceil((new Date(fechaFin) - new Date(fechaInicio)) / (7 * 86400000));

    let objetivoPeriodo;
    if (modo === 'semana') {
      objetivoPeriodo = objetivo.horas_semana;
    } else if (modo === 'mes') {
      objetivoPeriodo = await getObjetivoMes(empleadoId, hoy.getFullYear(), hoy.getMonth() + 1);
    } else if (modo === 'anio') {
      // Sumar el objetivo de cada mes del año
      let totalAnio = 0;
      for (let m = 1; m <= 12; m++) {
        totalAnio += await getObjetivoMes(empleadoId, hoy.getFullYear(), m);
      }
      objetivoPeriodo = totalAnio;
    } else {
      objetivoPeriodo = objetivo.horas_semana * semanasRango;
    }

    // Desglose diario
    const desglose = {};
    for (const f of fichajes) {
      const dia = new Date(f.timestamp).toISOString().split('T')[0];
      if (!desglose[dia]) desglose[dia] = [];
      desglose[dia].push(f);
    }
    const dias = Object.entries(desglose).map(([fecha, fs]) => ({
      fecha,
      horas: Math.round(calcularHorasDeFichajes(fs) * 100) / 100
    }));

    res.json({
      modo, fechaInicio, fechaFin,
      trabajadas: Math.round(horasTrabajadas * 100) / 100,
      ajuste: horasAjuste,
      objetivoPeriodo: Math.round(objetivoPeriodo * 100) / 100,
      diferencia: Math.round((horasTrabajadas + horasAjuste - objetivoPeriodo) * 100) / 100,
      desgloseDiario: dias,
      objetivo
    });
  } catch (err) {
    console.error('horas/filtro error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── RUTAS ADMIN ──────────────────────────────────────────────────────────────

// Genera array de semanas [{lunes, domingo}] dentro de un rango
// Calcula el saldo acumulado basado en semanas ISO completamente cerradas
// (lunes a domingo, el domingo debe haber pasado)
async function calcularSaldoSemanalAcum(empleadoId, fechaAlta, objetivoSemanal) {
  const hoy = new Date();
  // Obtener el último domingo completamente pasado
  const diaSemana = hoy.getDay(); // 0=Dom, 1=Lun…
  // Si hoy es domingo (0) retrocedemos 7 días; si es lunes (1) retrocedemos 1 día, etc.
  const diasAtras = diaSemana === 0 ? 7 : diaSemana;
  const ultimoDomingo = new Date(hoy);
  ultimoDomingo.setDate(hoy.getDate() - diasAtras);
  const ultimoDomingoStr = ultimoDomingo.toISOString().split('T')[0];

  // Suma TODOS los ajustes manuales del empleado (sin filtro de fecha)
  // para que ajustes de la semana actual (aún abierta) también cuenten
  const ajustesTotal = await pool.query(
    'SELECT COALESCE(SUM(cantidad_horas), 0) AS total FROM ajustes_horas WHERE empleado_id = $1',
    [empleadoId]
  );
  const totalAjustes = parseFloat(ajustesTotal.rows[0].total) || 0;

  // Si el empleado se incorporó después del último domingo → solo ajustes
  if (!fechaAlta || fechaAlta > ultimoDomingoStr) return Math.round(totalAjustes * 100) / 100;

  const semanas = semanasEnPeriodo(fechaAlta, ultimoDomingoStr)
    .filter(s => s.domingo <= ultimoDomingoStr);

  let saldo = 0;
  for (const s of semanas) {
    const { horasTrabajadas } = await calcularBalancePeriodo(empleadoId, s.lunes, s.domingo);
    // Objetivo real de esa semana: aplica horario + vacaciones (puede ser < horas_semana si hay ausencias)
    const objSemana = await calcularObjetivoRango(empleadoId, s.lunes, s.domingo);
    const objetivoEfectivo = objSemana !== null ? objSemana : objetivoSemanal;
    saldo += horasTrabajadas - objetivoEfectivo;
  }
  // Sumar todos los ajustes manuales por separado (independientemente de la semana)
  saldo += totalAjustes;
  return Math.round(saldo * 100) / 100;
}

function semanasEnPeriodo(fechaInicio, fechaFin) {
  const semanas = [];
  const inicio = new Date(fechaInicio + 'T12:00:00');
  const fin = new Date(fechaFin + 'T12:00:00');
  // Retroceder al lunes de la semana de inicio
  const diaSemana = inicio.getDay() === 0 ? 6 : inicio.getDay() - 1;
  let lunes = new Date(inicio);
  lunes.setDate(inicio.getDate() - diaSemana);
  while (lunes <= fin) {
    const domingo = new Date(lunes);
    domingo.setDate(lunes.getDate() + 6);
    semanas.push({
      lunes: lunes.toISOString().split('T')[0],
      domingo: domingo.toISOString().split('T')[0]
    });
    lunes = new Date(lunes);
    lunes.setDate(lunes.getDate() + 7);
  }
  return semanas;
}

// GET /api/horas/admin/todos?modo=semana|mes|anio|rango&desde=&hasta=
router.get('/admin/todos', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { modo = 'mes', desde, hasta } = req.query;
    const hoy = new Date();
    let fechaInicio, fechaFin;

    if (modo === 'semana') {
      const d = hoy.getDay() === 0 ? 6 : hoy.getDay() - 1;
      const lunes = new Date(hoy); lunes.setDate(hoy.getDate() - d);
      const domingo = new Date(lunes); domingo.setDate(lunes.getDate() + 6);
      fechaInicio = lunes.toISOString().split('T')[0];
      fechaFin = domingo.toISOString().split('T')[0];
    } else if (modo === 'mes') {
      fechaInicio = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`;
      fechaFin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().split('T')[0];
    } else if (modo === 'anio') {
      fechaInicio = `${hoy.getFullYear()}-01-01`;
      fechaFin = `${hoy.getFullYear()}-12-31`;
    } else if (modo === 'rango' && desde && hasta) {
      fechaInicio = desde;
      fechaFin = hasta;
    } else {
      fechaInicio = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`;
      fechaFin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().split('T')[0];
    }

    const semanas = semanasEnPeriodo(fechaInicio, fechaFin);

    const { rows: empleados } = await pool.query(
      "SELECT id, nombre, apellidos, departamento, fecha_alta FROM empleados WHERE activo = 1 AND rol = 'empleado' ORDER BY apellidos"
    );

    const resumen = await Promise.all(empleados.map(async emp => {
      const objetivo = await getObjetivoEmpleado(emp.id);
      const { horasTrabajadas, horasAjuste } = await calcularBalancePeriodo(emp.id, fechaInicio, fechaFin);

      let objetivoPeriodo;
      if (modo === 'semana') {
        const objSem = await calcularObjetivoRango(emp.id, fechaInicio, fechaFin);
        objetivoPeriodo = objSem !== null ? objSem : objetivo.horas_semana;
      } else if (modo === 'mes') {
        objetivoPeriodo = await getObjetivoMes(emp.id, hoy.getFullYear(), hoy.getMonth() + 1);
      } else if (modo === 'anio') {
        let totalAnio = 0;
        for (let m = 1; m <= 12; m++) {
          totalAnio += await getObjetivoMes(emp.id, hoy.getFullYear(), m);
        }
        objetivoPeriodo = totalAnio;
      } else {
        objetivoPeriodo = objetivo.horas_semana * semanas.length;
      }

      // Desglose por semana — objetivo real por semana (aplica horario + vacaciones)
      const desgloseSemanas = await Promise.all(semanas.map(async s => {
        const { horasTrabajadas: ht, horasAjuste: ha } = await calcularBalancePeriodo(emp.id, s.lunes, s.domingo);
        const objSemana = await calcularObjetivoRango(emp.id, s.lunes, s.domingo);
        const objEfectivo = objSemana !== null ? objSemana : objetivo.horas_semana;
        return {
          lunes: s.lunes,
          domingo: s.domingo,
          trabajadas: Math.round(ht * 100) / 100,
          ajuste: ha,
          objetivo: Math.round(objEfectivo * 100) / 100,
          diferencia: Math.round((ht + ha - objEfectivo) * 100) / 100
        };
      }));

      // Balance acumulado por semanas cerradas
      const balanceAcum = await calcularSaldoSemanalAcum(emp.id, emp.fecha_alta, objetivo.horas_semana);

      return {
        id: emp.id, nombre: emp.nombre, apellidos: emp.apellidos, departamento: emp.departamento,
        objetivo,
        periodo: {
          trabajadas: Math.round(horasTrabajadas * 100) / 100,
          ajuste: horasAjuste,
          objetivo: Math.round(objetivoPeriodo * 100) / 100,
          diferencia: Math.round((horasTrabajadas + horasAjuste - objetivoPeriodo) * 100) / 100
        },
        mes: {
          trabajadas: Math.round(horasTrabajadas * 100) / 100,
          ajuste: horasAjuste,
          objetivo: Math.round(objetivoPeriodo * 100) / 100,
          diferencia: Math.round((horasTrabajadas + horasAjuste - objetivoPeriodo) * 100) / 100
        },
        desgloseSemanas,
        balanceAcumulado: balanceAcum
      };
    }));

    res.json({ empleados: resumen, semanas, fechaInicio, fechaFin, modo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// GET /api/horas/admin/empleado/:id  — detalle completo de un empleado
router.get('/admin/empleado/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { rows: empRow } = await pool.query(
      'SELECT id, nombre, apellidos, departamento, fecha_alta FROM empleados WHERE id = $1',
      [id]
    );
    if (!empRow[0]) return res.status(404).json({ error: 'Empleado no encontrado' });

    const emp = empRow[0];
    const objetivo = await getObjetivoEmpleado(id);
    const meses = mesesDesdeAlta(emp.fecha_alta);

    let balanceAcum = 0;
    const historial = [];
    for (const m of meses) {
      const { horasTrabajadas, horasAjuste } = await calcularBalancePeriodo(id, m.primerDia, m.ultimoDia);
      const objM = await getObjetivoMes(id, m.anio, m.mes);
      const diferencia = horasTrabajadas + horasAjuste - objM;
      balanceAcum += diferencia;
      historial.push({
        anio: m.anio, mes: m.mes,
        trabajadas: Math.round(horasTrabajadas * 100) / 100,
        ajuste: horasAjuste,
        objetivo: objM,
        diferencia: Math.round(diferencia * 100) / 100,
        balanceAcumulado: Math.round(balanceAcum * 100) / 100
      });
    }

    const { rows: ajustes } = await pool.query(
      `SELECT a.*, e.nombre AS admin_nombre, e.apellidos AS admin_apellidos
       FROM ajustes_horas a JOIN empleados e ON a.admin_id = e.id
       WHERE a.empleado_id = $1 ORDER BY a.fecha DESC`,
      [id]
    );

    res.json({
      empleado: emp, objetivo, historial: historial.reverse(),
      ajustes, balanceAcumulado: Math.round(balanceAcum * 100) / 100
    });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PUT /api/horas/admin/objetivo/:id  — establecer objetivo personalizado
router.put('/admin/objetivo/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { horas_semana, horas_mes } = req.body;

    if (horas_semana == null && horas_mes == null) {
      // Eliminar override → usar valores globales
      await pool.query('DELETE FROM horas_objetivo WHERE empleado_id = $1', [id]);
      return res.json({ message: 'Objetivo personalizado eliminado, usando valores globales' });
    }

    await pool.query(
      `INSERT INTO horas_objetivo (empleado_id, horas_semana, horas_mes, admin_id, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (empleado_id) DO UPDATE
         SET horas_semana = $2, horas_mes = $3, admin_id = $4, updated_at = NOW()`,
      [id, horas_semana || null, horas_mes || null, req.user.id]
    );

    const objetivo = await getObjetivoEmpleado(id);
    res.json({ message: 'Objetivo actualizado', objetivo });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/horas/admin/ajuste  — añadir ajuste manual de horas
router.post('/admin/ajuste', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { empleado_id, cantidad_horas, concepto, fecha } = req.body;
    if (!empleado_id || cantidad_horas == null || !concepto) {
      return res.status(400).json({ error: 'empleado_id, cantidad_horas y concepto son obligatorios' });
    }
    if (cantidad_horas === 0) {
      return res.status(400).json({ error: 'La cantidad de horas no puede ser 0' });
    }

    const { rows } = await pool.query(
      `INSERT INTO ajustes_horas (empleado_id, cantidad_horas, concepto, admin_id, fecha)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [empleado_id, cantidad_horas, concepto.trim(), req.user.id, fecha || new Date().toISOString().split('T')[0]]
    );

    const { rows: full } = await pool.query(
      `SELECT a.*, e.nombre AS admin_nombre, e.apellidos AS admin_apellidos
       FROM ajustes_horas a JOIN empleados e ON a.admin_id = e.id WHERE a.id = $1`,
      [rows[0].id]
    );
    res.status(201).json(full[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// DELETE /api/horas/admin/ajuste/:id  — eliminar ajuste
router.delete('/admin/ajuste/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id FROM ajustes_horas WHERE id = $1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Ajuste no encontrado' });
    await pool.query('DELETE FROM ajustes_horas WHERE id = $1', [req.params.id]);
    res.json({ message: 'Ajuste eliminado' });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// PUT /api/horas/admin/config  — actualizar horas objetivo globales
router.put('/admin/config', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { horas_semana, horas_mes } = req.body;
    if (horas_semana != null) {
      await pool.query("UPDATE configuracion SET valor = $1 WHERE clave = 'horas_objetivo_semana'", [String(horas_semana)]);
    }
    if (horas_mes != null) {
      await pool.query("UPDATE configuracion SET valor = $1 WHERE clave = 'horas_objetivo_mes'", [String(horas_mes)]);
    }
    const { rows } = await pool.query(
      "SELECT clave, valor FROM configuracion WHERE clave IN ('horas_objetivo_semana','horas_objetivo_mes')"
    );
    res.json(Object.fromEntries(rows.map(r => [r.clave, parseFloat(r.valor)])));
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// ─── INFORME HISTÓRICO ────────────────────────────────────────────────────────

const MESES_ES = ['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio',
  'Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function fmtMinutos(m) {
  const h = Math.floor(Math.abs(m) / 60);
  const mm = Math.abs(m) % 60;
  return mm > 0 ? `${h}h ${mm}m` : `${h}h`;
}
function fmtDiferencia(h) {
  const abs = Math.abs(h);
  const hh = Math.floor(abs);
  const mm = Math.round((abs - hh) * 60);
  const s = h < 0 ? '-' : '+';
  return mm > 0 ? `${s}${hh}h ${mm}m` : `${s}${hh}h`;
}
function fmtHoraTs(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'Atlantic/Canary' });
}

// GET /api/horas/admin/informe?empleado_id=&desde=&hasta=&formato=csv
router.get('/admin/informe', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { empleado_id, desde, hasta, formato } = req.query;

    const hoyStr = new Date().toISOString().split('T')[0];
    const primerMes = `${new Date().getFullYear()}-01-01`;
    const fechaDesde = desde || primerMes;
    const fechaHasta = hasta || hoyStr;

    // Empleados a incluir
    const { rows: empleados } = empleado_id
      ? await pool.query(
          'SELECT id, nombre, apellidos, departamento, fecha_alta FROM empleados WHERE id = $1',
          [empleado_id]
        )
      : await pool.query(
          "SELECT id, nombre, apellidos, departamento, fecha_alta FROM empleados WHERE activo=1 AND rol='empleado' ORDER BY apellidos"
        );

    const informe = await Promise.all(empleados.map(async emp => {
      // Fichajes del periodo
      const { rows: fichajes } = await pool.query(
        `SELECT tipo, timestamp, es_descanso
         FROM fichajes
         WHERE empleado_id = $1
           AND timestamp::date >= $2::date
           AND timestamp::date <= $3::date
         ORDER BY timestamp ASC`,
        [emp.id, fechaDesde, fechaHasta]
      );

      // Agrupar por fecha (local Canarias)
      const porFecha = {};
      for (const f of fichajes) {
        const fecha = new Date(f.timestamp)
          .toLocaleDateString('es-ES', { timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit' })
          .split('/').reverse().join('-'); // DD/MM/YYYY → YYYY-MM-DD
        if (!porFecha[fecha]) porFecha[fecha] = [];
        porFecha[fecha].push(f);
      }

      // Calcular minutos por jornada
      const jornadas = Object.entries(porFecha).map(([fecha, fs]) => {
        let entrada = null;
        let minutos = 0;
        let breakStart = null;
        let breakAllowed = 30;
        let primeraEntrada = null;
        let ultimaSalida = null;
        for (const f of fs) {
          if (f.tipo === 'entrada') {
            if (breakStart) {
              const breakReal = (new Date(f.timestamp) - breakStart) / 60000;
              minutos += Math.min(breakReal, breakAllowed);
              breakStart = null;
            }
            const t = new Date(f.timestamp);
            if (!primeraEntrada) primeraEntrada = f.timestamp;
            entrada = t;
          } else if (f.tipo === 'salida' && entrada) {
            minutos += (new Date(f.timestamp) - entrada) / 60000;
            ultimaSalida = f.timestamp;
            entrada = null;
            if (f.es_descanso) {
              breakStart = new Date(f.timestamp);
              const match = (f.notas || '').match(/(\d+)\s*min/);
              breakAllowed = match ? parseInt(match[1]) : 30;
            }
          }
        }
        return { fecha, minutos: Math.round(minutos), primeraEntrada, ultimaSalida, enCurso: entrada !== null };
      }).sort((a, b) => a.fecha.localeCompare(b.fecha));

      // Agrupar por mes
      const porMes = {};
      for (const j of jornadas) {
        const [anio, mes] = j.fecha.split('-').map(Number);
        const key = `${anio}-${String(mes).padStart(2, '0')}`;
        if (!porMes[key]) porMes[key] = { anio, mes, jornadas: [] };
        porMes[key].jornadas.push(j);
      }

      const meses = await Promise.all(
        Object.values(porMes).sort((a, b) => a.anio - b.anio || a.mes - b.mes).map(async m => {
          const objetivo = await getObjetivoMes(emp.id, m.anio, m.mes);
          const minutosTotal = m.jornadas.reduce((s, j) => s + j.minutos, 0);
          const trabajadas = Math.round(minutosTotal / 60 * 100) / 100;
          return {
            anio: m.anio, mes: m.mes,
            label: `${MESES_ES[m.mes]} ${m.anio}`,
            objetivo: Math.round(objetivo * 100) / 100,
            trabajadas,
            diferencia: Math.round((trabajadas - objetivo) * 100) / 100,
            jornadas: m.jornadas
          };
        })
      );

      const objEmp = await getObjetivoEmpleado(emp.id);
      // Balance acumulado correcto (semanas cerradas + vacaciones descontadas)
      const balanceAcumulado = await calcularSaldoSemanalAcum(emp.id, emp.fecha_alta, objEmp.horas_semana);
      return { id: emp.id, nombre: emp.nombre, apellidos: emp.apellidos, departamento: emp.departamento, horas_semana: objEmp.horas_semana, balanceAcumulado, meses };
    }));

    if (formato === 'csv') {
      const cabecera = 'Empleado;Departamento;Mes;Fecha;Día semana;Entrada;Salida;Horas trabajadas;Objetivo mes (h);Diferencia mes\n';
      const filas = [];
      for (const emp of informe) {
        for (const m of emp.meses) {
          for (const j of m.jornadas) {
            const diasES = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
            const diaSem = diasES[new Date(j.fecha + 'T12:00:00').getDay()];
            const fechaES = new Date(j.fecha + 'T12:00:00').toLocaleDateString('es-ES');
            filas.push([
              `${emp.nombre} ${emp.apellidos}`,
              emp.departamento || '',
              m.label,
              fechaES,
              diaSem,
              fmtHoraTs(j.primeraEntrada),
              j.enCurso ? 'En curso' : fmtHoraTs(j.ultimaSalida),
              fmtMinutos(j.minutos),
              m.objetivo,
              fmtDiferencia(m.diferencia)
            ].join(';'));
          }
          // Fila resumen del mes
          filas.push([
            `${emp.nombre} ${emp.apellidos}`,
            emp.departamento || '',
            m.label,
            'TOTAL MES', '', '', '',
            fmtMinutos(m.trabajadas * 60),
            m.objetivo,
            fmtDiferencia(m.diferencia)
          ].join(';'));
          filas.push(''); // línea vacía entre meses
        }
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="informe_${fechaDesde}_${fechaHasta}.csv"`);
      return res.send('\uFEFF' + cabecera + filas.join('\n'));
    }

    res.json(informe);
  } catch (err) {
    console.error('informe error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
