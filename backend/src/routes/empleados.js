const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

// GET /api/empleados — lista todos los empleados (solo admin)
router.get('/', authMiddleware, adminMiddleware, (req, res) => {
  const empleados = db.prepare(`
    SELECT id, nombre, apellidos, email, rol, departamento, activo, fecha_alta
    FROM empleados ORDER BY apellidos, nombre
  `).all();
  res.json(empleados);
});

// POST /api/empleados — crear empleado (solo admin)
router.post('/', authMiddleware, adminMiddleware, (req, res) => {
  const { nombre, apellidos, email, password, rol = 'empleado', departamento = '' } = req.body;

  if (!nombre || !apellidos || !email || !password) {
    return res.status(400).json({ error: 'Nombre, apellidos, email y contraseña son obligatorios' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }

  const existe = db.prepare('SELECT id FROM empleados WHERE email = ?').get(email.toLowerCase().trim());
  if (existe) {
    return res.status(409).json({ error: 'Ya existe un empleado con ese email' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare(`
    INSERT INTO empleados (nombre, apellidos, email, password, rol, departamento)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(nombre.trim(), apellidos.trim(), email.toLowerCase().trim(), hash, rol, departamento.trim());

  const empleado = db.prepare('SELECT id, nombre, apellidos, email, rol, departamento, activo FROM empleados WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(empleado);
});

// PUT /api/empleados/:id — actualizar empleado (solo admin)
router.put('/:id', authMiddleware, adminMiddleware, (req, res) => {
  const { id } = req.params;
  const { nombre, apellidos, email, rol, departamento, activo, password } = req.body;

  const empleado = db.prepare('SELECT * FROM empleados WHERE id = ?').get(id);
  if (!empleado) return res.status(404).json({ error: 'Empleado no encontrado' });

  // Evitar que el admin se elimine a sí mismo
  if (parseInt(id) === req.user.id && activo === 0) {
    return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
  }

  let campos = [];
  let valores = [];

  if (nombre !== undefined) { campos.push('nombre = ?'); valores.push(nombre.trim()); }
  if (apellidos !== undefined) { campos.push('apellidos = ?'); valores.push(apellidos.trim()); }
  if (email !== undefined) { campos.push('email = ?'); valores.push(email.toLowerCase().trim()); }
  if (rol !== undefined) { campos.push('rol = ?'); valores.push(rol); }
  if (departamento !== undefined) { campos.push('departamento = ?'); valores.push(departamento.trim()); }
  if (activo !== undefined) { campos.push('activo = ?'); valores.push(activo ? 1 : 0); }
  if (password) {
    if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    campos.push('password = ?');
    valores.push(bcrypt.hashSync(password, 10));
  }

  if (campos.length === 0) return res.status(400).json({ error: 'No hay campos para actualizar' });

  valores.push(id);
  db.prepare(`UPDATE empleados SET ${campos.join(', ')} WHERE id = ?`).run(...valores);

  const actualizado = db.prepare('SELECT id, nombre, apellidos, email, rol, departamento, activo FROM empleados WHERE id = ?').get(id);
  res.json(actualizado);
});

// DELETE /api/empleados/:id — desactivar empleado (soft delete, solo admin)
router.delete('/:id', authMiddleware, adminMiddleware, (req, res) => {
  const { id } = req.params;
  if (parseInt(id) === req.user.id) {
    return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
  }
  const empleado = db.prepare('SELECT * FROM empleados WHERE id = ?').get(id);
  if (!empleado) return res.status(404).json({ error: 'Empleado no encontrado' });

  db.prepare('UPDATE empleados SET activo = 0 WHERE id = ?').run(id);
  res.json({ message: 'Empleado desactivado correctamente' });
});

module.exports = router;
