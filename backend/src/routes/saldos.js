const express = require('express');
const db = require('../db/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

const TIPOS_SALDO = ['vacaciones', 'horas_extra', 'permiso_especial', 'baja_medica'];

// GET /api/saldos/mio — saldo del empleado autenticado
router.get('/mio', authMiddleware, (req, res) => {
  const movimientos = db.prepare(`
    SELECT s.*, e.nombre as admin_nombre, e.apellidos as admin_apellidos
    FROM saldos s
    JOIN empleados e ON s.admin_id = e.id
    WHERE s.empleado_id = ?
    ORDER BY s.created_at DESC
  `).all(req.user.id);

  const resumen = calcularResumen(movimientos);
  res.json({ movimientos, resumen });
});

// GET /api/saldos/empleado/:id — saldo de un empleado (solo admin)
router.get('/empleado/:id', authMiddleware, adminMiddleware, (req, res) => {
  const { id } = req.params;
  const emp = db.prepare('SELECT id, nombre, apellidos FROM empleados WHERE id = ?').get(id);
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado' });

  const movimientos = db.prepare(`
    SELECT s.*, e.nombre as admin_nombre, e.apellidos as admin_apellidos
    FROM saldos s
    JOIN empleados e ON s.admin_id = e.id
    WHERE s.empleado_id = ?
    ORDER BY s.created_at DESC
  `).all(id);

  const resumen = calcularResumen(movimientos);
  res.json({ empleado: emp, movimientos, resumen });
});

// GET /api/saldos/resumen-todos — resumen de saldos de todos los empleados (solo admin)
router.get('/resumen-todos', authMiddleware, adminMiddleware, (req, res) => {
  const empleados = db.prepare('SELECT id, nombre, apellidos, departamento FROM empleados WHERE activo = 1 ORDER BY apellidos').all();

  const resultado = empleados.map(emp => {
    const movimientos = db.prepare('SELECT tipo, cantidad FROM saldos WHERE empleado_id = ?').all(emp.id);
    return { ...emp, resumen: calcularResumen(movimientos) };
  });

  res.json(resultado);
});

// POST /api/saldos — crear movimiento de saldo (solo admin)
router.post('/', authMiddleware, adminMiddleware, (req, res) => {
  const { empleado_id, tipo, cantidad, concepto, fecha_referencia } = req.body;

  if (!empleado_id || !tipo || cantidad == null || !concepto) {
    return res.status(400).json({ error: 'empleado_id, tipo, cantidad y concepto son obligatorios' });
  }

  if (!TIPOS_SALDO.includes(tipo)) {
    return res.status(400).json({ error: `Tipo inválido. Permitidos: ${TIPOS_SALDO.join(', ')}` });
  }

  if (typeof cantidad !== 'number' || isNaN(cantidad) || cantidad === 0) {
    return res.status(400).json({ error: 'La cantidad debe ser un número distinto de 0' });
  }

  const emp = db.prepare('SELECT id FROM empleados WHERE id = ? AND activo = 1').get(empleado_id);
  if (!emp) return res.status(404).json({ error: 'Empleado no encontrado o inactivo' });

  const result = db.prepare(`
    INSERT INTO saldos (empleado_id, tipo, cantidad, concepto, admin_id, fecha_referencia)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(empleado_id, tipo, cantidad, concepto.trim(), req.user.id, fecha_referencia || null);

  const saldo = db.prepare(`
    SELECT s.*, e.nombre as admin_nombre, e.apellidos as admin_apellidos
    FROM saldos s JOIN empleados e ON s.admin_id = e.id
    WHERE s.id = ?
  `).get(result.lastInsertRowid);

  res.status(201).json(saldo);
});

// DELETE /api/saldos/:id — eliminar movimiento (solo admin)
router.delete('/:id', authMiddleware, adminMiddleware, (req, res) => {
  const { id } = req.params;
  const saldo = db.prepare('SELECT * FROM saldos WHERE id = ?').get(id);
  if (!saldo) return res.status(404).json({ error: 'Movimiento no encontrado' });

  db.prepare('DELETE FROM saldos WHERE id = ?').run(id);
  res.json({ message: 'Movimiento eliminado' });
});

function calcularResumen(movimientos) {
  const resumen = {
    vacaciones: 0,
    horas_extra: 0,
    permiso_especial: 0,
    baja_medica: 0
  };
  for (const m of movimientos) {
    if (resumen[m.tipo] !== undefined) {
      resumen[m.tipo] += m.cantidad;
    }
  }
  // Redondear a 2 decimales
  for (const k of Object.keys(resumen)) {
    resumen[k] = Math.round(resumen[k] * 100) / 100;
  }
  return resumen;
}

module.exports = router;
