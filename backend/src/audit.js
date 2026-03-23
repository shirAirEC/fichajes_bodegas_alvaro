const { pool } = require('./db/database');

function getIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  return forwarded ? forwarded.split(',')[0].trim() : req.socket?.remoteAddress || '';
}

/**
 * Registra una acción en el log de auditoría.
 * @param {object} req         - Request Express (para extraer usuario e IP)
 * @param {string} accion      - Ej: 'crear_fichaje', 'editar_fichaje', 'eliminar_fichaje', 'editar_empleado'
 * @param {string} entidadTipo - Ej: 'fichaje', 'empleado'
 * @param {number} entidadId   - ID del registro afectado
 * @param {string} detalle     - Descripción legible del cambio
 */
async function registrarAudit(req, accion, entidadTipo, entidadId, detalle) {
  try {
    const usuarioId = req.user?.id || null;
    const usuarioNombre = req.user
      ? `${req.user.nombre} ${req.user.apellidos}`
      : 'Sistema';
    await pool.query(
      `INSERT INTO audit_log (usuario_id, usuario_nombre, accion, entidad_tipo, entidad_id, detalle, ip)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [usuarioId, usuarioNombre, accion, entidadTipo, entidadId, detalle, getIP(req)]
    );
  } catch (err) {
    // El fallo en auditoría nunca debe romper la operación principal
    console.error('audit_log error:', err.message);
  }
}

module.exports = { registrarAudit };
