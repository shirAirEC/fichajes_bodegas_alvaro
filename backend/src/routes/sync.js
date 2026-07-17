const express = require('express');
const { odooSyncAuth } = require('../middleware/odooSyncAuth');
const { upsertEmpleadoFromOdoo, syncAllEmpleados } = require('../sync/sync-empleado');
const {
  syncAllAsistencias,
  syncAsistenciaAfterFichaje,
  upsertAsistenciaFromOdoo,
} = require('../sync/sync-asistencia');
const {
  syncAllVacaciones,
  syncVacacionToOdoo,
  deleteVacacionFromOdoo,
  upsertVacacionFromOdoo,
} = require('../sync/sync-vacaciones');
const {
  syncAllSaldos,
  syncSaldoToOdoo,
  deleteSaldoFromOdoo,
  upsertSaldoFromOdoo,
} = require('../sync/sync-saldos');
const { syncAllHorarios, syncHorarioToOdoo, deleteHorarioFromOdoo } = require('../sync/sync-horarios');
const { syncAllReservas, syncReservaToOdoo, deleteReservaFromOdoo } = require('../sync/sync-reservas');
const { syncAllAjustes, syncAjusteToOdoo, deleteAjusteFromOdoo } = require('../sync/sync-ajustes');
const odoo = require('../sync/odoo-client');

const router = express.Router();

router.get('/health', async (req, res) => {
  let odooAuth = false;
  if (odoo.isConfigured()) {
    try {
      await odoo.search('hr.employee', [], { limit: 1 });
      odooAuth = true;
    } catch (err) {
      odooAuth = false;
    }
  }
  res.json({
    status: 'ok',
    odooConfigured: odoo.isConfigured(),
    odooAuthenticated: odooAuth,
    syncKeyConfigured: Boolean(process.env.ODOO_SYNC_API_KEY),
    models: {
      hr_attendance: odoo.isConfigured() ? await odoo.isModelAvailable('hr.attendance') : false,
      hr_leave: odoo.isConfigured() ? await odoo.isModelAvailable('hr.leave') : false,
      bodegas_horario: odoo.isConfigured()
        ? await odoo.isModelAvailable('bodegas.fichajes.horario')
        : false,
      calendar_event: odoo.isConfigured()
        ? await odoo.isModelAvailable('calendar.event')
        : false,
      hr_attendance_overtime: odoo.isConfigured()
        ? await odoo.isModelAvailable('hr.attendance.overtime')
        : false,
      resource_calendar: odoo.isConfigured()
        ? await odoo.isModelAvailable('resource.calendar')
        : false,
    },
    timestamp: new Date().toISOString(),
  });
});

router.get('/planificacion/health', async (req, res) => {
  res.redirect(307, '/api/sync/health');
});

router.post('/empleados', odooSyncAuth, async (req, res) => {
  try {
    // { sync_all: true } → empuja todos los empleados Fichajes → Odoo
    if (req.body && req.body.sync_all) {
      const result = await syncAllEmpleados(req.body);
      return res.json(result);
    }
    const result = await upsertEmpleadoFromOdoo(req.body);
    res.json(result);
  } catch (err) {
    console.error('[odoo-sync] upsert empleado:', err.message);
    res.status(400).json({ error: err.message || 'Error al sincronizar empleado' });
  }
});

