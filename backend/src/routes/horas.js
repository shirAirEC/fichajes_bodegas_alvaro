const express = require('express');
const { pool } = require('../db/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// ─── UTILIDADES ───────────────────────────────────────────────────────────────

function calcularHorasDeFichajes(fichajes) {
  let minutos = 0;
  let entrada = null;
  for (const f of fichajes) {
    if (f.tipo === 'entrada') {
      entrada = new Date(f.timestamp);
    } else if (f.tipo === 'salida' && entrada) {
      minutos += (new Date(f.timestamp) - entrada) / 60000;
      entrada = null;
    }
  }
  return Math.round(minutos) / 60;
}

async function getObjetivoEmpleado(empleadoId) {
  // Intenta primero objetivo personalizado del empleado
  const { rows: custom } = await pool.query(
    'SELECT horas_semana, horas_mes FROM horas_objetivo WHERE empleado_id = $1',
    [empleadoId]
  );
  if (custom[0]?.horas_semana != null) {
    return { horas_semana: custom[0].horas_semana, horas_mes: custom[0].horas_mes };
  }
  // Fallback a configuración global
  const { rows: cfg } = await pool.query(
    "SELECT clave, valor FROM configuracion WHERE clave IN ('horas_objetivo_semana','horas_objetivo_mes')"
  );
  const config = Object.fromEntries(cfg.map(r => [r.clave, parseFloat(r.valor)]));
  return {
    horas_semana: config.horas_objetivo_semana || 40,
    horas_mes: config.horas_objetivo_mes || 160
  };
}

async function calcularBalancePeriodo(empleadoId, fechaInicio, fechaFin) {
  const { rows: fichajes } = await pool.query(
    `SELECT tipo, timestamp FROM fichajes
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

    let balanceAcumulado = 0;
    for (const m of meses) {
      const { horasTrabajadas, horasAjuste } = await calcularBalancePeriodo(empleadoId, m.primerDia, m.ultimoDia);
      balanceAcumulado += horasTrabajadas + horasAjuste - objetivo.horas_mes;
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
        objetivo: objetivo.horas_mes,
        diferencia: Math.round((mes.horasTrabajadas + mes.horasAjuste - objetivo.horas_mes) * 100) / 100
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
      const diferencia = horasTrabajadas + horasAjuste - objetivo.horas_mes;
      balanceAcum += diferencia;
      historial.push({
        anio: m.anio, mes: m.mes,
        trabajadas: Math.round(horasTrabajadas * 100) / 100,
        ajuste: horasAjuste,
        objetivo: objetivo.horas_mes,
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
      `SELECT tipo, timestamp FROM fichajes
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
    const objetivoPeriodo = modo === 'semana' ? objetivo.horas_semana
      : modo === 'anio' ? objetivo.horas_semana * 52
      : objetivo.horas_semana * Math.ceil((new Date(fechaFin) - new Date(fechaInicio)) / (7 * 86400000));

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

// GET /api/horas/admin/todos  — resumen del mes actual para todos los empleados
router.get('/admin/todos', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const hoy = new Date();
    const mesInicio = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-01`;
    const mesFin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().split('T')[0];

    const { rows: empleados } = await pool.query(
      "SELECT id, nombre, apellidos, departamento, fecha_alta FROM empleados WHERE activo = 1 AND rol = 'empleado' ORDER BY apellidos"
    );

    const resumen = await Promise.all(empleados.map(async emp => {
      const objetivo = await getObjetivoEmpleado(emp.id);
      const { horasTrabajadas, horasAjuste } = await calcularBalancePeriodo(emp.id, mesInicio, mesFin);

      // Balance acumulado
      const meses = mesesDesdeAlta(emp.fecha_alta);
      let balanceAcum = 0;
      for (const m of meses) {
        const { horasTrabajadas: ht, horasAjuste: ha } = await calcularBalancePeriodo(emp.id, m.primerDia, m.ultimoDia);
        balanceAcum += ht + ha - objetivo.horas_mes;
      }

      return {
        id: emp.id, nombre: emp.nombre, apellidos: emp.apellidos, departamento: emp.departamento,
        objetivo,
        mes: {
          trabajadas: Math.round(horasTrabajadas * 100) / 100,
          ajuste: horasAjuste,
          objetivo: objetivo.horas_mes,
          diferencia: Math.round((horasTrabajadas + horasAjuste - objetivo.horas_mes) * 100) / 100
        },
        balanceAcumulado: Math.round(balanceAcum * 100) / 100
      };
    }));

    res.json(resumen);
  } catch (err) {
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
      const diferencia = horasTrabajadas + horasAjuste - objetivo.horas_mes;
      balanceAcum += diferencia;
      historial.push({
        anio: m.anio, mes: m.mes,
        trabajadas: Math.round(horasTrabajadas * 100) / 100,
        ajuste: horasAjuste,
        objetivo: objetivo.horas_mes,
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

module.exports = router;
