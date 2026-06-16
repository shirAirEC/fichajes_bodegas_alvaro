/** SSO Odoo → Fichajes admin. Ver tpv_bodegas_odoo/.../scripts/FICHAJES_SSO.md */
const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { pool } = require('../db/database');
const { JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

const SSO_SCOPE = 'fichajes_admin_sso';
const MAX_SKEW_SECONDS = 10;

function getSsoSecret() {
  const secret = process.env.ODOO_SSO_SECRET;
  if (!secret) {
    throw new Error('ODOO_SSO_SECRET no configurada');
  }
  return secret;
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

function verifySignedToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) {
    throw new Error('Formato de token invalido');
  }
  const [payloadB64, sigB64] = parts;
  const payloadBytes = b64urlDecode(payloadB64);
  const secret = getSsoSecret();
  const expected = crypto.createHmac('sha256', secret).update(payloadBytes).digest();
  const provided = b64urlDecode(sigB64);
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    throw new Error('Firma invalida');
  }
  const payload = JSON.parse(payloadBytes.toString('utf8'));
  const now = Math.floor(Date.now() / 1000);
  if (payload.scope !== SSO_SCOPE) {
    throw new Error('Scope invalido');
  }
  if (!payload.exp || payload.exp < now - MAX_SKEW_SECONDS) {
    throw new Error('Token expirado');
  }
  if (payload.exp > now + 120) {
    throw new Error('Token exp demasiado lejano');
  }
  if (!payload.nonce || !payload.email) {
    throw new Error('Payload incompleto');
  }
  return payload;
}

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return forwarded ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress || '';
}

async function consumeNonce(nonce) {
  const { rowCount } = await pool.query(
    `INSERT INTO sso_nonces (nonce, used_at) VALUES ($1, NOW())
     ON CONFLICT (nonce) DO NOTHING`,
    [nonce]
  );
  if (rowCount === 0) {
    throw new Error('Nonce ya utilizado');
  }
}

async function resolveAdminEmpleado(email) {
  const { rows } = await pool.query(
    `SELECT id, nombre, apellidos, email, rol, departamento, solo_planificacion
     FROM empleados
     WHERE LOWER(email) = LOWER($1) AND rol = 'admin' AND activo = 1
     LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

function frontendUrl() {
  const url = process.env.FRONTEND_URL || process.env.FICHAJES_ADMIN_URL;
  if (!url) {
    throw new Error('FRONTEND_URL no configurada');
  }
  return url.replace(/\/$/, '');
}

// GET /api/auth/odoo-sso?token=...
router.get('/odoo-sso', async (req, res) => {
  try {
    const payload = verifySignedToken(req.query.token);
    await consumeNonce(payload.nonce);

    const empleado = await resolveAdminEmpleado(payload.email);
    if (!empleado) {
      return res.status(403).json({
        error: 'No hay cuenta admin Fichajes vinculada a este email Odoo.',
      });
    }

    const fichajesJwt = jwt.sign(
      {
        id: empleado.id,
        email: empleado.email,
        nombre: empleado.nombre,
        apellidos: empleado.apellidos,
        rol: empleado.rol,
        departamento: empleado.departamento,
        solo_planificacion: empleado.solo_planificacion,
        sso: true,
        odoo_uid: payload.uid,
      },
      JWT_SECRET,
      { expiresIn: '12h' }
    );

    await pool.query(
      `INSERT INTO audit_log (usuario_id, usuario_nombre, accion, entidad_tipo, entidad_id, detalle, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        empleado.id,
        `${empleado.nombre} ${empleado.apellidos}`,
        'odoo_sso_login',
        'empleado',
        empleado.id,
        `Odoo uid=${payload.uid} email=${payload.email}`,
        clientIp(req),
      ]
    );

    const redirect = `${frontendUrl()}/admin/sso-callback#token=${encodeURIComponent(fichajesJwt)}`;
    return res.redirect(302, redirect);
  } catch (err) {
    console.error('[odoo-sso]', err.message);
    return res.status(401).json({ error: 'SSO invalido o expirado' });
  }
});

module.exports = router;