router.post('/asistencias', odooSyncAuth, async (req, res) => {
  try {
    const body = req.body || {};
    // Inbound Odoo → Fichajes (tiempo real)
    if (body.odoo_attendance_id || body.from_odoo) {
      const result = await upsertAsistenciaFromOdoo(body);
      return res.json(result);
    }
    const { fichaje_id: fichajeId, empleado_id: empleadoId, desde, hasta } = body;
    if (fichajeId) {
      const result = await syncAsistenciaAfterFichaje(fichajeId);
      return res.json(result || { skipped: true });
    }
    const result = await syncAllAsistencias({ empleadoId, desde, hasta });
    res.json(result);
  } catch (err) {
    console.error('[odoo-sync] asistencias:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/vacaciones', odooSyncAuth, async (req, res) => {
  try {
    const body = req.body || {};
    // Inbound Odoo → Fichajes (tiempo real)
    if (body.odoo_leave_id || (body.from_odoo && !body.odoo_allocation_id)) {
      const result = await upsertVacacionFromOdoo(body);
      return res.json(result);
    }
    const { vacacion_id: vacacionId, deleted } = body;
    if (deleted && vacacionId) {
      const result = await deleteVacacionFromOdoo(vacacionId);
      return res.json(result || { skipped: true });
    }
    if (vacacionId) {
      const result = await syncVacacionToOdoo(vacacionId);
      return res.json(result || { skipped: true });
    }
    const result = await syncAllVacaciones(body);
    res.json(result);
  } catch (err) {
    console.error('[odoo-sync] vacaciones:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/saldos', odooSyncAuth, async (req, res) => {
  try {
    const body = req.body || {};
    if (body.odoo_allocation_id || (body.from_odoo && body.number_of_days != null)) {
      const result = await upsertSaldoFromOdoo(body);
      return res.json(result);
    }
    const { saldo_id: saldoId, deleted, sync_all: syncAll } = body;
    if (deleted && saldoId) {
      const result = await deleteSaldoFromOdoo(saldoId);
      return res.json(result || { skipped: true });
    }
    if (saldoId) {
      const result = await syncSaldoToOdoo(saldoId);
      return res.json(result || { skipped: true });
    }
    if (syncAll || Object.keys(body).length === 0) {
      const result = await syncAllSaldos(body);
      return res.json(result);
    }
    res.status(400).json({ error: 'Indica saldo_id, sync_all o payload Odoo' });
  } catch (err) {
    console.error('[odoo-sync] saldos:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/reservas', odooSyncAuth, async (req, res) => {
  try {
    const { reserva_id: reservaId, deleted } = req.body || {};
    if (deleted && reservaId) {
      const result = await deleteReservaFromOdoo(reservaId);
      return res.json(result || { skipped: true });
    }
    if (reservaId) {
      const result = await syncReservaToOdoo(reservaId);
      return res.json(result || { skipped: true });
    }
    const result = await syncAllReservas(req.body || {});
    res.json(result);
  } catch (err) {
    console.error('[odoo-sync] reservas:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/horarios', odooSyncAuth, async (req, res) => {
  try {
    const { horario_id: horarioId, deleted } = req.body || {};
    if (deleted && horarioId) {
      const result = await deleteHorarioFromOdoo(horarioId);
      return res.json(result || { skipped: true });
    }
    if (horarioId) {
      const result = await syncHorarioToOdoo(horarioId);
      return res.json(result || { skipped: true });
    }
    const result = await syncAllHorarios(req.body || {});
    res.json(result);
  } catch (err) {
    console.error('[odoo-sync] horarios:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/ajustes', odooSyncAuth, async (req, res) => {
  try {
    const { ajuste_id: ajusteId, deleted } = req.body || {};
    if (deleted && ajusteId) {
      const result = await deleteAjusteFromOdoo(ajusteId);
      return res.json(result || { skipped: true });
    }
    if (ajusteId) {
      const result = await syncAjusteToOdoo(ajusteId);
      return res.json(result || { skipped: true });
    }
    const result = await syncAllAjustes(req.body || {});
    res.json(result);
  } catch (err) {
    console.error('[odoo-sync] ajustes:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/planificacion', odooSyncAuth, async (req, res) => {
  try {
    const options = req.body || {};
    const empleados = await syncAllEmpleados(options);
    const [asistencias, vacaciones, saldos, horarios, ajustes, reservas] = await Promise.all([
      syncAllAsistencias(options),
      syncAllVacaciones(options),
      syncAllSaldos(options),
      syncAllHorarios(options),
      syncAllAjustes(options),
      syncAllReservas(options),
    ]);
    res.json({ empleados, asistencias, vacaciones, saldos, horarios, ajustes, reservas });
  } catch (err) {
    console.error('[odoo-sync] planificacion batch:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
