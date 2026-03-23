const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/database');
const { authMiddleware, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Contraseña requerida' });
    }

    let empleado = null;

    if (email) {
      // Login de admin con email + contraseña
      const { rows } = await pool.query(
        'SELECT * FROM empleados WHERE email = $1 AND activo = 1',
        [email.toLowerCase().trim()]
      );
      if (rows[0] && bcrypt.compareSync(password, rows[0].password)) {
        empleado = rows[0];
      }
    } else {
      // Login de empleado solo con contraseña (busca en todos los activos)
      const { rows } = await pool.query(
        "SELECT * FROM empleados WHERE activo = 1 AND rol = 'empleado'"
      );
      for (const row of rows) {
        if (bcrypt.compareSync(password, row.password)) {
          empleado = row;
          break;
        }
      }
    }

    if (!empleado) {
      return res.status(401).json({ error: 'Contraseña incorrecta' });
    }

    const token = jwt.sign(
      { id: empleado.id, email: empleado.email, nombre: empleado.nombre,
        apellidos: empleado.apellidos, rol: empleado.rol, departamento: empleado.departamento,
        solo_planificacion: empleado.solo_planificacion },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      token,
      empleado: { id: empleado.id, nombre: empleado.nombre, apellidos: empleado.apellidos,
        email: empleado.email, rol: empleado.rol, departamento: empleado.departamento,
        solo_planificacion: empleado.solo_planificacion }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.get('/me', authMiddleware, async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, nombre, apellidos, email, rol, departamento, solo_planificacion FROM empleados WHERE id = $1',
      [req.user.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Empleado no encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

router.put('/cambiar-password', authMiddleware, async (req, res) => {
  try {
    const { passwordActual, passwordNuevo } = req.body;
    if (!passwordActual || !passwordNuevo) {
      return res.status(400).json({ error: 'Se requieren ambas contraseñas' });
    }
    if (!passwordNuevo) {
      return res.status(400).json({ error: 'La nueva contraseña no puede estar vacía' });
    }

    const { rows } = await pool.query('SELECT * FROM empleados WHERE id = $1', [req.user.id]);
    if (!bcrypt.compareSync(passwordActual, rows[0].password)) {
      return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    }

    await pool.query(
      'UPDATE empleados SET password = $1 WHERE id = $2',
      [bcrypt.hashSync(passwordNuevo, 10), req.user.id]
    );
    res.json({ message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

// POST /api/auth/solicitar-baja — solicitud pública de eliminación de cuenta (RGPD)
router.post('/solicitar-baja', async (req, res) => {
  try {
    const { nombre, apellidos, motivo = '' } = req.body;
    if (!nombre || !apellidos) {
      return res.status(400).json({ error: 'Nombre y apellidos son obligatorios' });
    }

    // Guardar la solicitud como notificación interna para los administradores
    const texto = `Solicitud de eliminación de cuenta (RGPD): ${nombre} ${apellidos}${motivo ? ` — Motivo: ${motivo}` : ''}`;
    const { rows: admins } = await pool.query(
      `SELECT id FROM empleados WHERE rol = 'admin'`
    );
    for (const admin of admins) {
      await pool.query(
        `INSERT INTO notificaciones (empleado_id, mensaje, visto, created_at)
         VALUES ($1, $2, false, NOW())`,
        [admin.id, texto]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('solicitar-baja error:', err);
    res.status(500).json({ error: 'Error interno del servidor' });
  }
});

module.exports = router;
