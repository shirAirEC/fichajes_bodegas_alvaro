const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/database');
const { authMiddleware, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email y contraseña son requeridos' });
  }

  const empleado = db.prepare('SELECT * FROM empleados WHERE email = ? AND activo = 1').get(email.toLowerCase().trim());

  if (!empleado) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  const passwordValido = bcrypt.compareSync(password, empleado.password);
  if (!passwordValido) {
    return res.status(401).json({ error: 'Credenciales incorrectas' });
  }

  const token = jwt.sign(
    {
      id: empleado.id,
      email: empleado.email,
      nombre: empleado.nombre,
      apellidos: empleado.apellidos,
      rol: empleado.rol,
      departamento: empleado.departamento
    },
    JWT_SECRET,
    { expiresIn: '12h' }
  );

  res.json({
    token,
    empleado: {
      id: empleado.id,
      nombre: empleado.nombre,
      apellidos: empleado.apellidos,
      email: empleado.email,
      rol: empleado.rol,
      departamento: empleado.departamento
    }
  });
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  const empleado = db.prepare('SELECT id, nombre, apellidos, email, rol, departamento FROM empleados WHERE id = ?').get(req.user.id);
  if (!empleado) return res.status(404).json({ error: 'Empleado no encontrado' });
  res.json(empleado);
});

// PUT /api/auth/cambiar-password
router.put('/cambiar-password', authMiddleware, (req, res) => {
  const { passwordActual, passwordNuevo } = req.body;

  if (!passwordActual || !passwordNuevo) {
    return res.status(400).json({ error: 'Se requieren ambas contraseñas' });
  }

  if (passwordNuevo.length < 6) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 6 caracteres' });
  }

  const empleado = db.prepare('SELECT * FROM empleados WHERE id = ?').get(req.user.id);
  const valido = bcrypt.compareSync(passwordActual, empleado.password);

  if (!valido) {
    return res.status(401).json({ error: 'Contraseña actual incorrecta' });
  }

  const nuevoHash = bcrypt.hashSync(passwordNuevo, 10);
  db.prepare('UPDATE empleados SET password = ? WHERE id = ?').run(nuevoHash, req.user.id);

  res.json({ message: 'Contraseña actualizada correctamente' });
});

module.exports = router;
