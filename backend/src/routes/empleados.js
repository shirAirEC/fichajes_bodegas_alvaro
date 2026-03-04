const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../db/database');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

const router = express.Router();

router.get('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nombre, apellidos, email, rol, departamento, activo, sin_restriccion_ip, descanso_activo, descanso_minutos, fecha_alta FROM empleados ORDER BY apellidos, nombre'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

async function passwordYaExiste(password, excluirId = null) {
  const { rows } = await pool.query(
    `SELECT id, password FROM empleados WHERE activo = 1${excluirId ? ' AND id != $1' : ''}`,
    excluirId ? [excluirId] : []
  );
  for (const emp of rows) {
    if (bcrypt.compareSync(password, emp.password)) return true;
  }
  return false;
}

router.post('/', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { nombre, apellidos, email, password, rol = 'empleado', departamento = '' } = req.body;
    if (!nombre || !apellidos || !email || !password) {
      return res.status(400).json({ error: 'Nombre, apellidos, email y contraseña son obligatorios' });
    }
    if (!password) {
      return res.status(400).json({ error: 'La contraseña es obligatoria' });
    }

    const { rows: existe } = await pool.query(
      'SELECT id FROM empleados WHERE email = $1', [email.toLowerCase().trim()]
    );
    if (existe[0]) return res.status(409).json({ error: 'Ya existe un empleado con ese email' });

    if (await passwordYaExiste(password)) {
      return res.status(409).json({ error: 'Esa contraseña ya está en uso por otro empleado. Cada empleado debe tener una contraseña única.' });
    }

    const { rows } = await pool.query(
      `INSERT INTO empleados (nombre, apellidos, email, password, rol, departamento)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, nombre, apellidos, email, rol, departamento, activo, sin_restriccion_ip`,
      [nombre.trim(), apellidos.trim(), email.toLowerCase().trim(), bcrypt.hashSync(password, 10), rol, departamento.trim()]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.put('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, apellidos, email, rol, departamento, activo, password, sin_restriccion_ip, descanso_activo, descanso_minutos } = req.body;

    const { rows: emp } = await pool.query('SELECT * FROM empleados WHERE id = $1', [id]);
    if (!emp[0]) return res.status(404).json({ error: 'Empleado no encontrado' });
    if (parseInt(id) === req.user.id && activo === 0) {
      return res.status(400).json({ error: 'No puedes desactivar tu propia cuenta' });
    }

    const campos = [];
    const valores = [];
    let idx = 1;

    if (nombre !== undefined)      { campos.push(`nombre = $${idx++}`);      valores.push(nombre.trim()); }
    if (apellidos !== undefined)   { campos.push(`apellidos = $${idx++}`);   valores.push(apellidos.trim()); }
    if (email !== undefined)       { campos.push(`email = $${idx++}`);       valores.push(email.toLowerCase().trim()); }
    if (rol !== undefined)         { campos.push(`rol = $${idx++}`);         valores.push(rol); }
    if (departamento !== undefined){ campos.push(`departamento = $${idx++}`);valores.push(departamento.trim()); }
    if (activo !== undefined)           { campos.push(`activo = $${idx++}`);              valores.push(activo ? 1 : 0); }
    if (sin_restriccion_ip !== undefined){ campos.push(`sin_restriccion_ip = $${idx++}`); valores.push(sin_restriccion_ip ? 1 : 0); }
    if (descanso_activo !== undefined)   { campos.push(`descanso_activo = $${idx++}`);    valores.push(descanso_activo); }
    if (descanso_minutos !== undefined)  { campos.push(`descanso_minutos = $${idx++}`);   valores.push(descanso_minutos); }
    if (password) {
      if (!password) return res.status(400).json({ error: 'La contraseña no puede estar vacía' });
      if (await passwordYaExiste(password, id)) {
        return res.status(409).json({ error: 'Esa contraseña ya está en uso por otro empleado. Cada empleado debe tener una contraseña única.' });
      }
      campos.push(`password = $${idx++}`);
      valores.push(bcrypt.hashSync(password, 10));
    }

    if (campos.length === 0) return res.status(400).json({ error: 'No hay campos para actualizar' });

    valores.push(id);
    const { rows } = await pool.query(
      `UPDATE empleados SET ${campos.join(', ')} WHERE id = $${idx}
       RETURNING id, nombre, apellidos, email, rol, departamento, activo, sin_restriccion_ip, descanso_activo, descanso_minutos`,
      valores
    );
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.delete('/:id', authMiddleware, adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta' });
    }
    const { rows } = await pool.query('SELECT id FROM empleados WHERE id = $1', [id]);
    if (!rows[0]) return res.status(404).json({ error: 'Empleado no encontrado' });
    await pool.query('UPDATE empleados SET activo = 0 WHERE id = $1', [id]);
    res.json({ message: 'Empleado desactivado correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
