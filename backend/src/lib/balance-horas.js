const { pool } = require('../db/database');
const { timeToMs } = require('../routes/horarios');
const { TZ } = require('../timezone');

/** SQL expression: local date (Canarias) for a fichajes.timestamp column. */
const FECHA_LOCAL_SQL = `(timestamp AT TIME ZONE '${TZ}')::date`;

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
        breakAllowed = match ? parseInt(match[1], 10) : 30;
      }
    }
  }
  return Math.round(minutos) / 60;
}

function tipoPrioridadHorario(tipo) {
  return { fecha: 0, rango: 1, semanal: 2, diario: 3 }[tipo] ?? 99;
}

function toDateStr(value) {
  if (!value) return null;
  if (typeof value === 'string') return value.split('T')[0];
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return String(value).split('T')[0];
}

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

  const fechaAltaStr = toDateStr(empRows[0]?.fecha_alta);
  let desdeDia = 1;
  if (fechaAltaStr) {
    const [yA, mA, dA] = fechaAltaStr.split('-').map(Number);
    if (yA === anio && mA === mes) desdeDia = dA;
  }

  const fechaInicioMesStr = `${anio}-${String(mes).padStart(2, '0')}-01`;
  const fechaFinMesStr = new Date(anio, mes, 0).toISOString().split('T')[0];
  const { rows: vacRowsRaw } = await pool.query(
    `SELECT fecha_inicio, fecha_fin FROM vacaciones
     WHERE empleado_id = $1 AND fecha_inicio <= $2 AND fecha_fin >= $3`,
    [empleadoId, fechaFinMesStr, fechaInicioMesStr]
  );
  const vacRows = vacRowsRaw.map(v => ({
    fecha_inicio: toDateStr(v.fecha_inicio),
    fecha_fin: toDateStr(v.fecha_fin)
  }));

  const tieneHorarioPersonal = horarios.some(h => h.empleado_id == empleadoId);
  const diasEnMes = new Date(anio, mes, 0).getDate();
  let totalHoras = 0;
  let hayDiasConHorario = false;

  for (let dia = desdeDia; dia <= diasEnMes; dia++) {
    const fecha = `${anio}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
    const d = new Date(fecha + 'T12:00:00');
    const diaSemana = d.getDay() === 0 ? 7 : d.getDay();

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

    if (tieneHorarioPersonal && mejor && !mejor._esPersonal) continue;
    const esVacaciones = vacRows.some(v => v.fecha_inicio <= fecha && v.fecha_fin >= fecha);
    if (esVacaciones) continue;

    if (mejor) {
      let horasDia = 0;
      if (mejor.hora_salida) {
        const msEntrada = timeToMs(mejor.hora_entrada);
        const msSalida = timeToMs(mejor.hora_salida);
        if (msSalida > msEntrada) horasDia = (msSalida - msEntrada) / 3600000;
      } else if (mejor.dias_semana) {
        const diasConfig = mejor.dias_semana.split(',').filter(Boolean).length;
        if (diasConfig > 0) horasDia = objConf.horas_semana / diasConfig;
      } else if (mejor.tipo === 'diario') {
        if (diaSemana <= 6) horasDia = objConf.horas_semana / 6;
      }
      if (horasDia > 0) {
        totalHoras += horasDia;
        hayDiasConHorario = true;
      }
    }
  }

  if (!hayDiasConHorario) return 0;
  return Math.max(0, Math.round(totalHoras * 100) / 100);
}

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

  const fechaAltaStr = toDateStr(empRows[0]?.fecha_alta);
  const { rows: vacRowsRaw } = await pool.query(
    `SELECT fecha_inicio, fecha_fin FROM vacaciones
     WHERE empleado_id = $1 AND fecha_inicio <= $2 AND fecha_fin >= $3`,
    [empleadoId, fechaFin, fechaInicio]
  );
  const vacRows = vacRowsRaw.map(v => ({
    fecha_inicio: toDateStr(v.fecha_inicio),
    fecha_fin: toDateStr(v.fecha_fin)
  }));

  const tieneHorarioPersonal = horarios.some(h => h.empleado_id == empleadoId);
  let totalHoras = 0;
  let hayDiasConHorario = false;

  const dInicio = new Date(fechaInicio + 'T12:00:00');
  const dFin = new Date(fechaFin + 'T12:00:00');

  for (let d = new Date(dInicio); d <= dFin; d.setDate(d.getDate() + 1)) {
    const fecha = d.toISOString().split('T')[0];
    if (fechaAltaStr && fecha < fechaAltaStr) continue;

    const diaSemana = d.getDay() === 0 ? 7 : d.getDay();
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

    if (tieneHorarioPersonal && mejor && !mejor._esPersonal) continue;
    const esVacaciones = vacRows.some(v => v.fecha_inicio <= fecha && v.fecha_fin >= fecha);
    if (esVacaciones) continue;

    if (mejor) {
      let horasDia = 0;
      if (mejor.hora_salida) {
        const msEntrada = timeToMs(mejor.hora_entrada);
        const msSalida = timeToMs(mejor.hora_salida);
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

  if (!hayDiasConHorario) return 0;
  return Math.max(0, Math.round(totalHoras * 100) / 100);
}

async function getObjetivoMes(empleadoId, anio, mes) {
  const porHorario = await calcularObjetivoMensPorHorario(empleadoId, anio, mes);
  if (porHorario !== null) return porHorario;
  const objetivo = await getObjetivoEmpleado(empleadoId);
  return objetivo.horas_mes;
}

async function getObjetivoEmpleado(empleadoId) {
  const { rows: custom } = await pool.query(
    'SELECT horas_semana, horas_mes FROM horas_objetivo WHERE empleado_id = $1',
    [empleadoId]
  );
  if (custom[0]?.horas_semana != null || custom[0]?.horas_mes != null) {
    const semana = parseFloat(custom[0].horas_semana) || 40;
    const mes = custom[0].horas_mes != null
      ? parseFloat(custom[0].horas_mes)
      : Math.round(semana * 52 / 12 * 100) / 100;
    return { horas_semana: semana, horas_mes: mes };
  }
  const { rows: cfg } = await pool.query(
    "SELECT clave, valor FROM configuracion WHERE clave IN ('horas_objetivo_semana','horas_objetivo_mes')"
  );
  const config = Object.fromEntries(cfg.map(r => [r.clave, parseFloat(r.valor)]));
  const semana = config.horas_objetivo_semana || 40;
  const mes = config.horas_objetivo_mes || Math.round(semana * 52 / 12 * 100) / 100;
  return { horas_semana: semana, horas_mes: mes };
}

async function calcularBalancePeriodo(empleadoId, fechaInicio, fechaFin) {
  const { rows: fichajes } = await pool.query(
    `SELECT tipo, timestamp, es_descanso, notas FROM fichajes
     WHERE empleado_id = $1
       AND ${FECHA_LOCAL_SQL} >= $2::date
       AND ${FECHA_LOCAL_SQL} <= $3::date
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

function semanasEnPeriodo(fechaInicio, fechaFin) {
  const semanas = [];
  const inicioStr = toDateStr(fechaInicio);
  const finStr = toDateStr(fechaFin);
  const inicio = new Date(inicioStr + 'T12:00:00');
  const fin = new Date(finStr + 'T12:00:00');
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

function ultimoDomingoCerradoStr(fechaRef = new Date()) {
  const diaSemana = fechaRef.getDay();
  const diasAtras = diaSemana === 0 ? 7 : diaSemana;
  const ultimoDomingo = new Date(fechaRef);
  ultimoDomingo.setDate(fechaRef.getDate() - diasAtras);
  return ultimoDomingo.toISOString().split('T')[0];
}

async function calcularSaldoSemanalAcum(empleadoId, fechaAlta, objetivoSemanal) {
  const ultimoDomingoStr = ultimoDomingoCerradoStr();

  const ajustesTotal = await pool.query(
    'SELECT COALESCE(SUM(cantidad_horas), 0) AS total FROM ajustes_horas WHERE empleado_id = $1',
    [empleadoId]
  );
  const totalAjustes = parseFloat(ajustesTotal.rows[0].total) || 0;

  const fechaAltaStr = toDateStr(fechaAlta);
  if (!fechaAltaStr || fechaAltaStr > ultimoDomingoStr) {
    return Math.round(totalAjustes * 100) / 100;
  }

  const semanas = semanasEnPeriodo(fechaAltaStr, ultimoDomingoStr)
    .filter(s => s.domingo <= ultimoDomingoStr);

  let saldo = 0;
  for (const s of semanas) {
    const { horasTrabajadas } = await calcularBalancePeriodo(empleadoId, s.lunes, s.domingo);
    const objSemana = await calcularObjetivoRango(empleadoId, s.lunes, s.domingo);
    const objetivoEfectivo = objSemana !== null ? objSemana : objetivoSemanal;
    saldo += horasTrabajadas - objetivoEfectivo;
  }
  saldo += totalAjustes;
  return Math.round(saldo * 100) / 100;
}

/** Alias canónico del balance acumulado (modelo semanal). */
const calcularBalanceAcumulado = calcularSaldoSemanalAcum;

async function buildHistorialSemanal(empleadoId, fechaAlta, objetivoSemanal) {
  const ultimoDomingoStr = ultimoDomingoCerradoStr();
  const fechaAltaStr = toDateStr(fechaAlta);

  const { rows: ajustesTotalRow } = await pool.query(
    'SELECT COALESCE(SUM(cantidad_horas), 0) AS total FROM ajustes_horas WHERE empleado_id = $1',
    [empleadoId]
  );
  const totalAjustes = parseFloat(ajustesTotalRow[0].total) || 0;

  if (!fechaAltaStr || fechaAltaStr > ultimoDomingoStr) {
    return { historial: [], balanceAcumulado: Math.round(totalAjustes * 100) / 100, totalAjustes };
  }

  const semanas = semanasEnPeriodo(fechaAltaStr, ultimoDomingoStr)
    .filter(s => s.domingo <= ultimoDomingoStr);

  let saldoSemanas = 0;
  const historial = [];
  for (const s of semanas) {
    const { horasTrabajadas, horasAjuste } = await calcularBalancePeriodo(empleadoId, s.lunes, s.domingo);
    const objSemana = await calcularObjetivoRango(empleadoId, s.lunes, s.domingo);
    const objetivoEfectivo = objSemana !== null ? objSemana : objetivoSemanal;
    const diferencia = horasTrabajadas - objetivoEfectivo;
    saldoSemanas += diferencia;
    historial.push({
      lunes: s.lunes,
      domingo: s.domingo,
      trabajadas: Math.round(horasTrabajadas * 100) / 100,
      ajuste: horasAjuste,
      objetivo: Math.round(objetivoEfectivo * 100) / 100,
      diferencia: Math.round(diferencia * 100) / 100,
      balanceAcumulado: Math.round((saldoSemanas + totalAjustes) * 100) / 100
    });
  }

  return {
    historial: historial.reverse(),
    balanceAcumulado: Math.round((saldoSemanas + totalAjustes) * 100) / 100,
    totalAjustes
  };
}

module.exports = {
  FECHA_LOCAL_SQL,
  calcularHorasDeFichajes,
  toDateStr,
  calcularObjetivoMensPorHorario,
  calcularObjetivoRango,
  getObjetivoMes,
  getObjetivoEmpleado,
  calcularBalancePeriodo,
  mesesDesdeAlta,
  semanasEnPeriodo,
  ultimoDomingoCerradoStr,
  calcularSaldoSemanalAcum,
  calcularBalanceAcumulado,
  buildHistorialSemanal,
};
