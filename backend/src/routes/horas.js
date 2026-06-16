const express = require('express');
const { pool } = require('../db/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { syncAjusteToOdoo, deleteAjusteFromOdoo } = require('../sync/sync-ajustes');
const {
  FECHA_LOCAL_SQL,
  calcularHorasDeFichajes,
  calcularObjetivoRango,
  getObjetivoMes,
  getObjetivoEmpleado,
  calcularBalancePeriodo,
  semanasEnPeriodo,
  calcularSaldoSemanalAcum,
  calcularBalanceAcumulado,
  buildHistorialSemanal,
} = require('../lib/balance-horas');

const router = express.Router();

function triggerAjusteSync(ajusteId, deleted = false) {
  const fn = deleted ? deleteAjusteFromOdoo : syncAjusteToOdoo;
  fn(ajusteId).catch((err) => {
    console.error('[odoo-sync] ajuste', ajusteId, err.message);
  });
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

    const [semana, mes, objSemanaActual] = await Promise.all([
      calcularBalancePeriodo(empleadoId, semanaInicio, semanaFin),
      calcularBalancePeriodo(empleadoId, mesInicio, mesFin),
      calcularObjetivoRango(empleadoId, semanaInicio, semanaFin)
    ]);

    const objMesActual = await getObjetivoMes(empleadoId, hoy.getFullYear(), hoy.getMonth() + 1);
    const objetivoSemana = objSemanaActual !== null ? objSemanaActual : objetivo.horas_semana;

    const { rows: empRow } = await pool.query('SELECT fecha_alta FROM empleados WHERE id = $1', [empleadoId]);
    const balanceAcumulado = await calcularBalanceAcumulado(empleadoId, empRow[0].fecha_alta, objetivo.horas_semana);

    res.json({
      objetivo,
      semana: {
        inicio: semanaInicio, fin: semanaFin,
        trabajadas: Math.round(semana.horasTrabajadas * 100) / 100,
        ajuste: semana.horasAjuste,
        objetivo: Math.round(objetivoSemana * 100) / 100,
        diferencia: Math.round((semana.horasTrabajadas + semana.horasAjuste - objetivoSemana) * 100) / 100
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

// GET /api/horas/historial  — historial semanal del empleado (modelo canónico)
router.get('/historial', authMiddleware, async (req, res) => {
  try {
    const empleadoId = req.user.id;
    const objetivo = await getObjetivoEmpleado(empleadoId);
    const { rows: empRow } = await pool.query('SELECT fecha_alta FROM empleados WHERE id = $1', [empleadoId]);
    const { historial, balanceAcumulado } = await buildHistorialSemanal(
      empleadoId, empRow[0].fecha_alta, objetivo.horas_semana
    );

    res.json({ historial, objetivo, balanceAcumulado });
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
       WHERE empleado_id = $1 AND ${FECHA_LOCAL_SQL} >= $2::date AND ${FECHA_LOCAL_SQL} <= $3::date
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
    const { historial, balanceAcumulado } = await buildHistorialSemanal(id, emp.fecha_alta, objetivo.horas_semana);

    const { rows: ajustes } = await pool.query(
      `SELECT a.*, e.nombre AS admin_nombre, e.apellidos AS admin_apellidos
       FROM ajustes_horas a JOIN empleados e ON a.admin_id = e.id
       WHERE a.empleado_id = $1 ORDER BY a.fecha DESC`,
      [id]
    );

    res.json({
      empleado: emp, objetivo, historial, ajustes, balanceAcumulado
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
    triggerAjusteSync(rows[0].id);
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
    const ajusteId = req.params.id;
    await pool.query('DELETE FROM ajustes_horas WHERE id = $1', [ajusteId]);
    triggerAjusteSync(ajusteId, true);
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
           AND ${FECHA_LOCAL_SQL} >= $2::date
           AND ${FECHA_LOCAL_SQL} <= $3::date
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
